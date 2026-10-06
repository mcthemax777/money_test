import { Text, View } from 'react-native';
import type { EntryListItem, EntryScopeQuery } from '@money/types';

import { useTransactionAnalysis } from '@money/core/hooks/useTransactionAnalysis';
import type { SearchRange, TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';

import CategoryDetailView from './CategoryDetailView';
import PageHeader from './PageHeader';
import PeriodNavigator from './PeriodNavigator';
import TypeTabs from './TypeTabs';

/**
 * 거래 화면 년월 줄의 분석 아이콘이 펴는 분석 보기. 웹의 TransactionAnalysisModal 과 같은 훅이다.
 *
 * 가계 분류 상세처럼 화면을 통째로 바꿔 그린다 (목록 위에 겹치면 그래프가 한참 밀린다).
 * 부르는 쪽은 펼 때만 이 컴포넌트를 세운다 -- 다시 펴면 그때의 검색으로 기간과 지출·수입을
 * 새로 정한다.
 *
 * 기간은 해·달·주 중 하나다. 옮기는 머리는 분석 탭과 같은 것이다 (`PeriodNavigator`).
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

  const controls = (
    <View className="gap-3">
      <Text className="text-sm text-gray-500">
        {searchCount > 0 ? t('tx.analysisFiltered', { count: searchCount }) : t('tx.analysisAll')}
      </Text>
      <PeriodNavigator periodKey={analysis.periodKey} onChange={analysis.setPeriodKey} />
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
