'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { EntryFilterQuery } from '@money/types';

import { apiClient, type ReportPeriod } from '@money/core/lib/api-client';
import { CHART_CATEGORY_COLORS, CHART_TOOLTIP_STYLE, formatTooltipAmount } from '@money/core/lib/chart';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

interface CategoryDonutChartProps {
  title: string;
  /** 지출을 쪼갤지 수입을 쪼갤지 */
  type: 'income' | 'expense';
  period: ReportPeriod;
  projectId: string | null;
  filter: EntryFilterQuery;
}

/** 서버가 주는 분류별 집계 한 줄 */
interface BreakdownRow {
  categoryId: string;
  categoryName: string;
  amount: string;
}

interface Slice {
  id: string;
  name: string;
  amount: number;
  color: string;
}

/** 색을 가진 조각의 최대 수. 이보다 많으면 나머지를 "기타"로 묶는다. */
const MAX_SLICES = CHART_CATEGORY_COLORS.length - 1;

/** 기타 조각의 색. 갈래가 아니라 나머지라 회색으로 물러선다. */
const REST_COLOR = '#9ca3af';

/**
 * 분류에 매길 색 자리.
 *
 * 금액 순서로 색을 주면 자산주인 필터를 바꿔 순위가 흔들릴 때마다 남은 분류의
 * 색이 바뀐다. 같은 분류는 늘 같은 색이어야 눈이 기억한다. 그래서 분류 id에서
 * 자리를 뽑고, 이미 찬 자리는 다음 빈 자리로 옮긴다.
 */
function colorOf(categoryId: string, taken: Set<number>): string {
  let hash = 0;
  for (const char of categoryId) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  for (let step = 0; step < MAX_SLICES; step += 1) {
    const slot = (hash + step) % MAX_SLICES;
    if (!taken.has(slot)) {
      taken.add(slot);
      return CHART_CATEGORY_COLORS[slot];
    }
  }
  return REST_COLOR;
}

/**
 * 이 달 지출(또는 수입)이 어느 분류로 나뉘었는지.
 *
 * 누적 그래프가 "얼마나 빨리 쓰는가"를 본다면 이 그림은 "어디에 쓰는가"를 본다.
 * 가운데에 합계를 적어, 조각을 세지 않아도 총액이 먼저 읽히게 한다.
 *
 * 조각 색만으로는 무엇인지 알 수 없다. 오른쪽 이름표가 색·이름·금액·비중을
 * 함께 적는다.
 */
export default function CategoryDonutChart({
  title,
  type,
  period,
  projectId,
  filter,
}: CategoryDonutChartProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /** 지출과 수입에서 문장이 갈리는 자리. 언어마다 조사가 달라 문장째로 나눠 둔다. */
  const emptyText = type === 'income' ? t('donut.empty.income') : t('donut.empty.expense');
  const failedText =
    type === 'income' ? t('donut.loadFailed.income') : t('donut.loadFailed.expense');
  const periodKey = JSON.stringify(period);
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    setIsLoading(true);
    setError('');
    apiClient
      .getCategoryBreakdown(period, type, projectId, filter)
      .then((data: BreakdownRow[]) => {
        if (cancelled) return;
        setRows(data ?? []);
      })
      .catch((err: unknown) => {
        console.error('분류별 합계 조회 실패:', err);
        if (cancelled) return;
        setRows([]);
        setError(failedText);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // period·filter는 렌더마다 새 객체다. 값이 같으면 다시 부르지 않게 굳힌다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, type, periodKey, filterKey]);

  const { slices, total } = useMemo(() => {
    const sorted = rows
      .map((row) => ({ id: row.categoryId, name: row.categoryName, amount: toNumber(row.amount) }))
      // 환불이 더 많은 분류는 음수다. 원형 그래프에는 음수 조각을 그릴 수 없다.
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const taken = new Set<number>();
    const head: Slice[] = sorted
      .slice(0, MAX_SLICES)
      .map((row) => ({ ...row, color: colorOf(row.id, taken) }));

    const restAmount = sorted.slice(MAX_SLICES).reduce((acc, row) => acc + row.amount, 0);
    const all =
      restAmount > 0
        ? [...head, { id: 'rest', name: t('donut.rest'), amount: restAmount, color: REST_COLOR }]
        : head;

    return { slices: all, total: sorted.reduce((acc, row) => acc + row.amount, 0) };
  }, [rows, t]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm font-semibold text-gray-900 tabular-nums">
          {formatCurrency(total, displayCurrency)}
        </p>
      </div>

      {isLoading && rows.length === 0 ? (
        <p className="mt-3 h-56 text-sm text-gray-600">{t('common.loading')}</p>
      ) : error ? (
        <p className="mt-3 h-56 text-sm text-red-600">{error}</p>
      ) : slices.length === 0 ? (
        <p className="mt-3 h-56 text-sm text-gray-600">{emptyText}</p>
      ) : (
        <div className="mt-3 flex h-56 items-center gap-3">
          <div className="h-full w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius="58%"
                  outerRadius="92%"
                  // 조각 사이를 벌려 붙은 두 색이 한 덩이로 보이지 않게 한다.
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.id} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any, name: any) =>
                    formatTooltipAmount(value, name as string, displayCurrency)
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* 이름표. 색만으로는 무엇인지 알 수 없으므로 이름과 금액을 함께 적는다. */}
          <ul className="min-w-0 flex-1 space-y-1 overflow-y-auto py-1 pr-1 text-sm">
            {slices.map((slice) => (
              <li key={slice.id} className="flex items-baseline gap-2">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-gray-700">{slice.name}</span>
                <span className="shrink-0 tabular-nums text-gray-900">
                  {formatCurrency(slice.amount, displayCurrency)}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-gray-500">
                  {total > 0 ? Math.round((slice.amount / total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
