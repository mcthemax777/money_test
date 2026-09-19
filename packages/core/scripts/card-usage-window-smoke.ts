/**
 * 주기 막대 창이 제자리에서 어디를 보는가.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/card-usage-window-smoke.ts
 *
 * **제자리는 진행 중인 주기가 오른쪽 끝이다.** 카드를 열었을 때 먼저 보는 것이 지금이고,
 * "지금으로"를 누르면 그 자리로 돌아온다.
 *
 * 할부를 걸면 아직 오지 않은 주기에도 갚을 돈이 잡히지만 제자리에 끼우지 않는다.
 * 24개월 할부 하나면 창이 통째로 앞 달로 채워져 이번 달이 밀려난다. 앞 주기는 끌어서
 * 보고, 끌면 실제로 나오는지도 함께 본다.
 */
import { cardUsageAnchorEnd, cardUsageBars } from '../src/lib/card-usage-chart';
import type { CardUsagePeriod } from '../src/lib/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const TODAY = '2026-09-20';

/**
 * 마감 8일 카드의 주기 목록. `billedFrom` 번째부터 청구액이 잡힌다.
 *
 * 마지막 주기가 진행 중(9/9~10/8)이 되도록 만든다. 그 뒤가 곧 앞 주기다.
 */
function periodsOf(past: number, upcoming: number, billedFrom: number): CardUsagePeriod[] {
  const rows: CardUsagePeriod[] = [];
  for (let offset = -past; offset <= upcoming; offset += 1) {
    // 2026-10 마감 주기를 0 으로 둔다 (9/9 ~ 10/8).
    const month = 10 + offset;
    const year = 2026 + Math.floor((month - 1) / 12);
    const m = ((month - 1) % 12) + 1;
    const start = new Date(Date.UTC(year, m - 2, 9));
    const end = new Date(Date.UTC(year, m - 1, 8));
    const index = offset + past;

    rows.push({
      closingKey: `${year}-${String(m).padStart(2, '0')}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      closed: end.toISOString().slice(0, 10) < TODAY,
      usage: '0',
      billed: index >= billedFrom ? '100000' : '0',
    } as CardUsagePeriod);
  }
  return rows;
}

/**
 * 창에 실리는 주기 이름. `offset` 은 끌어 둔 칸 수다 (음수가 앞 주기 쪽).
 *
 * 창을 자르는 셈은 `useCardUsageWindow` 와 같다. React 없이 돌리려고 여기서 같은 식을
 * 쓴다 -- 이 검사가 보는 것은 "제자리가 어디인가"이고, 그 답이 `cardUsageAnchorEnd` 다.
 */
function windowAt(
  periods: CardUsagePeriod[],
  measure: 'billed' | 'performance',
  offset = 0,
): string {
  const bars = cardUsageBars(periods, TODAY, null, measure);
  const span = 6;
  const minEnd = Math.min(span, bars.length);
  const rest = Math.min(Math.max(cardUsageAnchorEnd(bars), minEnd), bars.length);
  const end = Math.min(Math.max(rest - offset, minEnd), bars.length);
  return bars
    .slice(Math.max(0, end - span), end)
    .map((bar) => bar.closingKey)
    .join(',');
}

/** 제자리 창. "지금으로"를 누른 직후의 자리이기도 하다. */
const restWindow = (periods: CardUsagePeriod[], measure: 'billed' | 'performance') =>
  windowAt(periods, measure, 0);

// ── 할부가 없는 카드 ──
//
// 앞 주기에 잡힌 돈이 없다. 진행 중인 주기가 오른쪽 끝이다.
const plain = periodsOf(8, 0, 0);
eq('할부가 없으면 이번 주기가 끝', restWindow(plain, 'billed'), '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10');
// 오른쪽 끝이 오늘을 품은 주기다 (9/9 ~ 10/8).
eq('오른쪽 끝이 지금', restWindow(plain, 'billed').split(',').pop(), '2026-10');

// ── 3개월 할부 (앞 주기 둘) ──
//
// 앞 주기에 갚을 돈이 잡혀 있어도 제자리는 그대로다. 끌면 나온다.
const short = periodsOf(8, 2, 8);
eq(
  '할부가 있어도 이번 주기가 끝',
  restWindow(short, 'billed'),
  '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10',
);
eq(
  '한 칸 끌면 다음 달이 들어온다',
  windowAt(short, 'billed', -1),
  '2026-06,2026-07,2026-08,2026-09,2026-10,2026-11',
);
eq(
  '두 칸 끌면 그다음 달까지',
  windowAt(short, 'billed', -2),
  '2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
);

// ── 24개월 할부 (앞 주기가 잔뜩) ──
//
// 제자리는 달라지지 않는다. 전부 열면 이번 달이 창 밖으로 밀려난다.
const long = periodsOf(8, 23, 8);
eq(
  '앞 주기가 많아도 제자리는 이번 주기',
  restWindow(long, 'billed'),
  '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10',
);

// ── 실적 그래프 ──
eq(
  '실적도 이번 주기가 끝',
  restWindow(short, 'performance'),
  '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10',
);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
