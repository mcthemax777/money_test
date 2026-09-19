/**
 * 화면이 만드는 조회 구간이 그 지역의 하루를 온전히 담는가.
 *
 * 실행:
 *   npx tsx packages/core/scripts/day-range-smoke.ts
 *
 * 목록 창구는 **인스턴트**를 받고, 화면이 들고 있는 기간은 **달력 날짜**다. 그 사이를
 * `dayRangeQuery` 가 잇는다. 여기서 한 시간이라도 어긋나면 말일이나 초하루의 거래가
 * 조용히 목록에서 빠진다 -- 7월 주기를 눌렀는데 7월 31일 오후의 결제가 없던 자리다.
 *
 * 그리고 **받는 값의 모양이 둘**이다. 날짜 키("2026-07-01")와 카드 청구 주기가 들고
 * 다니는 UTC 자정 표시자("2026-07-01T00:00:00.000Z")다. 표시자를 날짜 키로 알고
 * 넘겼다가 `toISOString` 이 RangeError 로 터져 **앱이 꺼졌다.**
 */
import { dayRangeQuery } from '../src/lib/datetime';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const KST = 'Asia/Seoul';
const NY = 'America/New_York';

/** 그 인스턴트를 그 지역의 벽시계로. 사람이 읽고 견줄 수 있게. */
const wall = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));

// ── 날짜 키로 줄 때 ──
const july = dayRangeQuery('2026-07-01', '2026-07-31', KST);
eq('7월은 1일 0시에 시작한다', wall(july.startDate, KST), '2026-07-01 00:00:00');
eq('7월은 31일 끝에 닫힌다', wall(july.endDate, KST), '2026-07-31 23:59:59');
eq('8월 1일 0시보다 앞이다', new Date(july.endDate) < new Date('2026-07-31T15:00:00.000Z'), true);

// ── UTC 자정 표시자로 줄 때 (카드 청구 주기가 주는 모양) ──
const marker = dayRangeQuery(
  new Date(Date.UTC(2026, 6, 1)).toISOString(),
  new Date(Date.UTC(2026, 7, 0)).toISOString(),
  KST,
);
eq('표시자로 줘도 같은 구간이다 (시작)', marker.startDate, july.startDate);
eq('표시자로 줘도 같은 구간이다 (끝)', marker.endDate, july.endDate);

// ── 타임존이 다르면 경계도 그만큼 움직인다 ──
const nyJuly = dayRangeQuery('2026-07-01', '2026-07-31', NY);
eq('뉴욕도 그 지역 1일 0시', wall(nyJuly.startDate, NY), '2026-07-01 00:00:00');
eq('뉴욕도 그 지역 31일 끝', wall(nyJuly.endDate, NY), '2026-07-31 23:59:59');
eq('같은 날짜라도 인스턴트는 다르다', nyJuly.startDate === july.startDate, false);

// ── 달을 넘는 구간, 하루짜리 구간 ──
const across = dayRangeQuery('2026-12-30', '2027-01-02', KST);
eq('해를 넘겨도 끝날을 다 담는다', wall(across.endDate, KST), '2027-01-02 23:59:59');
const oneDay = dayRangeQuery('2026-02-28', '2026-02-28', KST);
eq('하루짜리 구간도 그 하루다', wall(oneDay.startDate, KST), '2026-02-28 00:00:00');
eq('하루짜리 구간의 끝', wall(oneDay.endDate, KST), '2026-02-28 23:59:59');

// ── 읽을 수 없는 값은 조용히 넘어가지 않는다 ──
let told = '';
try {
  dayRangeQuery('언젠가', '언젠가', KST);
} catch (error) {
  told = (error as Error).message;
}
// 형식기가 던지는 "Invalid time value" 로는 어느 값이 문제인지 알 수 없다.
eq('읽을 수 없으면 그 값을 말한다', told.includes('언젠가'), true);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
