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
/*
 * 미지정(unassigned)도 여기 든다. 결제수단을 고르지 않은 지출·수입이 쌓이는 자리라
 * 잔액이 계속 음수로 커지는데, 그 돈이 실제로 어느 자산에서 나갔는지는 모른다.
 * 순자산에 넣으면 자산 탭에 보이는 자산의 합과 순자산이 어긋난다.
 */
export const EQUITY_ACCOUNT_TYPES: readonly AccountType[] = ['opening_balance', 'unassigned'];

/** 시가로 평가하는 계정. 장부 잔액 대신 최신 평가액을 쓴다. */
export const VALUED_ACCOUNT_TYPES: readonly AccountType[] = ['investment', 'crypto', 'real_estate'];

/** 부채 계정. 잔액이 음수로 저장된다. */
export const LIABILITY_ACCOUNT_TYPES: readonly AccountType[] = ['credit_card', 'loan'];

/** 세 칸 중 어디에 드는지. 외화라는 이유로 칸이 바뀌지는 않는다(달러 통장도 현금성이다). */
export type NetWorthSlot = 'cash' | 'investment' | 'liability';

export function slotOf(type: AccountType): NetWorthSlot {
  if (VALUED_ACCOUNT_TYPES.includes(type)) return 'investment';
  if (LIABILITY_ACCOUNT_TYPES.includes(type)) return 'liability';
  return 'cash';
}

/** 자산 탭과 홈이 계좌를 나누는 네 묶음 */
export type AssetGroupKey = 'cash' | 'savings' | 'investment' | 'debt';

/** 네 묶음이 화면에 늘어서는 차례 */
export const ASSET_GROUP_KEYS: readonly AssetGroupKey[] = ['cash', 'savings', 'investment', 'debt'];

/**
 * 계좌 유형마다 드는 묶음 (2026-10-05, 사용자 결정).
 *
 *   cash        바로 쓸 돈. 현금·입출금·CMA·포인트·페이
 *   savings     만기까지 모으는 돈. 예금·적금·연금
 *   investment  투자. 주식·펀드·암호화폐·부동산
 *   debt        대출. 마이너스통장도 대출로 만든다
 *
 * 카드 사용액(credit_card)은 여기 적힌 묶음이 아니라 **결제 통장의 묶음**에 든다
 * (`groupOfRow`). 카드는 결제 통장 아래에 서고 그 대금은 그 통장에서 빠져나갈 돈이라,
 * 마이너스통장(대출) 카드의 대금이 입출금·현금 합계를 줄이면 안 된다. 결제 통장을 모를
 * 때만 이 표의 값(바로 쓸 돈)으로 되돌아간다.
 *
 * `Record` 로 적어 두어 유형이 새로 생기면 여기서 타입 검사가 깨진다. 하나라도 빠지면
 * 묶음 넷을 더한 값이 총자산과 달라진다. 자본 계정(opening_balance)과 미지정(unassigned)은
 * 순자산에서 빠지므로 묶음이 없다.
 */
export const ASSET_GROUP_OF: Readonly<
  Record<Exclude<AccountType, 'opening_balance' | 'unassigned'>, AssetGroupKey>
> = {
  cash: 'cash',
  deposit: 'cash',
  cma: 'cash',
  point_pay: 'cash',
  credit_card: 'cash',
  time_deposit: 'savings',
  savings: 'savings',
  pension: 'savings',
  investment: 'investment',
  crypto: 'investment',
  real_estate: 'investment',
  loan: 'debt',
};

/** 묶음 키인지. 조회 문자열로 들어온 값을 거를 때 쓴다. */
export function isAssetGroupKey(value: unknown): value is AssetGroupKey {
  return typeof value === 'string' && (ASSET_GROUP_KEYS as readonly string[]).includes(value);
}

/** 그 유형이 드는 묶음. 모르는 유형(새 서버와 옛 앱)은 바로 쓸 돈으로 본다. */
export function assetGroupOf(type: string): AssetGroupKey {
  return ASSET_GROUP_OF[type as keyof typeof ASSET_GROUP_OF] ?? 'cash';
}

/** 순자산 행이 드는 묶음. 카드 사용액은 결제 통장을 따른다. */
export function groupOfRow(row: Pick<NetWorthAccountRow, 'type' | 'paymentAccountType'>): AssetGroupKey {
  if (row.type === 'credit_card' && row.paymentAccountType) {
    return assetGroupOf(row.paymentAccountType);
  }
  return assetGroupOf(row.type);
}

/** 금액 표를 응답 모양으로. 0인 키는 넣지 않는다 (없는 것과 뜻이 같다). */
export function nonZeroAmounts<K extends string>(amounts: Map<K, Dec>): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const [key, amount] of amounts) {
    if (!amount.isZero()) result[key] = amount.toString();
  }
  return result;
}

export interface NetWorthAccountRow {
  id: string;
  type: AccountType;
  /**
   * 카드 부채 계정(credit_card)이면 그 카드의 결제 통장 유형. 대금을 어느 묶음에
   * 넣을지 이것으로 정한다 (`groupOfRow`). 다른 계정에는 없다.
   */
  paymentAccountType?: AccountType | null;
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
  /** 네 묶음별 소계. 카드 대금은 결제 통장의 묶음에 든다. */
  byGroup: Map<AssetGroupKey, Dec>;
}

export interface NetWorthPersonBucket extends NetWorthBucket {
  personId: string;
  personName: string;
  total: Dec;
}

/** 계좌 하나가 순자산에 더한 값. 화면이 계좌를 합계에서 뺄 때 쓴다. */
export interface NetWorthAccountPartResult {
  accountId: string;
  type: AccountType;
  group: AssetGroupKey;
  ownerId: string | null;
  amount: Dec;
}

export interface NetWorthResult extends NetWorthBucket {
  total: Dec;
  /** 계좌별 값. 자본 계정은 빠진다. */
  byAccount: NetWorthAccountPartResult[];
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
    byGroup: new Map(),
  });

  const totals = newBucket();
  const people = new Map<string, NetWorthPersonBucket>();
  const byAccount: NetWorthAccountPartResult[] = [];
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
    const group = groupOfRow(row);
    const addTo = (bucket: NetWorthBucket) => {
      bucket[slot] = bucket[slot].plus(value);
      bucket.byType.set(row.type, (bucket.byType.get(row.type) ?? Dec.of(0)).plus(value));
      bucket.byGroup.set(group, (bucket.byGroup.get(group) ?? Dec.of(0)).plus(value));
    };

    addTo(totals);
    byAccount.push({ accountId: row.id, type: row.type, group, ownerId: row.ownerId, amount: value });

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
    byAccount,
    byPerson: [...people.values()].map((bucket) => ({ ...bucket, total: sumOf(bucket) })),
  };
}
