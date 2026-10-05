'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EntryListItem, EntryScopeQuery } from '@money/types';

import { useTransactionAnalysis } from '@money/core/hooks/useTransactionAnalysis';
import type {
  PeriodGrouping,
  SearchRange,
  TransactionSearch,
} from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';

import { BudgetDetailModal } from './BudgetDetailModal';
import Modal from './Modal';
import MonthHeader from './MonthHeader';
import TypeTabs from './TypeTabs';

/**
 * 거래 화면 머리글의 그래프 단추가 여는 분석 창. 앱의 같은 보기와 같은 훅을 쓴다.
 *
 * 목록과 같은 조건(사람 필터 + 검색 + 세는 방식)으로 가계 분류별의 상세와 같은 그래프를
 * 그린다. 검색을 걸지 않았으면 모든 거래다. 부르는 쪽은 열 때만 이 컴포넌트를 세운다 --
 * 닫았다 다시 열면 보는 기간과 지출·수입이 그때의 검색에 맞춰 새로 정해져야 한다.
 *
 * 기간은 해·달·주 중 하나다. 달은 가계 화면과 같은 머리(달 고르기 포함)로, 해와 주는 앞뒤
 * 단추와 이름만으로 옮긴다.
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
  grouping,
  initialKey,
}: {
  onClose: () => void;
  /** 거래 목록이 기간을 나누는 규칙. 머리글의 단추로 열면 이 규칙으로 오늘이 든 기간을 연다. */
  grouping: PeriodGrouping;
  /** 년월 줄의 분석 단추로 열었으면 그 줄의 기간 열쇠. */
  initialKey?: string;
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
  const analysis = useTransactionAnalysis({ search, range, scope, grouping, initialKey });
  const [year, month] = analysis.periodKey.split('-').map(Number);
  /* 앞뒤 단추의 이름. 시작일을 옮긴 달도 달 단위로 옮긴다. */
  const stepLabel = {
    prev: analysis.unit === 'week' ? 'week.prev' : analysis.unit === 'year' ? 'month.prevYear' : 'month.prev',
    next: analysis.unit === 'week' ? 'week.next' : analysis.unit === 'year' ? 'month.nextYear' : 'month.next',
  } as const;

  return (
    <Modal isOpen onClose={onClose} title={t('tx.analysisTitle')} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {searchCount > 0
            ? t('tx.analysisFiltered', { count: searchCount })
            : t('tx.analysisAll')}
        </p>

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
          /*
            해·주와 시작일을 옮긴 달은 앞뒤 단추와 이름만 둔다. 직접 정한 기간은 옮길 앞뒤가
            없어 이름만 선다.
          */
          <div className="flex items-center gap-1">
            {analysis.unit !== 'range' ? (
              <button
                type="button"
                onClick={() => analysis.shift(-1)}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
                aria-label={t(stepLabel.prev)}
                title={t(stepLabel.prev)}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : null}
            <span className="py-1 text-2xl font-bold text-gray-900">{analysis.label}</span>
            {analysis.unit !== 'range' ? (
              <button
                type="button"
                onClick={() => analysis.shift(1)}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
                aria-label={t(stepLabel.next)}
                title={t(stepLabel.next)}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        )}

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
