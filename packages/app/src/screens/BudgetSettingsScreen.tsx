import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useBudgetSettings } from '@money/core/hooks/useBudgetSettings';
import { parseBudgetSettingsQuery, type BudgetSettingRow } from '@money/core/lib/budget';
import { currentYearMonth } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import {
  useCanEdit,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';

import BudgetEditModal from '../components/BudgetEditModal';
import MonthHeader from '../components/MonthHeader';
import PageHeader from '../components/PageHeader';
import TypeTabs from '../components/TypeTabs';
import { useNavigation } from '../shell/navigation';

/** 들여쓰기와 굵기. 합계가 가장 굵고 소분류는 한 칸 들어간다 (웹과 같은 값). */
const LEVEL_CLASS: Record<BudgetSettingRow['level'], string> = {
  total: 'font-semibold text-gray-900',
  main: 'font-medium text-gray-900',
  sub: 'pl-5 text-gray-700',
  tag: 'text-gray-900',
};

/**
 * 예산 설정. 홈의 예산 상자 오른쪽 위 톱니로 들어온다. 웹의 /home/budgets 와 같다.
 *
 * 분류 예산 상자의 톱니로 오면 합계·대분류·소분류를, 태그 예산 상자의 톱니로 오면(`kind=tag`)
 * 태그를 늘어놓는다. 줄을 누르면 예산 팝업이 열린다.
 */
export default function BudgetSettingsScreen() {
  const { t } = useTranslation();
  const { path } = useNavigation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const canEdit = useCanEdit();

  /* 홈에서 보던 갈래·달·지출수입으로 연다. 주소에 없으면 이번 달 분류 지출이다. */
  const [initial] = useState(() => {
    const today = currentYearMonth(timeZone);
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    return parseBudgetSettingsQuery(
      (key) => params.get(key),
      `${today.year}-${String(today.month).padStart(2, '0')}`,
    );
  });
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
    <View className="gap-4">
      <PageHeader title={isTag ? t('budget.tagSettings') : t('budget.settings')} showBack />

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
        예산 화면의 탭과 같은 모양이다 (고른 탭만 파랑). 합계는 이 화면이 다루지 않아 적지 않는다.
        태그 예산은 지출·수입으로 가르지 않아 탭이 없다.
      */}
      {!isTag ? <TypeTabs type={type} onChange={setType} tone="selection" /> : null}

      <Text className="text-sm text-gray-500">
        {isTag ? t('budget.tagSettingsHint') : t('budget.settingsHint')}
      </Text>

      {hasError ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('budget.settingsLoadFailed')}</Text>
        </View>
      ) : null}

      {isLoading && (isTag ? tagRows.length === 0 : rows.length <= 1) ? (
        <View className="rounded-lg bg-white p-4 shadow-sm">
          <Text className="text-sm text-gray-600">{t('common.loading')}</Text>
        </View>
      ) : isTag && tagRows.length === 0 ? (
        <Text className="text-sm text-gray-500">{t('budget.noTags')}</Text>
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
    </View>
  );
}

/** 예산 줄들. 분류 칸과 태그 칸이 같은 모양을 쓴다 (웹의 BudgetRows 와 같다). */
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
    <View className="overflow-hidden rounded-lg bg-white shadow-sm">
      {rows.map((row, index) => (
        <Pressable
          key={row.id}
          onPress={() => onOpen(row.id)}
          /* 보기 권한은 예산을 고칠 수 없다. 줄은 금액을 읽는 자리로만 남는다. */
          disabled={!canEdit}
          accessibilityRole="button"
          className={`flex-row items-center gap-2 px-4 py-3 ${
            index > 0 ? 'border-t border-gray-100' : ''
          } ${row.level === 'total' ? 'bg-gray-50' : ''} ${canEdit ? 'active:bg-gray-100' : ''}`}
        >
          {row.level === 'tag' ? (
            <View
              className="h-2.5 w-2.5 rounded-full bg-gray-300"
              style={row.color ? { backgroundColor: row.color } : undefined}
            />
          ) : null}
          <Text numberOfLines={1} className={`min-w-0 flex-1 text-sm ${LEVEL_CLASS[row.level]}`}>
            {row.name}
          </Text>
          {row.isOverridden ? (
            <Text className="text-xs text-amber-700">{t('budget.monthAdjusted')}</Text>
          ) : null}
          <Text
            className={`text-sm ${row.isSet ? 'font-semibold text-gray-900' : 'text-gray-400'}`}
          >
            {row.isSet ? formatCurrency(row.amount, currency) : t('common.none')}
          </Text>
          {canEdit ? <ChevronRight size={16} color="#9ca3af" /> : null}
        </Pressable>
      ))}
    </View>
  );
}
