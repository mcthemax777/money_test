/**
 * 거래 목록을 화면의 줄로 펴는 규칙.
 *
 * 한 결제를 식비 5,000 + 여행경비 5,000으로 나눴다면 목록에도 두 줄이 서야 한다.
 * 뭉쳐서 한 줄로 보여 주면 대표 분류 하나만 남아 "여행경비를 썼다"가 사라진다.
 *
 * 펴는 것은 지출과 수입뿐이다. 이체와 카드 대금 결제는 돈이 계좌 사이를 옮겨 다닌
 * 거래라 분류 관점으로 나눌 것이 없다. 자산 탭의 결제내역처럼 계좌 관점으로 보는
 * 화면은 이 함수를 아예 부르지 않는다 -- 통장에서는 10,000원이 한 번 빠진 것이고,
 * 그래야 은행 명세서와 대조가 된다.
 */

import { Dec } from './decimal';
import type { EntryLine, EntryListItem, EntryTag } from './entities';

/**
 * 목록에 실제로 그려지는 한 줄.
 *
 * 줄들 사이에 앞뒤가 없다. 나눈 거래의 첫 줄과 둘째 줄은 같은 모양으로 그려지고,
 * "이 줄은 나눈 거래의 일부"라는 사실은 화면이 아이콘 하나로 말한다 -- 그 판단은
 * `entry.splitCount` 로 하므로 이 모양에 담을 것이 없다.
 */
export interface EntryRow {
  /** 목록의 키. 같은 거래의 줄들이 서로 다른 값을 갖는다. */
  key: string;
  entry: EntryListItem;
  /** 이 줄이 가리키는 분류 줄. 이체·카드 대금 결제는 null 이다. */
  line: EntryLine | null;
  /** 이 줄의 금액. 분류 줄이면 그 줄만의 금액이고, 아니면 거래 전체의 금액이다. */
  amount: string;
  /** 이 줄에 붙은 태그. */
  tags: EntryTag[];
}

/** 줄로 펼 갈래. 나머지는 거래 하나가 한 줄이다. */
function splitsIntoLines(kind: EntryListItem['kind']): boolean {
  return kind === 'expense' || kind === 'income';
}

/**
 * 거래 목록을 줄 목록으로.
 *
 * 걸리지 않은 줄(`matched === false`)은 빼고 편다. 그 판단은 이미 `toListItem` 이
 * 해 두었다.
 */
export function entryRows(entries: readonly EntryListItem[]): EntryRow[] {
  /*
   * 같은 목록에는 같은 배열을 돌려준다.
   *
   * 목록 한 줄은 값이 그대로면 다시 그리지 않는다(memo). 부를 때마다 새 객체를 만들면
   * 그 검사가 늘 헛돌아, 한 달을 통째로 펼친 화면이 눈에 보이게 밀린다.
   */
  const cached = ROW_CACHE.get(entries);
  if (cached) return cached;

  const rows: EntryRow[] = [];

  for (const entry of entries) {
    const lines = splitsIntoLines(entry.kind)
      ? entry.lines.filter((line) => line.matched)
      : [];

    if (lines.length === 0) {
      rows.push({
        key: entry.id,
        entry,
        line: null,
        amount: entry.amount,
        tags: entry.tags,
      });
      continue;
    }

    for (const line of lines) {
      rows.push({
        key: `${entry.id}:${line.lineKey}`,
        entry,
        line,
        amount: line.amount,
        tags: line.tags,
      });
    }
  }

  ROW_CACHE.set(entries, rows);
  return rows;
}

/** 편 결과를 목록 배열 하나에 매어 둔다. 목록이 사라지면 함께 사라진다. */
const ROW_CACHE = new WeakMap<readonly EntryListItem[], EntryRow[]>();

/**
 * 화면에 뿌린 줄이 몇 "건"인가.
 *
 * 줄 수가 아니라 거래 수를 센다. 10,000원짜리 결제를 둘로 나눴다고 "2건"이 되면
 * 사용자가 적은 거래 수와 어긋난다.
 */
export function entryCountOf(rows: readonly EntryRow[]): number {
  return new Set(rows.map((row) => row.entry.id)).size;
}

/**
 * 목록에서 고른 줄 하나의 열쇠.
 *
 * 줄 키를 주면 그 줄, 주지 않으면 **그 거래의 모든 줄**이다. 접힌 달을 통째로 체크하면
 * 그 거래들이 화면에 없어 줄 키를 알 수 없고, 그때 사용자가 바란 것도 "그 범위의 모든
 * 것"이다. 태그 명령의 `TagTarget` 과 같은 세 갈래다.
 */
export function selectionKey(entryId: string, lineKey?: string | null): string {
  return lineKey === undefined ? entryId : `${entryId}\u0000${lineKey ?? ''}`;
}

/** 열쇠를 되돌린다. 구분자가 없으면 그 거래의 모든 줄이다. */
export function parseSelectionKey(key: string): { entryId: string; lineKey?: string | null } {
  const at = key.indexOf('\u0000');
  if (at < 0) return { entryId: key };
  const lineKey = key.slice(at + 1);
  return { entryId: key.slice(0, at), lineKey: lineKey === '' ? null : lineKey };
}

/**
 * 지금 화면에 실제로 잡히는 금액.
 *
 * 분류나 태그로 좁힌 목록은 걸린 줄만 보여 준다. 그런데 날짜 줄과 수단 줄의 합계가
 * 거래 전체 금액을 더하면, 화면에 5,000원 한 줄만 서 있는데 그 날의 합계는 10,000원이
 * 된다 -- 같은 화면 안에서 두 숫자가 어긋난다.
 *
 * 줄이 모두 걸렸으면 거래 금액을 그대로 쓴다. 줄마다 환산한 값을 다시 더하면 반올림이
 * 쌓여 거래 금액에서 1원씩 벗어날 수 있다.
 *
 * 이체와 카드 대금 결제는 줄로 펴지 않으므로(`entryRows`) 언제나 거래 금액이다.
 */
export function matchedAmountOf(entry: EntryListItem): string {
  if (!splitsIntoLines(entry.kind) || entry.lines.length === 0) return entry.amount;

  let total = Dec.of(0);
  let all = true;
  for (const line of entry.lines) {
    if (line.matched) total = total.plus(line.amount);
    else all = false;
  }
  return all ? entry.amount : total.toString();
}
