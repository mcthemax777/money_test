'use client';

import { useState } from 'react';
import { ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { budgetPercentage } from '@/lib/budget';

interface BudgetCardProps {
  categoryId?: string;
  categoryName?: string;
  icon?: React.ReactNode;
  monthlyAmount: number;
  usedAmount: number;
  onEdit: () => void;
  onDelete: () => void;
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
  onEdit,
  onDelete,
  onSelect,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  isChild = false,
  isVirtualBudget = false,
}: BudgetCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const percentage = budgetPercentage(monthlyAmount, usedAmount);
  const remainAmount = monthlyAmount - usedAmount;
  const isOverBudget = remainAmount < 0;
  const barColor = percentage > 100 ? 'bg-red-500' : percentage === 0 ? 'bg-gray-300' : 'bg-blue-500';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  };

  return (
    <div
      className={`border-b border-gray-200 px-4 py-3 ${isChild ? 'bg-gray-50' : ''} ${categoryId && onSelect ? 'cursor-pointer hover:bg-blue-50 transition' : ''}`}
      onClick={() => categoryId && onSelect && onSelect(categoryId)}
    >
      <div className="flex flex-col gap-2">
        {/* 첫 줄: 카테고리명 : 사용금액 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!isChild && (
              <div className="w-6 flex-shrink-0">
                {hasChildren && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand?.();
                    }}
                    className="p-0 hover:bg-gray-200 rounded transition flex items-center justify-center w-6 h-6"
                  >
                    <ChevronDown
                      size={18}
                      className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
            )}
            <div className={`font-semibold text-gray-800 text-sm ${monthlyAmount === 0 ? 'text-blue-600' : ''}`}>
              {categoryName}
            </div>
          </div>
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

            {/* 메뉴 버튼 */}
            <div className="relative z-20">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="p-1 hover:bg-gray-100 rounded transition"
              >
                <ChevronDown size={16} />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded shadow-xl z-50 min-w-max">
                  <button
                    onClick={() => {
                      onEdit();
                      setShowMenu(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 w-full"
                  >
                    <Edit2 size={14} />
                    수정
                  </button>
                  <button
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-sm text-red-600 w-full"
                  >
                    <Trash2 size={14} />
                    삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
