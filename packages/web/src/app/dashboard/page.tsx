'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@/store/project';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useBudget } from '@/store/budget';
import { apiClient, type ReportPeriod } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@/lib/money';
import { DAY_OF_MONTH_HINT, DAY_OF_MONTH_OPTIONS } from '@/lib/day-of-month';
import {
  dateKeyOf,
  dayRangeQuery,
  formatDateTime,
  currentYearMonth,
  monthInputToIso,
  monthQueryRange,
  nowTimeKey,
  timeInputOf,
  todayKey,
} from '@/lib/datetime';
import {
  CURRENCY_LABEL,
  LEDGER_MIN_ENTRY_DATE_KEY,
  SUPPORTED_CURRENCIES,
  isCurrencyCode,
  ledgerMaxEntryDateKey,
  zonedFormValueToUtc,
  type CardTransferDirection,
  type CurrencyCode,
} from '@money/types';
import CustomSelect from '@/components/CustomSelect';
import CategoryFormFields, {
  NO_SUB_CATEGORIES,
  filledSubCategories,
  type SubCategoryRow,
} from '@/components/CategoryFormFields';
import ChoiceModal from '@/components/ChoiceModal';
import Modal from '@/components/Modal';
import TransactionCalendar from '@/components/TransactionCalendar';
import TransactionListView from '@/components/TransactionListView';
import MonthHeader from '@/components/MonthHeader';
import PageHeader from '@/components/PageHeader';
import AddAccountModal from '@/components/AddAccountModal';
import PersonModal from '@/components/PersonModal';
import TransactionItem, { EntryListItem } from '@/components/TransactionItem';
import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import PaymentMethodTab from '@/components/PaymentMethodTab';
import CategoryTab from '@/components/CategoryTab';
import EntryFilterBar, { FixedType } from '@/components/EntryFilterBar';
import { useInstitutions } from '@/hooks/useInstitutions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { EntryFilterQuery } from '@money/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
/**
 * 기간 보기에서 그릴 달력 장수 상한.
 *
 * 달마다 한 장이라 구간이 길면 끝없이 늘어난다. 1년치면 화면을 훑어보는 한계에
 * 가깝고, 그보다 길면 목록과 분류별로 보는 편이 낫다.
 */
const CALENDAR_MAX_MONTHS = 12;

const ENTRY_FORM_ID = 'entry-form';
const BUDGET_FORM_ID = 'detail-budget-form';
const CARD_FORM_ID = 'card-form';
const CATEGORY_FORM_ID = 'category-form';

/** 거래 추가/수정 팝업 맨 위의 유형 탭 */
/** 카드사가 흔히 제공하는 할부 개월수. 빈 값이 일시불이다. */
const INSTALLMENT_OPTIONS = [
  { id: '', name: '일시불' },
  ...[2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36].map((m) => ({ id: String(m), name: `${m}개월` })),
];

const ENTRY_TYPE_TABS = [
  { id: 'expense', label: '지출' },
  { id: 'income', label: '수입' },
  { id: 'transfer', label: '이체' },
] as const;

const ENTRY_KIND_LABEL: Record<string, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
  card_payment: '카드대금 결제',
  adjustment: '잔액 조정',
};






export default function TransactionsPage() {
  const { isAuthenticated, loadUser, user, defaultProjectData } = useAuth();
  const {
    selectedPersonIds,
    setPeople: setStorePeople,
    setSelectedPersonIds,
    togglePersonId,
    resetPersonFilterFor,
  } =
    useUserFilter();
  const { selectedProjectId } = useProject();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
  // 거래 입력의 환율 기준은 **저장 통화**다. 표시 통화가 아니다.
  // 원장이 저장하는 환산액(baseAmount)이 저장 통화 기준이기 때문이다.
  const ledgerCurrency = useProjectLedgerCurrency();
  // 목록 금액은 표시 통화 환산액이다. 저장 통화와 같을 때만 그 값을 폼에 되돌릴 수 있다.
  const displayCurrency = useProjectDisplayCurrency();
  const { rateOf } = useExchangeRates();
  /** 설정에서 지정한 "구성원 중 나". 새 거래의 사용자 기본값이 된다. */
  const myPersonId = useMyPersonId();
  const { monthlyBudgets, fetchMonthlyBudgets, createBudget: createBudgetApi, updateBudget: updateBudgetApi, deleteBudget: deleteBudgetApi } = useBudget();
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<EntryListItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
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
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const dateTransactionsRef = useRef<HTMLDivElement>(null);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  // 계좌 추가 폼 상태는 AddAccountModal이 직접 들고 있다. 여기서는 열림 여부만 관리한다.
  const [cardFormData, setCardFormData] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit' as 'debit' | 'credit',
    issuerId: '',
    expiryDate: '',
    creditLimit: '',
    // 청구 주기는 마감일과 결제일 두 값으로 계산한다
    statementClosingDay: 15,
    paymentDueDay: 25,
  });
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const { options: issuerOptions } = useInstitutions('card_issuer');
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    subCategories: NO_SUB_CATEGORIES as SubCategoryRow[],
  });
  /** 카테고리 추가가 실패한 이유. 예전에는 콘솔에만 남아 사용자는 아무 반응을 못 봤다. */
  const [categoryError, setCategoryError] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  /**
   * 소분류를 붙일 대분류 id. 비어 있으면 대분류를 새로 만드는 모드다.
   *
   * 카테고리 팝업 하나로 두 가지를 처리한다. 소분류는 반드시 대분류 밑에 붙으므로
   * "어느 대분류인가"만 다르고 받을 값(이름 목록)은 같다.
   */
  const [categoryParentId, setCategoryParentId] = useState('');
  /** 소분류 모드일 때의 대분류. 없으면 대분류를 새로 만드는 모드다. */
  const categoryParent = categories.find((c) => c.id === categoryParentId);
  const [formData, setFormData] = useState(() => ({
    method: 'account',
    accountId: '',
    cardId: '',
    personId: '',
    type: 'expense',
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    description: '',
    merchant: '',
    detailedNote: '',
    toAccountId: '',
    /** 통화가 다른 환전에서 실제로 받은 금액 (받는 계좌 통화) */
    toAmount: '',
    transferFee: '',
    transferFeeMainCategoryId: '',
    transferFeeSubCategoryId: '',
    date: todayKey(timeZone),
    time: '',
    isFixed: false,
    /** 할부 개월수. 빈 값이거나 1이면 일시불 */
    installmentMonths: '',
    /** 카드사 이체의 방향. 수정으로만 들어오며 그대로 되돌려 보낸다 */
    cardTransferDirection: 'payment' as CardTransferDirection,
    /** 위 금액을 입력한 통화. 결제수단을 고르면 그 계좌 통화로 맞춰진다. */
    currency: 'KRW' as CurrencyCode,
    /**
     * 통장에서 실제로 빠진 기준통화 금액. 환율 대신 이것을 넣을 수 있다.
     *
     * 환율은 카드사가 결제일에 정하는 값이라 미리 알 수 없고, 명세서에 찍히는
     * 것도 대개 금액이다. 둘 중 하나만 채운다.
     */
    billedAmount: '',
    /**
     * 통화를 사용자가 직접 골랐는지.
     *
     * 결제수단을 바꿀 때 통화를 덮어쓸지 가르는 값이다. 자동으로 채워진 통화는
     * 덮어써도 되지만, 사용자가 고른 통화는 지우면 안 된다.
     */
    currencyTouched: false,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 고정/변동 선택. 둘 다 고른 상태로 시작한다 (= 전체). */
  const [selectedFixedTypes, setSelectedFixedTypes] = useState<FixedType[]>(['fixed', 'variable']);
  /** 결제수단 드롭다운이 계좌·카드를 합쳤으므로 "무엇을 추가할지"는 이 팝업에서 고른다. */
  const [isMethodChooserOpen, setIsMethodChooserOpen] = useState(false);

  useEffect(() => {
    const initializeProject = async () => {
      await loadUser();

      // 프로젝트 목록 불러오기
      try {
        const projects = await apiClient.getMyProjects();
        const { setSelectedProjectId } = useProject.getState();

        if (!projects || projects.length === 0) {
          // 프로젝트가 하나도 없으면 여기서는 아무것도 불러올 수 없다.
          // 생성 화면으로 보내지 않으면 로딩 상태에 갇힌다.
          setSelectedProjectId(null);
          router.push('/settings/projects');
          return;
        }

        // 저장된 선택값이 삭제되거나 탈퇴한 프로젝트를 가리킬 수 있다.
        const isSelectionValid =
          selectedProjectId && projects.some((p: { id: string }) => p.id === selectedProjectId);

        if (!isSelectionValid) {
          setSelectedProjectId(projects[0].id);
        }
      } catch (err) {
        console.error('프로젝트 로드 실패:', err);
      }
    };

    initializeProject();
  }, [loadUser, selectedProjectId, router]);

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
        setPeople(peopleData || []);
        setStorePeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);

        /*
         * 저장된 사람 필터를 이 프로젝트의 구성원에 맞춘다.
         *
         *   - 다른 프로젝트의 선택이 남아 있으면 전체 선택으로 새로 시작한다.
         *     사람 id는 프로젝트마다 다르므로 그대로 두면 "아무도 안 고름"이 되어
         *     화면이 통째로 빈다.
         *   - 이 프로젝트에서 한 번도 건드리지 않았어도 전체 선택으로 시작한다.
         *   - 건드린 적이 있으면 사라진 구성원의 id만 걷어내고 나머지는 존중한다.
         *     (전부 해제한 상태는 사용자의 의도이므로 되살리지 않는다)
         */
        const loadedPeople = peopleData || [];
        const allIds = loadedPeople.map((person: Person) => person.id);
        const filterState = useUserFilter.getState();
        const isOtherProject = filterState.filterProjectId !== selectedProjectId;

        if (isOtherProject || !filterState.personFilterTouched) {
          resetPersonFilterFor(selectedProjectId, allIds);
        } else {
          const validIds = new Set(allIds);
          const stillValid = selectedPersonIds.filter((id) => validIds.has(id));
          if (stillValid.length !== selectedPersonIds.length) {
            setSelectedPersonIds(stillValid);
          }
        }

        // 초기 월 설정. 거래는 아래 월별 useEffect가 불러온다.
        // 이번 달 판단도 프로젝트 타임존 기준이다.
        const today = currentYearMonth(timeZone);
        setDisplayEntries([]);
        setCurrentMonth(today.month);
        setCurrentYear(today.year);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router, selectedProjectId, defaultProjectData]);

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
    const allFixedSelected = selectedFixedTypes.length === 2;

    return {
      ...(allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
      ...(allFixedSelected ? {} : { fixedTypes: selectedFixedTypes.join(',') }),
    };
  }, [selectedPersonIds, people.length, selectedFixedTypes]);
  const appliedFilter = useDebouncedValue(entryFilter, 250);
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
   * 결제수단 드롭다운 옵션. 계좌와 카드를 한 목록에 합친다.
   *
   * 종류를 잃지 않도록 id에 접두사를 붙인다("account:xxx" / "card:xxx").
   * 라벨의 "(계좌)"/"(카드)"는 사용자가 종류를 구분하기 위한 표시다.
   */
  const paymentMethodOptions = useMemo(
    () => [
      ...accounts.map((account) => ({
        id: `account:${account.id}`,
        name: `(계좌) ${account.name}`,
      })),
      ...cards.map((card) => ({
        id: `card:${card.id}`,
        name: `(카드) ${card.name}${card.issuer?.name ? ` · ${card.issuer.name}` : ''}`,
      })),
    ],
    [accounts, cards],
  );

  /**
   * 이체에서 고를 수 있는 계좌. 신용카드 부채 계정을 함께 넣는다.
   *
   * 부채 계정은 통장 목록(GET /accounts)에서 감춰져 있다. 지출 결제수단이나
   * 자산 화면에 새어 나가면 안 되므로 서버 목록을 열지 않고, 이미 받아 둔 카드에서
   * liabilityAccountId를 꺼내 이 화면에서만 조립한다.
   */
  const transferAccountOptions = useMemo(
    () => [
      ...accounts.map((account) => ({ id: account.id, name: account.name })),
      ...cards
        .filter((card) => card.cardType === 'credit' && card.liabilityAccountId)
        .map((card) => ({ id: card.liabilityAccountId!, name: `(카드) ${card.name}` })),
    ],
    [accounts, cards],
  );

  /** 이체 양쪽 중 카드 부채 계정인 쪽. 없으면 일반 이체다. */
  const transferCardSide = (() => {
    if (formData.type !== 'transfer') return null;
    const liabilityIds = new Set(
      cards.filter((c) => c.liabilityAccountId).map((c) => c.liabilityAccountId!),
    );
    const fromIsCard = liabilityIds.has(formData.accountId);
    const toIsCard = liabilityIds.has(formData.toAccountId);
    if (fromIsCard && !toIsCard) return 'refund' as const;
    if (toIsCard && !fromIsCard) return 'payment' as const;
    return null;
  })();

  /*
   * 통화.
   *
   * 기본값은 결제수단(또는 이체 보내는 계좌)의 통화다. 달러 통장을 고르면
   * 달러로 입력하게 되고, 원화 카드를 고른 채 통화만 달러로 바꾸면 "원화 카드로
   * 한 외화 결제"가 된다. 두 경우의 원장 모양은 서버가 갈라 준다.
   */
  const currencyOfAccount = (accountId: string): CurrencyCode => {
    const account = accounts.find((a) => a.id === accountId);
    return isCurrencyCode(account?.currency) ? account.currency : ledgerCurrency;
  };

  /** 결제수단의 통화. 카드는 결제 통장을 따른다. */
  const currencyOfMethod = (accountId?: string | null, cardId?: string | null): CurrencyCode => {
    if (cardId) {
      const card = cards.find((c) => c.id === cardId);
      return card ? currencyOfAccount(card.paymentAccountId) : ledgerCurrency;
    }
    if (accountId) return currencyOfAccount(accountId);
    return ledgerCurrency;
  };

  /** 지금 고른 결제수단의 통화 */
  const paymentCurrency = currencyOfMethod(formData.accountId, formData.cardId);

  const toCurrency: CurrencyCode = formData.toAccountId
    ? currencyOfAccount(formData.toAccountId)
    : ledgerCurrency;

  const isCrossCurrencyTransfer =
    formData.type === 'transfer' && Boolean(formData.toAccountId) && paymentCurrency !== toCurrency;

  /** 환율 칸을 보여 줄지. 기준통화로 입력하면 환산할 것이 없다. */
  const needsRate = formData.currency !== ledgerCurrency;

  /**
   * 청구액 칸을 보여 줄지.
   *
   * 원화 카드로 달러를 결제한 경우처럼 "결제수단은 기준통화, 입력은 외화"일 때만
   * 통장에서 빠진 금액이 따로 존재한다. 달러 통장에서 달러를 쓴 거래에는 그런
   * 금액이 없다. 계좌 통화 금액이 이미 사실이기 때문이다. 서버도 같은 조건으로
   * 받는다 (LedgerService.resolveBilled).
   */
  const needsBilled = needsRate && paymentCurrency === ledgerCurrency;

  /** 사용자가 청구액을 직접 넣었는지. 넣었으면 환율보다 우선한다. */
  const hasBilled = needsBilled && toNumber(formData.billedAmount) > 0;

  /**
   * 실제 금액을 지금 받아야 하는지.
   *
   * 청구액이 나중에 정해지는 것은 신용카드뿐이다. 통장과 체크카드는 결제하는
   * 자리에서 돈이 빠지므로 사용자가 금액을 알고, 확정할 화면도 따로 없다
   * (카드 대조는 신용카드 전용이다). 서버도 같은 규칙으로 막는다
   * (LedgerService.assertCanEstimate).
   */
  const isCreditCardSelected =
    cards.find((c) => c.id === formData.cardId)?.cardType === 'credit';
  const mustBill = needsBilled && !isCreditCardSelected;

  /**
   * 할부를 받을 수 있는지.
   *
   * 신용카드 지출만 된다. 체크카드는 결제 즉시 통장에서 빠져 나눌 청구가 없고,
   * 통장 결제도 마찬가지다. 서버도 같은 규칙으로 막는다(LedgerService.assertCanInstall).
   */
  const canInstall =
    formData.type === 'expense' && formData.method === 'card' && isCreditCardSelected;

  /**
   * 저장하면 얼마로 기록되는지. 저장 전에 눈으로 확인하게 한다.
   *
   * 청구액을 넣었으면 그 금액이 그대로 기록된다. 환율을 곱하지 않는다.
   */
  const convertedPreview = (() => {
    if (!needsRate) return '';
    if (hasBilled) return formatCurrency(formData.billedAmount, ledgerCurrency);

    const rate = Number(rateOf(formData.currency));
    const amount = Number(formData.amount);
    if (!Number.isFinite(rate) || !Number.isFinite(amount) || rate <= 0 || amount <= 0) return '';
    return formatCurrency(amount * rate, ledgerCurrency);
  })();

  /** 청구액을 넣었을 때 실제로 적용되는 환율. 저장 전에 함께 보여 준다. */
  const derivedRate = (() => {
    const amount = toNumber(formData.amount);
    if (!hasBilled || amount <= 0) return '';
    return formatNumber(Math.round((toNumber(formData.billedAmount) / amount) * 100) / 100);
  })();

  const selectedPaymentMethodId = formData.cardId
    ? `card:${formData.cardId}`
    : formData.accountId
      ? `account:${formData.accountId}`
      : '';

  /**
   * 결제수단 선택 반영.
   *
   * 카드를 고르면 지출로 고정한다. 카드로는 수입이나 이체를 만들 수 없고,
   * 유형이 남아 있으면 카테고리 목록이 어긋난다.
   */
  const handlePaymentMethodChange = (value: string) => {
    const [kind, id] = value.split(':');

    const methodCurrency =
      kind === 'card' ? currencyOfMethod(null, id) : currencyOfMethod(id, null);

    /*
     * 결제수단을 고르면 입력 통화도 그 계좌 통화로 맞춘다.
     *
     * 달러 통장을 고르면 달러로 입력하는 것이 자연스럽다. 다만 사용자가 통화를
     * 직접 골라 둔 뒤라면 그 선택을 지우지 않는다. "$1을 국민카드로 결제"를
     * 입력하다가 카드를 바꿨다고 통화가 원화로 되돌아가면 매번 다시 골라야 한다.
     *
     * 새 결제수단이 그 통화를 감당하지 못하면 되돌린다. 원장이 다루는 조합은
     * "계좌 통화 == 입력 통화"(달러 통장의 달러 결제)와 "계좌 통화 == 기준통화"
     * (원화 카드의 외화 결제) 둘뿐이라, 엔화 통장에 달러 같은 조합은 서버가 막는다.
     */
    const nextCurrency = (prev: { currency: CurrencyCode; currencyTouched: boolean }) =>
      prev.currencyTouched &&
      (methodCurrency === prev.currency || methodCurrency === ledgerCurrency)
        ? prev.currency
        : methodCurrency;

    /** 통화가 바뀐 만큼 청구액도 다시 받는다. 통화가 그대로면 건드리지 않는다. */
    const currencyFields = (prev: typeof formData) => {
      const currency = nextCurrency(prev);
      if (currency === prev.currency) return { currency };

      return {
        currency,
        // 청구액은 결제수단마다 달라지는 값이라 그대로 둘 수 없다.
        billedAmount: '',
        currencyTouched: false,
      };
    };

    /*
     * 할부를 못 받는 결제수단으로 바꾸면 개월수를 지운다.
     *
     * 칸이 사라져도 값이 남아 있으면 화면에 보이지 않는 할부가 그대로 저장된다.
     * 신용카드에서 신용카드로 옮길 때는 유지한다. 같은 조건이라 다시 고를 이유가 없다.
     */
    const keepsInstallment =
      kind === 'card' && cards.find((c) => c.id === id)?.cardType === 'credit';

    if (kind === 'card') {
      setFormData((prev) => ({
        ...prev,
        method: 'card',
        cardId: id,
        accountId: '',
        type: 'expense',
        ...currencyFields(prev),
        installmentMonths: keepsInstallment ? prev.installmentMonths : '',
        mainCategoryId: prev.type === 'expense' ? prev.mainCategoryId : '',
        subCategoryId: prev.type === 'expense' ? prev.subCategoryId : '',
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      method: 'account',
      accountId: id,
      cardId: '',
      installmentMonths: '',
      ...currencyFields(prev),
    }));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.personId) {
      setError('사용자를 선택해주세요.');
      return;
    }

    // 수수료를 넣었으면 분류가 있어야 한다. 없이 보내면 서버가 거절하는데,
    // 그 오류만 보고는 어느 칸이 비었는지 알기 어렵다.
    if (
      formData.type === 'transfer' &&
      !transferCardSide &&
      toNumber(formData.transferFee) > 0 &&
      !formData.transferFeeMainCategoryId
    ) {
      setError('수수료 대분류를 선택해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      // 입력한 날짜/시각은 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
      // 시간을 비우면 그 지역의 하루 시작이 된다.
      const dateValue = zonedFormValueToUtc(
        formData.date,
        formData.time || undefined,
        timeZone,
      ).toISOString();

      // 화면의 개념을 그대로 보낸다. 서버가 전표(postings)로 번역한다.
      // card_payment는 수정으로만 들어온다 (새로 만드는 것은 자산 화면의 결제하기다).
      const kind =
        formData.type === 'card_payment'
          ? 'card_payment'
          : formData.type === 'income'
            ? 'income'
            : formData.type === 'transfer'
              ? 'transfer'
              : 'expense';
      const useCard = formData.method === 'card' && Boolean(formData.cardId);

      const payload: any = {
        kind,
        personId: formData.personId,
        // 금액은 문자열로 보낸다 (정밀도 손실 방지)
        amount: toAmountString(formData.amount),
        description: formData.description,
        date: dateValue,
        isFixed: formData.isFixed,
      };

      // 기준통화면 통화·환율을 보내지 않는다. 서버가 계좌 통화로 알아서 본다.
      if (formData.currency !== ledgerCurrency) {
        payload.currency = formData.currency;
        // 환율은 보내지 않는다. 실제 금액이 있으면 그것을 보내고, 없으면
        // 서버가 설정된 환율로 추정한다 (신용카드만 가능).
        if (hasBilled) {
          payload.billedAmount = toAmountString(formData.billedAmount);
        }
      }

      if (formData.merchant) payload.merchant = formData.merchant;
      if (formData.detailedNote) payload.detailedNote = formData.detailedNote;

      if (kind === 'card_payment') {
        // 부채가 줄어드는 카드와 돈이 오가는 통장을 함께 보낸다. 둘 다 폼에서 고정이다.
        payload.cardId = formData.cardId;
        payload.accountId = formData.accountId;
        payload.cardTransferDirection = formData.cardTransferDirection;
        // 카드사 이체는 지출이 아니므로 분류도 고정 여부도 없다.
        delete payload.isFixed;
      } else if (kind === 'transfer') {
        payload.accountId = formData.accountId;
        payload.toAccountId = formData.toAccountId;
        // 통화가 다른 환전은 받은 금액을 그대로 적는다. 그러면 실제 적용된
        // 환율이 저절로 기록되고, 별도의 환차손익 처리가 필요 없다.
        if (isCrossCurrencyTransfer && formData.toAmount) {
          payload.toAmount = toAmountString(formData.toAmount);
        }
        // 카드사와의 이체에는 수수료가 붙지 않는다. 칸을 감췄어도 남은 값이 따라가지 않게 뺀다.
        if (formData.transferFee && !transferCardSide) {
          payload.transferFee = toAmountString(formData.transferFee);
          // 수수료는 소분류가 있으면 소분류를, 없으면 대분류를 쓴다
          payload.transferFeeCategoryId =
            formData.transferFeeSubCategoryId || formData.transferFeeMainCategoryId;
        }
      } else {
        // 결제수단은 계좌와 카드 중 하나만 보낸다. 둘 다 보내면 서버가 거부한다.
        if (useCard) payload.cardId = formData.cardId;
        else payload.accountId = formData.accountId;
        // posting은 가장 구체적인 카테고리 하나만 가리킨다
        payload.categoryId = formData.subCategoryId || formData.mainCategoryId;
        // 할부는 신용카드 지출에만 붙는다. 2개월 미만이면 일시불이라 보내지 않는다.
        // canInstall이 카드 종류까지 본다. 체크카드로 바꾼 뒤 남은 값이 새지 않게 막는다.
        const months = Number(formData.installmentMonths);
        if (canInstall && months >= 2) payload.installmentMonths = months;
      }

      if (editingId) {
        await apiClient.updateEntry(editingId, payload);
      } else {
        await apiClient.createEntry({ ...payload, projectId: selectedProjectId });
      }

      await reloadPeriod();
      setDataVersion((version) => version + 1);

      // 예산 데이터도 다시 로드
      if (selectedProjectId) {
        fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
      }
      setFormData({
        method: 'card',
        accountId: '',
        cardId: '',
        personId: '',
        type: 'expense',
        mainCategoryId: '',
        subCategoryId: '',
        amount: '',
        description: '',
        merchant: '',
        detailedNote: '',
        toAccountId: '',
        toAmount: '',
        transferFee: '',
        transferFeeMainCategoryId: '',
        transferFeeSubCategoryId: '',
        currency: ledgerCurrency,
        billedAmount: '',
        currencyTouched: false,
        date: todayKey(timeZone),
        time: '',
        isFixed: false,
        installmentMonths: '',
        cardTransferDirection: 'payment',
      });
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err) {
      setError(editingId ? '거래 수정에 실패했습니다.' : '거래 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 새 거래 입력 시작.
   *
   * 날짜와 시각을 지금으로 채운다. 시각을 비워 두면 그 날 0시로 기록되므로
   * 입력 시점을 그대로 남기려면 기본값이 있어야 한다.
   */
  const handleAddClick = () => {
    setEditingId(null);
    setError('');
    setFormData((prev) => ({
      ...prev,
      date: todayKey(timeZone),
      time: nowTimeKey(timeZone),
      // "나"를 지정해 두면 사용자를 매번 고르지 않아도 된다.
      personId: prev.personId || myPersonId || '',
    }));
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      method: 'account',
      accountId: '',
      cardId: '',
      personId: '',
      type: 'expense',
      mainCategoryId: '',
      subCategoryId: '',
      amount: '',
      description: '',
      merchant: '',
      detailedNote: '',
      toAccountId: '',
      toAmount: '',
      transferFee: '',
      transferFeeMainCategoryId: '',
      transferFeeSubCategoryId: '',
      currency: ledgerCurrency,
      billedAmount: '',
      currencyTouched: false,
      date: todayKey(timeZone),
      time: '',
      isFixed: false,
      installmentMonths: '',
      cardTransferDirection: 'payment',
    });
    setEditingId(null);
    setError('');
  };

  const handleTransactionClick = (transaction: EntryListItem) => {
    setSelectedTransaction(transaction);
    setIsDetailModalOpen(true);
  };

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

  const handleDetailEditClick = () => {
    if (!selectedTransaction) return;
    setIsDetailModalOpen(false);
    handleEditClick(selectedTransaction);
  };

  /**
   * 수정할 수 있는 전표.
   *
   * 잔액 조정만 제외한다. 기초잔액 전표는 계좌 잔액에서 역산되는 값이라
   * 거래 폼으로 고칠 수 있는 대상이 아니다 (자산 화면의 잔액 수정이 담당한다).
   *
   * 카드대금 결제는 폼을 열 수 있다. 결제일이 오기 전에 잘못 눌러 넣은 결제를
   * 되돌리려면 금액이나 날짜를 고쳐야 하고, 그것이 사용 내역을 건드리지 않고
   * 바로잡는 가장 짧은 경로다. 카드와 통장은 바꿀 수 없다 (바꿀 일이면 삭제가 낫다).
   */
  const isEditable = (entry: EntryListItem) => entry.kind !== 'adjustment';

  /** 카드대금 결제 수정 중인지. 폼이 분류·유형·이체 칸을 감춘다. */
  const isCardPaymentForm = formData.type === 'card_payment';

  /**
   * 대분류/소분류로 나눈다.
   *
   * 서버는 가장 구체적인 카테고리 하나만 들고 있다(대분류만 지정했으면 그게 곧 leaf다).
   * 폼은 두 칸으로 나뉘어 있으므로 parentId를 보고 되돌린다.
   */
  const splitCategory = (categoryId: string | null) => {
    if (!categoryId) return { mainCategoryId: '', subCategoryId: '' };
    const category = categories.find((c) => c.id === categoryId);
    return category?.parentId
      ? { mainCategoryId: category.parentId, subCategoryId: category.id }
      : { mainCategoryId: categoryId, subCategoryId: '' };
  };

  const handleEditClick = (entry: EntryListItem) => {
    if (!isEditable(entry)) {
      setError('이 거래는 수정할 수 없습니다. 삭제 후 다시 등록해주세요.');
      return;
    }

    setEditingId(entry.id);
    const category = splitCategory(entry.categoryId);
    const fee = splitCategory(entry.feeCategoryId);

    /*
     * 청구액을 되돌려 놓을 수 있는 거래인지.
     *
     * 아직 잠정인 거래는 채우지 않는다. 그 금액은 사용자가 넣은 적 없는 서버
     * 추정값인데, 칸에 적혀 있으면 확정된 금액처럼 보이고 그대로 저장하는 순간
     * 확정으로 넘어간다. 확정한 사실이 없는데 확정 표시가 붙으면 안 된다.
     *
     * 나머지 조건은 폼의 needsBilled 와 같다.
     */
    const billedPrefill =
      !entry.rateProvisional &&
      isCurrencyCode(entry.originalCurrency) &&
      entry.originalCurrency !== ledgerCurrency &&
      currencyOfMethod(entry.accountId, entry.cardId) === ledgerCurrency &&
      displayCurrency === ledgerCurrency
        ? entry.amount
        : '';

    setFormData({
      // 카드대금 결제는 통장에서 돈이 나가고 카드 부채가 줄어든다. 두 값을 다 들고 있어야
      // 저장할 때 그대로 돌려보낼 수 있으므로 method로 하나만 고르지 않는다.
      method: entry.kind === 'card_payment' ? 'account' : entry.cardId ? 'card' : 'account',
      accountId: entry.accountId || '',
      cardId: entry.cardId || '',
      personId: entry.personId || '',
      type: entry.kind,
      mainCategoryId: category.mainCategoryId,
      subCategoryId: category.subCategoryId,
      /*
       * 금액과 통화.
       *
       * 서버는 목록 금액을 언제나 기준통화 환산액으로 준다. 외화 거래를 고칠 때
       * 환산액을 보여 주면 사용자가 입력했던 값과 달라 혼란스러우므로, 원 통화
       * 금액이 함께 왔으면 그것을 되돌려 놓는다.
       */
      amount: entry.originalAmount ?? entry.amount,
      currency: isCurrencyCode(entry.originalCurrency) ? entry.originalCurrency : ledgerCurrency,
      /*
       * 확정된 거래만 금액을 되돌려 놓는다 (billedPrefill 참고).
       *
       * 그대로 저장하면 금액이 한 푼도 움직이지 않는다. 잠정인 거래는 비워 두어,
       * 설명만 고쳐 저장해도 확정으로 넘어가지 않게 한다.
       */
      billedAmount: billedPrefill,
      // 결제수단 통화와 다른 통화로 기록된 거래다. 결제수단을 바꿔도 유지한다.
      currencyTouched:
        isCurrencyCode(entry.originalCurrency) &&
        entry.originalCurrency !== currencyOfMethod(entry.accountId, entry.cardId),
      description: entry.description || '',
      merchant: entry.merchant || '',
      detailedNote: entry.detailedNote || '',
      toAccountId: entry.toAccountId || '',
      // 받는 계좌 통화 그대로인 값을 쓴다. entry.amount는 기준통화 환산액이라
      // 통화가 다른 환전에서는 단위가 어긋난다.
      toAmount: entry.toAmount ?? '',
      // 수수료는 별도 다리라 예전에는 비워뒀다. 이제 목록 응답에 들어 있어 그대로 채운다.
      transferFee: toNumber(entry.feeAmount) > 0 ? entry.feeAmount ?? '' : '',
      transferFeeMainCategoryId: fee.mainCategoryId,
      transferFeeSubCategoryId: fee.subCategoryId,
      date: dateKeyOf(entry.date, timeZone),
      time: timeInputOf(entry.date, timeZone),
      isFixed: entry.isFixed,
      installmentMonths: entry.installmentMonths ? String(entry.installmentMonths) : '',
      // 놓치면 환불 입금을 고칠 때 대금 결제로 뒤집힌다
      cardTransferDirection: entry.cardTransferDirection ?? 'payment',
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteEntry(id);
      await reloadPeriod();
      setDataVersion((version) => version + 1);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '거래 삭제에 실패했습니다.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePersonModalSuccess = (updatedPeople: Person[]) => {
    setPeople(updatedPeople);
    setStorePeople(updatedPeople);
    setIsPersonModalOpen(false);
  };


  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCardSubmitting(true);

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardFormData.issuerId) {
        alert('발급사를 선택하세요.');
        setCardSubmitting(false);
        return;
      }

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardFormData.expiryDate) ?? undefined;
      const isCredit = cardFormData.cardType === 'credit';
      await apiClient.createCard({
        // 결제 통장은 사용자가 만든 계좌여야 한다. 신용카드면 서버가 부채 계정을 함께 만든다.
        paymentAccountId: cardFormData.accountId,
        name: cardFormData.name,
        ...(cardFormData.cardNumber && { cardNumber: cardFormData.cardNumber }),
        cardType: cardFormData.cardType,
        issuerId: cardFormData.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: isCredit ? toAmountString(cardFormData.creditLimit) : undefined,
        // 신용카드는 마감일과 결제일이 필수다 (없으면 청구서를 만들 수 없다)
        statementClosingDay: isCredit ? cardFormData.statementClosingDay : undefined,
        paymentDueDay: isCredit ? cardFormData.paymentDueDay : undefined,
        projectId: selectedProjectId ?? undefined,
      });
      const data = await apiClient.getCards(selectedProjectId);
      setCards(data || []);
      setCardFormData({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuerId: '',
        expiryDate: '',
        creditLimit: '',
        statementClosingDay: 15,
        paymentDueDay: 25,
      });
      setIsCardModalOpen(false);
    } catch (err) {
      console.error('카드 추가 실패:', err);
    } finally {
      setCardSubmitting(false);
    }
  };

  /** 카테고리 팝업을 닫고 폼을 비운다. 다음에 열 때 지난 입력이 남아 있으면 안 된다. */
  const closeCategoryModal = () => {
    setIsCategoryModalOpen(false);
    setCategoryParentId('');
    setCategoryFormData({ name: '', type: 'expense', subCategories: NO_SUB_CATEGORIES });
    setCategoryError('');
  };

  /** 카테고리 팝업 열기. parentId를 주면 그 대분류에 소분류만 붙이는 모드다. */
  const openCategoryModal = (parentId = '') => {
    setCategoryParentId(parentId);
    setCategoryFormData({
      name: '',
      type: 'expense',
      // 소분류를 붙이러 열었으면 첫 줄을 미리 준다. 그 줄이 이 팝업의 본론이다.
      subCategories: parentId ? [{ id: '', name: '', defaultIsFixed: false }] : NO_SUB_CATEGORIES,
    });
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const subs = filledSubCategories(categoryFormData.subCategories);
    // 소분류 모드에서는 이름이 하나라도 있어야 만들 것이 있다.
    if (categoryParent && subs.length === 0) {
      setCategoryError('소분류 이름을 입력해주세요.');
      return;
    }

    try {
      setCategorySubmitting(true);
      setCategoryError('');

      // 소분류 모드: 고른 대분류 밑에만 붙인다. 유형은 대분류를 따라간다.
      // 대분류 모드: 대분류를 먼저 만들고 그 id로 소분류를 붙인다.
      const parent = categoryParent
        ? categoryParent
        : await apiClient.createCategory({
            name: categoryFormData.name,
            type: categoryFormData.type,
          });

      const created: Category[] = [];
      for (const sub of subs) {
        created.push(
          await apiClient.createCategory({
            name: sub.name.trim(),
            type: parent.type,
            parentId: parent.id,
            defaultIsFixed: sub.defaultIsFixed,
          }),
        );
      }

      const data = await apiClient.getCategories();
      setCategories(data || []);

      /*
       * 방금 만든 소분류를 거래 폼에 바로 꽂아 준다.
       *
       * 소분류를 추가하러 팝업을 연 이유는 그 소분류로 거래를 적으려는 것이다.
       * 목록만 갱신하고 두면 사용자가 드롭다운을 다시 열어 같은 값을 또 골라야 한다.
       * 여러 개를 넣었으면 무엇을 고를지 알 수 없으므로 하나일 때만 고른다.
       */
      if (categoryParent && created.length === 1) {
        setFormData((prev) =>
          prev.mainCategoryId === categoryParent.id
            ? { ...prev, subCategoryId: created[0].id, isFixed: created[0].defaultIsFixed }
            : prev,
        );
      }

      closeCategoryModal();
    } catch (err: any) {
      setCategoryError(err?.response?.data?.error?.message || '카테고리 추가에 실패했습니다.');
    } finally {
      setCategorySubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  /**
   * 상세 분석 패널의 제목.
   *
   * 예전에는 카드를 누를 때 이름을 따로 저장했다. 그러면 지출/수입 탭을 옮길 때
   * selectedCategoryId만 새 탭의 전체예산으로 바뀌고 이름은 그대로 남아 제목이 어긋났다.
   * 저장하지 않고 id에서 만들면 그런 어긋남이 생기지 않는다.
   */
  const selectedCategoryLabel = useMemo(() => {
    if (selectedCategoryId === 'total-expense') return '전체지출';
    if (selectedCategoryId === 'total-income') return '전체수입';
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

  const openDetailBudgetModal = () => {
    // 이미 예산이 있으면 그 값을 채워 수정으로, 없으면 0에서 시작한다.
    setDetailBudgetAmount(resolveDetailBudgetTarget().existing?.monthlyAmount ?? 0);
    setDetailBudgetError('');
    setShowDetailBudgetModal(true);
  };

  const handleDetailBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDetailBudgetError('');
    if (!selectedProjectId) return;

    if (detailBudgetAmount < 0) {
      setDetailBudgetError('예산 금액은 0보다 작을 수 없습니다.');
      return;
    }

    const { type, apiCategoryId, existing } = resolveDetailBudgetTarget();

    // 0은 "예산 없음"이라는 뜻이다. 있으면 지우고, 애초에 없으면 할 일이 없다.
    if (detailBudgetAmount === 0 && !existing) {
      setDetailBudgetError('삭제할 예산이 없습니다.');
      return;
    }

    try {
      setDetailBudgetSubmitting(true);

      if (detailBudgetAmount === 0) {
        await deleteBudgetApi(existing!.budgetId);
      } else if (existing) {
        await updateBudgetApi(existing.budgetId, {
          monthlyAmount: toAmountString(detailBudgetAmount),
        });
      } else {
        await createBudgetApi({
          projectId: selectedProjectId,
          categoryId: apiCategoryId,
          type,
          monthlyAmount: toAmountString(detailBudgetAmount),
          // 보고 있는 달을 넘긴다. 예산이 기간별로 나뉘어 있을 때
          // 서버가 어느 규칙을 고쳐야 할지 이 값으로 정한다.
          yearMonth: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
        });
      }

      await fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId, appliedFilter);
      setShowDetailBudgetModal(false);
    } catch (err: any) {
      setDetailBudgetError(err.message || '저장에 실패했습니다.');
    } finally {
      setDetailBudgetSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="가계"
        action={
          /* 거래 추가는 어느 탭에서든 쓸 수 있어야 한다 */
          <button
            onClick={handleAddClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
          >
            거래 추가
          </button>
        }
      />

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
                날짜별
              </button>
              <button
                onClick={() => setViewType('budget')}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  viewType === 'budget'
                    ? 'bg-white text-blue-600 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                분류별
              </button>
              <button
                onClick={() => setViewType('payment-method')}
                className={`px-4 py-2 rounded-md font-medium transition ${
                  viewType === 'payment-method'
                    ? 'bg-white text-blue-600 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              수단별
            </button>
          </div>
        }
      />

      <EntryFilterBar
        people={people}
        myPersonId={myPersonId}
        selectedPersonIds={selectedPersonIds}
        onTogglePerson={togglePersonId}
        selectedFixedTypes={selectedFixedTypes}
        onToggleFixedType={(value) =>
          setSelectedFixedTypes((prev) =>
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
          <p className="text-gray-600">로딩 중...</p>
        ) : viewType === 'payment-method' ? (
          /* 수단별 탭은 거래가 없어도 계좌·카드를 0원으로 보여준다.
             "거래가 없습니다"로 먼저 끊으면 그 화면에 도달할 수 없다. */
          <PaymentMethodTab
            period={reportPeriod}
            projectId={selectedProjectId}
            filter={appliedFilter}
            onEntryClick={handleTransactionClick}
            reloadToken={dataVersion}
          />
        ) : visibleEntries.length === 0 ? (
          /* 필터로 비었는지 원래 없는지 구분해 준다. 체크를 다 풀면 결과가 없는 게 정상이다. */
          <p className="text-gray-600">
            {isFilterNarrowed
              ? '필터에 맞는 거래가 없습니다.'
              : '거래가 없습니다.'}
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
                        {year}년 {month}월
                      </p>
                      <TransactionCalendar
                        entries={visibleEntries}
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
                      달력은 {CALENDAR_MAX_MONTHS}개월까지만 그립니다. 나머지 기간은 목록과
                      분류별에서 볼 수 있습니다.
                    </p>
                  )}
                </>
              ) : (
                <TransactionCalendar
                  entries={visibleEntries}
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
                    onEntryClick={handleTransactionClick}
                  />
                ) : (
                  <>
                    <TransactionListView
                      entries={displayEntries}
                      onEntryClick={handleTransactionClick}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <TransactionListView entries={visibleEntries} onEntryClick={handleTransactionClick} />
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={
          isCardPaymentForm
            ? formData.cardTransferDirection === 'refund'
              ? '환불 입금 수정'
              : '카드 대금 결제 수정'
            : editingId
              ? '거래 수정'
              : '거래 추가'
        }
        /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
        footer={
          <button
            type="submit"
            form={ENTRY_FORM_ID}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        }
      >
        <form id={ENTRY_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
              {isCardPaymentForm && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
                  {formData.cardTransferDirection === 'refund'
                    ? '카드사에서 통장으로 돈이 들어온 기록입니다.'
                    : '통장에서 카드사로 대금이 나간 기록입니다.'}{' '}
                  지출로 집계되지 않습니다. 잘못 넣었다면 금액과 날짜를 고치거나 삭제하세요.
                  사용 내역은 건드릴 필요가 없습니다.
                </div>
              )}

              {/* 유형을 맨 위에서 탭으로 고른다. 아래 입력이 유형에 따라 달라지므로 먼저 정한다. */}
              {/* 카드대금 결제는 다른 유형으로 바꿀 수 없다. 부채 상환이라 대응하는 탭이 없다. */}
              {!isCardPaymentForm && (
              <div role="tablist" aria-label="거래 유형" className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {ENTRY_TYPE_TABS.map((tab) => {
                  // 카드는 지출만 만들 수 있고, 결제된 청구서에 속한 내역은 유형을 못 바꾼다.
                  const disabled = formData.method === 'card' && tab.id !== 'expense';
                  const selected = formData.type === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      disabled={disabled}
                      onClick={() => setFormData({
                        ...formData,
                        type: tab.id,
                        mainCategoryId: '',
                        subCategoryId: '',
                      })}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                        selected
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-gray-600' : ''}`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              )}

              {/* 금액은 유형 바로 아래에 둔다. 팝업이 열릴 때 여기로 포커스가 가므로
                  아래쪽에 있으면 본문이 스크롤돼 유형 탭이 가려진다. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">금액</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    required
                    /* 팝업이 열리면 여기부터 입력한다 (Modal이 이 표시를 찾아 포커스한다) */
                    data-autofocus
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="50000"
                  />
                  {/*
                    통화. 결제수단을 고르면 그 계좌 통화로 맞춰지고, 원화 카드를 둔 채
                    달러로 바꾸면 "원화 카드로 한 외화 결제"가 된다.
                  */}
                  <select
                    value={formData.currency}
                    onChange={(e) => {
                      const currency = e.target.value as CurrencyCode;
                      setFormData({
                        ...formData,
                        currency,
                        billedAmount: '',
                        // 직접 고른 통화다. 결제수단을 바꿔도 유지한다.
                        currencyTouched: true,
                      });
                    }}
                    className="w-28 shrink-0 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>

                {needsRate && (
                  <div className="mt-2 space-y-2">
                    {/*
                      환율은 받지 않는다. 실제 금액만 받고 환율은 계산해서 보여 준다.

                      사용자가 아는 값은 "통장에서 얼마가 빠졌는가"이지 환율이 아니다.
                      기본 환율이 실제와 다르면 설정에서 바꾼다. 여기서 환율을 받으면
                      거래마다 서로 다른 값이 들어가 어떤 것이 맞는지 알 수 없게 된다.
                    */}
                    {needsBilled && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          실제 {isCreditCardSelected ? '청구액' : '결제액'} ({ledgerCurrency})
                          {mustBill && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        <input
                          type="number"
                          step="any"
                          required={mustBill}
                          value={formData.billedAmount}
                          onChange={(e) =>
                            setFormData({ ...formData, billedAmount: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={isCreditCardSelected ? '명세서에 찍힌 금액' : '통장에서 빠진 금액'}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {isCreditCardSelected
                            ? '명세서가 나온 뒤에 넣어도 됩니다. 그때까지는 기본 환율로 추정합니다.'
                            : '통장에서 이미 빠진 금액입니다.'}
                        </p>
                      </div>
                    )}

                    {/* 적용되는 환율. 입력값이 아니라 결과다. */}
                    <div className="px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">
                          환율 (1 {formData.currency} = ? {ledgerCurrency})
                        </span>
                        <span className="font-medium text-gray-900">
                          {derivedRate || formatNumber(rateOf(formData.currency)) || '-'}
                          {!hasBilled && <span className="ml-1 text-gray-500">기본</span>}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {convertedPreview
                          ? `${convertedPreview} 로 기록됩니다.`
                          : '금액을 넣으면 기록될 값이 여기 나옵니다.'}
                        {!hasBilled && ' 기본 환율은 설정에서 바꿉니다.'}
                      </p>
                    </div>
                  </div>
                )}

                {paymentCurrency !== formData.currency && formData.currency !== ledgerCurrency && (
                  <p className="mt-1 text-xs text-gray-500">
                    결제수단은 {paymentCurrency}입니다. 청구되는 {ledgerCurrency} 금액이 기록되고
                    원래 금액은 참고용으로 함께 남습니다.
                  </p>
                )}
              </div>

              {/* 그다음 날짜와 시각을 받는다. 자주 고치는 값이라 위쪽에 둔다. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    날짜
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    /* 원장 하한(기초잔액 전표 날짜)까지만 거슬러 올라간다 */
                    min={LEDGER_MIN_ENTRY_DATE_KEY}
                    // 연도 오타(2026 -> 2926)를 서버 400 전에 브라우저가 막는다
                    max={ledgerMaxEntryDateKey()}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    시간
                  </label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {isCardPaymentForm ? (
                /*
                 * 카드와 통장은 고정이다. 바꾸면 다른 카드의 부채를 갚는 전혀 다른 거래가
                 * 되므로, 잘못 골랐다면 지우고 자산 화면에서 다시 결제하는 것이 맞다.
                 */
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">카드</label>
                    <p className="px-3 py-2 bg-gray-100 rounded-lg text-gray-700">
                      {cards.find((c) => c.id === formData.cardId)?.name ?? '-'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {formData.cardTransferDirection === 'refund' ? '입금 통장' : '결제 통장'}
                    </label>
                    <p className="px-3 py-2 bg-gray-100 rounded-lg text-gray-700">
                      {accounts.find((a) => a.id === formData.accountId)?.name ?? '-'}
                    </p>
                  </div>
                </div>
              ) : formData.type === 'transfer' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    보내는 계좌
                  </label>
                  {/* 신용카드를 고르면 카드사에 대금을 갚는 것이 아니라 환불을 받는 쪽이 된다 */}
                  <CustomSelect
                    options={transferAccountOptions.filter(
                      (option) => option.id !== formData.toAccountId,
                    )}
                    value={formData.accountId}
                    onChange={(value) =>
                      setFormData({ ...formData, method: 'account', accountId: value, cardId: '' })
                    }
                    placeholder="선택하세요"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    결제수단
                  </label>
                  {/* 계좌와 카드를 한 목록에서 고른다. 접두사로 종류를 구분한다. */}
                  <CustomSelect
                    options={paymentMethodOptions}
                    value={selectedPaymentMethodId}
                    onChange={handlePaymentMethodChange}
                    placeholder="선택하세요"
                    onAddClick={() => setIsMethodChooserOpen(true)}
                    addButtonLabel="결제수단 추가"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  사용자
                </label>
                <CustomSelect
                  options={people.map((p) => ({ id: p.id, name: p.name }))}
                  value={formData.personId}
                  onChange={(value) => setFormData({ ...formData, personId: value })}
                  placeholder="선택하세요"
                  onAddClick={() => setIsPersonModalOpen(true)}
                  addButtonLabel="사용자 추가"
                />
              </div>

              {formData.type !== 'transfer' && !isCardPaymentForm && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      대분류
                    </label>
                    <CustomSelect
                      options={categories
                        .filter((c) => !c.parentId && c.type === formData.type)
                        .map((cat) => ({ id: cat.id, name: cat.name }))}
                      value={formData.mainCategoryId}
                      onChange={(value) => {
                        const selectedCategory = categories.find((c) => c.id === value);
                        setFormData({
                          ...formData,
                          mainCategoryId: value,
                          subCategoryId: '',
                          isFixed: selectedCategory?.defaultIsFixed || false,
                        });
                      }}
                      placeholder="선택하세요"
                      onAddClick={() => openCategoryModal()}
                      addButtonLabel="대분류 추가"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      소분류 (선택)
                    </label>
                    <CustomSelect
                      options={
                        formData.mainCategoryId
                          ? categories
                              .filter(
                                (c) =>
                                  Boolean(c.parentId) &&
                                  c.parentId === formData.mainCategoryId
                              )
                              .map((cat) => ({ id: cat.id, name: cat.name }))
                          : [{ id: '', name: '없음' }]
                      }
                      value={formData.subCategoryId}
                      onChange={(value) => {
                        // 소분류를 고르면 그 소분류의 기본값, "없음"으로 되돌리면 대분류의 기본값을 쓴다.
                        const target =
                          categories.find((c) => c.id === value) ??
                          categories.find((c) => c.id === formData.mainCategoryId);
                        setFormData({
                          ...formData,
                          subCategoryId: value,
                          isFixed: target?.defaultIsFixed || false,
                    });
                  }}
                  placeholder="없음"
                  /*
                    소분류는 대분류 아래에 붙는다. 대분류를 고르기 전에는 붙일 곳이
                    없으므로 버튼 자체를 내리고, 고른 뒤에는 그 대분류로 팝업을 연다.
                  */
                  onAddClick={
                    formData.mainCategoryId
                      ? () => openCategoryModal(formData.mainCategoryId)
                      : undefined
                  }
                  addButtonLabel="소분류 추가"
                />
                  </div>

                  {/* 고정 여부는 이 분류에 저장된다. 다음에 같은 분류를 고르면 자동으로 켜진다. */}
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="isFixed"
                      checked={formData.isFixed}
                      onChange={(e) => setFormData({ ...formData, isFixed: e.target.checked })}
                      className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
                    />
                    <label htmlFor="isFixed" className="text-sm font-medium text-gray-700">
                      {formData.type === 'income' ? '고정수입' : '고정지출'}
                    </label>
                  </div>

                </>
              )}

              {formData.type === 'transfer' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      이체 대상 계좌
                    </label>
                    <CustomSelect
                      options={transferAccountOptions.filter(
                        (option) => option.id !== formData.accountId,
                      )}
                      value={formData.toAccountId}
                      onChange={(value) => setFormData({ ...formData, toAccountId: value })}
                      placeholder="선택하세요"
                    />
                  </div>

                  {/*
                    통화가 다른 환전.

                    보낸 금액과 받은 금액을 그대로 적으면 실제 적용된 환율이
                    저절로 기록된다. 서버 환율로 추정하지 않으므로 은행 수수료가
                    섞인 실거래 환율이 그대로 남는다.
                  */}
                  {isCrossCurrencyTransfer && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        받은 금액 ({toCurrency})
                      </label>
                      <input
                        type="number"
                        value={formData.toAmount}
                        onChange={(e) => setFormData({ ...formData, toAmount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="135000"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        {paymentCurrency} 계좌에서 {toCurrency} 계좌로 옮깁니다. 통장에 실제로
                        찍힌 금액을 적으면 그날의 실효 환율로 기록됩니다. 비우면 서버 환율로
                        계산합니다.
                      </p>
                    </div>
                  )}

                  {/*
                    한쪽이 신용카드면 카드사와의 자금 이동이다. 방향이 뜻을 바꾸므로
                    저장하기 전에 무엇으로 기록되는지 알려 준다.
                  */}
                  {transferCardSide && (
                    <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
                      {transferCardSide === 'payment'
                        ? '통장에서 카드사로 나가므로 대금 결제로 기록됩니다.'
                        : '카드사에서 통장으로 들어오므로 환불 입금으로 기록됩니다.'}{' '}
                      지출로 집계되지 않고 카드 부채만 움직입니다.
                    </div>
                  )}

                  {/* 카드사와의 이체에는 수수료를 붙일 수 없다 (서버도 거부한다) */}
                  <div className={transferCardSide ? 'hidden' : undefined}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      이체 수수료 (선택)
                    </label>
                    <input
                      type="number"
                      value={formData.transferFee}
                      onChange={(e) => setFormData({ ...formData, transferFee: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>

                  {formData.transferFee && parseInt(formData.transferFee) > 0 && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          수수료 대분류
                        </label>
                        <CustomSelect
                          options={categories
                            .filter((c) => !c.parentId && c.type === 'expense')
                            .map((cat) => ({ id: cat.id, name: cat.name }))}
                          value={formData.transferFeeMainCategoryId}
                          onChange={(value) => {
                            const selected = categories.find((c) => c.id === value);
                            setFormData({
                              ...formData,
                              transferFeeMainCategoryId: value,
                              transferFeeSubCategoryId: '',
                              isFixed: selected?.defaultIsFixed || false,
                            });
                          }}
                          placeholder="선택하세요"
                          onAddClick={() => openCategoryModal()}
                          addButtonLabel="대분류 추가"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          수수료 소분류 (선택)
                        </label>
                        <CustomSelect
                          options={
                            formData.transferFeeMainCategoryId
                              ? categories
                                  .filter(
                                    (c) =>
                                      Boolean(c.parentId) &&
                                      c.parentId === formData.transferFeeMainCategoryId
                                  )
                                  .map((cat) => ({ id: cat.id, name: cat.name }))
                              : [{ id: '', name: '없음' }]
                          }
                          value={formData.transferFeeSubCategoryId}
                          onChange={(value) => {
                            // 소분류를 고르면 그 기본값, "없음"이면 수수료 대분류의 기본값을 쓴다.
                            const target =
                              categories.find((c) => c.id === value) ??
                              categories.find((c) => c.id === formData.transferFeeMainCategoryId);
                            setFormData({
                              ...formData,
                              transferFeeSubCategoryId: value,
                              isFixed: target?.defaultIsFixed || false,
                            });
                          }}
                          placeholder="없음"
                        />
                      </div>

                      {/* 이체에서 고정 여부는 수수료 분류에 저장된다 (이체 자체는 지출이 아니다). */}
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="feeIsFixed"
                          checked={formData.isFixed}
                          onChange={(e) => setFormData({ ...formData, isFixed: e.target.checked })}
                          className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
                        />
                        <label htmlFor="feeIsFixed" className="text-sm font-medium text-gray-700">
                          고정지출
                        </label>
                      </div>
                    </>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="거래 설명"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  거래처 (선택)
                </label>
                <input
                  type="text"
                  value={formData.merchant}
                  onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="가맹점, 송금 계좌주 등 (선택사항)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상세설명 (선택)
                </label>
                <input
                  type="text"
                  value={formData.detailedNote}
                  onChange={(e) => setFormData({ ...formData, detailedNote: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="추가 설명 (선택사항)"
                />
              </div>

              {/*
                할부. 자주 쓰는 값이 아니라 폼 맨 아래에 둔다.

                신용카드 지출에만 뜬다. 체크카드는 결제 즉시 통장에서 빠지고 통장에는
                갚을 빚이 없어 나눌 청구가 없다 (서버도 같은 규칙으로 막는다).
                원금과 지출은 구매 시점에 전액 잡히고, 카드 화면의 주기별 사용액만 나뉜다.
              */}
              {canInstall && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    할부 (선택)
                  </label>
                  <CustomSelect
                    options={INSTALLMENT_OPTIONS}
                    value={formData.installmentMonths}
                    onChange={(value) => setFormData({ ...formData, installmentMonths: value })}
                    placeholder="일시불"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    지출과 카드 부채는 오늘 전액 잡힙니다. 청구만 나뉩니다.
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
                  {error}
                </div>
              )}

        </form>
      </Modal>

      {/* 결제수단 드롭다운의 추가 버튼. 계좌와 카드를 한 목록에서 고르므로 종류를 여기서 묻는다. */}
      <ChoiceModal
        isOpen={isMethodChooserOpen}
        onClose={() => setIsMethodChooserOpen(false)}
        title="결제수단 추가"
        choices={[
          {
            key: 'account',
            icon: '🏦',
            label: '계좌 추가',
            description: '새로운 계좌를 추가합니다',
            tone: 'green',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsAccountModalOpen(true);
            },
          },
          {
            key: 'card',
            icon: '💳',
            label: '카드 추가',
            description: '새로운 카드를 추가합니다',
            tone: 'purple',
            onSelect: () => {
              setIsMethodChooserOpen(false);
              setIsCardModalOpen(true);
            },
          },
        ]}
      />

      {/* 상세 분석에서 여는 예산 입력. 분류가 정해져 있으므로 금액만 받는다. */}
      <Modal
        isOpen={showDetailBudgetModal}
        onClose={() => setShowDetailBudgetModal(false)}
        title={`${selectedCategoryLabel} 예산`}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetailBudgetModal(false)}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              취소
            </button>
            <button
              type="submit"
              form={BUDGET_FORM_ID}
              disabled={detailBudgetSubmitting}
              className={`flex-1 px-4 py-2 text-white rounded-lg transition disabled:opacity-50 ${
                detailBudgetAmount === 0
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {detailBudgetSubmitting ? '저장 중...' : detailBudgetAmount === 0 ? '삭제' : '저장'}
            </button>
          </div>
        }
      >
        <form id={BUDGET_FORM_ID} onSubmit={handleDetailBudgetSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              월 예산 금액
            </label>
            <input
              type="number"
              min="0"
              autoFocus
              value={detailBudgetAmount}
              onChange={(e) => setDetailBudgetAmount(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-2 text-xs text-gray-500">0을 입력하면 예산을 삭제합니다.</p>
          </div>

          {detailBudgetError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded text-sm">
              {detailBudgetError}
            </div>
          )}

        </form>
      </Modal>

      <PersonModal
        isOpen={isPersonModalOpen}
        onClose={() => setIsPersonModalOpen(false)}
        person={null}
        mode="add"
        onSuccess={handlePersonModalSuccess}
        onDelete={async () => {}}
      />

      <AddAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAccounts) => setAccounts(newAccounts)}
        people={people}
        projectId={selectedProjectId}
      />

      <Modal
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        title="카드 추가"
        footer={
          <button
            type="submit"
            form={CARD_FORM_ID}
            disabled={cardSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {cardSubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CARD_FORM_ID} onSubmit={handleCardSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 이름
            </label>
            <input
              type="text"
              required
              value={cardFormData.name}
              onChange={(e) => setCardFormData({ ...cardFormData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 내 체크카드"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={cardFormData.accountId}
              onChange={(value) => setCardFormData({ ...cardFormData, accountId: value })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel="계좌 추가"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 번호 (선택)
            </label>
            <input
              type="text"
              value={cardFormData.cardNumber}
              onChange={(e) => setCardFormData({ ...cardFormData, cardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="16자리"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 유형
            </label>
            <CustomSelect
              options={[
                { id: 'debit', name: '체크카드' },
                { id: 'credit', name: '신용카드' },
              ]}
              value={cardFormData.cardType}
              onChange={(value) => setCardFormData({ ...cardFormData, cardType: value as 'debit' | 'credit' })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel=""
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              발급사
            </label>
            <CustomSelect
              options={issuerOptions}
              value={cardFormData.issuerId}
              onChange={(value) => setCardFormData({ ...cardFormData, issuerId: value })}
              placeholder="카드사를 선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              만료 월 (선택)
            </label>
            <input
              type="month"
              value={cardFormData.expiryDate}
              onChange={(e) => setCardFormData({ ...cardFormData, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {cardFormData.cardType === 'credit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  신용한도 (원)
                </label>
                <input
                  type="number"
                  value={cardFormData.creditLimit}
                  onChange={(e) => setCardFormData({ ...cardFormData, creditLimit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000000"
                />
              </div>

              {/* 마감일과 결제일로 청구 주기를 계산한다 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  마감일
                </label>
                <select
                  value={cardFormData.statementClosingDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제일
                </label>
                <select
                  value={cardFormData.paymentDueDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, paymentDueDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
              </div>
            </>
          )}

        </form>
      </Modal>

      {/* 대분류 추가와 "이 대분류에 소분류 추가"를 한 팝업으로 처리한다 */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={closeCategoryModal}
        title={categoryParent ? `${categoryParent.name} 소분류 추가` : '카테고리 추가'}
        footer={
          <button
            type="submit"
            form={CATEGORY_FORM_ID}
            /* 소분류 모드에는 이름 칸이 없다. 그때는 소분류 줄이 채워졌는지 본다. */
            disabled={
              categorySubmitting ||
              (categoryParent
                ? filledSubCategories(categoryFormData.subCategories).length === 0
                : !categoryFormData.name.trim())
            }
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {categorySubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CATEGORY_FORM_ID} onSubmit={handleCategorySubmit} className="space-y-4">
          <CategoryFormFields
            name={categoryFormData.name}
            onNameChange={(name) => setCategoryFormData({ ...categoryFormData, name })}
            type={categoryFormData.type}
            onTypeChange={(type) => setCategoryFormData({ ...categoryFormData, type })}
            subCategories={categoryFormData.subCategories}
            onSubCategoriesChange={(subCategories) =>
              setCategoryFormData({ ...categoryFormData, subCategories })
            }
            parentName={categoryParent?.name}
          />

          {categoryError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{categoryError}</div>
          )}

        </form>
      </Modal>

      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="거래 상세내역"
        footer={
          selectedTransaction ? (
            <div className="flex gap-2">
              {/*
                카드대금 결제와 잔액 조정은 이 폼으로 만들 수 없는 종류다.
                수정 폼에 담으면 지출로 바뀌어 버리므로 버튼 자체를 감춘다.
              */}
              {isEditable(selectedTransaction) ? (
                <button
                  onClick={handleDetailEditClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
              ) : (
                <div className="flex-1 px-4 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg text-center">
                  잔액 조정은 수정할 수 없습니다
                </div>
              )}
              {/* 카드 거래도 계좌 거래와 똑같이 지운다. 청구서 잠금은 없다. */}
              <button
                onClick={async () => {
                  setIsDetailModalOpen(false);
                  await handleDeleteClick(selectedTransaction.id);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                disabled={isSubmitting}
              >
                삭제하기
              </button>
            </div>
          ) : null
        }
      >
        {selectedTransaction && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                수단
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.cardId ? '카드' : '계좌'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {selectedTransaction.cardId ? '카드' : '계좌'}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.cardId
                  ? cards.find(c => c.id === selectedTransaction.cardId)?.name || '-'
                  : accounts.find(a => a.id === selectedTransaction.accountId)?.name || '-'
                }
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                사용자
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.personName || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {ENTRY_KIND_LABEL[selectedTransaction.kind]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                대분류
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.parentCategoryName || selectedTransaction.categoryName || '-'}
              </p>
            </div>

            {selectedTransaction.parentCategoryName && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소분류
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.categoryName || '-'}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                금액
              </label>
              <p className={`px-3 py-2 bg-gray-50 rounded-lg text-lg font-bold ${
                selectedTransaction.kind === 'income' ? 'text-green-600' : 'text-red-600'
              }`}>
                {selectedTransaction.kind === 'income' ? '+' : '-'}
                {formatCurrency(selectedTransaction.amount)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                설명
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.description || '-'}
              </p>
            </div>

            {selectedTransaction.merchant && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  거래처
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.merchant}
                </p>
              </div>
            )}

            {selectedTransaction.detailedNote && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상세설명
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.detailedNote}
                </p>
              </div>
            )}

            {selectedTransaction.toAccountName && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이체 대상 계좌
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedTransaction.toAccountName}
                </p>
              </div>
            )}

            {/* 이체 수수료. 수수료가 없어도 0으로 보여준다 */}
            {selectedTransaction.kind === 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이체 수수료
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {formatCurrency(selectedTransaction.feeAmount ?? 0)}
                  {selectedTransaction.feeCategoryName && (
                    <span className="ml-2 text-sm text-gray-500">
                      ({selectedTransaction.feeCategoryName})
                    </span>
                  )}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                고정 지출
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.isFixed ? '고정' : '변동'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                날짜
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {/* 시간을 입력하지 않은 거래는 날짜만 보여준다 */}
                {formatDateTime(selectedTransaction.date, timeZone)}
              </p>
            </div>

          </div>
        )}
      </Modal>
    </div>
  );
}
