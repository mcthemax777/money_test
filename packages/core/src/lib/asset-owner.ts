/**
 * 통장과 카드의 주인.
 *
 * 검색 창과 조건 알약이 함께 쓴다. "국민은행 통장"이 셋 있는 집에서는 이름만으로
 * 어느 것을 고르는지 알 수 없다. 주인을 함께 적어야 고를 수 있다.
 *
 * **카드는 결제 통장의 주인을 따른다.** 카드 자체에는 주인이 없고(Card 에는 결제
 * 통장만 있다), 자산 화면도 카드를 그 통장 아래에 세운다. 같은 규칙을 여기서도 쓴다.
 */
import type { AccountDto, CardDto } from '@money/types';

/** 자산 id(통장·카드) -> 주인 이름. 주인을 알 수 없는 것은 담기지 않는다. */
export function assetOwnerNames(
  accounts: AccountDto.Response[],
  cards: CardDto.Response[],
  /** 계좌에 owner 가 실려 오지 않을 때 이름을 찾을 구성원 목록 */
  people: Array<{ id: string; name: string }> = [],
): Map<string, string> {
  const personName = new Map(people.map((person) => [person.id, person.name]));
  const owners = new Map<string, string>();

  for (const account of accounts) {
    // ownerId 는 주인이 없는 계좌에서 null 이다 (자본 계정 등).
    const name = account.owner?.name ?? (account.ownerId ? personName.get(account.ownerId) : undefined);
    if (name) owners.set(account.id, name);
  }

  for (const card of cards) {
    const name = owners.get(card.paymentAccountId);
    if (name) owners.set(card.id, name);
  }

  return owners;
}

/**
 * 주인 이름을 적어야 하는가.
 *
 * 주인이 하나뿐인 가계부에서는 적지 않는다. 모든 줄에 같은 이름이 붙으면 고르는 데
 * 도움이 되지 않고 이름만 길어진다.
 */
export function hasSeveralOwners(owners: Map<string, string>): boolean {
  return new Set(owners.values()).size > 1;
}

/**
 * 카드를 자산 화면과 같은 차례로 세운다.
 *
 * 자산 화면은 카드를 결제 통장 아래에 세운다. 검색 창은 주인별로만 묶으므로, 통장의
 * 차례를 따라 세워야 두 화면의 차례가 같아진다. 서버가 주는 카드 순서는 통장을 보지
 * 않아 "외화카드 · com2us · nori · ktMmobile"처럼 통장이 뒤섞인다.
 *
 * 같은 통장에 딸린 카드끼리는 받은 차례를 그대로 둔다 (사용자가 정한 순서다).
 */
export function sortCardsByAccount(
  cards: CardDto.Response[],
  accounts: AccountDto.Response[],
): CardDto.Response[] {
  const place = new Map(accounts.map((account, index) => [account.id, index]));
  // 통장을 찾지 못한 카드는 맨 뒤로. 숨긴 통장에 딸린 카드가 그렇다.
  const placeOf = (card: CardDto.Response) => place.get(card.paymentAccountId) ?? accounts.length;

  return [...cards].sort((a, b) => placeOf(a) - placeOf(b));
}

/** 주인별로 묶은 한 덩이. */
export interface OwnerGroup<T> {
  /** 주인 이름. 주인을 알 수 없는 것들은 null 로 묶인다. */
  ownerName: string | null;
  items: T[];
}

/**
 * 주인별로 묶는다. 묶음 안의 차례는 받은 목록을 그대로 따른다.
 *
 * 묶음의 차례는 `ownerOrder`(구성원 목록의 차례)를 따른다. 자산 화면이 구성원을 그
 * 차례로 세우므로 두 화면의 차례가 같아진다. 주지 않으면 목록에 먼저 나온 순이다 --
 * 그 경우 서버와 기기 사본의 정렬 규칙이 조금만 달라도 웹과 앱의 차례가 갈린다.
 *
 * 주인을 알 수 없는 묶음은 언제나 맨 뒤다.
 */
export function groupByOwner<T extends { id: string }>(
  items: T[],
  owners: Map<string, string>,
  /** 구성원 이름의 차례. 자산 화면이 세우는 순서다. */
  ownerOrder: readonly string[] = [],
): Array<OwnerGroup<T>> {
  const groups: Array<OwnerGroup<T>> = [];
  const indexOf = new Map<string, number>();

  for (const item of items) {
    const ownerName = owners.get(item.id) ?? null;
    const key = ownerName ?? '';
    const found = indexOf.get(key);

    if (found === undefined) {
      indexOf.set(key, groups.length);
      groups.push({ ownerName, items: [item] });
    } else {
      groups[found].items.push(item);
    }
  }

  // 목록에 없는 이름과 주인 없는 묶음은 뒤로. 안정 정렬이라 그들끼리는 나온 차례 그대로다.
  const place = (group: OwnerGroup<T>) => {
    if (group.ownerName === null) return ownerOrder.length + 1;
    const found = ownerOrder.indexOf(group.ownerName);
    return found < 0 ? ownerOrder.length : found;
  };

  return groups.sort((a, b) => place(a) - place(b));
}
