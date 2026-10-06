'use client';

import type { EntryListItem, EntryScopeQuery } from '@money/types';

import { useTransactionAnalysis } from '@money/core/hooks/useTransactionAnalysis';
import type { SearchRange, TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';

import { BudgetDetailModal } from './BudgetDetailModal';
import Modal from './Modal';
import PeriodNavigator from './PeriodNavigator';
import TypeTabs from './TypeTabs';

/**
 * 거래 화면 년월 줄의 분석 아이콘이 여는 분석 창. 앱의 같은 보기와 같은 훅을 쓴다.
 *
 * 목록과 같은 조건(사람 필터 + 검색 + 세는 방식)으로 가계 분류별의 상세와 같은 그래프를
 * 그린다. 검색을 걸지 않았으면 모든 거래다. 부르는 쪽은 열 때만 이 컴포넌트를 세운다 --
 * 닫았다 다시 열면 보는 기간과 지출·수입이 그때의 검색에 맞춰 새로 정해져야 한다.
 *
 * 기간은 해·달·주 중 하나다. 옮기는 머리는 분석 탭과 같은 것이다 (`PeriodNavigator`).
 */
export default function TransactionAnalysisModal({
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
  onEntryClick: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const analysis = useTransactionAnalysis({ search, range, scope, initialKey });

  return (
    <Modal isOpen onClose={onClose} title={t('tx.analysisTitle')} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {searchCount > 0
            ? t('tx.analysisFiltered', { count: searchCount })
            : t('tx.analysisAll')}
        </p>

        <PeriodNavigator periodKey={analysis.periodKey} onChange={analysis.setPeriodKey} />

        <TypeTabs type={analysis.type} onChange={analysis.setType} />

        {analysis.period ? (
          <BudgetDetailModal
            isOpen
            onClose={onClose}
            isInline
            categoryId={analysis.categoryId}
            categoryName=""
            categories={categories}
            period={analysis.period}
            projectId={projectId}
            filter={analysis.filter}
            trendClip={analysis.trendClip}
            trendPeriod={analysis.trendPeriod}
            onEntryClick={onEntryClick}
          />
        ) : (
          <p className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</p>
        )}
      </div>
    </Modal>
  );
}
