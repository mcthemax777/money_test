/**
 * 총자산을 쪼개 보는 자리들이 함께 쓰는 계산.
 *
 * 자산 화면과 홈이 같은 응답(/reports/net-worth)을 다르게 나눠 보여 준다. 나누는
 * 규칙이 화면마다 따로 있으면 같은 계좌가 한쪽에서는 투자, 다른 쪽에서는 현금성으로
 * 세어질 수 있다.
 */
import {
  ASSET_GROUP_KEYS,
  ASSET_GROUP_OF,
  assetGroupOf,
  slotOf,
  type AccountType,
  type AssetGroupKey,
  type ReportDto,
} from '@money/types';

import type { MessageKey } from '../lib/i18n';
import { toAmountString, toNumber } from './money';

/*
 * 유형이 드는 묶음은 서버와 기기가 함께 쓰는 순자산 집계(@money/types 의
 * net-worth-aggregation)가 정한다. 여기서는 그 규칙으로 화면의 네 칸을 만든다.
 */
export type { AssetGroupKey };

/** 총자산을 이루는 세 값과 유형별·묶음별 소계 */
export type NetWorthParts = Pick<
  ReportDto.NetWorth,
  'cash' | 'investment' | 'liability' | 'byType' | 'byGroup'
>;

/** 금액 표를 하나로 더한다. 키가 없는 행은 0으로 본다. */
function addAmounts<K extends string>(
  tables: Array<Partial<Record<K, string>> | undefined>,
): Partial<Record<K, string>> {
  const sums = new Map<K, number>();
  for (const table of tables) {
    for (const [key, amount] of Object.entries(table ?? {}) as Array<[K, string]>) {
      sums.set(key, (sums.get(key) ?? 0) + toNumber(amount));
    }
  }
  return Object.fromEntries(
    [...sums].map(([key, amount]) => [key, toAmountString(amount)]),
  ) as Partial<Record<K, string>>;
}

/**
 * 고른 자산주인들의 소계를 하나로 합친다.
 *
 * 서버가 준 전체 합계(total)는 주인 없는 계좌까지 담고 있어 일부만 골랐을 때
 * 쓸 수 없다. 계좌가 없는 구성원은 소계 자체가 없으므로 건너뛴다.
 *
 * 묶음별 소계는 모든 행에 있을 때만 더한다. 하나라도 없는 옛 응답이 섞이면 반쪽 합이
 * 되므로, 그때는 비워 두어 화면이 유형별 소계로 되돌아가게 한다 (`assetGroupAmount`).
 */
export function sumNetWorth(
  rows: Array<NetWorthParts | undefined>,
): NetWorthParts & { total: string } {
  const present = rows.filter((row): row is NetWorthParts => row !== undefined);
  const sum = present.reduce(
    (acc, row) => ({
      cash: acc.cash + toNumber(row.cash),
      investment: acc.investment + toNumber(row.investment),
      liability: acc.liability + toNumber(row.liability),
    }),
    { cash: 0, investment: 0, liability: 0 },
  );

  return {
    cash: toAmountString(sum.cash),
    investment: toAmountString(sum.investment),
    liability: toAmountString(sum.liability),
    byType: addAmounts<AccountType>(present.map((row) => row.byType)),
    ...(present.every((row) => row.byGroup)
      ? { byGroup: addAmounts<AssetGroupKey>(present.map((row) => row.byGroup)) }
      : {}),
    total: toAmountString(sum.cash + sum.investment + sum.liability),
  };
}

const GROUP_LABEL: Record<AssetGroupKey, MessageKey> = {
  cash: 'assetGroup.cash',
  savings: 'assetGroup.savings',
  investment: 'assetGroup.investment',
  debt: 'assetGroup.debt',
};

/** 네 묶음과 그 안의 유형. 화면에 늘어서는 차례다. */
export const ASSET_TYPE_GROUPS: Array<{
  key: AssetGroupKey;
  /** 사전의 열쇠. 이름 자체가 아니라 열쇠를 두어야 언어를 따라간다. */
  labelKey: MessageKey;
  types: AccountType[];
}> = ASSET_GROUP_KEYS.map((key) => ({
  key,
  labelKey: GROUP_LABEL[key],
  types: (Object.keys(ASSET_GROUP_OF) as AccountType[]).filter(
    (type) => assetGroupOf(type) === key,
  ),
}));

/**
 * 계좌들을 네 묶음으로 나눈다. 빈 묶음은 빼고, 묶음 안의 차례는 받은 그대로다.
 * 자산 탭의 "자산유형별" 목록이 쓴다.
 */
export function groupAccountsByAsset<T extends { type: string }>(
  accounts: readonly T[],
): Array<{ group: (typeof ASSET_TYPE_GROUPS)[number]; accounts: T[] }> {
  return ASSET_TYPE_GROUPS.map((group) => ({
    group,
    accounts: accounts.filter((account) => assetGroupOf(account.type) === group.key),
  })).filter((row) => row.accounts.length > 0);
}

/**
 * 고른 사람들의 계좌를 네 묶음으로 나눈다. 자산 탭의 "자산유형별" 목록과 묶음 상세가 쓴다.
 *
 * 사람 차례 → 그 사람 안의 차례로 늘어놓은 뒤 나눈다. 그래서 한 묶음 안에서도 같은
 * 사람의 계좌가 이웃하고, 각자 정한 차례가 남는다.
 */
export function groupAccountsOfPeople<T extends { type: string; ownerId?: string | null }>(
  people: readonly { id: string }[],
  accounts: readonly T[],
): ReturnType<typeof groupAccountsByAsset<T>> {
  return groupAccountsByAsset(
    people.flatMap((person) => accounts.filter((account) => account.ownerId === person.id)),
  );
}

/**
 * 한 묶음의 소계.
 *
 * 묶음별 소계(byGroup)를 읽는다. 카드 대금이 결제 통장의 묶음에 들어 있는 값이다.
 * 그것이 없는 옛 응답이면 유형별 소계를 묶어 더한다 -- 그때 카드 대금은 모두
 * 입출금·현금에 든다.
 */
export function assetGroupAmount(
  parts: Pick<NetWorthParts, 'byType' | 'byGroup'> | undefined,
  group: (typeof ASSET_TYPE_GROUPS)[number],
): number {
  if (parts?.byGroup) return toNumber(parts.byGroup[group.key]);
  return group.types.reduce((acc, type) => acc + toNumber(parts?.byType?.[type]), 0);
}

/**
 * 합계에서 뺄 계좌를 덜어 낸 총자산 (자산 탭의 합계 제외, 2026-10-10 사용자 요청).
 *
 * 총액·세 칸·유형별·묶음별·사람별 소계에서 그 계좌가 더한 값을 그대로 뺀다. 계좌가
 * 어느 칸에 얼마를 더했는지는 응답의 `byAccount` 가 말한다 -- 시가·환율을 다시 셈하지
 * 않아도 되고, 카드 대금이 결제 통장의 묶음에 든 것도 그대로 따라온다.
 *
 * `byAccount` 가 없는 옛 응답이면 뺄 수 없어 받은 그대로 돌려준다. 그때 목록의
 * "합계 제외" 표시만 서고 금액은 그대로다.
 */
export function withoutAccounts(
  netWorth: ReportDto.NetWorth | null,
  excludedIds: ReadonlySet<string>,
): ReportDto.NetWorth | null {
  if (!netWorth?.byAccount || excludedIds.size === 0) return netWorth;
  const removed = netWorth.byAccount.filter((part) => excludedIds.has(part.accountId));
  if (removed.length === 0) return netWorth;

  /* 한 바구니(전체 또는 한 사람)에서 덜어 낸다. 남은 값이 0이면 키를 뺀다 (응답과 같은 모양). */
  const subtract = <B extends NetWorthParts & { total: string }>(
    bucket: B,
    parts: readonly ReportDto.NetWorthAccountPart[],
  ): B => {
    if (parts.length === 0) return bucket;
    const minus = (table: Partial<Record<string, string>> | undefined, key: string, amount: number) => {
      const left = toNumber(table?.[key]) - amount;
      const { [key]: _drop, ...rest } = table ?? {};
      return left === 0 ? rest : { ...rest, [key]: toAmountString(left) };
    };

    let next: B = { ...bucket };
    for (const part of parts) {
      const amount = toNumber(part.amount);
      const slot = slotOf(part.type);
      next = {
        ...next,
        total: toAmountString(toNumber(next.total) - amount),
        [slot]: toAmountString(toNumber(next[slot]) - amount),
        byType: minus(next.byType, part.type, amount),
        ...(next.byGroup ? { byGroup: minus(next.byGroup, part.group, amount) } : {}),
      };
    }
    return next;
  };

  return {
    ...subtract(netWorth, removed),
    byAccount: netWorth.byAccount.filter((part) => !excludedIds.has(part.accountId)),
    byPerson: netWorth.byPerson.map((person) =>
      subtract(
        person,
        removed.filter((part) => part.ownerId === person.personId),
      ),
    ),
  };
}

/**
 * 합계 제외로 실제로 빼야 하는 계정들.
 *
 * 고른 계좌에 더해, 그 계좌를 결제 통장으로 쓰는 카드의 대금 계정도 뺀다. 목록에서 카드는
 * 결제 통장 밑에 달려 있고 통장 줄의 금액도 카드 대금을 뺀 값이라, 통장을 빼면서 그
 * 대금만 남기면 합계가 빚만큼 엉뚱하게 줄어든다.
 */
export function excludedLedgerAccountIds(
  excludedAccountIds: readonly string[],
  cards: readonly { paymentAccountId?: string | null; liabilityAccountId?: string | null }[],
): Set<string> {
  const ids = new Set(excludedAccountIds);
  for (const card of cards) {
    if (card.liabilityAccountId && card.paymentAccountId && ids.has(card.paymentAccountId)) {
      ids.add(card.liabilityAccountId);
    }
  }
  return ids;
}
