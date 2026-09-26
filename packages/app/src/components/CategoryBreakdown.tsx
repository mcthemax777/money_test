import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EntryScopeQuery } from '@money/types';

import { homeDataPort } from '@money/core/data/home-port';
import type { ReportPeriod } from '@money/core/lib/api-client';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { useTranslation } from '@money/core/lib/i18n';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
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

/** 목록에서 무엇을 눌렀는지. 상세 화면이 그대로 받아 조회한다. */
export interface CategoryTarget {
  /** 실제 분류 id, 또는 'total-expense'/'total-income' */
  categoryId: string;
  /** 상세 머리글에 적을 이름. 목록이 쓰던 이름을 그대로 넘긴다. */
  name: string;
  /** "미분류"를 눌렀는지 (소분류를 뺀 그 대분류만 본다) */
  exact: boolean;
}

/**
 * 분류별. 웹 가계 화면의 분류별 탭에서 왼쪽 목록을 옮긴 것이다.
 *
 * 합계는 서버가 posting 기준으로 계산한다. 화면에서 거래 목록을 더하면 한 거래를
 * 여러 분류로 쪼갠 건이 대표 분류에 통째로 잡혀 숫자가 틀어진다.
 *
 * **소분류를 처음부터 펼쳐 둔다.** 예전에는 대분류를 눌러야 펼쳐졌는데, 그러면 그
 * 누름이 "펼치기"에 묶여 상세로 들어가는 길이 없었다. 지금은 누름이 전부 상세로
 * 가고, 무엇이 있는지는 접지 않고 그대로 보여 준다. 거래가 없는 소분류도 0원으로
 * 함께 남긴다 -- 빠지면 "이 기간에 안 썼다"와 "그런 분류가 없다"를 구분할 수 없다.
 *
 * 예산 진행률은 아직 웹에만 있다.
 */
export default function CategoryBreakdown({
  period,
  projectId,
  filter,
  categories,
  reloadToken,
  onSelect,
}: {
  period: ReportPeriod;
  projectId?: string | null;
  filter?: EntryScopeQuery;
  categories: Category[];
  reloadToken?: number;
  /** 합계·대분류·소분류·미분류 중 하나를 누를 때. 부모가 상세 화면을 연다. */
  onSelect: (target: CategoryTarget) => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  // 남이 고친 거래도 이 집계에 들어와야 한다. reloadToken 은 이 화면의 편집만 센다.
  const mirrorVersion = useMirrorVersion();

  const [type, setType] = useState<EntryType>('expense');
  /** 대분류로 합친 집계(rollup). 목록의 윗줄이다. */
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  /** 쪼개지 않은 집계. 소분류 줄을 여기서 만든다. */
  const [flatRows, setFlatRows] = useState<BreakdownRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const periodKey = period.yearMonth ?? `${period.startDate}~${period.endDate}`;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setIsLoading(true);

    // 두 벌을 함께 받는다. 대분류 합계는 서버의 rollup 을 그대로 쓰고(화면에서
    // 더하면 서버와 어긋날 여지가 생긴다), 소분류 줄은 쪼개지 않은 쪽에서 만든다.
    Promise.all([
      homeDataPort().getCategoryBreakdown(period, type, projectId, filter),
      homeDataPort().getCategoryBreakdown(period, type, projectId, { rollup: false, ...filter }),
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
  }, [projectId, periodKey, type, filter, reloadToken, mirrorVersion]);

  /**
   * 대분류 줄. 거래가 없는 분류도 0원으로 남긴다.
   *
   * 금액은 서버의 rollup 값을 그대로 쓴다.
   */
  const parentRows = categories
    .filter((category) => !category.parentId && category.type === type)
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
  const countOf = (categoryId: string) =>
    flatRows.find((row) => row.categoryId === categoryId)?.count ?? 0;

  return (
    <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
      <TypeTabs type={type} onChange={setType} />

      {isLoading && rows.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : parentRows.length === 0 ? (
        <Text className="text-gray-600">{t('category.none')}</Text>
      ) : (
        <>
          {/* 합계. 누르면 그 유형 전체를 대분류별로 쪼갠 상세가 열린다. */}
          <Pressable
            onPress={() =>
              onSelect({
                categoryId: totalIdOf(type),
                name: t(type === 'expense' ? 'category.totalExpense' : 'category.totalIncome'),
                exact: false,
              })
            }
            className="flex-row items-baseline justify-between rounded-lg px-3 py-2 active:bg-gray-50"
          >
            <Text className="text-sm text-gray-600">{t('budget.total')}</Text>
            <Text className="text-lg font-bold text-gray-900">
              {formatCurrency(total, displayCurrency)}
            </Text>
          </Pressable>

          <View className="gap-1">
            {parentRows.map((row) => {
              const children = categories
                .filter((category) => category.parentId === row.categoryId)
                .map((category) => ({
                  id: category.id,
                  name: category.name,
                  amount: amountOf(category.id),
                  count: countOf(category.id),
                }))
                .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
              /* 소분류 없이 대분류에 바로 기록한 금액. 빼면 돈이 사라진 것처럼 보인다. */
              const directAmount = amountOf(row.categoryId);
              /** 비율은 그 대분류 안에서의 몫이다. 전체 대비로 적으면 어느 소분류가 큰지 알 수 없다. */
              const shareOf = (amount: number) => (row.amount > 0 ? (amount / row.amount) * 100 : 0);

              return (
                <View key={row.categoryId}>
                  <Pressable
                    onPress={() =>
                      onSelect({ categoryId: row.categoryId, name: row.categoryName, exact: false })
                    }
                    className="rounded-lg px-3 py-2 active:bg-gray-50"
                  >
                    <View className="flex-row items-baseline justify-between gap-2">
                      <Text numberOfLines={1} className="shrink text-sm text-gray-800">
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

                  {children.length > 0 ? (
                    <View className="ml-4 mt-1 gap-1 border-l border-gray-200 pl-3">
                      {children.map((child) => (
                        <Pressable
                          key={child.id}
                          onPress={() =>
                            onSelect({ categoryId: child.id, name: child.name, exact: false })
                          }
                          className="flex-row items-baseline justify-between gap-2 rounded px-2 py-1 active:bg-gray-50"
                        >
                          <Text numberOfLines={1} className="shrink text-sm text-gray-700">
                            {child.name}
                            <Text className="text-xs text-gray-500">
                              {' '}
                              ({shareOf(child.amount).toFixed(0)}%)
                            </Text>
                            {child.count > 0 ? (
                              <Text className="text-xs text-gray-400">
                                {' '}
                                {t('ledger.entryCount', { count: child.count })}
                              </Text>
                            ) : null}
                          </Text>
                          <Text
                            className={`text-sm ${
                              child.amount > 0 ? 'text-gray-800' : 'text-gray-400'
                            }`}
                          >
                            {formatCurrency(child.amount, displayCurrency)}
                          </Text>
                        </Pressable>
                      ))}

                      {/*
                        소분류 없이 대분류에 바로 기록한 건. 자기 분류가 없을 뿐
                        거래는 실재하므로 눌러서 볼 수 있어야 한다. 대분류 id 에
                        "소분류 제외"를 붙여 조회한다.
                      */}
                      {directAmount > 0 ? (
                        <Pressable
                          onPress={() =>
                            onSelect({
                              categoryId: row.categoryId,
                              name: t('category.exact', { name: row.categoryName }),
                              exact: true,
                            })
                          }
                          className="flex-row items-baseline justify-between gap-2 rounded px-2 py-1 active:bg-gray-50"
                        >
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
                        </Pressable>
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
