'use client';

import { useState } from 'react';
import { ChevronDown, Edit2, Trash2 } from 'lucide-react';

interface BudgetCardProps {
  categoryId?: string;
  categoryName?: string;
  icon?: React.ReactNode;
  monthlyAmount: number;
  usedAmount: number;
  percentage: number;
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
  percentage,
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

  const remainAmount = monthlyAmount - usedAmount;
  const isOverBudget = remainAmount < 0;
  const barColor = percentage > 100 ? 'bg-red-500' : percentage === 0 ? 'bg-gray-300' : 'bg-blue-500';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  };

  return (
    <div className={`border-b border-gray-200 px-4 py-3 ${isChild ? 'pl-12 bg-gray-50' : ''}`}>
      {/* 한 줄 레이아웃: 좌측(카테고리) - 중앙(프로그레스바) - 우측(정보 + 메뉴) */}
      <div className="flex items-center gap-4">
        {/* 좌측: 카테고리 정보 (고정 너비) */}
        <div
          className={`flex items-center gap-2 min-w-fit ${categoryId && onSelect ? 'cursor-pointer hover:opacity-70' : ''}`}
          onClick={() => categoryId && onSelect && onSelect(categoryId)}
        >
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
          <div>
            <div className={`font-semibold text-gray-800 text-sm ${monthlyAmount === 0 ? 'text-blue-600' : ''}`}>
              {categoryName}
            </div>
            <div className="text-lg font-bold text-gray-900">
              {formatCurrency(usedAmount)}원
            </div>
          </div>
        </div>

        {/* 중앙: 프로그레스 바 (유동 너비) - 예산값이 없을 때는 숨김 */}
        {monthlyAmount > 0 && (
          <div className="flex-1 min-w-[200px]">
            <div className="mb-1 h-6 bg-gray-100 rounded-md overflow-hidden relative">
              <div
                className={`h-full ${barColor} transition-all duration-300`}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700 pointer-events-none">
                {percentage}%
              </div>
            </div>
          </div>
        )}

        {/* 우측: 예산값, 남은액/초과액, 메뉴 - 예산값이 없을 때는 숨김 */}
        {monthlyAmount > 0 && (
          <div className="flex items-center gap-4 min-w-fit">
            {/* 예산값 및 남은액/초과액 */}
            <div className="text-right">
              <div className="text-lg font-bold text-gray-900">{formatCurrency(monthlyAmount)}원</div>
              <div className={`text-sm font-semibold ${isOverBudget ? 'text-red-500' : 'text-gray-600'}`}>
                {isOverBudget ? `초과 ${formatCurrency(Math.abs(remainAmount))}원` : formatCurrency(remainAmount) + '원'}
              </div>
            </div>

            {/* 메뉴 버튼 */}
            <div className="relative z-20">
              <button
                onClick={() => setShowMenu(!showMenu)}
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
