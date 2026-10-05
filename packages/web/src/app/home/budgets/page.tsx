'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { useBudgetSettings } from '@money/core/hooks/useBudgetSettings';
import { parseBudgetSettingsQuery, type BudgetSettingRow } from '@money/core/lib/budget';
import { currentYearMonth } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import {
  useCanEdit,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import BudgetEditModal from '@/components/BudgetEditModal';
import MonthHeader from '@/components/MonthHeader';
import PageHeader from '@/components/PageHeader';
import TypeTabs from '@/components/TypeTabs';
import { useProjectGuard } from '@/hooks/useProjectGuard';

/** 들여쓰기와 굵기. 합계가 가장 굵고 소분류는 한 칸 들어간다. */
const LEVEL_CLASS: Record<BudgetSettingRow['level'], string> = {
  total: 'font-semibold text-gray-900',
  main: 'font-medium text-gray-900',
  sub: 'pl-5 text-gray-700',
  tag: 'text-gray-900',
};

// useSearchParams는 Suspense 경계 안에서만 프리렌더가 가능하다.
export default function BudgetSettingsPage() {
  return (
    <Suspense>
      <BudgetSettings />
    </Suspense>
  );
}

/**
 * 예산 설정. 홈의 예산 상자 오른쪽 위 톱니로 들어온다.
 *
 * 두 갈래로 열린다. 분류 예산 상자의 톱니로 오면 합계·대분류·소분류를 분류 화면의 차례로,
 * 태그 예산 상자의 톱니로 오면(`kind=tag`) 태그를 태그 화면의 차례로 모두 늘어놓는다 (예산이
 * 없는 것도). 줄을 누르면 가계 화면의 분류별 상세와 같은 예산 팝업이 열린다. 앱의 같은 화면과
 * 같은 훅을 쓴다.
 */
function BudgetSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = useProjectGuard();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const canEdit = useCanEdit();

  /* 홈에서 보던 갈래·달·지출수입으로 연다. 주소에 없으면 이번 달 분류 지출이다. */
  const today = currentYearMonth(timeZone);
  const initial = parseBudgetSettingsQuery(
    (key) => searchParams.get(key),
    `${today.year}-${String(today.month).padStart(2, '0')}`,
  );
  const [yearMonth, setYearMonth] = useState(initial.yearMonth);
  const [type, setType] = useState(initial.type);
  const [year, month] = yearMonth.split('-').map(Number);
  const isTag = initial.kind === 'tag';

  const { rows, tagRows, isLoading, hasError, editor, nameOf } = useBudgetSettings({
    projectId,
    yearMonth,
    type,
  });

  return (
    <div className="space-y-4">
      {/* 돌아가기는 히스토리를 되짚는다. 들어온 자리가 홈이 아닐 수도 있다. */}
      <PageHeader
        title={isTag ? t('budget.tagSettings') : t('budget.settings')}
        onBack={() => router.back()}
      />

      {/*
        예산은 달마다 다를 수 있어(고른 달부터 바꾸기, 이 달만 조정) 어느 달의 금액인지
        적고 여기서 옮긴다. 합계는 이 화면이 다루지 않는다.
      */}
      <MonthHeader
        year={year}
        month={month}
        incomeTotal={0}
        expenseTotal={0}
        showTotals={false}
        onMonthChange={(nextYear, nextMonth) =>
          setYearMonth(`${nextYear}-${String(nextMonth).padStart(2, '0')}`)
        }
      />

      {/*
        지출·수입. 예산 화면의 탭과 같은 모양이다 (고른 탭만 파랑). 합계는 이 화면이 다루지 않아 적지 않는다.
        태그 예산은 지출·수입으로 가르지 않아 탭이 없다.
      */}
      {!isTag && <TypeTabs type={type} onChange={setType} tone="selection" />}

      <p className="text-sm text-gray-500">
        {isTag ? t('budget.tagSettingsHint') : t('budget.settingsHint')}
      </p>

      {hasError && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">
          {t('budget.settingsLoadFailed')}
        </div>
      )}

      {isLoading && (isTag ? tagRows.length === 0 : rows.length <= 1) ? (
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">{t('common.loading')}</p>
        </div>
      ) : isTag && tagRows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('budget.noTags')}</p>
      ) : (
        <BudgetRows
          rows={isTag ? tagRows : rows}
          canEdit={canEdit}
          onOpen={editor.open}
          currency={displayCurrency}
        />
      )}

      <BudgetEditModal
        editor={editor}
        projectId={projectId}
        name={editor.targetId ? nameOf(editor.targetId) : ''}
        yearMonth={yearMonth}
      />
    </div>
  );
}

/** 예산 줄들. 분류 칸과 태그 칸이 같은 모양을 쓴다. */
function BudgetRows({
  rows,
  canEdit,
  onOpen,
  currency,
}: {
  rows: BudgetSettingRow[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  currency: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onOpen(row.id)}
          /* 보기 권한은 예산을 고칠 수 없다. 줄은 금액을 읽는 자리로만 남는다. */
          disabled={!canEdit}
          className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition hover:bg-gray-50 disabled:hover:bg-transparent disabled:cursor-default ${
            row.level === 'total' ? 'bg-gray-50' : ''
          }`}
        >
          {/* 태그 색. 태그 화면·거래 입력과 같은 점이다. 색을 정하지 않은 태그는 회색이다. */}
          {row.level === 'tag' && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-300"
              style={row.color ? { backgroundColor: row.color } : undefined}
              aria-hidden
            />
          )}
          <span className={`flex-1 min-w-0 truncate ${LEVEL_CLASS[row.level]}`}>{row.name}</span>
          {row.isOverridden && (
            <span className="shrink-0 text-xs text-amber-700">{t('budget.monthAdjusted')}</span>
          )}
          <span
            className={`shrink-0 tabular-nums ${
              row.isSet ? 'font-semibold text-gray-900' : 'text-gray-400'
            }`}
          >
            {row.isSet ? formatCurrency(row.amount, currency) : t('common.none')}
          </span>
          {canEdit && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
