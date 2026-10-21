/**
 * 벽시계 → UTC (`zonedTimeToUtc`)의 서머타임 전환일.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/timezone-smoke.ts
 *
 * 시각이 없는 날(뉴욕 3월 둘째 일요일 02:30)은 시계가 뛴 만큼 뒤로(03:30 EDT), 두 번 있는 날(11월 첫 일요일
 * 01:30)은 앞의 것(EDT)이다. 예전에는 없는 시각을 한 시간 앞(01:30 EST)으로 저장했다.
 */
import { zonedDayStart, zonedTimeToUtc } from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${String(expected)}, 실제 ${String(actual)})`);
}

const iso = (date: Date) => date.toISOString();
eq('서울 보통 날', iso(zonedTimeToUtc(2026, 9, 30, 14, 23, 'Asia/Seoul')), '2026-09-30T05:23:00.000Z');
eq('뉴욕 보통 날', iso(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York')), '2026-07-01T13:00:00.000Z');
eq('뉴욕 없는 시각은 뒤로 민다', iso(zonedTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York')), '2026-03-08T07:30:00.000Z');
eq('뉴욕 두 번 있는 시각은 앞의 것', iso(zonedTimeToUtc(2026, 11, 1, 1, 30, 'America/New_York')), '2026-11-01T05:30:00.000Z');
eq('뉴욕 전환 뒤', iso(zonedTimeToUtc(2026, 3, 8, 3, 30, 'America/New_York')), '2026-03-08T07:30:00.000Z');
eq('달 넘김(13월)', iso(zonedTimeToUtc(2026, 13, 1, 0, 0, 'Asia/Seoul')), '2026-12-31T15:00:00.000Z');
eq('자정이 없는 날의 시작', iso(zonedDayStart(2026, 9, 6, 'America/Santiago')), '2026-09-06T04:00:00.000Z');

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
