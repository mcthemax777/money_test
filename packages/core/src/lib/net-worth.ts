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
  type AccountType,
  type AssetGroupKey,
  type ReportDto,
} from '@money/types';

import type { MessageKey } from '../lib/i18n';
import { toAmountString, toNumber } from './money';

/*
 * 유형이 드는 묶음은 서버와 기기가 함께 쓰는 순자산 집계(@money/types 의
 * net-worth-aggregation)가 정한다. 화면은 여기서 이름만 다시 받는다.
 */
export { assetGroupOf, type AssetGroupKey };

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
 * 자산 탭의 사람 상자 안 목록이 쓴다.
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
