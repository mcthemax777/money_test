import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { EntryListItem, EntryScopeQuery } from '@money/types';

import { useTransactionAnalysis } from '@money/core/hooks/useTransactionAnalysis';
import type { SearchRange, TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';

import CategoryDetailView from './CategoryDetailView';
import MonthHeader from './MonthHeader';
import PageHeader from './PageHeader';
import TypeTabs from './TypeTabs';

/**
 * 거래 화면 년월 줄의 분석 아이콘이 펴는 분석 보기. 웹의 TransactionAnalysisModal 과 같은 훅이다.
 *
 * 가계 분류 상세처럼 화면을 통째로 바꿔 그린다 (목록 위에 겹치면 그래프가 한참 밀린다).
 * 부르는 쪽은 펼 때만 이 컴포넌트를 세운다 -- 다시 펴면 그때의 검색으로 기간과 지출·수입을
 * 새로 정한다.
 *
 * 기간은 해·달·주 중 하나다. 달은 가계 화면과 같은 머리(달 고르기 포함)로, 해와 주는 앞뒤
 * 단추와 이름만으로 옮긴다 (웹과 같다).
 */
export default function TransactionAnalysisView({
  onClose,
  search,
  searchCount,
  range,
  scope,
  categories,
  projectId,
  onEntryClick,
  initialKey,
}: {
  onClose: () => void;
  /** 년월 줄의 분석 아이콘이 연 그 줄의 기간 열쇠. */
  initialKey: string;
  search: TransactionSearch;
  /** 걸어 둔 검색 조건 수. 무엇으로 그린 그래프인지 한 줄로 알린다. */
  searchCount: number;
  range: SearchRange | null;
  scope: EntryScopeQuery;
  categories: Category[];
  projectId: string | null;
  onEntryClick?: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const analysis = useTransactionAnalysis({ search, range, scope, initialKey });
  const [year, month] = analysis.periodKey.split('-').map(Number);
  /* 앞뒤 단추의 이름. 시작일을 옮긴 달도 달 단위로 옮긴다 (웹과 같다). */
  const stepLabel = {
    prev: analysis.unit === 'week' ? 'week.prev' : analysis.unit === 'year' ? 'month.prevYear' : 'month.prev',
    next: analysis.unit === 'week' ? 'week.next' : analysis.unit === 'year' ? 'month.nextYear' : 'month.next',
  } as const;

  const controls = (
    <View className="gap-3">
      <Text className="text-sm text-gray-500">
        {searchCount > 0 ? t('tx.analysisFiltered', { count: searchCount }) : t('tx.analysisAll')}
      </Text>
      {analysis.isCalendarMonth ? (
        <MonthHeader
          year={year}
          month={month}
          incomeTotal={0}
          expenseTotal={0}
          showTotals={false}
          onMonthChange={(nextYear, nextMonth) =>
            analysis.setPeriodKey(`${nextYear}-${String(nextMonth).padStart(2, '0')}`)
          }
        />
      ) : (
        /* 직접 정한 기간은 옮길 앞뒤가 없어 이름만 선다 (웹과 같다). */
        <View className="flex-row items-center gap-1">
          {analysis.unit !== 'range' ? (
            <Pressable
              onPress={() => analysis.shift(-1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t(stepLabel.prev)}
              className="rounded-lg p-2 active:bg-gray-100"
            >
              <ChevronLeft size={20} color="#9ca3af" />
            </Pressable>
          ) : null}
          <Text className="shrink py-1 text-xl font-bold text-gray-900">{analysis.label}</Text>
          {analysis.unit !== 'range' ? (
            <Pressable
              onPress={() => analysis.shift(1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t(stepLabel.next)}
              className="rounded-lg p-2 active:bg-gray-100"
            >
              <ChevronRight size={20} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>
      )}
      <TypeTabs type={analysis.type} onChange={analysis.setType} />
    </View>
  );

  /* 이 달이 검색 기간 밖이면 그릴 것이 없다. 머리글과 달 옮기기는 그대로 둔다. */
  if (!analysis.period) {
    return (
      <View className="gap-6">
        <PageHeader title={t('tx.analysisTitle')} onBack={onClose} />
        {controls}
        <Text className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</Text>
      </View>
    );
  }

  return (
    <CategoryDetailView
      title={t('tx.analysisTitle')}
      controls={controls}
      categoryId={analysis.categoryId}
      categoryName=""
      categories={categories}
      period={analysis.period}
      projectId={projectId}
      filter={analysis.filter}
      trendClip={analysis.trendClip}
      trendPeriod={analysis.trendPeriod}
      onClose={onClose}
      onEntryClick={onEntryClick}
    />
  );
}
