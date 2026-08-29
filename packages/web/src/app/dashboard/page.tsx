'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@/store/project';
import { useBudget } from '@/store/budget';
import { apiClient, type ReportPeriod } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { toAmountString, toNumber } from '@/lib/money';
import {
  dateKeyOf,
  dayRangeQuery,
  currentYearMonth,
  formatYearMonth,
  monthQueryRange,
} from '@/lib/datetime';
import { countedShare } from '@/lib/entries';
import { useTranslation, type MessageKey } from '@/lib/i18n';
import Modal from '@/components/Modal';
import TransactionCalendar from '@/components/TransactionCalendar';
import TransactionListView from '@/components/TransactionListView';
import MonthHeader from '@/components/MonthHeader';
import PageHeader from '@/components/PageHeader';
import { EntryListItem } from '@/components/TransactionItem';
import PaymentMethodTab from '@/components/PaymentMethodTab';
import CategoryTab from '@/components/CategoryTab';
import EntryFilterBar, { ExtraType } from '@/components/EntryFilterBar';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import BudgetScheduleList from '@/components/BudgetScheduleList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePersonFilterSync } from '@/hooks/usePersonFilterSync';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import type { EntryFilterQuery } from '@money/types';
import { useApiError } from '@/lib/api-error';

/**
 * 기간 보기에서 그릴 달력 장수 상한.
 *
 * 달마다 한 장이라 구간이 길면 끝없이 늘어난다. 1년치면 화면을 훑어보는 한계에
 * 가깝고, 그보다 길면 목록과 분류별로 보는 편이 낫다.
 */
const CALENDAR_MAX_MONTHS = 12;

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const BUDGET_FORM_ID = 'detail-budget-form';

/**
 * 여러 달을 한꺼번에 바꾸는 두 가지 방법.
 *
 * 서버가 다르게 처리한다. 'all'은 규칙의 금액을 고치고, 'from'은 규칙을 앞
 * 달까지로 끊은 뒤 그 달부터 새 규칙을 만든다.
 *
 * 한 달만 바꾸는 일은 여기 없다. 아래 월별 목록에서 그 줄을 직접 고친다.
 * 같은 입력 칸이 "모든 달"도 되고 "이 달만"도 되면 어느 쪽이 걸리는지 알 수 없다.
 */
const BUDGET_SCOPE_OPTIONS: Array<{
  value: 'all' | 'from';
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}> = [
  {
    value: 'all',
    labelKey: 'budget.scopeAll',
    descriptionKey: 'budget.scopeAllHint',
  },
  {
    value: 'from',
    labelKey: 'budget.scopeFrom',
    descriptionKey: 'budget.scopeFromHint',
  },
];

export default function TransactionsPage() {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const { isAuthenticated, user, defaultProjectData } = useAuth();
  const { selectedPersonIds, togglePersonId } = useUserFilter();
  const { selectedProjectId } = useProject();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
  // 목록 금액은 표시 통화 환산액이다.
  const displayCurrency = useProjectDisplayCurrency();
  /** 설정에서 지정한 "구성원 중 나". 필터 막대가 이름 뒤에 표시한다. */
  const myPersonId = useMyPersonId();
  const {
    monthlyBudgets,
    fetchMonthlyBudgets,
    createBudget: createBudgetApi,
    updateBudget: updateBudgetApi,
    deleteBudget: deleteBudgetApi,
    resetBudgets: resetBudgetsApi,
  } = useBudget();
  const router = useRouter();
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  // 월 합계는 서버가 계산한다 (/reports/summary)
  const [summary, setSummary] = useState<{ income: string; expense: string }>({ income: '0', expense: '0' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [displayEntries, setDisplayEntries] = useState<EntryListItem[]>([]);
  const [currentMonth, setCurrentMonth] = useState<number>(() => currentYearMonth(timeZone).month);
  const [currentYear, setCurrentYear] = useState<number>(() => currentYearMonth(timeZone).year);
  const [viewType, setViewType] = useState<'calendar' | 'budget' | 'payment-method'>('calendar');
  /**
   * 어느 구간을 보고 있는지.
   *
   * 'month'  : 달 단위 (기본). 달력·예산이 달을 전제로 하므로 기본은 이쪽이다.
   * 'range'  : 직접 정한 기간. 카드 청구주기나 여행처럼 달력의 달과 어긋나는
   *            구간을 볼 때 쓴다. 달을 넘어가도 된다.
   */
  const [periodMode, setPeriodMode] = useState<'month' | 'range'>('month');
  /** "YYYY-MM-DD". 양끝을 포함한다. */
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [budgetType, setBudgetType] = useState<'income' | 'expense'>('expense');
  /** 고른 것이 "미분류"인지 (대분류에 바로 기록한 건만). 분류별 화면이 쓴다. */
  const [selectedCategoryExact, setSelectedCategoryExact] = useState(false);
  // 상세 분석 패널에서 여는 예산 입력. 분류는 보고 있는 것으로 고정되고 금액만 받는다.
  const [showDetailBudgetModal, setShowDetailBudgetModal] = useState(false);
  const [detailBudgetAmount, setDetailBudgetAmount] = useState(0);
  const [detailBudgetError, setDetailBudgetError] = useState('');
  const [detailBudgetSubmitting, setDetailBudgetSubmitting] = useState(false);
  /**
   * 이 금액을 어느 달에 적용할지.
   *
   * 'all'   : 이 예산 규칙이 덮는 모든 달 (기본)
   * 'from'  : 보고 있는 달부터. 이전 달은 지금 금액 그대로 남는다.
   * 'month' : 보고 있는 달만. 규칙은 그대로 두고 이 달에만 다른 값을 씌운다.
   */
  const [detailBudgetScope, setDetailBudgetScope] = useState<'all' | 'from'>('all');
  /**
   * 'from'일 때 적용을 시작할 달 "YYYY-MM".
   *
   * 보고 있는 달로 고정하지 않는다. 8월 화면을 보면서 "10월부터 예산을 줄인다"처럼
   * 앞으로의 계획을 넣는 일이 흔한데, 고정해 두면 그 달로 옮겨 간 뒤에야 넣을 수 있다.
   */
  const [detailBudgetFromMonth, setDetailBudgetFromMonth] = useState('');
  /** 위쪽 폼이 규칙을 바꾸면 올린다. 아래 월별 목록이 이 값을 보고 다시 읽는다. */
  const [budgetScheduleToken, setBudgetScheduleToken] = useState(0);
  const [isResettingBudgets, setIsResettingBudgets] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const dateTransactionsRef = useRef<HTMLDivElement>(null);
  /** 일반/과소비 선택. 둘 다 고른 상태로 시작한다 (= 전체). */
  const [selectedExtraTypes, setSelectedExtraTypes] = useState<ExtraType[]>(['normal', 'extra']);
  /** 거래 상세·추가 팝업. 이 화면과 자산 화면이 같은 컴포넌트를 쓴다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  useProjectGuard();

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) {
      if (!isAuthenticated) {
        router.push('/login');
      }
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);

        // 항상 API에서 최신 데이터 가져오기 (캐시 사용 안 함)
        console.log('[Dashboard] 📡 Fetching data for project:', selectedProjectId);
        const [accountsData, peopleData, cardsData, categoriesData] = await Promise.all([
          apiClient.getAccountsV2(selectedProjectId),
          apiClient.getPeople(selectedProjectId),
          apiClient.getCards(selectedProjectId),
          apiClient.getCategories(selectedProjectId),
        ]);

        setAccounts(accountsData || []);
        // 저장된 자산주인 선택은 usePersonFilterSync 가 이 목록에 맞춘다.
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);

        // 초기 월 설정. 거래는 아래 월별 useEffect가 불러온다.
        // 이번 달 판단도 프로젝트 타임존 기준이다.
        const today = currentYearMonth(timeZone);
        setDisplayEntries([]);
        setCurrentMonth(today.month);
        setCurrentYear(today.year);
      } catch (err) {
        setError(t('home.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router, selectedProjectId, defaultProjectData]);

  usePersonFilterSync(selectedProjectId, people);

  /**
   * 서버로 보내는 필터.
   *
   * 체크 상태를 그대로 넘긴다. 전부 고른 경우만 파라미터를 빼서 서버가 필터 없는
   * 기본 경로를 타게 하고(사람을 새로 추가해도 자동 포함), 하나도 고르지 않았으면
   * 빈 값을 보내 "결과 없음"을 뜻하게 한다. 빼는 것과 빈 값은 서버에서 다르게 읽는다.
   * 체크박스를 연달아 누르는 동안은 디바운스로 조회를 미룬다.
   */
  const entryFilter = useMemo<EntryFilterQuery>(() => {
    const allPeopleSelected =
      people.length > 0 && selectedPersonIds.length === people.length;
    const allExtraSelected = selectedExtraTypes.length === 2;

    return {
      ...(allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
      ...(allExtraSelected ? {} : { extraTypes: selectedExtraTypes.join(',') }),
    };
  }, [selectedPersonIds, people.length, selectedExtraTypes]);
  const appliedFilter = useDebouncedValue(entryFilter, 250);
  /*
   * 일반/과소비 중 어느 몫을 셀지.
   *
   * 한 거래가 둘로 나뉘므로(3,000원 중 2,000원이 과소비) 한쪽만 볼 때는 목록의
   * 날짜별 소계도 그 몫만 세야 위 합계와 맞는다. 서버가 리포트에서 쓰는 규칙과 같다.
   */
  const share = countedShare(appliedFilter);
  /** 필터가 걸려 있는지. 목록이 비었을 때 이유를 알려주는 데 쓴다. */
  const isFilterNarrowed = Object.keys(appliedFilter).length > 0;

  // 예산 사용금액도 같은 필터를 탄다. 이 선언은 appliedFilter 뒤에 있어야 한다
  // (의존성 배열은 렌더 중에 평가되므로 앞에 두면 초기화 전 접근이 된다).
  useEffect(() => {
    if (selectedProjectId && currentYear && currentMonth) {
      fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
    }
  }, [selectedProjectId, currentYear, currentMonth, fetchMonthlyBudgets, appliedFilter]);

  /**
   * 표시 중인 달의 거래와 합계를 가져온다.
   *
   * 예전에는 거래 전량을 받아 브라우저에서 월별로 나누고 합산했다.
   * 이제 조회 범위도 합계도 서버가 처리한다.
   */
  /**
   * 거래를 고치고 나면 올라가는 번호.
   *
   * 분류별·수단별 탭은 각자 서버에서 데이터를 받는다. 이 화면의 목록만 다시 불러오면
   * 그 탭들은 고치기 전 값을 계속 보여 준다. 번호를 넘겨 함께 다시 받게 한다.
   */
  const [dataVersion, setDataVersion] = useState(0);

  /**
   * 지금 보고 있는 구간.
   *
   * 목록 API는 인스턴트를, 리포트 API는 달력 날짜를 받는다. 같은 구간을 두 형식으로
   * 만들어 두 곳에 넘긴다. 한쪽만 바꾸면 목록과 상단 합계가 서로 다른 구간을 본다.
   */
  const isRangeMode = periodMode === 'range' && Boolean(rangeStart && rangeEnd);
  /**
   * 기간이 걸쳐 있는 달들. 기간 보기의 달력은 달마다 한 장씩 그린다.
   *
   * 장수를 12로 자른다. 3년 구간이면 달력 36장이 되는데, 그 화면은 아무도 읽지
   * 않으면서 렌더만 무거워진다. 잘랐다는 사실은 달력 아래에 적는다.
   */
  const monthsInRange = useMemo(() => {
    if (!isRangeMode) return [];

    const [startYear, startMonth] = rangeStart.split('-').map(Number);
    const [endYear, endMonth] = rangeEnd.split('-').map(Number);
    const months: Array<{ year: number; month: number }> = [];

    for (
      let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
      cursor.getTime() <= Date.UTC(endYear, endMonth - 1, 1) && months.length < CALENDAR_MAX_MONTHS;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    ) {
      months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    }

    return months;
  }, [isRangeMode, rangeStart, rangeEnd]);
  const reportPeriod: ReportPeriod = isRangeMode
    ? { startDate: rangeStart, endDate: rangeEnd }
    : { yearMonth: `${currentYear}-${String(currentMonth).padStart(2, '0')}` };
  const entryRange = isRangeMode
    ? dayRangeQuery(rangeStart, rangeEnd, timeZone)
    : monthQueryRange(currentYear, currentMonth, timeZone);
  // 객체는 렌더마다 새로 만들어지므로 의존성에는 값을 쓴다.
  const rangeKey = `${entryRange.startDate}~${entryRange.endDate}`;

  const reloadPeriod = useCallback(async () => {
    if (!selectedProjectId || !currentYear || !currentMonth) return;

    // 커서를 끝까지 따라간다. 한 페이지(200건)만 받으면 목록이 잘리는 것보다,
    // 달력의 일별 합계와 일별 누적 그래프가 조용히 과소 집계되는 것이 문제다.
    // 상단 요약은 서버가 전량으로 계산하므로 같은 화면 안에서 숫자가 어긋난다.
    const [entryRows, summaryRes] = await Promise.all([
      apiClient.getAllEntries({ ...entryRange, ...appliedFilter }, selectedProjectId),
      apiClient.getSummary(reportPeriod, selectedProjectId, appliedFilter),
    ]);

    setEntries(entryRows ?? []);
    setSummary(summaryRes ?? { income: '0', expense: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, currentYear, currentMonth, rangeKey, appliedFilter]);

  useEffect(() => {
    reloadPeriod().catch((err: unknown) => {
      console.error('거래 조회 실패:', err);
      setEntries([]);
    });
  }, [reloadPeriod]);

  useEffect(() => {
    if (selectedProjectId) {
      apiClient.getCategories(selectedProjectId).then((data) => {
        setCategories(data);
      });
    }
  }, [selectedProjectId]);

  /*
   * 분류별 탭에 들어오면 합계를 골라 둔다.
   *
   * 오른쪽 상세가 비어 있으면 화면 절반이 빈 채로 시작한다. 지출/수입 탭을 옮길
   * 때도 그 탭의 합계로 옮겨야 한다. 그러지 않으면 지출 분류를 고른 채 수입 탭을
   * 보게 된다.
   */
  useEffect(() => {
    if (viewType === 'budget') {
      setSelectedCategoryId(budgetType === 'expense' ? 'total-expense' : 'total-income');
      setSelectedCategoryExact(false);
    }
  }, [viewType, budgetType]);

  /**
   * 거래를 저장하거나 지운 뒤 이 화면이 다시 읽어야 할 것들.
   *
   * 목록과 상단 합계는 이 화면이, 분류별·수단별 탭은 각자 서버에서 받는다.
   * 예산 사용금액도 거래가 바뀌면 달라지므로 함께 다시 받는다.
   */
  const handleEntryChange = useCallback(async () => {
    await reloadPeriod();
    setDataVersion((version) => version + 1);
    if (selectedProjectId) {
      fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
    }
  }, [
    reloadPeriod,
    selectedProjectId,
    currentYear,
    currentMonth,
    appliedFilter,
    fetchMonthlyBudgets,
  ]);

  /** 거래 팝업 안에서 계좌·카드·분류·사람을 새로 만들었을 때. 바뀐 목록만 갈아 끼운다. */
  const handleReferenceDataChange = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  const handleTransactionClick = (entry: EntryListItem) => {
    entryEditorRef.current?.openDetail(entry);
  };

  const handleAddClick = () => {
    entryEditorRef.current?.openAdd();
  };

  /**
   * 목록에 보여 줄 거래.
   *
   * 이체와 카드사 이체도 그대로 보여 준다. 돈이 움직인 사실은 가계부에 남아야 한다.
   * 대신 합계에는 들어가지 않는다. 내 계좌 사이의 이동이라 수입도 지출도 아니고,
   * 카드 사용액은 결제할 때가 아니라 그을 때 이미 지출로 잡혔기 때문이다.
   * 세면 같은 돈을 두 번 세게 된다.
   *
   * 그 규칙은 걸러 내기가 아니라 `expenseAmountOf`/`incomeAmountOf`가 지킨다.
   * 두 함수가 이체와 카드사 이체에 0을 돌려주므로 목록에 있어도 합계가 흔들리지 않는다.
   */
  const visibleEntries = entries;

  const monthlyTotals = useMemo(
    () => ({ incomeTotal: toNumber(summary.income), expenseTotal: toNumber(summary.expense) }),
    [summary],
  );


  const handleCalendarDateSelect = (clickedDate: Date, dayEntries: EntryListItem[]) => {
    if (startDate &&
        clickedDate.getFullYear() === startDate.getFullYear() &&
        clickedDate.getMonth() === startDate.getMonth() &&
        clickedDate.getDate() === startDate.getDate()
    ) {
      setStartDate(null);
      setDisplayEntries([]);
    } else {
      setStartDate(clickedDate);
      setDisplayEntries(dayEntries);
    }

    setTimeout(() => {
      dateTransactionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const handleMonthChange = (year: number, month: number) => {
    setCurrentYear(year);
    setCurrentMonth(month);
    setStartDate(null);
    setDisplayEntries([]);
  };

  /**
   * 달 보기 <-> 기간 보기.
   *
   * 기간을 처음 켜면 보고 있던 달의 1일~말일을 넣어 준다. 빈 칸 두 개를 주면
   * 사용자가 무엇을 넣어야 하는지 알기 어렵고, 켜자마자 목록이 비어 버린다.
   */
  const handlePeriodModeChange = (mode: 'month' | 'range') => {
    if (mode === 'range' && !(rangeStart && rangeEnd)) {
      const { startDate: start, endDate: end } = monthQueryRange(
        currentYear,
        currentMonth,
        timeZone,
      );
      setRangeStart(dateKeyOf(start, timeZone));
      setRangeEnd(dateKeyOf(end, timeZone));
    }
    // 기간 보기에는 달력이 없다. 달력이 고른 날짜 필터를 들고 넘어가면
    // 목록이 그 하루만 남은 채로 보인다.
    setStartDate(null);
    setDisplayEntries([]);
    setPeriodMode(mode);
  };

  const handleRangeChange = (start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
    setDisplayEntries([]);
  };



  if (!isAuthenticated) {
    return <div>{t('common.loading')}</div>;
  }

  /**
   * 상세 분석 패널의 제목.
   *
   * 예전에는 카드를 누를 때 이름을 따로 저장했다. 그러면 지출/수입 탭을 옮길 때
   * selectedCategoryId만 새 탭의 전체예산으로 바뀌고 이름은 그대로 남아 제목이 어긋났다.
   * 저장하지 않고 id에서 만들면 그런 어긋남이 생기지 않는다.
   */
  const selectedCategoryLabel = useMemo(() => {
    if (selectedCategoryId === 'total-expense') return t('ledger.totalExpense');
    if (selectedCategoryId === 'total-income') return t('ledger.totalIncome');
    return categories.find((c) => c.id === selectedCategoryId)?.name ?? '';
  }, [selectedCategoryId, categories]);

  /**
   * 상세 분석에서 보고 있는 대상을 예산 API가 쓰는 형태로 바꾼다.
   *
   * selectedCategoryId는 실제 카테고리 id이거나, 전체예산 카드가 넘기는
   * 'total-income'/'total-expense' 합성 id다. 후자는 카테고리 없는 예산이라
   * 생성할 때 API 센티널 값을 따로 보내야 한다.
   */
  const resolveDetailBudgetTarget = () => {
    const isTotal =
      selectedCategoryId === 'total-income' || selectedCategoryId === 'total-expense';
    const type: 'income' | 'expense' = isTotal
      ? selectedCategoryId === 'total-income'
        ? 'income'
        : 'expense'
      : (categories.find((c) => c.id === selectedCategoryId)?.type ?? budgetType);

    const found = monthlyBudgets.find((b) =>
      isTotal
        ? !b.categoryId && (b.type === type || b.categoryType === type)
        : b.categoryId === selectedCategoryId,
    );

    return {
      type,
      apiCategoryId: isTotal
        ? type === 'income'
          ? 'BUDGET_TOTAL_INCOME'
          : 'BUDGET_TOTAL_EXPENSE'
        : selectedCategoryId,
      // placeholder는 목록을 채우기 위한 표시용 행이다. 저장된 예산이 아니다.
      existing: found && !found.budgetId.startsWith('placeholder-') ? found : undefined,
    };
  };

  /** 보고 있는 달 "YYYY-MM". 예산 API가 적용 기준으로 쓴다. */
  const viewingYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  /** 예산 팝업이 고치고 있는 규칙. 아직 없으면 undefined (새로 만드는 중). */
  const editingBudget = showDetailBudgetModal
    ? resolveDetailBudgetTarget().existing
    : undefined;

  /**
   * 저장 버튼이 지우는 버튼이 되는 경우.
   *
   * 0원은 "예산을 두지 않는다"는 뜻이다. 범위는 어디까지 없앨지만 정한다.
   * '모든 달'이면 규칙을 지우고, '고른 달부터'면 앞 달까지로 끊는다.
   *
   * 0원짜리 규칙을 남기지 않는 이유는, 그것이 "예산 없음"과 화면에서 다르게
   * 보이기 때문이다. 0원 예산은 한 푼만 써도 초과로 붉게 뜬다.
   *
   * 특정 한 달만 0원으로 두는 것은 아래 월별 목록에서 한다. 그쪽은 규칙이 아니라
   * 그 달의 조정값이라 다음 달에 영향을 주지 않는다.
   */
  const isDeletingBudget = detailBudgetAmount === 0 && Boolean(editingBudget);

  const openDetailBudgetModal = () => {
    const { existing } = resolveDetailBudgetTarget();
    /*
     * 위쪽 폼은 "여러 달을 한꺼번에" 바꾸는 자리다. 그래서 이 달만 조정돼 있어도
     * 조정값이 아니라 규칙 금액을 채운다. 조정값을 넣어 두면 그 값을 저장했을 뿐인데
     * 다른 달까지 그 금액이 되어 버린다. 조정은 아래 월별 목록에서 고친다.
     */
    setDetailBudgetAmount(existing?.ruleAmount ?? existing?.monthlyAmount ?? 0);
    /*
     * 범위 선택(detailBudgetScope)은 그대로 둔다. 열 때마다 '모든 달'로 되돌리면,
     * "고른 달부터"로 저장하고 확인하러 다시 연 사용자가 모든 달이 골라진 화면을
     * 보게 된다. 그 상태로 0을 넣으면 예산이 통째로 사라진다.
     */
    setDetailBudgetFromMonth(viewingYearMonth);
    setDetailBudgetError('');
    setShowDetailBudgetModal(true);
  };

  /** 예산 규칙이 바뀐 뒤. 화면의 예산 카드와 팝업 안 월별 목록을 함께 다시 읽는다. */
  const reloadBudgets = async () => {
    if (!selectedProjectId) return;
    await fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
    setBudgetScheduleToken((token) => token + 1);
  };

  /**
   * 프로젝트의 예산을 전부 지운다.
   *
   * 분류가 수십 개면 하나씩 지우는 것으로는 손을 댈 수 없다. 되돌릴 수 없는
   * 동작이라 몇 개가 지워지는지 세어 확인을 받는다.
   *
   * 지금은 화면에 이 동작을 부르는 버튼이 없다. 실수로 누르기 쉬운 자리에 있었고
   * 되돌릴 수 없어서 뺐다. 서버 엔드포인트(DELETE /budgets)와 함께 남겨 둔다.
   */
  const handleResetBudgets = async () => {
    if (!selectedProjectId) return;

    const saved = monthlyBudgets.filter((b) => !b.budgetId.startsWith('placeholder-')).length;
    if (saved === 0) {
      alert(t('budget.nothingToDelete'));
      return;
    }
    if (!window.confirm(t('budget.deleteAllConfirm', { count: saved }))) {
      return;
    }

    try {
      setIsResettingBudgets(true);
      const deleted = await resetBudgetsApi(selectedProjectId);
      await reloadBudgets();
      alert(t('budget.deleted', { count: deleted }));
    } catch (err: any) {
      alert(err?.message || t('budget.deleteFailed'));
    } finally {
      setIsResettingBudgets(false);
    }
  };

  const handleDetailBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDetailBudgetError('');
    if (!selectedProjectId) return;

    if (detailBudgetAmount < 0) {
      setDetailBudgetError(t('budget.negative'));
      return;
    }

    const { type, apiCategoryId, existing } = resolveDetailBudgetTarget();
    const monthlyAmount = toAmountString(detailBudgetAmount);

    // 아직 규칙이 없으면 0은 지울 것이 없다는 뜻이다.
    if (!existing && detailBudgetAmount === 0) {
      setDetailBudgetError(t('budget.noneToDelete'));
      return;
    }

    /*
     * '고른 달부터'는 그 달부터 끝까지를 이 금액으로 만든다는 뜻이다.
     * 지나간 달이든 앞으로의 달이든 고를 수 있다. 뒤에 나뉘어 있던 규칙은
     * 서버가 함께 걷어내므로, 고른 달 이후가 다른 금액으로 남는 일은 없다.
     */
    const applyFromMonth = detailBudgetFromMonth;
    if (existing && detailBudgetScope === 'from') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(applyFromMonth)) {
        setDetailBudgetError(t('budget.pickMonth'));
        return;
      }
    }

    try {
      setDetailBudgetSubmitting(true);

      if (!existing) {
        await createBudgetApi({
          projectId: selectedProjectId,
          categoryId: apiCategoryId,
          type,
          monthlyAmount,
          // 보고 있는 달을 넘긴다. 예산이 기간별로 나뉘어 있을 때
          // 서버가 어느 규칙을 고쳐야 할지 이 값으로 정한다.
          yearMonth: viewingYearMonth,
        });
      } else if (detailBudgetAmount === 0) {
        /*
         * 0원 = "예산을 두지 않는다". 범위만큼 규칙을 없앤다.
         * '모든 달'이면 규칙을 지우고, '고른 달부터'면 앞 달까지로 끊는다
         * (서버가 남는 달이 없는 경우를 판단해 규칙째 지운다).
         */
        await deleteBudgetApi(
          existing.budgetId,
          detailBudgetScope === 'from' ? applyFromMonth : undefined,
        );
      } else if (detailBudgetScope === 'from') {
        /*
         * 고른 달부터 끝까지를 이 금액으로 만든다.
         *
         * 이미 그 달부터 시작하는 규칙이어도 그대로 보낸다. 뒤에 다른 규칙이
         * 나뉘어 있을 수 있고, 그것까지 걷어내는 것은 서버만 할 수 있다.
         * 여기서 'all' 경로로 새면 고른 달만 바뀌고 그 뒤는 옛 금액이 남는다.
         */
        await updateBudgetApi(existing.budgetId, {
          monthlyAmount,
          applyMode: 'from',
          applyFromMonth,
        });
      } else {
        await updateBudgetApi(existing.budgetId, { monthlyAmount });
      }

      await reloadBudgets();
      setShowDetailBudgetModal(false);
    } catch (err: any) {
      const message =
        messageOf(err, 'budget.saveFailed');
      setDetailBudgetError(message);
    } finally {
      setDetailBudgetSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <PersonScopeTitle
            noun={t('ledger.noun')}
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
        action={
          /* 거래 추가는 어느 탭에서든 쓸 수 있어야 한다 */
          <button
            onClick={handleAddClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
          >
            {t('ledger.addEntry')}
          </button>
        }
      />

      {/*
        데이터를 못 받았을 때. 예전에는 이 메시지가 거래 추가 팝업 안에만 있어서,
        팝업을 열기 전에는 화면이 그냥 비어 보였다.
      */}
      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{error}</div>
      )}

      {/* 년월(또는 기간) 이동과 보기 방식 탭 */}
      <MonthHeader
        year={currentYear}
        month={currentMonth}
        incomeTotal={monthlyTotals.incomeTotal}
        expenseTotal={monthlyTotals.expenseTotal}
        onMonthChange={handleMonthChange}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        isRangeMode={periodMode === 'range'}
        onRangeChange={handleRangeChange}
        onPeriodModeChange={handlePeriodModeChange}
        right={
          <div className="flex gap-2 bg-gray-200 rounded-lg p-1">
              <button
                onClick={() => setViewType('calendar')}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  viewType === 'calendar'
                    ? 'bg-white text-blue-600 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t('ledger.tab.daily')}
              </button>
              <button
                onClick={() => setViewType('budget')}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  viewType === 'budget'
                    ? 'bg-white text-blue-600 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t('ledger.tab.category')}
              </button>
              <button
                onClick={() => setViewType('payment-method')}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  viewType === 'payment-method'
                    ? 'bg-white text-blue-600 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              {t('ledger.tab.method')}
            </button>
          </div>
        }
      />

      <EntryFilterBar
        selectedExtraTypes={selectedExtraTypes}
        onToggleExtraType={(value) =>
          setSelectedExtraTypes((prev) =>
            prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
          )
        }
      />

      <div>
        {viewType === 'budget' ? (
          /*
            분류별.

            달 단위와 기간 보기가 같은 화면을 쓴다. 다른 점은 예산뿐이라, 예산이
            있는 달 단위에서만 budgets 를 넘겨 진행률 줄이 붙게 한다. 기간에는
            예산을 넘기지 않는다. 예산은 달마다 정하는 값이라 두 달 반짜리 구간에
            얼마인지가 정의되지 않는다.
          */
          <CategoryTab
            period={reportPeriod}
            projectId={selectedProjectId}
            filter={appliedFilter}
            categories={categories}
            onEntryClick={handleTransactionClick}
            reloadToken={dataVersion}
            type={budgetType}
            onTypeChange={setBudgetType}
            selectedId={selectedCategoryId}
            selectedExact={selectedCategoryExact}
            onSelect={(categoryId, exact) => {
              setSelectedCategoryId(categoryId);
              setSelectedCategoryExact(exact);
            }}
            budgets={isRangeMode ? undefined : monthlyBudgets}
            onEditBudget={isRangeMode ? undefined : openDetailBudgetModal}
          />
        ) : isLoading ? (
          <p className="text-gray-600">{t('common.loading')}</p>
        ) : viewType === 'payment-method' ? (
          /* 수단별 탭은 거래가 없어도 계좌·카드를 0원으로 보여준다.
             "거래가 없습니다"로 먼저 끊으면 그 화면에 도달할 수 없다. */
          <PaymentMethodTab
            period={reportPeriod}
            projectId={selectedProjectId}
            filter={appliedFilter}
            onEntryClick={handleTransactionClick}
            reloadToken={dataVersion}
            /* 정산 팝업이 결제 통장과 그 주인을 찾는 데 쓴다 */
            cards={cards}
            accounts={accounts}
            onCardChange={handleEntryChange}
          />
        ) : visibleEntries.length === 0 ? (
          /* 필터로 비었는지 원래 없는지 구분해 준다. 체크를 다 풀면 결과가 없는 게 정상이다. */
          <p className="text-gray-600">
            {isFilterNarrowed
              ? t('ledger.noFiltered')
              : t('feed.empty')}
          </p>
        ) : viewType === 'calendar' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="lg:col-span-1 space-y-4">
              {/*
                기간 보기는 걸쳐 있는 달마다 달력을 한 장씩 그린다. 구간 밖의 날은
                흐리게 두고 누를 수 없게 한다 (그 날짜의 거래는 받아오지 않았다).
              */}
              {isRangeMode ? (
                <>
                  {monthsInRange.map(({ year, month }) => (
                    <div key={`${year}-${month}`}>
                      <p className="mb-1 text-sm font-semibold text-gray-700">
                        {formatYearMonth(year, month)}
                      </p>
                      <TransactionCalendar
                        entries={visibleEntries}
                        share={share}
                        year={year}
                        month={month}
                        onDateSelect={handleCalendarDateSelect}
                        onMonthChange={handleMonthChange}
                        startDate={startDate}
                        endDate={endDate}
                        periodStart={rangeStart}
                        periodEnd={rangeEnd}
                      />
                    </div>
                  ))}
                  {monthsInRange.length >= CALENDAR_MAX_MONTHS && (
                    <p className="text-xs text-gray-500">
                      {t('ledger.calendarLimit', { months: CALENDAR_MAX_MONTHS })}
                    </p>
                  )}
                </>
              ) : (
                <TransactionCalendar
                  entries={visibleEntries}
                  share={share}
                  year={currentYear}
                  month={currentMonth}
                  onDateSelect={handleCalendarDateSelect}
                  onMonthChange={handleMonthChange}
                  startDate={startDate}
                  endDate={endDate}
                />
              )}
            </div>

            {/* 달력이 날짜를 고르는 도구라서 좁은 화면에서도 달력을 위에 둔다 */}
            {(displayEntries.length > 0 || !startDate) && (
              <div ref={dateTransactionsRef} className="lg:col-span-1">
                {!startDate ? (
                  <TransactionListView
                    entries={visibleEntries}
                    share={share}
                    onEntryClick={handleTransactionClick}
                  />
                ) : (
                  <>
                    <TransactionListView
                      entries={displayEntries}
                      share={share}
                      onEntryClick={handleTransactionClick}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <TransactionListView
            entries={visibleEntries}
            share={share}
            onEntryClick={handleTransactionClick}
          />
        )}
      </div>

      <EntryEditor
        ref={entryEditorRef}
        projectId={selectedProjectId}
        accounts={accounts}
        cards={cards}
        categories={categories}
        people={people}
        onReferenceDataChange={handleReferenceDataChange}
        onEntryChange={handleEntryChange}
      />


      {/* 상세 분석에서 여는 예산 입력. 분류가 정해져 있으므로 금액만 받는다. */}
      <Modal
        isOpen={showDetailBudgetModal}
        onClose={() => setShowDetailBudgetModal(false)}
        title={t('budget.modalTitle', { name: selectedCategoryLabel })}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetailBudgetModal(false)}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form={BUDGET_FORM_ID}
              disabled={detailBudgetSubmitting}
              className={`flex-1 px-4 py-2 text-white rounded-lg transition disabled:opacity-50 ${
                isDeletingBudget
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {detailBudgetSubmitting
                ? t('common.saving')
                : isDeletingBudget
                  ? t('budget.deleteAction')
                  : t('common.save')}
            </button>
          </div>
        }
      >
        <form id={BUDGET_FORM_ID} onSubmit={handleDetailBudgetSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('budget.monthlyAmount')}
            </label>
            <input
              type="number"
              min="0"
              autoFocus
              value={detailBudgetAmount}
              onChange={(e) => setDetailBudgetAmount(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/*
            적용 범위.

            규칙이 아직 없으면 고를 것이 없다. 새로 만드는 예산은 모든 달에 적용된다.
            (기간을 나누는 것은 이미 있는 규칙을 끊는 일이라 끊을 규칙이 있어야 한다)
          */}
          {editingBudget ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('budget.scope')}</label>
              <div className="space-y-2">
                {BUDGET_SCOPE_OPTIONS.map((option) => (
                  <div key={option.value}>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="budget-scope"
                        value={option.value}
                        checked={detailBudgetScope === option.value}
                        onChange={() => setDetailBudgetScope(option.value)}
                        className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm">
                        <span className="text-gray-900">{t(option.labelKey)}</span>
                        <span className="block text-xs text-gray-500">
                          {t(option.descriptionKey)}
                        </span>
                      </span>
                    </label>

                    {/*
                      시작 월 선택. label 밖에 둔다. 안에 넣으면 달을 고르려고 누른
                      클릭이 라디오까지 눌러 버린다.

                      고를 수 있는 달을 가두지 않는다. 지나간 달의 예산을 고치는 일도
                      있고, 몇 달 뒤부터 줄이겠다고 미리 넣는 일도 있다.
                    */}
                    {option.value === 'from' && detailBudgetScope === 'from' && (
                      <input
                        type="month"
                        value={detailBudgetFromMonth}
                        onChange={(e) => setDetailBudgetFromMonth(e.target.value)}
                        className="mt-2 ml-6 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {detailBudgetScope === 'all'
                  ? t('budget.zeroHintAll')
                  : t('budget.zeroHintFrom')}
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              {t('budget.newHint')}
            </p>
          )}

          {detailBudgetError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded text-sm">
              {detailBudgetError}
            </div>
          )}

        </form>

        {/*
          월별 목록.

          규칙이 있어야 달마다 얼마인지가 정해진다. 아직 없으면 보여 줄 것이 없다.

          form 밖에 둔다. 안에 두면 목록의 금액 칸에서 Enter를 쳤을 때 위쪽 폼이
          제출되어, "이 달만" 고치려던 값이 모든 달에 걸린다.
        */}
        {editingBudget && (
          <div className="mt-4">
            <BudgetScheduleList
              projectId={selectedProjectId}
              categoryId={resolveDetailBudgetTarget().apiCategoryId}
              type={resolveDetailBudgetTarget().type}
              startMonth={viewingYearMonth}
              reloadToken={budgetScheduleToken}
              onChange={reloadBudgets}
            />
          </div>
        )}
      </Modal>





    </div>
  );
}
