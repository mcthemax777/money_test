/*
 * 거래 폼의 결제수단·이체 계좌 고르기 목록을 만든다.
 *
 * 둘 다 "사람마다 묶고, 계좌 아래에 그 통장에서 빠져나가는 카드를 단다"는 같은 짜임이라
 * 한곳에 둔다. 문구는 부르는 쪽의 t 로 받는다.
 */
import type { Account, Card, Person } from '@money/core/lib/types';
import type { MessageKey } from '@money/core/lib/i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type GroupedOption = { id: string; name: string; group: string };

interface OptionSource {
  accounts: Account[];
  cards: Card[];
  people: Person[];
  t: Translate;
  /** 주인 없는 계좌·카드를 담는 묶음의 이름. */
  otherOwnerGroup: string;
}

/** 사람 목록에 없는 주인(또는 주인 없는 시스템 계정)의 계좌. 맨 끝 묶음에 모인다. */
function orphanAccountsOf(accounts: Account[], people: Person[]): Account[] {
  const knownOwnerIds = new Set(people.map((person) => person.id));
  return accounts.filter((account) => !account.ownerId || !knownOwnerIds.has(account.ownerId));
}

/**
 * 결제수단 드롭다운 옵션. 계좌와 카드를 한 목록에 합친다.
 *
 * 종류를 잃지 않도록 id에 접두사를 붙인다("account:xxx" / "card:xxx").
 * 라벨의 "(계좌)"/"(카드)"는 사용자가 종류를 구분하기 위한 표시다.
 *
 * 계좌 주인은 라벨에 붙이지 않고 고를 수 없는 머리글로 묶는다. 이름을 항목마다
 * 반복하면 정작 구분해야 할 계좌명이 뒤로 밀린다. 카드는 결제 통장을 따라
 * 그 통장 바로 아래에 둔다 — 어느 통장에서 빠져나가는 카드인지가 고를 때 필요한
 * 정보이기 때문이다.
 */
export function buildPaymentMethodOptions({
  accounts,
  cards,
  people,
  t,
  otherOwnerGroup,
}: OptionSource): GroupedOption[] {
  const cardsOfAccount = new Map<string, Card[]>();
  for (const card of cards) {
    const list = cardsOfAccount.get(card.paymentAccountId) ?? [];
    list.push(card);
    cardsOfAccount.set(card.paymentAccountId, list);
  }

  const cardLabel = (card: Card) =>
    t('editor.cardOption', {
      name: `${card.name}${card.issuer?.name ? ` · ${card.issuer.name}` : ''}`,
    });

  /*
   * 맨 위는 "선택 안 함"이다. 지출·수입은 결제수단 없이 적을 수 있고, 그러면 서버가
   * 미지정 계정에 붙인다. 한 번 고른 뒤 되돌릴 길이 있어야 해서 목록에 둔다.
   */
  const options: GroupedOption[] = [{ id: '', name: t('editor.noMethod'), group: '' }];
  const listed = new Set<string>();

  const pushOwner = (group: string, owned: Account[]) => {
    for (const account of owned) {
      options.push({
        id: `account:${account.id}`,
        name: t('editor.accountOption', { name: account.name }),
        group,
      });
      for (const card of cardsOfAccount.get(account.id) ?? []) {
        options.push({ id: `card:${card.id}`, name: cardLabel(card), group });
        listed.add(card.id);
      }
    }
  };

  for (const person of people) {
    const owned = accounts.filter((account) => account.ownerId === person.id);
    if (owned.length > 0) pushOwner(person.name, owned);
  }

  // 주인이 없거나(시스템 계정) 사람 목록에 없는 주인의 계좌, 그리고 결제 통장이
  // 목록에 없는 카드는 맨 끝에 모은다.
  const orphanAccounts = orphanAccountsOf(accounts, people);
  if (orphanAccounts.length > 0) pushOwner(otherOwnerGroup, orphanAccounts);

  for (const card of cards) {
    if (listed.has(card.id)) continue;
    options.push({ id: `card:${card.id}`, name: cardLabel(card), group: otherOwnerGroup });
  }

  return options;
}

/**
 * 이체에서 고를 수 있는 계좌. 신용카드 부채 계정을 함께 넣는다.
 *
 * 부채 계정은 통장 목록(GET /accounts)에서 감춰져 있다. 지출 결제수단이나
 * 자산 화면에 새어 나가면 안 되므로 서버 목록을 열지 않고, 이미 받아 둔 카드에서
 * liabilityAccountId를 꺼내 이 화면에서만 조립한다.
 */
export function buildTransferAccountOptions({
  accounts,
  cards,
  people,
  t,
  otherOwnerGroup,
}: OptionSource): GroupedOption[] {
  const creditCards = cards.filter((card) => card.cardType === 'credit' && card.liabilityAccountId);

  const options: GroupedOption[] = [];
  const listed = new Set<string>();

  const pushOwner = (group: string, owned: Account[]) => {
    for (const account of owned) {
      options.push({ id: account.id, name: account.name, group });
      for (const card of creditCards.filter((c) => c.paymentAccountId === account.id)) {
        options.push({
          id: card.liabilityAccountId!,
          name: t('editor.cardOption', { name: card.name }),
          group,
        });
        listed.add(card.id);
      }
    }
  };

  for (const person of people) {
    const owned = accounts.filter((account) => account.ownerId === person.id);
    if (owned.length > 0) pushOwner(person.name, owned);
  }

  const orphanAccounts = orphanAccountsOf(accounts, people);
  if (orphanAccounts.length > 0) pushOwner(otherOwnerGroup, orphanAccounts);

  for (const card of creditCards) {
    if (listed.has(card.id)) continue;
    options.push({
      id: card.liabilityAccountId!,
      name: t('editor.cardOption', { name: card.name }),
      group: otherOwnerGroup,
    });
  }

  return options;
}
