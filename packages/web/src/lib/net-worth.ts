/**
 * 총자산을 쪼개 보는 자리들이 함께 쓰는 계산.
 *
 * 자산 화면과 홈이 같은 응답(/reports/net-worth)을 다르게 나눠 보여 준다. 나누는
 * 규칙이 화면마다 따로 있으면 같은 계좌가 한쪽에서는 투자, 다른 쪽에서는 현금성으로
 * 세어질 수 있다.
 */
import type { AccountType, ReportDto } from '@money/types';

import { toAmountString, toNumber } from './money';

/** 총자산을 이루는 세 값과 유형별 소계 */
export type NetWorthParts = Pick<
  ReportDto.NetWorth,
  'cash' | 'investment' | 'liability' | 'byType'
>;

/**
 * 고른 자산주인들의 소계를 하나로 합친다.
 *
 * 서버가 준 전체 합계(total)는 주인 없는 계좌까지 담고 있어 일부만 골랐을 때
 * 쓸 수 없다. 계좌가 없는 구성원은 소계 자체가 없으므로 건너뛴다.
 */
export function sumNetWorth(
  rows: Array<NetWorthParts | undefined>,
): NetWorthParts & { total: string } {
  const byType = new Map<AccountType, number>();
  const sum = rows.reduce(
    (acc, row) => {
      for (const [type, amount] of Object.entries(row?.byType ?? {})) {
        const key = type as AccountType;
        byType.set(key, (byType.get(key) ?? 0) + toNumber(amount));
      }
      return {
        cash: acc.cash + toNumber(row?.cash),
        investment: acc.investment + toNumber(row?.investment),
        liability: acc.liability + toNumber(row?.liability),
      };
    },
    { cash: 0, investment: 0, liability: 0 },
  );

  return {
    cash: toAmountString(sum.cash),
    investment: toAmountString(sum.investment),
    liability: toAmountString(sum.liability),
    byType: Object.fromEntries(
      [...byType].map(([type, amount]) => [type, toAmountString(amount)]),
    ) as ReportDto.NetWorthByType,
    total: toAmountString(sum.cash + sum.investment + sum.liability),
  };
}

/**
 * 홈의 유형별 카드.
 *
 * 계좌 유형을 빠짐없이 넷으로 묶는다. 하나라도 빠지면 카드 넷을 더한 값이 위의
 * 총자산과 달라진다. 카드 사용액(credit_card)은 갚아야 할 돈이라 대출과 같은 칸에 든다.
 * 자본 계정(opening_balance)은 순자산에서 빠지므로 응답에 아예 없다.
 */
export const ASSET_TYPE_GROUPS: Array<{ key: string; label: string; types: AccountType[] }> = [
  { key: 'cash', label: '예금/현금', types: ['deposit', 'cash'] },
  { key: 'savings', label: '적금/연금', types: ['savings'] },
  { key: 'investment', label: '투자', types: ['investment', 'real_estate'] },
  { key: 'debt', label: '대출', types: ['loan', 'credit_card'] },
];

/** 한 묶음의 소계. 서버가 보내지 않은 유형은 0이다. */
export function assetGroupAmount(
  byType: ReportDto.NetWorthByType | undefined,
  types: AccountType[],
): number {
  return types.reduce((acc, type) => acc + toNumber(byType?.[type]), 0);
}
