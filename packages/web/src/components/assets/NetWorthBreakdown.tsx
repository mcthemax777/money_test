'use client';

/*
 * 구성원 상세 머리글 아래의 묶음별 금액 한 줄.
 */
import { ASSET_TYPE_GROUPS, assetGroupAmount, type NetWorthParts } from '@money/core/lib/net-worth';
import { formatCurrency } from '@money/core/lib/money';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 네 묶음(입출금·현금 · 예적금·연금 · 투자 · 대출)의 금액 한 줄.
 *
 * 구성원 패널이 쓴다. 나누는 규칙은 맨 위 유형 카드와 같다 (`ASSET_TYPE_GROUPS`).
 * 금액이 있는 묶음이 하나뿐이면 총자산이 곧 그것이라 쪼갤 것이 없어 그리지 않는다.
 */
export default function NetWorthBreakdown({
  parts,
  className,
}: {
  parts: NetWorthParts | undefined;
  className: string;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  if (!parts) return null;
  const amounts = ASSET_TYPE_GROUPS.map((group) => ({
    group,
    amount: assetGroupAmount(parts, group),
  })).filter((row) => row.amount !== 0);
  if (amounts.length < 2) return null;

  return (
    <p className={className}>
      {amounts
        .map(({ group, amount }) => `${t(group.labelKey)} ${formatCurrency(amount, displayCurrency)}`)
        .join(' · ')}
    </p>
  );
}
