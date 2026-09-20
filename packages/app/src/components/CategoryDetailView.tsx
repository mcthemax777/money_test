/*
 * 분류 하나(또는 그 유형 전체)의 상세. 화면을 통째로 덮는다.
 *
 * 웹에서는 분류별 탭의 오른쪽 절반에 나란히 서지만, 폰에서는 나란히 세울 자리가
 * 없다. 목록 아래에 이어 붙이면 그래프가 한참 밑으로 밀려 무엇을 보고 있는지도
 * 흐려지므로, 자산 상세와 같은 규칙으로 화면을 덮는다 -- 머리글의 ← 와 기기의
 * 뒤로가기가 같은 일을 한다.
 *
 * 무엇을 받아 무엇을 그릴지는 core 의 useCategoryDetail 이 정한다(웹의 상세와 같은
 * 훅이다). 같은 분류를 누르면 두 화면이 같은 값을 말한다.
 */
import { Pressable, Text, View } from 'react-native';
import type { EntryFilterQuery, EntryListItem } from '@money/types';

import {
  TOTAL_EXPENSE_ID,
  TOTAL_INCOME_ID,
  useCategoryDetail,
} from '@money/core/hooks/useCategoryDetail';
import { type ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import DailyCumulativeChart from './DailyCumulativeChart';
import MonthlyAmountChart from './MonthlyAmountChart';
import CategoryPieChart from './CategoryPieChart';
import PageHeader from './PageHeader';
import TransactionListView from './TransactionListView';

export default function CategoryDetailView({
  categoryId,
  categoryName,
  categories,
  period,
  exactCategory = false,
  projectId,
  filter,
  reloadToken,
  onClose,
  onEntryClick,
}: {
  /** 실제 분류 id, 또는 'total-expense'/'total-income' */
  categoryId: string;
  /** 머리글에 적을 이름. 목록이 쓰던 이름을 그대로 받는다. */
  categoryName: string;
  categories: Category[];
  period: ReportPeriod;
  /** 목록의 "미분류"에서 들어왔는지 (소분류를 뺀 그 대분류만 본다) */
  exactCategory?: boolean;
  projectId?: string | null;
  filter?: EntryFilterQuery;
  reloadToken?: number;
  onClose: () => void;
  /** 거래를 누르면 부른다. 가계 화면의 고치기 팝업으로 잇는 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  const detail = useCategoryDetail({
    categoryId,
    categories,
    period,
    exactCategory,
    projectId,
    filter,
    reloadToken,
  });

  /** 원형차트 제목. 지금이 대분류별인지 소분류별인지를 말한다. */
  const pieTitle = (() => {
    if (categoryId === TOTAL_EXPENSE_ID) {
      return t(detail.drilledId ? 'detail.pieExpenseChild' : 'detail.pieExpenseParent');
    }
    if (categoryId === TOTAL_INCOME_ID) {
      return t(detail.drilledId ? 'detail.pieIncomeChild' : 'detail.pieIncomeParent');
    }
    return t('detail.pieExpenseChild');
  })();

  return (
    <View className="gap-6">
      <PageHeader title={t('category.detailTitle', { name: categoryName })} onBack={onClose} />

      {detail.isLoading ? (
        <Text className="py-12 text-center text-gray-500">{t('detail.loading')}</Text>
      ) : (
        <>
          {/* 구성비. 소분류나 "미분류"를 보고 있으면 쪼갤 것이 없어 조각이 없다. */}
          {detail.slices.length > 0 ? (
            <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-base font-semibold text-gray-900">{pieTitle}</Text>
                {detail.drilledId ? (
                  <Pressable
                    onPress={detail.resetDrill}
                    className="rounded bg-gray-200 px-3 py-1 active:bg-gray-300"
                  >
                    <Text className="text-sm text-gray-700">{t('detail.back')}</Text>
                  </Pressable>
                ) : null}
              </View>

              <CategoryPieChart
                slices={detail.slices}
                currency={displayCurrency}
                /* 한 단 더 내려간 뒤에는 쪼갤 것이 없다. 그때는 누를 수 없는 그림이다. */
                onDrill={detail.drilledId ? undefined : detail.drill}
              />
            </View>
          ) : null}

          <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
            <Text className="text-base font-semibold text-gray-900">
              {t('detail.monthlyUsage')}
            </Text>
            {detail.hasMonthlyAmount ? (
              <MonthlyAmountChart points={detail.monthly} currency={displayCurrency} />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {t('detail.noYearUsage')}
              </Text>
            )}
          </View>

          <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
            <Text className="text-base font-semibold text-gray-900">
              {t('detail.dailyCumulative')}
            </Text>
            {detail.hasDailyAmount ? (
              <DailyCumulativeChart
                current={detail.daily}
                comparisons={detail.comparisons}
                currentName={detail.currentMonthName}
                throughDay={detail.throughDay}
                tooltipName={t('detail.cumulativeUsage')}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {t('detail.noMonthUsage')}
              </Text>
            )}
          </View>

          <View className="gap-3">
            <Text className="text-base font-semibold text-gray-900">{t('detail.entries')}</Text>
            {detail.entries.length === 0 ? (
              <Text className="text-sm text-gray-500">{t('detail.noEntries')}</Text>
            ) : (
              <TransactionListView entries={detail.entries} onEntryClick={onEntryClick} />
            )}
          </View>
        </>
      )}
    </View>
  );
}
