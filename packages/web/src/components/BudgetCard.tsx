'use client';

import { ChevronDown } from 'lucide-react';
import { budgetPercentage } from '@/lib/budget';

/** 목록에서 이 줄이 어느 단계인지. 들여쓰기와 글자 크기를 여기서 정한다. */
export type BudgetLevel = 'total' | 'main' | 'sub';

// 예산 수정/삭제는 이 카드가 아니라 오른쪽 상세 분석 패널에서 한다.
interface BudgetCardProps {
  categoryId?: string;
  categoryName?: string;
  monthlyAmount: number;
  usedAmount: number;
  onSelect?: (categoryId: string) => void;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  /** 전체 / 대분류 / 소분류 */
  level?: BudgetLevel;
  /** 오른쪽 상세 분석이 보고 있는 줄. 파란 강조는 선택 표시 전용이다. */
  isSelected?: boolean;
}

/**
 * 단계별 왼쪽 막대 위치. 막대는 모두 4px(w-1) 굵기이고 사이 간격도 4px이다.
 *
 *   전체:    [파란]                        (테두리에 붙여 한 줄처럼 이어 보이게)
 *   대분류:  [테두리] 4px [파란]
 *   소분류:  [테두리] 4px [회색] 4px [파란]
 *
 * 전체의 파란 막대는 아래 대분류들의 테두리선과 이어지는 한 줄로 보여야 하므로
 * 왼쪽 끝에 붙인다. 소분류의 회색 막대는 대분류의 파란 막대와 같은 세로선(4px)에
 * 놓여, 대분류에서 선이 내려오는 것처럼 보인다.
 */
const LEVEL_BARS: Record<BudgetLevel, { gray: string | null; blue: string }> = {
  total: { gray: null, blue: 'left-0' },
  main: { gray: null, blue: 'left-1' },
  sub: { gray: 'left-1', blue: 'left-3' },
};

/** 단계별 모양. 파란색은 "선택"에만 쓰므로 여기서는 회색조와 크기만 다룬다. */
const LEVEL_STYLE: Record<BudgetLevel, { row: string; name: string; used: string }> = {
  total: { row: 'pl-5', name: 'text-sm font-bold text-gray-900', used: 'text-lg font-bold' },
  main: { row: 'pl-5', name: 'text-sm font-semibold text-gray-800', used: 'text-lg font-bold' },
  sub: { row: 'pl-9', name: 'text-sm font-medium text-gray-600', used: 'text-base font-semibold' },
};

export function BudgetCard({
  categoryId,
  categoryName = '전체예산',
  monthlyAmount,
  usedAmount,
  onSelect,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  level = 'main',
  isSelected = false,
}: BudgetCardProps) {
  const percentage = budgetPercentage(monthlyAmount, usedAmount);
  const remainAmount = monthlyAmount - usedAmount;
  const isOverBudget = remainAmount < 0;
  const barColor = percentage > 100 ? 'bg-red-500' : percentage === 0 ? 'bg-gray-300' : 'bg-blue-500';
  const style = LEVEL_STYLE[level];
  const bars = LEVEL_BARS[level];
  const isClickable = Boolean(categoryId && onSelect);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  };

  return (
    /*
      선택 표시는 왼쪽 세로 막대 + 연한 파란 배경이다. 어느 줄의 통계를 보고 있는지
      목록만 봐도 알 수 있어야 한다. 소분류에는 그 자리에 회색 막대가 기본으로 있고,
      고르면 그 오른쪽에 파란 막대가 하나 더 붙는다.
      단계 구분은 들여쓰기·글자 크기·회색 막대로만 하고 파란색은 선택에만 쓴다.
    */
    <div
      aria-current={isSelected ? 'true' : undefined}
      /*
        배경은 한 번만 정한다. 선택과 소분류 음영에 각각 bg-* 클래스를 주면 둘 다
        같은 우선순위라 어느 쪽이 이길지 CSS 순서에 달리게 된다.
      */
      className={`relative border-b border-gray-200 py-3 pr-4 transition ${style.row} ${
        isSelected
          ? 'bg-blue-50'
          : level === 'sub'
            ? 'bg-gray-50/60 hover:bg-gray-100/70'
            : isClickable
              ? 'hover:bg-gray-50'
              : ''
      } ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={() => categoryId && onSelect && onSelect(categoryId)}
    >
      {/* 위치 규칙은 LEVEL_BARS 참고. 부모의 파란 막대 자리에 자식의 회색 막대가 온다. */}
      {bars.gray && (
        <span className={`absolute inset-y-0 w-1 bg-gray-200 ${bars.gray}`} aria-hidden />
      )}
      {isSelected && (
        <span className={`absolute inset-y-0 w-1 bg-blue-600 ${bars.blue}`} aria-hidden />
      )}

      <div className="flex flex-col gap-2">
        {/* 첫 줄: 카테고리명 : 사용금액 */}
        <div className="flex items-center justify-between gap-3">
          {/*
            이름과 화살표를 한 덩어리로 묶어 통째로 누르게 한다. 화살표만 누르던 예전 구조는
            손가락으로 맞히기에 너무 작았다. 펼칠 것이 없는 소분류는 버튼으로 만들지 않는다.
          */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                // 이름을 누르는 것은 "펼치기/접기"다. 오른쪽 상세 분석은 그대로 둔다.
                // 이 줄의 통계를 보려면 줄의 다른 곳(금액·진행률 영역)을 누른다.
                e.stopPropagation();
                onToggleExpand?.();
              }}
              className="flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded hover:bg-gray-200/70 transition"
              aria-expanded={isExpanded}
            >
              <span className={style.name}>{categoryName}</span>
              <ChevronDown
                size={18}
                className={`flex-shrink-0 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className={`truncate ${style.name}`}>{categoryName}</span>
            </div>
          )}
          <div className={`text-gray-900 whitespace-nowrap ${style.used}`}>
            {formatCurrency(usedAmount)}원
          </div>
        </div>

        {/* 두 번째 줄: 프로그래스바, 예산값, 남은액/초과액 - 예산값이 없을 때는 숨김 */}
        {monthlyAmount > 0 && (
          <div className="flex items-center gap-3">
            {/* 프로그레스 바 */}
            <div className="flex-1 min-w-[120px]">
              <div className="h-2 bg-gray-100 rounded-md overflow-hidden relative">
                <div
                  className={`h-full ${barColor} transition-all duration-300`}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">{percentage}%</div>
            </div>

            {/* 예산값 및 남은액/초과액 */}
            <div className="text-right text-sm">
              <div className="font-semibold text-gray-900">예산금액: {formatCurrency(monthlyAmount)}원</div>
              <div className={`text-xs font-semibold ${isOverBudget ? 'text-red-500' : 'text-gray-600'}`}>
                {isOverBudget ? `초과 ${formatCurrency(Math.abs(remainAmount))}원` : `남은금액 ${formatCurrency(remainAmount)}원`}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
