/**
 * 결제수단별 집계 규칙.
 *
 * "이번 달에 어느 통장과 어느 카드로 얼마를 썼나"를 만든다. 규칙이 서버에만 있으면
 * 기기는 오프라인에서 이 칸을 비워 둘 수밖에 없다. 그래서 규칙만 여기로 옮기고 서버도
 * 이것을 쓴다 (`report-aggregation.ts` 머리말의 경계와 이유가 그대로 적용된다).
 *
 * 이 집계에서 까다로운 자리는 둘이다.
 *
 *   1. **목록이 거래 유무와 무관하다.** 이번 달에 쓰지 않은 통장과 카드도 0원으로
 *      남는다. 그러지 않으면 화면에서 "왜 내 카드가 없나"를 묻게 된다.
 *   2. **이체는 소비가 아니지만 수수료는 지출이다.** 수수료를 보내는 계좌에 붙여야
 *      지출 카테고리 합계와 총액이 맞는다.
 *
 * 금액은 이미 표시 통화로 환산된 값을 받는다. 환산은 `toListItem` 이 하고, 카드 실적
 * 기준액은 부르는 쪽이 옮겨 온다. 통장 통화가 카드마다 다를 수 있어 환율을 고르는 일이
 * 질의의 몫이기 때문이다.
 */

import { Dec } from './decimal';
import type { ReportDto } from './dtos';
import type { AccountType, EntryListItem } from './entities';
import { matchedAmountOf } from './entry-rows';

/**
 * 사용자가 "통장"으로 인식하지 않는 내부 계정.
 *
 * credit_card 는 카드 화면의 사용액이고, opening_balance 는 기초잔액의 상대편이라
 * 결제수단 목록에 노출하면 안 된다.
 */
export const HIDDEN_ACCOUNT_TYPES: readonly AccountType[] = ['credit_card', 'opening_balance'];

/** 집계가 보는 계좌. 조회용이라 비활성과 숨김 유형까지 담아 보낸다. */
export interface PaymentMethodAccount {
  id: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  ownerId: string | null;
  ownerName: string | null;
}

/** 집계가 보는 카드. 주인은 결제 통장의 주인이다. */
export interface PaymentMethodCard {
  id: string;
  name: string;
  cardType: string;
  isActive: boolean;
  color: string | null;
  statementClosingDay: number | null;
  /**
   * 표시 통화로 옮긴 실적 기준액. 설정하지 않았으면 null.
   *
   * 카드에 저장된 값은 결제 통장의 통화다. 그대로 두면 달러 카드의 기준액이 원화
   * 사용액과 비교되므로, 부르는 쪽이 환산해 넣는다.
   */
  performanceTarget: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

export interface PaymentMethodOptions {
  /**
   * 자산 주인 필터. 소유자로 거른다.
   *
   *   null/undefined = 전체
   *   빈 배열        = 아무도 고르지 않았다 (어떤 수단도 남지 않는다)
   */
  personIds?: readonly string[] | null;
  /** 필터가 아무것도 고르지 않았다. 목록은 그대로 두고 금액만 세지 않는다. */
  matchNothing?: boolean;
}

const ZERO = Dec.of(0);

export function paymentMethods(
  items: readonly EntryListItem[],
  accounts: readonly PaymentMethodAccount[],
  cards: readonly PaymentMethodCard[],
  options: PaymentMethodOptions = {},
): ReportDto.PaymentMethodItem[] {
  const { personIds = null, matchNothing = false } = options;

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const buckets = new Map<string, ReportDto.PaymentMethodItem>();

  const isVisibleOwner = (ownerId: string | null | undefined): boolean =>
    !personIds || (ownerId ? personIds.includes(ownerId) : false);

  const accountBucket = (
    account: PaymentMethodAccount,
    amount: string,
    count: number,
    income = '0',
  ): ReportDto.PaymentMethodItem => ({
    kind: 'account',
    id: account.id,
    name: account.name,
    ownerId: account.ownerId,
    ownerName: account.ownerName,
    amount,
    count,
    income,
  });

  /** 카드 한 장의 칸. 목록을 채울 때와 금액을 더할 때가 같은 모양이어야 한다. */
  const cardBucket = (
    card: PaymentMethodCard,
    amount: string,
    count: number,
    income = '0',
  ): ReportDto.PaymentMethodItem => ({
    kind: card.cardType === 'credit' ? 'credit_card' : 'debit_card',
    id: card.id,
    name: card.name,
    ownerId: card.ownerId,
    ownerName: card.ownerName,
    amount,
    count,
    income,
    // 없는 값은 키 자체를 두지 않는다. 화면이 "설정하지 않았다"와 0을 가른다.
    ...(card.performanceTarget !== null ? { performanceTarget: card.performanceTarget } : {}),
    ...(card.color !== null ? { color: card.color } : {}),
    ...(card.statementClosingDay !== null
      ? { statementClosingDay: card.statementClosingDay }
      : {}),
  });

  const addTo = (item: ReportDto.PaymentMethodItem) => {
    const key = `${item.kind}:${item.id}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, item);
      return;
    }
    existing.amount = Dec.of(existing.amount).plus(item.amount).toString();
    existing.count += item.count;
    existing.income = Dec.of(existing.income).plus(item.income).toString();
  };

  // 이번 달에 쓰지 않은 수단도 0원으로 남긴다.
  for (const account of accounts) {
    if (!account.isActive) continue;
    if (HIDDEN_ACCOUNT_TYPES.includes(account.type)) continue;
    if (!isVisibleOwner(account.ownerId)) continue;
    addTo(accountBucket(account, '0', 0));
  }

  for (const card of cards) {
    if (!card.isActive) continue;
    if (!isVisibleOwner(card.ownerId)) continue;
    addTo(cardBucket(card, '0', 0));
  }

  // 필터가 아무것도 고르지 않았으면 금액은 없지만 목록은 그대로 둔다.
  for (const item of matchNothing ? [] : items) {
    /*
     * 걸린 줄만 센다.
     *
     * 분류나 태그로 좁힌 화면은 걸린 줄만 보여 준다. 거래 전체를 더하면 목록에 5,000원
     * 한 줄이 서 있는데 그 카드 줄에는 10,000원이 적힌다.
     */
    const amount = Dec.of(matchedAmountOf(item) || 0);

    /*
     * 셀 몫이 없으면 건수도 세지 않는다. "0원인데 3건"이 되지 않게 한다.
     *
     * 전액을 취소한 거래가 0원으로 남으므로 여기서 빠진다. 쓴 돈도 건수도 없는 것이
     * 맞다 -- 승인이 있었다가 그대로 되돌아갔다.
     */
    if (amount.lte(ZERO) && item.kind !== 'transfer') continue;

    if (item.kind === 'transfer') {
      const fee = Dec.of(item.feeAmount ?? '0');
      if (fee.lte(ZERO) || !item.accountId) continue;

      /*
       * 보내는 계좌에 붙인다. 다른 사람이 감춰진 사람의 계좌로 결제했더라도 그 계좌는
       * 목록에 넣지 않는다. 목록에 있는 수단은 "지금 보고 있는 사람들의 자산"이어야 한다.
       */
      const account = accountById.get(item.accountId);
      if (!account || !isVisibleOwner(account.ownerId)) continue;
      addTo(accountBucket(account, fee.toString(), 1));
      continue;
    }

    /*
     * 들어온 수입.
     *
     * 수입은 받는 쪽 다리에 붙는다(entry-view 가 accountId 를 그 계좌로 준다).
     *
     * **카드로도 들어온다.** 카드사가 되돌려 주는 돈이 통장을 거치지 않고 다음 청구에서
     * 빠지면, 그 돈이 들어온 자리는 그 카드의 빚이다. 그때는 카드 칸에 붙인다 --
     * 계좌로 붙이면 목록에서 감춰 둔 카드 부채 계정이 결제수단으로 튀어나온다.
     */
    if (item.kind === 'income') {
      if (item.cardId) {
        const card = cardById.get(item.cardId);
        if (!card || !isVisibleOwner(card.ownerId)) continue;
        addTo(cardBucket(card, '0', 0, amount.toString()));
        continue;
      }
      if (!item.accountId) continue;
      const account = accountById.get(item.accountId);
      if (!account || !isVisibleOwner(account.ownerId)) continue;
      addTo(accountBucket(account, '0', 0, amount.toString()));
      continue;
    }

    if (item.kind !== 'expense') continue;

    if (item.cardId) {
      const card = cardById.get(item.cardId);
      if (!card || !isVisibleOwner(card.ownerId)) continue;
      addTo(cardBucket(card, amount.toString(), 1));
    } else if (item.accountId) {
      const account = accountById.get(item.accountId);
      if (!account || !isVisibleOwner(account.ownerId)) continue;
      addTo(accountBucket(account, amount.toString(), 1));
    }
  }

  return [...buckets.values()].sort((a, b) => Number(b.amount) - Number(a.amount));
}
