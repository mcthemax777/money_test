'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { useAuth } from '@money/core/store/auth';
import { useUserFilter } from '@money/core/store/user-filter';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import { useBudget } from '@money/core/store/budget';
import { useLedgerBasis } from '@money/core/store/ledger-basis';
import { apiClient, type ReportPeriod } from '@money/core/lib/api-client';
import type { Account, Card, Category, Person } from '@money/core/lib/types';
import { toNumber } from '@money/core/lib/money';
import {
  dateKeyOf,
  dayRangeQuery,
  currentYearMonth,
  monthQueryRange,
} from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import BasisPicker from '@/components/BasisPicker';
import Modal from '@/components/Modal';
import MonthHeader from '@/components/MonthHeader';
import LedgerKindSummary from '@/components/LedgerKindSummary';
import { EntryListItem } from '@/components/TransactionItem';
import PaymentMethodTab from '@/components/PaymentMethodTab';
import CategoryTab from '@/components/CategoryTab';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import BudgetEditModal from '@/components/BudgetEditModal';
import { useBudgetEditor } from '@money/core/hooks/useBudgetEditor';
import { useDebouncedValue } from '@money/core/hooks/useDebouncedValue';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import type { EntryScopeQuery } from '@money/types';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';

/** 가계 화면의 보기 방식. 날짜별·분류별·수단별 셋이다. */
/**
 * 가계가 보여 주는 두 가지.
 *
 * 날짜별(달력 + 그 날의 목록)은 여기 없다. 거래 화면이 같은 일을 더 넓게 하므로
 * (년월 -> 날짜 -> 거래, 달력 보기, 검색) 같은 것을 두 자리에서 기르지 않는다.
 */
type ViewType = 'budget' | 'payment-method';

export default function TransactionsPage() {
  const { t } = useTranslation();
  const { isAuthenticated, user, defaultProjectData } = useAuth();
  const { selectedPersonIds, togglePersonId } = useUserFilter();
  const { selectedProjectId } = useProject();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
  // 목록 금액은 표시 통화 환산액이다.
  const displayCurrency = useProjectDisplayCurrency();
  /** 설정에서 지정한 "구성원 중 나". 필터 막대가 이름 뒤에 표시한다. */
  const myPersonId = useMyPersonId();
  const { monthlyBudgets, fetchMonthlyBudgets, resetBudgets: resetBudgetsApi } = useBudget();
  const router = useRouter();
  // 월 합계는 서버가 계산한다 (/reports/summary)
  const [summary, setSummary] = useState<{ income: string; expense: string }>({ income: '0', expense: '0' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  /*
   * 무엇을 "그 달에 쓴 돈"으로 셀지. 머리글의 더보기에서 고른다 (거래 화면과 같은 둘).
   *
   * 이 화면이 답하는 물음이 "이 달에 어디에 얼마를 썼나"라 기본은 회차 기준이다 --
   * 24개월치를 산 달 하나에 몰아 두면 그 달의 분류별·수단별이 통째로 기울고 나머지
   * 스물세 달에는 실제로 나가는 돈이 보이지 않는다.
   */
  const { basis, setBasis } = useLedgerBasis();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<number>(() => currentYearMonth(timeZone).month);
  const [currentYear, setCurrentYear] = useState<number>(() => currentYearMonth(timeZone).year);
  const [viewType, setViewType] = useState<ViewType>('budget');
  /*
   * 한 번 열어 본 보기는 지우지 않고 감춘다.
   *
   * 옮길 때마다 지우고 다시 만들면 그 사이 화면이 빈다. 대신 다시 열 때마다 서버에
   * 새로 물어본다(visits). 프로젝트를 여럿이 함께 쓰므로 내가 보지 않는 동안 남이
   * 고쳤을 수 있다. 받아 둔 값을 먼저 보여 주고 새 값이 오면 갈아 끼운다.
   * 앱의 가계 화면도 같은 방식이다.
   */
  const mirrorVersion = useMirrorVersion();
  const [visited, setVisited] = useState<ViewType[]>(['budget']);
  const [visits, setVisits] = useState<Record<ViewType, number>>({
    budget: 0,
    'payment-method': 0,
  });

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
  const [isResettingBudgets, setIsResettingBudgets] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
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
        setCurrentMonth(today.month);
        setCurrentYear(today.year);
      } catch (err) {
        setError(t('home.loadFailed'));
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
  const entryFilter = useMemo<EntryScopeQuery>(() => {
    const allPeopleSelected =
      people.length > 0 && selectedPersonIds.length === people.length;
    return {
      ...(allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
      /*
       * 세는 기준. 상단 합계·예산·분류별·수단별이 모두 이 값을 함께 싣는다 -- 한쪽만
       * 다른 기준으로 세면 한 화면 안에서 숫자가 갈린다.
       */
      basis,
    };
  }, [selectedPersonIds, people.length, basis]);
  const appliedFilter = useDebouncedValue(entryFilter, 250);

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
  const reportPeriod: ReportPeriod = isRangeMode
    ? { startDate: rangeStart, endDate: rangeEnd }
    : { yearMonth: `${currentYear}-${String(currentMonth).padStart(2, '0')}` };
  const entryRange = isRangeMode
    ? dayRangeQuery(rangeStart, rangeEnd, timeZone)
    : monthQueryRange(currentYear, currentMonth, timeZone);
  // 객체는 렌더마다 새로 만들어지므로 의존성에는 값을 쓴다.
  const rangeKey = `${entryRange.startDate}~${entryRange.endDate}`;

  /**
   * 위 머리글의 합계.
   *
   * 거래 목록은 받지 않는다. 날짜별 보기가 빠지면서 이 화면이 한 달치 거래를
   * 통째로 들고 있을 까닭이 없어졌다 -- 분류별·수단별은 서버 집계를 쓰고, 상세는
   * 자기가 필요한 구간만 따로 받는다.
   */
  const reloadPeriod = useCallback(async () => {
    if (!selectedProjectId || !currentYear || !currentMonth) return;

    const summaryRes = await apiClient.getSummary(reportPeriod, selectedProjectId, appliedFilter);
    setSummary(summaryRes ?? { income: '0', expense: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, currentYear, currentMonth, rangeKey, appliedFilter]);

  /** 보기를 옮긴다. 다시 연 보기는 그 자리에서 새로 받는다. */
  const openView = (next: ViewType) => {
    setViewType(next);
    setVisited((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setVisits((prev) => ({ ...prev, [next]: prev[next] + 1 }));
  };

  useEffect(() => {
    reloadPeriod().catch((err: unknown) => {
      console.error('합계 조회 실패:', err);
      setSummary({ income: '0', expense: '0' });
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

  /*
   * 남이 고친 것을 이 화면에 들여온다.
   *
   * 거래·합계·예산과 자식 탭은 저장 직후에 하는 일과 같아 `handleEntryChange` 를 그대로
   * 쓰고, 참조 목록(통장·카드·분류·구성원)은 여기서 함께 받는다. 맨 위의 첫 조회 효과를
   * 다시 돌리지 않는 이유는 그것이 **보고 있는 달을 오늘로 되돌리기** 때문이다 -- 지난달을
   * 펼쳐 둔 사람의 화면이 남의 저장 때문에 이번 달로 튀면 안 된다.
   *
   * 처음 그릴 때는 건너뛴다. 그때는 위의 조회들이 이미 돈다.
   */
  const seenMirrorRef = useRef(0);
  useEffect(() => {
    if (seenMirrorRef.current === mirrorVersion) return;
    seenMirrorRef.current = mirrorVersion;
    if (!selectedProjectId) return;

    const refresh = async () => {
      const [accountsData, peopleData, cardsData, categoriesData] = await Promise.all([
        apiClient.getAccountsV2(selectedProjectId),
        apiClient.getPeople(selectedProjectId),
        apiClient.getCards(selectedProjectId),
        apiClient.getCategories(selectedProjectId),
      ]);
      setAccounts(accountsData || []);
      setPeople(peopleData || []);
      setCards(cardsData || []);
      setCategories(categoriesData || []);
      await handleEntryChange();
    };

    refresh().catch((err: unknown) => console.error('바뀐 내용 조회 실패:', err));
  }, [mirrorVersion, selectedProjectId, handleEntryChange]);

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

  const monthlyTotals = useMemo(
    () => ({ incomeTotal: toNumber(summary.income), expenseTotal: toNumber(summary.expense) }),
    [summary],
  );


  const handleMonthChange = (year: number, month: number) => {
    setCurrentYear(year);
    setCurrentMonth(month);
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
    setPeriodMode(mode);
  };

  const handleRangeChange = (start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
  };


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

  /** 보고 있는 달 "YYYY-MM". 예산 API가 적용 기준으로 쓴다. */
  const viewingYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  /** 예산 규칙이 바뀐 뒤. 화면의 예산 카드를 다시 읽는다. */
  const reloadBudgets = async () => {
    if (!selectedProjectId) return;
    await fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
  };

  /*
   * 상세 분석에서 여는 예산 팝업. 분류는 보고 있는 것으로 고정되고 금액만 받는다.
   * 홈의 예산 설정 화면도 같은 훅과 팝업을 쓴다.
   */
  const budgetEditor = useBudgetEditor({
    projectId: selectedProjectId,
    yearMonth: viewingYearMonth,
    budgets: monthlyBudgets,
    categories,
    onSaved: reloadBudgets,
  });

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

  // 훅(위의 useMemo·useBudgetEditor)보다 뒤여야 한다. 앞에서 돌려주면 훅 순서가 어긋난다.
  if (!isAuthenticated) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/*
        화면의 첫 문장이자 제목이다. 자산 화면과 같은 짜임새다 -- 이름을 누르면
        자산주인을, 갈래 상자를 누르면 무엇을 더한 금액인지 고른다.

        날짜를 고르는 자리도 이 문장 안에 있다. "언제의 순수입인가"를 답하지 않으면
        금액만으로는 무엇을 본 것인지 알 수 없다.
      */}
      <LedgerKindSummary
        scopeTitle={
          /* 낱말(순수입·수입·지출)은 다음 줄로 내려갔으므로 noun 을 넘기지 않는다. */
          <PersonScopeTitle
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
        dateControl={
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
            /* 합계는 위 문장과 아래 상자가 말한다. 여기서 또 적으면 같은 숫자가 세 번이다. */
            showTotals={false}
            /* 보기 방식 전환은 아래 action 으로 빼서 우측 상단에 둔다. */
            showModeSwitch={false}
            /* 년월 글자를 윗줄 제목과 같은 왼쪽 선에 세우고, 꺽쇠 양옆을 붙인다. */
            tightArrows
          />
        }
        action={
          <div className="flex items-center gap-1">
            {/*
              달 보기 <-> 기간 보기. 지금이 어느 쪽인지에 따라 반대쪽 이름을 적는다 --
              누르면 무엇이 되는지가 버튼 이름이다.
            */}
            <button
              type="button"
              onClick={() => handlePeriodModeChange(periodMode === 'range' ? 'month' : 'range')}
              className="px-3 py-1.5 text-sm border rounded-lg text-gray-700 hover:bg-gray-100 whitespace-nowrap"
            >
              {t(periodMode === 'range' ? 'month.byMonth' : 'month.byRange')}
            </button>
            {/*
              더보기. 거래 화면과 같은 자리, 같은 아이콘이다.

              안에 세는 기준만 든다 -- 이 화면에서 쓰기는 일어나지 않으므로(거래를 적는
              것은 거래 화면이 맡는다) 태그·지우기 같은 것이 들어올 자리가 없다.
            */}
            <button
              type="button"
              onClick={() => setIsMoreOpen(true)}
              aria-label={t('tx.more')}
              title={t('tx.more')}
              className="flex items-center justify-center p-2 text-gray-600 hover:text-gray-900"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          </div>
        }
        incomeTotal={monthlyTotals.incomeTotal}
        expenseTotal={monthlyTotals.expenseTotal}
      />

      {/* 더보기. 세는 기준 하나만 든다 (거래 화면의 같은 창과 같은 모양이다). */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        {/*
          창을 닫지 않는다 -- 둘을 눌러 보며 숫자가 어떻게 달라지는지 견주는 자리라,
          누를 때마다 닫히면 다시 열어야 한다.
        */}
        <BasisPicker value={basis} onChange={setBasis} />
      </Modal>

      {/*
        데이터를 못 받았을 때. 예전에는 이 메시지가 거래 추가 팝업 안에만 있어서,
        팝업을 열기 전에는 화면이 그냥 비어 보였다.
      */}
      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{error}</div>
      )}

      {/*
        보기 방식. 목록에 무엇을 할지 고르는 것이라 목록 바로 위에 둔다.

        거래를 적는 것은 거래 화면이 맡는다. 가계는 읽는 자리다.

        w-fit 으로 글자만큼만 차지하게 둔다. 예전에는 추가 버튼과 한 줄을 이루며
        justify-between 이 이 상자를 왼쪽으로 밀었는데, 버튼이 빠지면서 그 틀이
        없어졌다. 그냥 두면 회색 띠가 화면 끝까지 늘어난다.
      */}
      <div className="flex w-fit gap-2 bg-gray-200 rounded-lg p-1">
        <button
          onClick={() => openView('budget')}
          className={`px-4 py-2 rounded-md font-medium transition ${
            viewType === 'budget'
              ? 'bg-white text-blue-600 shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('ledger.tab.category')}
        </button>
        <button
          onClick={() => openView('payment-method')}
          className={`px-4 py-2 rounded-md font-medium transition ${
            viewType === 'payment-method'
              ? 'bg-white text-blue-600 shadow'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('ledger.tab.method')}
        </button>
      </div>

      {/* 감춘 보기도 그려 둔 채로 남긴다. 다시 누르면 받아 둔 값이 바로 보인다. */}
      {visited.includes('budget') && (
        <div hidden={viewType !== 'budget'}>
          {/*
            분류별.

            달 단위와 기간 보기가 같은 화면을 쓴다. 다른 점은 예산뿐이라, 예산이
            있는 달 단위에서만 budgets 를 넘겨 진행률 줄이 붙게 한다. 기간에는
            예산을 넘기지 않는다. 예산은 달마다 정하는 값이라 두 달 반짜리 구간에
            얼마인지가 정의되지 않는다.
          */}
          <CategoryTab
            period={reportPeriod}
            projectId={selectedProjectId}
            filter={appliedFilter}
            categories={categories}
            onEntryClick={handleTransactionClick}
            reloadToken={dataVersion + visits.budget}
            type={budgetType}
            onTypeChange={setBudgetType}
            selectedId={selectedCategoryId}
            selectedExact={selectedCategoryExact}
            onSelect={(categoryId, exact) => {
              setSelectedCategoryId(categoryId);
              setSelectedCategoryExact(exact);
            }}
            budgets={isRangeMode ? undefined : monthlyBudgets}
            onEditBudget={isRangeMode ? undefined : () => budgetEditor.open(selectedCategoryId)}
          />
        </div>
      )}

      {visited.includes('payment-method') && (
        <div hidden={viewType !== 'payment-method'}>
          {/* 수단별 탭은 거래가 없어도 계좌·카드를 0원으로 보여준다.
              "거래가 없습니다"로 먼저 끊으면 그 화면에 도달할 수 없다. */}
          <PaymentMethodTab
            period={reportPeriod}
            projectId={selectedProjectId}
            filter={appliedFilter}
            onEntryClick={handleTransactionClick}
            reloadToken={dataVersion + visits['payment-method']}
            /* 정산 팝업이 결제 통장과 그 주인을 찾는 데 쓴다 */
            cards={cards}
            accounts={accounts}
            onCardChange={handleEntryChange}
          />
        </div>
      )}

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
      <BudgetEditModal
        editor={budgetEditor}
        projectId={selectedProjectId}
        name={selectedCategoryLabel}
        yearMonth={viewingYearMonth}
      />





    </div>
  );
}
