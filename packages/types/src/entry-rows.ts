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
import type { EntryLine, EntryListItem, EntryTag, InstallmentRowShare } from './entities';
import {
  installmentLineShares,
  installmentMonthShares,
  installmentRowDate,
} from './installment-schedule';

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
  /**
   * 이 줄이 할부의 한 회차라면 그 회차. 회차 기준으로 볼 때만 채워진다.
   *
   * 금액(`amount`)은 이미 그 회차 몫이다. 화면은 이 값으로 "3개월 중 2회차"를 적고,
   * 이자가 있으면 얼마가 이자인지 밝힌다.
   */
  installment?: InstallmentRowShare;
}

/**
 * 회차 기준으로 펼 때 함께 주는 것.
 *
 * `from`·`to` 는 화면이 보여 주는 구간이다. 그 안에 든 회차만 줄이 된다 -- 지난달에
 * 산 3개월 할부는 이번 달에 2회차만 서야 한다.
 */
export interface EntryRowsBasis {
  timeZone: string;
  /** 구간의 시작 (포함). */
  from: Date | string;
  /** 구간의 끝 (제외). */
  to: Date | string;
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
export function entryRows(
  entries: readonly EntryListItem[],
  /**
   * 회차 기준으로 볼 때만 준다. 없으면 발생 기준이다.
   *
   * 이미 `installmentEntryViews` 로 옮긴 목록에는 주지 않는다 -- 두 번 나뉜다.
   */
  basis?: EntryRowsBasis,
): EntryRow[] {
  // 회차로 옮기는 규칙은 한 곳(`installmentEntryViews`)이 갖는다. 여기서는 펴기만 한다.
  if (basis) return entryRows(installmentEntryViews(entries, basis));

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
        ...(entry.installment ? { installment: entry.installment } : {}),
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
        // 줄마다의 회차 몫. 분할이면 줄 금액의 비율로 나뉘어 있다.
        ...(line.installment ? { installment: line.installment } : {}),
      });
    }
  }

  ROW_CACHE.set(entries, rows);
  return rows;
}

/** 편 결과를 목록 배열 하나에 매어 둔다. 목록이 사라지면 함께 사라진다. */
const ROW_CACHE = new WeakMap<readonly EntryListItem[], EntryRow[]>();

/**
 * 이 구간에 선 회차. 할부가 아니면 `'not-installment'`, 회차가 없으면 null 이다.
 *
 * 줄 금액을 주면 그 줄의 몫을 낸다. 분할이 아니면 회차 금액 그대로이고, 분할이면 줄
 * 금액의 비율이다. 이자도 같은 비율로 나눈다 -- 이자의 분류는 거래의 분류를 따라간다.
 */
function installmentShareIn(
  entry: EntryListItem,
  basis: EntryRowsBasis,
):
  | 'not-installment'
  | null
  | {
      index: number;
      months: number;
      amountsOf: (lineAmount: string) => { total: string; principal: string; interest: string };
    } {
  const months = entry.installmentMonths ?? 1;
  if (months < 2) return 'not-installment';
  /*
   * 이미 옮긴 거래는 그대로 둔다. 금액이 이미 한 회차 몫이라 다시 나누면 그 몫을
   * 또 쪼갠다 -- 변환을 두 번 태우는 자리는 실수하기 쉬워 여기서 막는다.
   */
  if (entry.installment) return 'not-installment';

  const shares = installmentMonthShares({
    date: entry.date,
    // 목록 금액은 이미 차감된 뒤다. 카드에 청구된 금액이라 회차의 합과 같다.
    total: entry.amount,
    months,
    principals: entry.installmentShares,
    interests: entry.installmentInterestShares,
    timeZone: basis.timeZone,
  });

  const from = asTime(basis.from);
  const to = asTime(basis.to);
  const at = shares.findIndex((_, index) => {
    const time = asTime(installmentRowDate(entry.date, index, basis.timeZone));
    return time >= from && time < to;
  });
  if (at < 0) return null;

  const totals = shares.map((share) => share.amount);
  const interests = shares.map((share) => share.interest);

  return {
    index: shares[at].index,
    months,
    amountsOf: (lineAmount: string) => {
      /*
       * 줄 금액을 회차 몫(원금 + 이자)의 비율로 나눈다. 합은 언제나 줄 금액과 같다 --
       * 전표 금액이 이미 이자를 품고 있어, 회차를 다 더하면 산 날의 금액으로 돌아온다.
       */
      const total = installmentLineShares(lineAmount, totals)[at];
      /*
       * 그중 얼마가 이자인지는 따로 센다. 화면이 "이자 3,000"을 적는 데 쓰는 값이라
       * 나눈 뒤 원금을 빼서 얻는다 -- 두 값을 따로 나누면 합이 줄 금액에서 벗어난다.
       */
      const interest = installmentLineShares(
        interestShareOf(lineAmount, entry.amount, interests),
        interests,
      )[at];
      return {
        total: total.toString(),
        principal: total.minus(interest).toString(),
        interest: interest.toString(),
      };
    },
  };
}

/**
 * 거래 목록을 **회차 기준의 거래로** 바꾼다. 회차 기준으로 세는 모든 화면의 입구다.
 *
 * 할부 한 건은 이 구간에 서는 회차 하나가 되고, 금액도 날짜도 그 회차의 것이다.
 * 회차가 이 구간에 없는 할부는 빠진다 -- 산 달의 전액이 남으면 합계와 목록이 어긋난다.
 *
 * **날짜를 함께 옮기는 것이 요점이다.** 날짜별 합계와 달력이 이 값을 보고 줄을 세우므로,
 * 산 날에 그대로 두면 지난달에 산 할부가 이번 달 목록에 지난달 날짜로 선다.
 */
export function installmentEntryViews(
  entries: readonly EntryListItem[],
  basis: EntryRowsBasis,
): EntryListItem[] {
  const views: EntryListItem[] = [];

  for (const entry of entries) {
    const share = installmentShareIn(entry, basis);
    if (share === 'not-installment') {
      views.push(entry);
      continue;
    }
    if (!share) continue;

    const whole = share.amountsOf(entry.amount);
    views.push({
      ...entry,
      // 사용자가 적은 것. 자세히 보기와 고치기가 이 값을 연다(`originalEntry`).
      origin: entry,
      date: isoOf(installmentRowDate(entry.date, share.index - 1, basis.timeZone)),
      amount: whole.total,
      installment: shareOf(whole, share),
      lines: entry.lines.map((line) => {
        const amounts = share.amountsOf(line.amount);
        return {
          ...line,
          amount: amounts.total,
          installment: shareOf(amounts, share),
          /*
           * 깎인 금액은 회차로 나누지 않는다. 산 자리에서 한 번 깎인 값이라 회차마다
           * 다시 깎이는 것이 아니고, 회차 금액은 이미 깎인 뒤의 청구액을 나눈 것이다.
           */
          discountAmount: null,
        };
      }),
    });
  }

  return views;
}

/**
 * 사용자가 적은 그대로의 거래. 회차로 옮긴 것이면 옮기기 전의 것이다.
 *
 * 자세히 보기와 고치기가 쓴다. 목록에 선 것은 그 달의 회차 몫이지만, 눌러서 여는 것은
 * 산 날의 거래 한 건이어야 한다 -- 폼이 회차 금액을 들면 저장하는 순간 할부가 한 달치
 * 금액으로 바뀐다.
 */
export function originalEntry(entry: EntryListItem): EntryListItem {
  return entry.origin ?? entry;
}

/** 나눈 금액에 회차 번호를 붙인다. 화면이 "3개월 중 2회차"를 적는 데 쓴다. */
function shareOf(
  amounts: { principal: string; interest: string },
  share: { index: number; months: number },
): InstallmentRowShare {
  return {
    index: share.index,
    months: share.months,
    principal: amounts.principal,
    interest: amounts.interest,
  };
}

/** 날짜를 와이어 계약의 모양으로. 옮긴 회차 날짜는 Date 로 온다. */
function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** 이 줄이 가져갈 이자 총액. 줄 금액이 결제 금액에서 차지하는 만큼이다. */
function interestShareOf(
  lineAmount: string,
  entryAmount: string,
  interests: readonly string[],
): Dec {
  const total = interests.reduce<Dec>((acc, value) => acc.plus(value), Dec.of(0));
  if (total.isZero()) return Dec.of(0);

  const line = Dec.of(lineAmount).abs();
  const whole = Dec.of(entryAmount).abs();
  if (whole.isZero() || line.eq(whole)) return total;
  return total.times(line).dividedBy(whole, 0);
}

function asTime(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

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
