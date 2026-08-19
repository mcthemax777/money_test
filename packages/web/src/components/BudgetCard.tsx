'use client';

import { ChevronDown } from 'lucide-react';
import { budgetPercentage } from '@/lib/budget';

// 예산 수정/삭제는 이 카드가 아니라 오른쪽 상세 분석 패널에서 한다.
interface BudgetCardProps {
  categoryId?: string;
  categoryName?: string;
  icon?: React.ReactNode;
  monthlyAmount: number;
  usedAmount: number;
  onSelect?: (categoryId: string) => void;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  isChild?: boolean;
  isVirtualBudget?: boolean;
}

export function BudgetCard({
  categoryId,
  categoryName = '전체예산',
  icon,
  monthlyAmount,
  usedAmount,
  onSelect,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  isChild = false,
  isVirtualBudget = false,
}: BudgetCardProps) {
  const percentage = budgetPercentage(monthlyAmount, usedAmount);
  const remainAmount = monthlyAmount - usedAmount;
  const isOverBudget = remainAmount < 0;
  const barColor = percentage > 100 ? 'bg-red-500' : percentage === 0 ? 'bg-gray-300' : 'bg-blue-500';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  };

  return (
    // 화살표가 이름 오른쪽으로 가면서 대분류 앞의 자리차지 여백이 없어졌다.
    // 소분류를 들여써서 계층이 보이게 한다.
    <div
      className={`border-b border-gray-200 py-3 pr-4 ${isChild ? 'bg-gray-50 pl-10' : 'pl-4'} ${categoryId && onSelect ? 'cursor-pointer hover:bg-blue-50 transition' : ''}`}
      onClick={() => categoryId && onSelect && onSelect(categoryId)}
    >
      <div className="flex flex-col gap-2">
        {/* 첫 줄: 카테고리명 : 사용금액 */}
        <div className="flex items-center justify-between">
          {/*
            이름과 화살표를 한 덩어리로 묶어 통째로 누르게 한다. 화살표만 누르던 예전 구조는
            손가락으로 맞히기에 너무 작았다. 펼칠 것이 없는 소분류는 버튼으로 만들지 않는다.
          */}
          {hasChildren && !isChild ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // 상세 분석도 이 분류로 함께 옮긴다. 예전처럼 줄을 눌러 선택하는 길을 막지 않는다.
                if (categoryId) onSelect?.(categoryId);
                onToggleExpand?.();
              }}
              className="flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded hover:bg-gray-200/70 transition"
              aria-expanded={isExpanded}
            >
              <span className={`font-semibold text-gray-800 text-sm ${monthlyAmount === 0 ? 'text-blue-600' : ''}`}>
                {categoryName}
              </span>
              <ChevronDown
                size={18}
                className={`flex-shrink-0 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          ) : (
            <div className={`font-semibold text-gray-800 text-sm ${monthlyAmount === 0 ? 'text-blue-600' : ''}`}>
              {categoryName}
            </div>
          )}
          <div className="text-lg font-bold text-gray-900">
            {formatCurrency(usedAmount)}원
          </div>
        </div>

        {/* 두 번째 줄: 프로그래스바, 예산값, 남은액/초과액, 메뉴 - 예산값이 없을 때는 숨김 */}
        {monthlyAmount > 0 && (
          <div className="flex items-center gap-3">
            {/* 프로그레스 바 */}
            <div className="flex-1 min-w-[150px]">
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
