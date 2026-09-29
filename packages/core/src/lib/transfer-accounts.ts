/**
 * 이체의 양쪽에 고를 수 있는 것. 반복 등록 팝업(웹·앱)이 함께 쓴다.
 *
 * 보내는 쪽은 통장이다. 받는 쪽은 통장에 더해 **신용카드의 부채 계정**도 된다 -- 카드대금
 * 자동이체("매달 14일 신한카드 대금")가 통장에서 그 카드로 가는 이체이기 때문이다.
 * 거래 폼의 이체 목록과 같은 규칙이다.
 *
 * 카드 부채·기초잔액 계정은 통장 목록에 두지 않는다. 사람이 만든 통장이 아니다.
 */

import { HIDDEN_ACCOUNT_TYPES } from '@money/types';

import type { Account, Card } from './types';

export interface TransferOption {
  /** 계정 id. 카드면 그 카드의 부채 계정이다. */
  id: string;
  name: string;
  /** 카드 부채 계정인가. 화면이 "카드: 이름" 으로 적는다. */
  isCard: boolean;
}

/** 보내는 쪽. 쓰고 있는 통장만. */
export function transferFromOptions(accounts: Account[]): TransferOption[] {
  return accounts
    .filter((account) => account.isActive && !HIDDEN_ACCOUNT_TYPES.includes(account.type))
    .map((account) => ({ id: account.id, name: account.name, isCard: false }));
}

/** 받는 쪽. 보내는 통장은 뺀다(같은 통장으로는 이체가 안 된다). */
export function transferToOptions(
  accounts: Account[],
  cards: Card[],
  fromAccountId: string | null,
): TransferOption[] {
  const creditCards = cards
    .filter((card) => card.isActive && card.cardType === 'credit' && card.liabilityAccountId)
    .map((card) => ({ id: card.liabilityAccountId as string, name: card.name, isCard: true }));

  return [...transferFromOptions(accounts), ...creditCards].filter(
    (option) => option.id !== fromAccountId,
  );
}
