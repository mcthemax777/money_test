'use client';

import { useMemo, type ReactNode } from 'react';
import type { ReportDto } from '@money/types';
import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import { ASSET_TYPE_GROUPS, assetGroupAmount } from '@money/core/lib/net-worth';
import { useAssetTypeFilter } from '@money/core/store/asset-type-filter';
import { useProjectDisplayCurrency } from '@money/core/store/project';

interface AssetTypeSummaryProps {
  byType: ReportDto.NetWorthByType | undefined;
  /**
   * 문장 앞머리에 들어가는 자산주인 제목 ("아빠님의 자산", "전체 자산").
   *
   * 이 화면의 h1을 겸한다. 누르면 자산주인을 고르는 목록이 열린다.
   */
  scopeTitle: ReactNode;
  /** 자산주인을 하나도 고르지 않았는지. 그때는 금액 대신 그 사실을 적는다. */
  hasNoScope: boolean;
}

/**
 * 첫 줄 인사와 유형별 소계.
 *
 * "○○님의 자산은 1억 2,345만 원입니다"로 시작한다. 화면 이름("홈")을 적는 대신
 * 지금 궁금한 값을 문장으로 먼저 말한다.
 *
 * 유형 넷은 계좌 유형을 빠짐없이 나눈 것이라(lib/net-worth의 ASSET_TYPE_GROUPS)
 * 넷을 다 켜면 문장의 금액이 총자산이 된다. 대출은 갚아야 할 돈이라 음수로 나온다.
 *
 * 카드를 눌러 끄면 그 유형을 뺀 금액이 문장에 나온다. "대출을 빼면 얼마인가",
 * "당장 쓸 수 있는 돈은 얼마인가"는 총액 하나로는 답할 수 없는 질문이다.
 * 어느 것을 켜 뒀는지는 브라우저에 남는다. 볼 때마다 다시 고르지 않아도 된다.
 */
export default function AssetTypeSummary({
  byType,
  scopeTitle,
  hasNoScope,
}: AssetTypeSummaryProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { selectedKeys, toggleKey } = useAssetTypeFilter();

  /* 켜 둔 유형의 합과 그 이름. 화면에 늘어놓은 차례를 그대로 따른다. */
  const { total, label } = useMemo(() => {
    const selected = ASSET_TYPE_GROUPS.filter((group) => selectedKeys.includes(group.key));
    return {
      total: selected.reduce((acc, group) => acc + assetGroupAmount(byType, group.types), 0),
      label: selected.map((group) => t(group.labelKey)).join(', '),
    };
  }, [byType, selectedKeys, t]);

  return (
    <div className="space-y-4">
      <div>
        {/* 제목과 "은"이 한 문장으로 읽히도록 같은 줄에 둔다. */}
        <div className="flex flex-wrap items-center">
          {scopeTitle}
          {/*
            제목 버튼은 누를 자리를 넓히려고 좌우 여백(px-2)을 갖는다. 그대로 두면
            "자산"과 "은" 사이가 벌어지므로 그 여백만큼 당겨 붙인다.

            relative를 함께 준다. 제목은 자리를 잡은(relative) 상자라 그냥 두면
            마우스를 올렸을 때의 회색 바탕이 "은" 위에 얹혀 글자를 덮는다.
          */}
          {/*
            조사는 언어마다 있고 없다. 영어 사전은 이 자리를 비워 두어 제목 다음에
            바로 금액이 오게 한다.
          */}
          <span className="relative -ml-2 text-2xl font-bold text-gray-900">
            {t('assetSummary.particle')}
          </span>
        </div>

        {hasNoScope ? (
          <p className="mt-1 text-lg text-gray-600">{t('assetSummary.noScope')}</p>
        ) : (
          <p className="mt-1 text-4xl font-bold text-gray-900 tabular-nums">
            {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
            {formatAmountWithUnit(total, displayCurrency)}
            <span className="ml-2 text-xl font-medium text-gray-500">
              {t('assetSummary.suffix')}
            </span>
          </p>
        )}

        {/* 무엇을 더한 금액인지. 카드를 끄면 이 줄도 함께 줄어든다. */}
        <p className="mt-1 text-sm text-gray-500">{label || t('assetSummary.noType')}</p>
      </div>

      {/*
        유형 넷. 눌러서 위 금액에서 빼고 더한다.
        넷이 한눈에 들어와야 해서 좁은 화면에서는 두 줄로 접는다. 옆으로 넘기게 두면
        넷째 칸이 화면 밖에 있어 "왜 대출이 없지"가 된다.
      */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ASSET_TYPE_GROUPS.map((group) => {
          const amount = assetGroupAmount(byType, group.types);
          const isSelected = selectedKeys.includes(group.key);
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => toggleKey(group.key)}
              aria-pressed={isSelected}
              /* 고른 표시는 가계의 분류별 목록과 같은 파란 바탕이다. */
              className={`rounded-lg border p-3 text-left transition ${
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="flex items-center gap-1.5 text-xs text-gray-600">
                {/* 켜 둔 것을 색으로도 알린다. 글자 색만으로는 흑백에서 갈리지 않는다. */}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSelected ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                  aria-hidden
                />
                <span className="truncate">{t(group.labelKey)}</span>
              </p>
              <p
                className={`mt-1 text-base font-semibold tabular-nums ${
                  amount < 0 ? 'text-red-600' : 'text-gray-900'
                }`}
              >
                {formatCurrency(amount, displayCurrency)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
