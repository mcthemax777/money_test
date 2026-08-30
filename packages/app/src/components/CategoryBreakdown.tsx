import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EntryFilterQuery } from '@money/types';

import { apiClient, type ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Category } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import TypeTabs, { type EntryType } from './TypeTabs';

interface BreakdownRow {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  amount: string;
  count: number;
}

/**
 * 분류별. 웹 가계 화면의 분류별 탭에서 왼쪽 목록을 옮긴 것이다.
 *
 * 합계는 서버가 posting 기준으로 계산한다. 화면에서 거래 목록을 더하면 한 거래를
 * 여러 분류로 쪼갠 건이 대표 분류에 통째로 잡혀 숫자가 틀어진다.
 *
 * 대분류를 누르면 그 아래 소분류가 펼쳐진다. 거래가 없는 소분류도 0원으로 함께
 * 보여 준다. 목록에서 빠지면 "이 기간에 안 썼다"와 "그런 분류가 없다"를 구분할 수 없다.
 * 예산 진행률과 상세(그래프·거래 목록)는 아직 웹에만 있다.
 */
export default function CategoryBreakdown({
  period,
  projectId,
  filter,
  categories,
  reloadToken,
}: {
  period: ReportPeriod;
  projectId?: string | null;
  filter?: EntryFilterQuery;
  categories: Category[];
  reloadToken?: number;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  const [type, setType] = useState<EntryType>('expense');
  /** 대분류로 합친 집계(rollup). 목록의 윗줄이다. */
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  /** 쪼개지 않은 집계. 대분류를 펼쳤을 때 소분류 줄을 만든다. */
  const [flatRows, setFlatRows] = useState<BreakdownRow[]>([]);
  const [expandedId, setExpandedId] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const periodKey = period.yearMonth ?? `${period.startDate}~${period.endDate}`;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setIsLoading(true);

    // 두 벌을 함께 받는다. 대분류 합계는 서버의 rollup 을 그대로 쓰고(화면에서
    // 더하면 서버와 어긋날 여지가 생긴다), 소분류 줄은 쪼개지 않은 쪽에서 만든다.
    Promise.all([
      apiClient.getCategoryBreakdown(period, type, projectId, filter),
      apiClient.getCategoryBreakdown(period, type, projectId, { rollup: false, ...filter }),
    ])
      .then(([rollupRows, flat]) => {
        if (cancelled) return;
        setRows((rollupRows ?? []) as BreakdownRow[]);
        setFlatRows((flat ?? []) as BreakdownRow[]);
      })
      .catch((error) => {
        console.error('분류별 집계를 불러오지 못했습니다:', error);
        if (cancelled) return;
        setRows([]);
        setFlatRows([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, periodKey, type, filter, reloadToken]);

  /**
   * 대분류 줄. 거래가 없는 분류도 0원으로 남긴다.
   *
   * 금액은 서버의 rollup 값을 그대로 쓴다.
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

  const amountOf = (categoryId: string) =>
    toNumber(flatRows.find((row) => row.categoryId === categoryId)?.amount);

  return (
    <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
      <TypeTabs type={type} onChange={setType} />

      {isLoading && rows.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : parentRows.length === 0 ? (
        <Text className="text-gray-600">{t('category.none')}</Text>
      ) : (
        <>
          <View className="flex-row items-baseline justify-between px-3 py-2">
            <Text className="text-sm text-gray-600">{t('budget.total')}</Text>
            <Text className="text-lg font-bold text-gray-900">
              {formatCurrency(total, displayCurrency)}
            </Text>
          </View>

          <View className="gap-1">
            {parentRows.map((row) => {
              const children = categories
                .filter((category) => category.parentId === row.categoryId && category.isActive)
                .map((category) => ({
                  id: category.id,
                  name: category.name,
                  amount: amountOf(category.id),
                }))
                .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
              /* 소분류 없이 대분류에 바로 기록한 금액. 빼면 돈이 사라진 것처럼 보인다. */
              const directAmount = amountOf(row.categoryId);
              const isExpanded = expandedId === row.categoryId && children.length > 0;
              /** 비율은 그 대분류 안에서의 몫이다. 전체 대비로 적으면 어느 소분류가 큰지 알 수 없다. */
              const shareOf = (amount: number) => (row.amount > 0 ? (amount / row.amount) * 100 : 0);

              return (
                <View key={row.categoryId}>
                  <Pressable
                    onPress={() => setExpandedId(isExpanded ? '' : row.categoryId)}
                    className="rounded-lg px-3 py-2 active:bg-gray-50"
                  >
                    <View className="flex-row items-baseline justify-between gap-2">
                      <Text numberOfLines={1} className="shrink text-sm text-gray-800">
                        {children.length > 0 ? (
                          <Text className="text-xs text-gray-400">
                            {isExpanded ? '▾ ' : '▸ '}
                          </Text>
                        ) : null}
                        {row.categoryName}
                        <Text className="text-xs text-gray-500">
                          {' '}
                          ({shareOfTotal(row.amount).toFixed(0)}%)
                        </Text>
                        {row.count > 0 ? (
                          <Text className="text-xs text-gray-400">
                            {' '}
                            {t('ledger.entryCount', { count: row.count })}
                          </Text>
                        ) : null}
                      </Text>
                      <Text
                        className={`text-sm font-semibold ${
                          row.amount > 0 ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        {formatCurrency(row.amount, displayCurrency)}
                      </Text>
                    </View>
                  </Pressable>

                  {isExpanded ? (
                    <View className="ml-4 mt-1 gap-1 border-l border-gray-200 pl-3">
                      {children.map((child) => (
                        <View
                          key={child.id}
                          className="flex-row items-baseline justify-between gap-2 px-2 py-1"
                        >
                          <Text numberOfLines={1} className="shrink text-sm text-gray-700">
                            {child.name}
                            <Text className="text-xs text-gray-500">
                              {' '}
                              ({shareOf(child.amount).toFixed(0)}%)
                            </Text>
                          </Text>
                          <Text
                            className={`text-sm ${
                              child.amount > 0 ? 'text-gray-800' : 'text-gray-400'
                            }`}
                          >
                            {formatCurrency(child.amount, displayCurrency)}
                          </Text>
                        </View>
                      ))}

                      {directAmount > 0 ? (
                        <View className="flex-row items-baseline justify-between gap-2 px-2 py-1">
                          <Text className="text-sm text-gray-500">
                            {t('category.uncategorized')}
                            <Text className="text-xs text-gray-500">
                              {' '}
                              ({shareOf(directAmount).toFixed(0)}%)
                            </Text>
                          </Text>
                          <Text className="text-sm text-gray-600">
                            {formatCurrency(directAmount, displayCurrency)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}
