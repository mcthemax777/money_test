'use client';

import { useEffect, useState } from 'react';
import type { EntryFilterQuery } from '@money/types';
import { apiClient, type ReportPeriod } from '@/lib/api-client';
import { formatCurrency, toNumber } from '@/lib/money';
import { budgetPercentage } from '@/lib/budget';
import type { EntryListItem } from '@/components/TransactionItem';
import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import type { Category } from '@/lib/types';
import { useProjectDisplayCurrency } from '@/store/project';

/** 예산 화면이 넘겨 주는 한 줄. 월 단위에서만 쓴다. */
export interface BudgetRow {
  categoryId?: string;
  categoryType?: 'income' | 'expense';
  type?: 'income' | 'expense';
  monthlyAmount: number;
}

interface Props {
  period: ReportPeriod;
  projectId?: string | null;
  filter?: EntryFilterQuery;
  /** 분류를 고르면 상세 패널이 쓴다 (대분류인지 소분류인지 판별). */
  categories: Category[];
  onEntryClick: (entry: EntryListItem) => void;
  /** 거래를 고치면 부모가 올린다. 합계를 다시 받는다. */
  reloadToken?: number;

  /** 지출/수입. 부모가 들고 있다 (예산 저장이 이 값을 쓴다). */
  type: 'income' | 'expense';
  onTypeChange: (type: 'income' | 'expense') => void;
  /**
   * 고른 대상. 실제 카테고리 id이거나 'total-expense'/'total-income'이다.
   * 부모가 들고 있는 이유는 예산 모달이 같은 값을 쓰기 때문이다.
   */
  selectedId: string;
  /** 고른 것이 "미분류"인지 (대분류에 바로 기록한 건만) */
  selectedExact: boolean;
  onSelect: (categoryId: string, exact: boolean) => void;

  /**
   * 이 달의 예산. 넘기면 예산이 있는 분류에 진행률이 함께 붙는다.
   *
   * 기간 보기에서는 넘기지 않는다. 예산은 달마다 정하는 값이라 두 달 반짜리
   * 구간에 얼마인지가 정의되지 않는다.
   */
  budgets?: BudgetRow[];
  /** 예산을 넣거나 고칠 때. 넘기면 상세 헤더에 버튼이 붙는다. */
  onEditBudget?: () => void;
}

interface BreakdownRow {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  amount: string;
  count: number;
  ratio: number;
}

/**
 * 기간의 분류별 지출·수입.
 *
 * 달 단위 "분류별" 화면은 예산 진행률을 함께 보여 주는데, 예산은 월 단위 개념이라
 * 임의 기간에는 붙일 수 없다(두 달 반의 예산이 얼마인지는 정의되지 않는다).
 * 그래서 기간 보기에서는 예산을 빼고 금액과 구성비만 보여 준다.
 *
 * 합계는 서버가 posting 기준으로 계산한다. 화면에서 거래 목록을 더하면 한 거래를
 * 여러 분류로 쪼갠 건이 대표 분류에 통째로 잡혀 숫자가 틀어진다.
 */
export default function CategoryTab({
  period,
  projectId,
  filter,
  categories,
  onEntryClick,
  reloadToken,
  type,
  onTypeChange,
  selectedId,
  selectedExact,
  onSelect,
  budgets,
  onEditBudget,
}: Props) {
  const displayCurrency = useProjectDisplayCurrency();
  /** 대분류로 합친 집계 (rollup). 목록의 윗줄이다. */
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  /** 쪼개지 않은 집계. 대분류를 펼쳤을 때 소분류 줄을 만든다. */
  const [flatRows, setFlatRows] = useState<BreakdownRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const periodKey = period.yearMonth ?? `${period.startDate}~${period.endDate}`;

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    // 두 벌을 함께 받는다. 대분류 합계는 서버의 rollup 을 그대로 쓰고(화면에서
    // 더하면 서버와 어긋날 여지가 생긴다), 소분류 줄은 쪼개지 않은 쪽에서 만든다.
    Promise.all([
      apiClient.getCategoryBreakdown(period, type, projectId, filter),
      apiClient.getCategoryBreakdown(period, type, projectId, { rollup: false, ...filter }),
    ])
      .then(([rollupRes, flatRes]) => {
        if (cancelled) return;
        setRows((rollupRes ?? []) as BreakdownRow[]);
        setFlatRows((flatRes ?? []) as BreakdownRow[]);
      })
      .catch((error) => {
        console.error('분류별 집계를 불러오지 못했습니다:', error);
        if (!cancelled) {
          setRows([]);
          setFlatRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, type, projectId, filter, reloadToken]);

  // 구간이나 유형이 바뀌면 선택을 비운다. 없는 분류가 선택된 채로 남으면 목록이 빈다.
  /** 목록에서 무엇을 고를 때. 같은 것을 다시 누르면 닫는다(= 접힌다). */
  const select = (categoryId: string, exact = false) => {
    const isSame = selectedId === categoryId && selectedExact === exact;
    onSelect(isSame ? '' : categoryId, isSame ? false : exact);
  };

  /**
   * 대분류 밑의 소분류 줄.
   *
   * 거래가 없는 소분류도 0원으로 함께 보여 준다. 목록에서 빠지면 "이 기간에 안 썼다"와
   * "그런 분류가 없다"를 구분할 수 없다.
   *
   * 소분류 없이 대분류에 바로 기록한 금액은 '미분류'로 넣는다. 이것을 빼면 소분류
   * 합계가 대분류 금액보다 적어져 돈이 사라진 것처럼 보인다.
   *
   * 비율은 **그 대분류 안에서**의 몫이다. 전체 대비로 적으면 소분류마다 1~2%가 되어
   * 어느 소분류가 큰지 알 수 없다. 미분류까지 더하면 100%가 된다.
   */
  const childrenOf = (parentId: string, parentAmount: number) => {
    const amountOf = (categoryId: string) =>
      toNumber(flatRows.find((row) => row.categoryId === categoryId)?.amount);
    const countOf = (categoryId: string) =>
      flatRows.find((row) => row.categoryId === categoryId)?.count ?? 0;

    const children = categories
      .filter((category) => category.parentId === parentId && category.isActive)
      .map((category) => ({
        categoryId: category.id,
        categoryName: category.name,
        amount: amountOf(category.id),
        count: countOf(category.id),
      }))
      .sort((a, b) => b.amount - a.amount || a.categoryName.localeCompare(b.categoryName));

    return {
      children,
      directAmount: amountOf(parentId),
      // 대분류 금액이 0이면 나눌 수 없다. 그때는 소분류도 전부 0이라 0%가 맞다.
      shareOf: (amount: number) => (parentAmount > 0 ? (amount / parentAmount) * 100 : 0),
    };
  };

  /**
   * 대분류 줄. 거래가 없는 분류도 0원으로 남긴다.
   *
   * 금액은 서버의 rollup 값을 그대로 쓴다. 화면에서 소분류를 더하면 서버 합계와
   * 어긋날 여지가 생긴다.
   */
  const parentRows = categories
    .filter((category) => !category.parentId && category.isActive && category.type === type)
    .map((category) => {
      const row = rows.find((item) => item.categoryId === category.id);
      return {
        categoryId: category.id,
        categoryName: category.name,
        amount: toNumber(row?.amount),
        count: row?.count ?? 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.categoryName.localeCompare(b.categoryName));

  const total = rows.reduce((acc, row) => acc + toNumber(row.amount), 0);
  /** 전체 대비 몫. 대분류 줄에 적는다. */
  const shareOfTotal = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);

  /**
   * 그 분류에 걸린 예산액. 없으면 0이다.
   *
   * categoryId 를 비우면 "전체 예산"(분류 없는 예산)을 찾는다. 예산 응답은 type 과
   * categoryType 중 한쪽만 채워 오는 경우가 있어 둘 다 본다.
   */
  const budgetOf = (categoryId?: string) => {
    if (!budgets) return 0;

    const row = budgets.find((item) =>
      categoryId
        ? item.categoryId === categoryId
        : !item.categoryId && (item.type === type || item.categoryType === type),
    );
    return row?.monthlyAmount ?? 0;
  };

  /**
   * 예산 진행률 줄.
   *
   * 예산이 걸린 분류에만 붙는다. 구성비(퍼센티지)는 "이 기간에 어디에 많이 썼나"를,
   * 이 줄은 "정해 둔 한도에 얼마나 왔나"를 말한다. 서로 다른 질문이라 함께 보여도
   * 겹치지 않는다.
   */
  const budgetLine = (categoryId: string | undefined, usedAmount: number) => {
    const budget = budgetOf(categoryId);
    if (budget <= 0) return null;

    const percent = budgetPercentage(budget, usedAmount);
    const over = usedAmount > budget;

    return (
      <div className="mt-1 flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${over ? 'bg-red-500' : 'bg-blue-400'}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <span className={`text-xs shrink-0 ${over ? 'text-red-600' : 'text-gray-500'}`}>
          예산 {formatCurrency(budget, displayCurrency)} · {percent}%
          {over
            ? ` · ${formatCurrency(usedAmount - budget, displayCurrency)} 초과`
            : ` · ${formatCurrency(budget - usedAmount, displayCurrency)} 남음`}
        </span>
      </div>
    );
  };

  /**
   * 상세 패널이 보여 줄 대상.
   *
   * 합계 줄을 고르면 그 유형 전체(원형차트가 대분류별로 그려진다), 분류를 고르면
   * 그 분류다. 달 단위 화면과 같은 규칙이라 같은 컴포넌트를 그대로 쓴다.
   */
  const totalId = type === 'expense' ? 'total-expense' : 'total-income';

  /**
   * 펼쳐 둘 대분류.
   *
   * 별도 상태로 두지 않고 선택에서 유도한다. 상태를 따로 두면 합계나 다른 대분류를
   * 고른 뒤에도 먼저 펼친 소분류가 남고, 그 대분류를 다시 눌러야 접히는
   * (펼치려고 눌렀는데 접히는) 어긋남이 생긴다.
   *
   * 소분류나 미분류를 고르면 그 부모는 펼쳐진 채로 남는다. 고르는 순간 목록이
   * 접히면 방금 무엇을 눌렀는지 알 수 없다.
   */
  const expandedId = (() => {
    if (!selectedId || selectedId === totalId) return '';
    const selected = categories.find((category) => category.id === selectedId);
    return selected?.parentId ?? selectedId;
  })();
  const selectedName = (() => {
    if (selectedId === totalId) return type === 'expense' ? '전체 지출' : '전체 수입';

    const name =
      flatRows.find((row) => row.categoryId === selectedId)?.categoryName ??
      rows.find((row) => row.categoryId === selectedId)?.categoryName ??
      '';
    return selectedExact ? `${name} · 미분류` : name;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="lg:col-span-1 bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6 border-b">
          <div className="flex gap-2">
            {(['expense', 'income'] as const).map((value) => (
              <button
                key={value}
                onClick={() => onTypeChange(value)}
                className={`px-4 py-2 font-medium transition ${
                  type === value
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {value === 'expense' ? '지출' : '수입'}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="text-gray-600">로딩 중...</p>
        ) : parentRows.length === 0 ? (
          <p className="text-gray-600">분류가 없습니다.</p>
        ) : (
          <>
            <button
              onClick={() => select(totalId)}
              className={`w-full mb-3 px-3 py-2 rounded-lg transition ${
                selectedId === totalId ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-gray-600">합계</span>
                <span className="text-lg font-bold text-gray-900">{formatCurrency(total, displayCurrency)}</span>
              </div>
              {/* 전체 예산 (분류 없는 예산) */}
              {budgetLine(undefined, total)}
            </button>

            <div className="space-y-1">
              {parentRows.map((row) => {
                const isSelected = selectedId === row.categoryId && !selectedExact;
                const { children, directAmount, shareOf } = childrenOf(row.categoryId, row.amount);
                const isExpanded = expandedId === row.categoryId && children.length > 0;

                return (
                  <div key={row.categoryId}>
                    <button
                      // 누르면 상세가 열리고 소분류도 함께 펼쳐진다 (expandedId 참고).
                      // 같은 줄을 다시 누르면 선택이 풀리면서 접힌다.
                      onClick={() => select(row.categoryId)}
                      className={`w-full px-3 py-2 rounded-lg transition ${
                        isSelected ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-baseline gap-2">
                      <span className="text-sm text-gray-800 truncate">
                        {children.length > 0 && (
                          <span className="mr-1 text-xs text-gray-400">
                            {isExpanded ? '▾' : '▸'}
                          </span>
                        )}
                        {row.categoryName}
                        {/* 전체 대비 몫 */}
                        <span className="ml-1 text-xs text-gray-500">
                          ({shareOfTotal(row.amount).toFixed(0)}%)
                        </span>
                        {row.count > 0 && (
                          <span className="ml-1 text-xs text-gray-400">{row.count}건</span>
                        )}
                      </span>
                      <span
                        className={`text-sm font-semibold shrink-0 ${
                          row.amount > 0 ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        {formatCurrency(row.amount, displayCurrency)}
                      </span>
                      </div>
                      {budgetLine(row.categoryId, row.amount)}
                    </button>

                    {isExpanded && (
                      <div className="mt-1 ml-4 space-y-1 border-l border-gray-200 pl-3">
                        {children.map((child) => (
                          <button
                            key={child.categoryId}
                            onClick={() => select(child.categoryId)}
                            className={`w-full px-2 py-1 rounded transition ${
                              selectedId === child.categoryId && !selectedExact
                                ? 'bg-blue-50 ring-1 ring-blue-300'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex justify-between items-baseline gap-2">
                            <span className="text-sm text-gray-700 truncate">
                              {child.categoryName}
                              {/* 대분류 안에서의 몫 */}
                              <span className="ml-1 text-xs text-gray-500">
                                ({shareOf(child.amount).toFixed(0)}%)
                              </span>
                              {child.count > 0 && (
                                <span className="ml-1 text-xs text-gray-400">{child.count}건</span>
                              )}
                            </span>
                            <span
                              className={`text-sm shrink-0 ${
                                child.amount > 0 ? 'text-gray-800' : 'text-gray-400'
                              }`}
                            >
                              {formatCurrency(child.amount, displayCurrency)}
                            </span>
                            </div>
                            {budgetLine(child.categoryId, child.amount)}
                          </button>
                        ))}

                        {/*
                          소분류 없이 대분류에 바로 기록한 건. 자기 분류가 없을 뿐
                          거래는 실재하므로 눌러서 볼 수 있어야 한다. 대분류 id에
                          "소분류 제외"를 붙여 조회한다.
                        */}
                        {directAmount > 0 && (
                          <button
                            onClick={() => select(row.categoryId, true)}
                            className={`w-full flex justify-between items-baseline gap-2 px-2 py-1 rounded transition ${
                              selectedId === row.categoryId && selectedExact
                                ? 'bg-blue-50 ring-1 ring-blue-300'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <span className="text-sm text-gray-500">
                              미분류
                              <span className="ml-1 text-xs text-gray-500">
                                ({shareOf(directAmount).toFixed(0)}%)
                              </span>
                            </span>
                            <span className="text-sm text-gray-600">
                              {formatCurrency(directAmount, displayCurrency)}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/*
              기간 보기에서만 띄운다. 월 단위에서는 진행률이 그대로 보이므로
              "월 단위에서만 보인다"는 안내가 눈앞의 화면과 어긋난다.
            */}
            {!budgets && (
              <p className="mt-4 text-xs text-gray-500">
                예산 진행률은 월 단위에서만 보입니다. 예산은 달마다 정하는 값이라 기간에
                맞춰 나눌 수 없습니다.
              </p>
            )}
          </>
        )}
      </div>

      {/*
        상세는 달 단위 화면과 같은 패널을 쓴다. 원형차트·일별 누적·12개월 추이·거래
        목록이 전부 들어 있고, 구간만 바꿔 넘기면 그대로 동작한다.
      */}
      {selectedId && (
        <div className="lg:col-span-1 bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">{selectedName} 상세 분석</h3>
            {/* 보고 있는 분류의 예산을 그 자리에서 넣거나 고친다 (월 단위에서만) */}
            {onEditBudget && !selectedExact && (
              <button
                onClick={onEditBudget}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 whitespace-nowrap"
              >
                예산 설정
              </button>
            )}
          </div>
          <BudgetDetailModal
            isOpen={true}
            onClose={() => onSelect('', false)}
            categoryId={selectedId}
            categoryName={selectedName}
            categories={categories}
            isInline={true}
            period={period}
            exactCategory={selectedExact}
            projectId={projectId}
            filter={filter}
            onEntryClick={onEntryClick}
            reloadToken={reloadToken}
          />
        </div>
      )}
    </div>
  );
}
