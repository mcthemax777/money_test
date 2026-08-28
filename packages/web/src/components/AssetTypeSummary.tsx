'use client';

import { useMemo } from 'react';
import type { ReportDto } from '@money/types';
import { formatCurrency } from '@/lib/money';
import { ASSET_TYPE_GROUPS, assetGroupAmount } from '@/lib/net-worth';
import { useAssetTypeFilter } from '@/store/asset-type-filter';
import { useProjectDisplayCurrency } from '@/store/project';

interface AssetTypeSummaryProps {
  byType: ReportDto.NetWorthByType | undefined;
}

/**
 * 총 자산과 유형별 소계.
 *
 * 유형 넷은 계좌 유형을 빠짐없이 나눈 것이라(lib/net-worth의 ASSET_TYPE_GROUPS)
 * 넷을 다 켜면 위의 금액이 총자산이 된다. 대출은 갚아야 할 돈이라 음수로 나온다.
 *
 * 카드를 눌러 끄면 그 유형을 뺀 금액이 위에 나온다. "대출을 빼면 얼마인가",
 * "당장 쓸 수 있는 돈은 얼마인가"는 총액 하나로는 답할 수 없는 질문이다.
 * 위 제목은 지금 켜 둔 유형 이름을 이어 붙여, 그 금액이 무엇의 합인지 밝힌다.
 * 어느 것을 켜 뒀는지는 브라우저에 남는다. 볼 때마다 다시 고르지 않아도 된다.
 *
 * 좁은 화면에서는 옆으로 넘겨서 본다. 카드를 접어 두 줄로 만들면 넷째 칸이
 * 화면 밖으로 밀려 "왜 대출이 없지"가 된다.
 */
export default function AssetTypeSummary({ byType }: AssetTypeSummaryProps) {
  const displayCurrency = useProjectDisplayCurrency();
  const { selectedKeys, toggleKey } = useAssetTypeFilter();

  /* 켜 둔 유형의 합과 그 이름. 화면에 늘어놓은 차례를 그대로 따른다. */
  const { total, title } = useMemo(() => {
    const selected = ASSET_TYPE_GROUPS.filter((group) => selectedKeys.includes(group.key));
    return {
      total: selected.reduce((acc, group) => acc + assetGroupAmount(byType, group.types), 0),
      title: selected.map((group) => group.label).join(', '),
    };
  }, [byType, selectedKeys]);

  return (
    <div className="space-y-3">
      <div className="bg-blue-600 text-white rounded-lg p-6">
        {/* 하나도 켜지 않으면 더할 것이 없다. 0원이 무엇의 0인지 밝힌다. */}
        <p className="text-sm opacity-90">{title || '고른 유형 없음'}</p>
        <p className="text-4xl font-bold mt-2">{formatCurrency(total, displayCurrency)}</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {ASSET_TYPE_GROUPS.map((group) => {
          const amount = assetGroupAmount(byType, group.types);
          const isSelected = selectedKeys.includes(group.key);
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => toggleKey(group.key)}
              aria-pressed={isSelected}
              /*
                고른 표시는 가계의 분류별 목록과 같은 파란 바탕이다. 다만 여기서는
                ring을 쓰지 않는다. ring은 테두리 바깥에 1px을 더 그려서 고른 카드만
                굵어 보이고, 가로로 넘기는 칸이라 양끝에서는 그 선이 잘리기도 한다.
                테두리 두께는 그대로 두고 색만 바꾼다.
              */
              className={`min-w-[9.5rem] flex-1 shrink-0 rounded-lg border p-4 text-left transition ${
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-600">{group.label}</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
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
