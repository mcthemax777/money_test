/**
 * 보안 정책(CSP) 위반 알림을 받는다 (next.config.js 의 기록만 하는 정책).
 *
 * 브라우저가 허용 목록 밖의 출처를 쓰려 할 때 여기로 보낸다. 웹 서버 로그(pm2)에 남겨, 며칠 모은 뒤
 * 빠진 곳을 채우고 목록을 막는 정책으로 옮긴다. 같은 위반은 서버가 뜬 동안 한 번만 적는다 -- 광고가
 * 뜰 때마다 같은 줄이 쏟아지면 로그를 읽을 수 없다. 사용자 정보는 받지도 적지도 않는다(지시어와 출처만).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** 이미 적은 위반. 너무 많아지면 더 적지 않는다 (공격으로 로그를 채우지 못하게). */
const seen = new Set<string>();
const SEEN_LIMIT = 500;

/** 출처만 남긴다. 경로·검색어에 사용자 값이 실릴 수 있다. */
function originOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (!value.includes('://')) return value.slice(0, 40); // 'inline', 'eval', 'data' 따위
  try {
    return new URL(value).origin;
  } catch {
    return value.slice(0, 40);
  }
}

export async function POST(request: Request) {
  try {
    const text = (await request.text()).slice(0, 10_000);
    const body = JSON.parse(text) as Record<string, unknown>;
    // 옛 형식({"csp-report": {...}})과 새 형식(Reporting API 의 배열) 둘 다 받는다.
    const reports = Array.isArray(body) ? body.map((item) => item?.body ?? {}) : [body['csp-report'] ?? {}];
    for (const report of reports as Record<string, unknown>[]) {
      const directive = String(report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'] ?? '');
      const blocked = originOf(report['blocked-uri'] ?? report.blockedURL);
      const key = `${directive} ${blocked}`;
      if (seen.has(key) || seen.size >= SEEN_LIMIT) continue;
      seen.add(key);
      console.warn(`[CSP] ${directive} 가 ${blocked || '(알 수 없음)'} 을(를) 허용 목록 밖으로 썼다`);
    }
  } catch {
    // 모양이 틀린 알림은 버린다.
  }
  return new NextResponse(null, { status: 204 });
}
