/**
 * 순자산 집계 규칙.
 *
 * 계좌 유형을 어느 칸에 넣을지, 외화와 투자 계좌를 어떻게 다시 평가할지가 여기 있다.
 * 기기가 오프라인에서 같은 총자산을 내야 하므로 서버의 서비스 안에 두지 않는다.
 * (같은 이유와 같은 자리 선택은 report-aggregation.ts 의 머리말에 적어 두었다)
 *
 * 통화를 두 층으로 다룬다는 점이 이 계산의 핵심이다.
 *   - `balance` 는 그 계좌의 통화다. 달러 통장이면 달러다.
 *   - `bookValue` 는 거래마다 그때의 환율로 쌓인 저장 통화 합계다.
 * 순자산은 표시 통화 한 가지로 말해야 하므로 둘을 각자의 환율로 옮긴다. 그 차이가
 * 미실현 손익이고, 투자 계좌의 (시가 - 장부가)와 같은 자리에 더해진다.
 */

import { Dec, type DecInput } from './decimal';
import { currencyDecimals } from './currency';
import type { AccountType } from './entities';

/**
 * 자본 계정. 자산이 아니므로 순자산에서 빼야 한다.
 *
 * 계좌를 만들 때의 잔액을 전표화할 때 상대편으로 쓰는 계정이라, 합계에 넣으면
 * 기초잔액이 두 번 세어진다.
 */
export const EQUITY_ACCOUNT_TYPES: readonly AccountType[] = ['opening_balance'];

/** 시가로 평가하는 계정. 장부 잔액 대신 최신 평가액을 쓴다. */
export const VALUED_ACCOUNT_TYPES: readonly AccountType[] = ['investment', 'real_estate'];

/** 부채 계정. 잔액이 음수로 저장된다. */
export const LIABILITY_ACCOUNT_TYPES: readonly AccountType[] = ['credit_card', 'loan'];

/** 세 칸 중 어디에 드는지. 외화라는 이유로 칸이 바뀌지는 않는다(달러 통장도 현금성이다). */
export type NetWorthSlot = 'cash' | 'investment' | 'liability';

export function slotOf(type: AccountType): NetWorthSlot {
  if (VALUED_ACCOUNT_TYPES.includes(type)) return 'investment';
  if (LIABILITY_ACCOUNT_TYPES.includes(type)) return 'liability';
  return 'cash';
}

export interface NetWorthAccountRow {
  id: string;
  type: AccountType;
  /** 계좌 통화 */
  currency: string;
  /** 계좌 통화로 본 잔액 */
  balance: DecInput;
  ownerId: string | null;
  ownerName: string | null;
  /**
   * 투자성 계좌의 최신 평가액 (저장 통화).
   *
   * 없으면 장부 잔액으로 대체한다. 평가 기록을 아직 넣지 않은 계좌가 0원으로
   * 보이면 총자산이 통째로 틀린다.
   */
  marketValue?: DecInput | null;
  /** 거래마다 그때의 환율로 쌓인 저장 통화 합계 */
  bookValue?: DecInput | null;
}

export interface NetWorthRates {
  ledgerCurrency: string;
  displayCurrency: string;
  /** 계좌 통화 -> 표시 통화. 없는 통화는 1로 본다. */
  toDisplay: Readonly<Record<string, DecInput>>;
  /** 저장 통화 -> 표시 통화 */
  ledgerToDisplay: DecInput;
}

export interface NetWorthBucket {
  cash: Dec;
  investment: Dec;
  liability: Dec;
  /** 계좌 유형별 소계. 0인 유형은 담기지 않는다. */
  byType: Map<AccountType, Dec>;
}

export interface NetWorthPersonBucket extends NetWorthBucket {
  personId: string;
  personName: string;
  total: Dec;
}

export interface NetWorthResult extends NetWorthBucket {
  total: Dec;
  /** 투자 시가 + 외화 재평가액에서 각각의 장부가를 뺀 값 */
  unrealizedGain: Dec;
  byPerson: NetWorthPersonBucket[];
}

/**
 * 총자산과 사람별 소계.
 *
 * 자본 계정은 부르는 쪽이 걸러 온다(질의가 하는 일이다). 혹시 섞여 와도 여기서
 * 한 번 더 빼낸다. 합계에 들면 기초잔액이 두 번 세어지기 때문이다.
 */
export function netWorth(
  rows: readonly NetWorthAccountRow[],
  rates: NetWorthRates,
): NetWorthResult {
  const decimals = currencyDecimals(rates.displayCurrency);
  const isIdentity = rates.ledgerCurrency === rates.displayCurrency;

  /** 계좌 통화 금액을 표시 통화로. 계좌마다 한 번만 곱한다. */
  const fromNative = (value: DecInput, currency: string): Dec => {
    const rate = rates.toDisplay[currency] ?? 1;
    return Dec.of(value).times(rate).round(decimals);
  };

  /** 저장 통화 금액을 표시 통화로. 두 통화가 같으면 곱셈도 반올림도 하지 않는다. */
  const fromLedger = (value: DecInput): Dec => {
    const amount = Dec.of(value);
    return isIdentity ? amount : amount.times(rates.ledgerToDisplay).round(decimals);
  };

  const newBucket = (): NetWorthBucket => ({
    cash: Dec.of(0),
    investment: Dec.of(0),
    liability: Dec.of(0),
    byType: new Map(),
  });

  const totals = newBucket();
  const people = new Map<string, NetWorthPersonBucket>();
  let revaluedNow = Dec.of(0);
  let revaluedBook = Dec.of(0);

  for (const row of rows) {
    if (EQUITY_ACCOUNT_TYPES.includes(row.type)) continue;

    const isValued = VALUED_ACCOUNT_TYPES.includes(row.type);
    const isForeign = row.currency !== rates.ledgerCurrency;

    let value: Dec;
    if (isValued || isForeign) {
      const market = row.marketValue;
      value =
        isValued && market !== null && market !== undefined
          ? fromLedger(market)
          : fromNative(row.balance, row.currency);
      revaluedNow = revaluedNow.plus(value);
      revaluedBook = revaluedBook.plus(fromLedger(row.bookValue ?? 0));
    } else {
      value = fromNative(row.balance, row.currency);
    }

    const slot = slotOf(row.type);
    const addTo = (bucket: NetWorthBucket) => {
      bucket[slot] = bucket[slot].plus(value);
      bucket.byType.set(row.type, (bucket.byType.get(row.type) ?? Dec.of(0)).plus(value));
    };

    addTo(totals);

    if (row.ownerId) {
      const bucket =
        people.get(row.ownerId) ??
        {
          ...newBucket(),
          personId: row.ownerId,
          personName: row.ownerName ?? '',
          total: Dec.of(0),
        };
      addTo(bucket);
      people.set(row.ownerId, bucket);
    }
  }

  const sumOf = (bucket: NetWorthBucket): Dec =>
    bucket.cash.plus(bucket.investment).plus(bucket.liability);

  return {
    ...totals,
    total: sumOf(totals),
    unrealizedGain: revaluedNow.minus(revaluedBook),
    byPerson: [...people.values()].map((bucket) => ({ ...bucket, total: sumOf(bucket) })),
  };
}
