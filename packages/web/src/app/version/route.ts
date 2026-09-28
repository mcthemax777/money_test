/**
 * 지금 배포된 웹의 빌드 번호. 열려 있던 탭이 자기 번호와 견준다(`WebUpdate`).
 *
 * 빌드할 때 박힌 값이라 새로 배포해야만 바뀐다. 캐시하면 옛 번호가 돌아와 새 버전을
 * 모르게 되므로 매번 새로 답한다.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_WEB_VERSION ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
