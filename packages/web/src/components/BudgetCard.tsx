'use client';

import { useState } from 'react';
import { ChevronDown, Edit2, Trash2 } from 'lucide-react';

interface BudgetCardProps {
  categoryName?: string;
  icon?: React.ReactNode;
  monthlyAmount: number;
  usedAmount: number;
  percentage: number;
  onEdit: () => void;
  onDelete: () => void;
}

export function BudgetCard({
  categoryName = '전체예산',
  icon,
  monthlyAmount,
  usedAmount,
  percentage,
  onEdit,
  onDelete,
}: BudgetCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const remainAmount = monthlyAmount - usedAmount;
  const isOverBudget = remainAmount < 0;
  const barColor = percentage > 100 ? 'bg-red-400' : percentage === 0 ? 'bg-gray-300' : 'bg-blue-400';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
  };

  return (
    <div className="border-b border-gray-200 px-4 py-4">
      {/* 상단: 카테고리명 및 진행률 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1">
          {icon && <span className="text-xl">{icon}</span>}
          <button className="flex items-center gap-1 font-semibold text-gray-800 hover:text-gray-600">
            {categoryName}
            <ChevronDown size={18} />
          </button>
        </div>
        <div className="text-2xl font-bold text-gray-800">{percentage}%</div>
      </div>

      {/* 중단: 월 예산 */}
      <div className="mb-2 text-lg font-semibold text-gray-700">
        {formatCurrency(monthlyAmount)}원
      </div>

      {/* 진행 바 */}
      <div className="mb-3 h-8 bg-gray-100 rounded-lg overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      {/* 하단: 사용액 및 남은액/초과액 */}
      <div className="flex items-center justify-between text-sm">
        <span className={`font-semibold ${isOverBudget ? 'text-red-400' : 'text-blue-400'}`}>
          {formatCurrency(usedAmount)}원
        </span>

        <span className={isOverBudget ? 'text-red-500 font-semibold' : 'text-gray-600'}>
          {isOverBudget ? `초과 ${formatCurrency(Math.abs(remainAmount))}원` : `${formatCurrency(remainAmount)}원`}
        </span>

        <div className="relative z-20">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 hover:bg-gray-100 rounded"
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
    </div>
  );
}
