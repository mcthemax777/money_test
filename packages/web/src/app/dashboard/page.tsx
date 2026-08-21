'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { useMyPersonId, useProject, useProjectTimeZone } from '@/store/project';
import { useBudget } from '@/store/budget';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { DAY_OF_MONTH_HINT, DAY_OF_MONTH_OPTIONS } from '@/lib/day-of-month';
import {
  dateKeyOf,
  dateMarkerKey,
  formatDateTime,
  currentYearMonth,
  monthInputToIso,
  monthQueryRange,
  nowTimeKey,
  timeInputOf,
  todayKey,
} from '@/lib/datetime';
import { LEDGER_MIN_ENTRY_DATE_KEY, zonedFormValueToUtc } from '@money/types';
import CustomSelect from '@/components/CustomSelect';
import ChoiceModal from '@/components/ChoiceModal';
import Modal from '@/components/Modal';
import TransactionCalendar from '@/components/TransactionCalendar';
import TransactionListView from '@/components/TransactionListView';
import MonthHeader from '@/components/MonthHeader';
import AddAccountModal from '@/components/AddAccountModal';
import PersonModal from '@/components/PersonModal';
import TransactionItem, { EntryListItem } from '@/components/TransactionItem';
import { BudgetCard } from '@/components/BudgetCard';
import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import PaymentMethodTab from '@/components/PaymentMethodTab';
import EntryFilterBar, { FixedType } from '@/components/EntryFilterBar';
import { useInstitutions } from '@/hooks/useInstitutions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { EntryFilterQuery } from '@money/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const ENTRY_FORM_ID = 'entry-form';
const BUDGET_FORM_ID = 'detail-budget-form';
const CARD_FORM_ID = 'card-form';
const CATEGORY_FORM_ID = 'category-form';

/** 거래 추가/수정 팝업 맨 위의 유형 탭 */
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
  const { selectedPersonIds, setPeople: setStorePeople, setSelectedPersonIds, togglePersonId } =
    useUserFilter();
  const { selectedProjectId } = useProject();
  // 날짜 입력과 표시는 브라우저 로컬이 아니라 프로젝트 기준 타임존으로 해석한다.
  const timeZone = useProjectTimeZone();
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
  const [budgetType, setBudgetType] = useState<'income' | 'expense'>('expense');
  const [expandedBudgetIds, setExpandedBudgetIds] = useState<Set<string>>(new Set());
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
    subCategories: [''],
    color: '',
  });
  const [categorySubmitting, setCategorySubmitting] = useState(false);
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
    transferFee: '',
    transferFeeMainCategoryId: '',
    transferFeeSubCategoryId: '',
    date: todayKey(timeZone),
    time: '',
    isFixed: false,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * 수정 중인 거래가 이미 결제된 청구서에 포함되어 있으면 그 청구 기간.
   *
   * 금액·결제수단은 잠그되, 날짜는 이 기간 안에서 고칠 수 있게 둔다.
   * 같은 청구서에 머무르면 청구액이 달라지지 않으므로 오타 정정에 문제가 없다.
   */
  const [lockedPeriod, setLockedPeriod] = useState<{ start: string; end: string } | null>(null);
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

        // 저장된 사람 필터를 이 프로젝트의 구성원에 맞춘다.
        //   - 한 번도 건드리지 않았으면 전체 선택으로 시작한다.
        //     (아무도 고르지 않은 상태는 "거래 없음"이라 첫 화면이 비어 버린다)
        //   - 건드린 적이 있으면 이 프로젝트에 없는 id만 걷어낸다.
        const loadedPeople = peopleData || [];
        const validIds = new Set(loadedPeople.map((person: Person) => person.id));
        const stillValid = selectedPersonIds.filter((id) => validIds.has(id));

        if (!useUserFilter.getState().personFilterTouched) {
          setSelectedPersonIds(loadedPeople.map((person: Person) => person.id));
        } else if (stillValid.length !== selectedPersonIds.length) {
          setSelectedPersonIds(stillValid);
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
  const reloadMonth = useCallback(async () => {
    if (!selectedProjectId || !currentYear || !currentMonth) return;

    const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const { startDate, endDate } = monthQueryRange(currentYear, currentMonth, timeZone);

    const [entriesRes, summaryRes] = await Promise.all([
      apiClient.getEntries(
        { startDate, endDate, limit: 200, ...appliedFilter },
        selectedProjectId,
      ),
      apiClient.getSummary(yearMonth, selectedProjectId, appliedFilter),
    ]);

    setEntries(entriesRes?.data ?? []);
    setSummary(summaryRes ?? { income: '0', expense: '0' });
  }, [selectedProjectId, currentYear, currentMonth, timeZone, appliedFilter]);

  useEffect(() => {
    reloadMonth().catch((err: unknown) => {
      console.error('거래 조회 실패:', err);
      setEntries([]);
    });
  }, [reloadMonth]);

  useEffect(() => {
    if (selectedProjectId) {
      apiClient.getCategories(selectedProjectId).then((data) => {
        setCategories(data);
      });
    }
  }, [selectedProjectId]);

  // 예산 로드 시 모든 항목 펼치기
  useEffect(() => {
    if (monthlyBudgets.length > 0) {
      // 전체예산만 기본 펼침, 대분류와 소분류는 닫힘
      setExpandedBudgetIds(new Set(['total']));
    }
  }, [monthlyBudgets]);

  // 분류별 탭 진입 시 초기값 설정 및 budgetType 변경 시 categoryId 업데이트
  useEffect(() => {
    if (viewType === 'budget') {
      // budgetType에 따라 categoryId 자동 설정
      setSelectedCategoryId(budgetType === 'expense' ? 'total-expense' : 'total-income');
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

    if (kind === 'card') {
      setFormData((prev) => ({
        ...prev,
        method: 'card',
        cardId: id,
        accountId: '',
        type: 'expense',
        mainCategoryId: prev.type === 'expense' ? prev.mainCategoryId : '',
        subCategoryId: prev.type === 'expense' ? prev.subCategoryId : '',
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, method: 'account', accountId: id, cardId: '' }));
  };

  // 사람·고정 필터는 서버가 건다. 여기서는 카드대금 결제만 뺀다
  // (부채 상환이라 소비가 아니고, 목록에 섞이면 합계와 어긋난다).
  const visibleEntries = useMemo(
    () => entries.filter((entry) => entry.kind !== 'card_payment'),
    [entries],
  );

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

      // 화면의 "지출/수입/이체" 개념을 그대로 보낸다. 서버가 전표(postings)로 번역한다.
      const kind =
        formData.type === 'income' ? 'income' : formData.type === 'transfer' ? 'transfer' : 'expense';
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

      if (formData.merchant) payload.merchant = formData.merchant;
      if (formData.detailedNote) payload.detailedNote = formData.detailedNote;

      if (kind === 'transfer') {
        payload.accountId = formData.accountId;
        payload.toAccountId = formData.toAccountId;
        if (formData.transferFee) {
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
      }

      if (editingId) {
        await apiClient.updateEntry(editingId, payload);
      } else {
        await apiClient.createEntry({ ...payload, projectId: selectedProjectId });
      }

      await reloadMonth();

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
        transferFee: '',
        transferFeeMainCategoryId: '',
        transferFeeSubCategoryId: '',
        date: todayKey(timeZone),
        time: '',
        isFixed: false,
      });
      setEditingId(null);
      setLockedPeriod(null);
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
    setLockedPeriod(null);
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
      transferFee: '',
      transferFeeMainCategoryId: '',
      transferFeeSubCategoryId: '',
      date: todayKey(timeZone),
      time: '',
      isFixed: false,
    });
    setEditingId(null);
    setLockedPeriod(null);
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

  const handleDetailEditClick = () => {
    if (!selectedTransaction) return;
    setIsDetailModalOpen(false);
    handleEditClick(selectedTransaction);
  };

  /** 수정할 수 없는 전표. 화면에서 만들 수 없는 종류라 수정 폼에 담을 수 없다. */
  const isEditable = (entry: EntryListItem) =>
    entry.kind === 'expense' || entry.kind === 'income' || entry.kind === 'transfer';

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
    setLockedPeriod(
      entry.lockedByStatement && entry.statementPeriodStart && entry.statementPeriodEnd
        ? {
            // 청구 기간은 @db.Date라 날짜만 의미가 있다 (인스턴트가 아니다).
            start: dateMarkerKey(entry.statementPeriodStart),
            end: dateMarkerKey(entry.statementPeriodEnd),
          }
        : null,
    );
    const category = splitCategory(entry.categoryId);
    const fee = splitCategory(entry.feeCategoryId);

    setFormData({
      method: entry.cardId ? 'card' : 'account',
      accountId: entry.accountId || '',
      cardId: entry.cardId || '',
      personId: entry.personId || '',
      type: entry.kind,
      mainCategoryId: category.mainCategoryId,
      subCategoryId: category.subCategoryId,
      amount: entry.amount,
      description: entry.description || '',
      merchant: entry.merchant || '',
      detailedNote: entry.detailedNote || '',
      toAccountId: entry.toAccountId || '',
      // 수수료는 별도 다리라 예전에는 비워뒀다. 이제 목록 응답에 들어 있어 그대로 채운다.
      transferFee: toNumber(entry.feeAmount) > 0 ? entry.feeAmount ?? '' : '',
      transferFeeMainCategoryId: fee.mainCategoryId,
      transferFeeSubCategoryId: fee.subCategoryId,
      date: dateKeyOf(entry.date, timeZone),
      time: timeInputOf(entry.date, timeZone),
      isFixed: entry.isFixed,
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteEntry(id);
      await reloadMonth();
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

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCategorySubmitting(true);
      await apiClient.createCategory({
        name: categoryFormData.name,
        type: categoryFormData.type,
      });
      const categoryList = await apiClient.getCategories();
      const mainCategory = categoryList?.find((c: Category) => c.name === categoryFormData.name && !c.parentId);

      if (mainCategory) {
        const filteredSubs = categoryFormData.subCategories.filter((sub) => sub.trim());
        for (const subName of filteredSubs) {
          await apiClient.createCategory({
            name: subName,
            type: categoryFormData.type,
            parentId: mainCategory.id,
          });
        }
      }

      const data = await apiClient.getCategories();
      setCategories(data || []);
      setCategoryFormData({
        name: '',
        type: 'expense',
        subCategories: [''],
        color: '',
      });
      setIsCategoryModalOpen(false);
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
    } finally {
      setCategorySubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  const toggleBudgetExpanded = (budgetId: string) => {
    const newExpanded = new Set(expandedBudgetIds);
    if (newExpanded.has(budgetId)) {
      newExpanded.delete(budgetId);
    } else {
      newExpanded.add(budgetId);
    }
    setExpandedBudgetIds(newExpanded);
  };

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

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '전체예산';
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || 'Unknown';
  };

  return (
    <>
      {/* 통합 헤더. 년월과 탭, 거래 추가가 한 줄에 놓인다. */}
      <MonthHeader
        year={currentYear}
        month={currentMonth}
        incomeTotal={monthlyTotals.incomeTotal}
        expenseTotal={monthlyTotals.expenseTotal}
        onMonthChange={handleMonthChange}
        right={
          <>
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

            {/* 거래 추가는 어느 탭에서든 쓸 수 있어야 한다 */}
            <button
              onClick={handleAddClick}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              거래 추가
            </button>
          </>
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
          // 예산 뷰
          monthlyBudgets.length === 0 ? (
            <p className="text-gray-600">설정된 예산이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 p-6 overflow-hidden">
                {/* 수입/지출 탭 */}
                <div className="flex gap-2 mb-6 border-b">
                  <button
                    onClick={() => setBudgetType('expense')}
                    className={`px-4 py-2 font-medium transition ${
                      budgetType === 'expense'
                        ? 'border-b-2 border-blue-600 text-blue-600'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    지출
                  </button>
                  <button
                    onClick={() => setBudgetType('income')}
                    className={`px-4 py-2 font-medium transition ${
                      budgetType === 'income'
                        ? 'border-b-2 border-blue-600 text-blue-600'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    수입
                  </button>
                </div>

                {/* 줄을 패널 가장자리까지 붙인다. 선택 표시(왼쪽 막대)가 가장자리에 닿아야 눈에 든다. */}
                <div className="-mx-6 border-t border-gray-200">
                {(() => {
                  console.log('=== Budget Section Debug ===');
                  console.log('monthlyBudgets:', monthlyBudgets);
                  console.log('categories count:', categories?.length);
                  console.log('budgetType:', budgetType);

                  // 현재 탭의 예산만 필터링 (type이 있는 항목들)
                  const categoryBudgets = monthlyBudgets.filter(
                    (b) => b.categoryId && (b.type === budgetType || b.categoryType === budgetType)
                  );
                  console.log('categoryBudgets:', categoryBudgets);

                  // 모든 대분류 카테고리 가져오기
                  const allMainCategories = categories.filter(
                    (c) => !c.parentId && c.type === budgetType
                  );
                  console.log('allMainCategories:', allMainCategories);

                  // 예산 데이터와 카테고리를 매칭 (없으면 0으로 표시)
                  const mainCategories = allMainCategories.map(cat => {
                    const budget = categoryBudgets.find(b => b.categoryId === cat.id);
                    if (budget) {
                      return {
                        ...budget,
                        monthlyAmount: budget.monthlyAmount || 0,
                        usedAmount: budget.usedAmount || 0,
                        hasChildren: categories.some(c => c.parentId === cat.id && c.type === budgetType),
                      };
                    }
                    return {
                      budgetId: `placeholder-${cat.id}`,
                      categoryId: cat.id,
                      categoryName: cat.name,
                      monthlyAmount: 0,
                      usedAmount: 0,
                      type: budgetType,
                      isOverridden: false,
                      hasChildren: categories.some(c => c.parentId === cat.id && c.type === budgetType),
                    };
                  });
                  console.log('mainCategories:', mainCategories);

                  // API에서 받은 전체예산 (실제로 설정된 것)
                  const actualTotalBudget = monthlyBudgets.find(
                    (b) => !b.categoryId && !b.parentCategoryId && (b.type === budgetType || b.categoryType === budgetType)
                  );
                  console.log('actualTotalBudget:', actualTotalBudget);

                  // 전체예산 없으면 placeholder 생성 (monthlyAmount: 0)
                  const totalBudget = actualTotalBudget || {
                    budgetId: `placeholder-total-${budgetType}`,
                    categoryName: budgetType === 'expense' ? '전체 지출' : '전체 수입',
                    monthlyAmount: 0,
                    usedAmount: 0,
                    type: budgetType,
                    isOverridden: false,
                    hasChildren: mainCategories.length > 0,
                  };
                  console.log('totalBudget:', totalBudget);

                  const isTotalExpanded = expandedBudgetIds.has('total');

                  return (
                    <>
                      {/* 전체예산 */}
                      {totalBudget && (
                        <div>
                          {(() => {
                            const totalCategoryName = (totalBudget as any).categoryName || (budgetType === 'income' ? '전체수입' : '전체지출');
                            const totalCategoryId = budgetType === 'income' ? 'total-income' : 'total-expense';
                            const usedAmount = (totalBudget as any).usedAmount || 0;
                            return (
                              <BudgetCard
                                categoryId={totalCategoryId}
                                categoryName={totalCategoryName}
                                monthlyAmount={(totalBudget as any).monthlyAmount}
                                usedAmount={usedAmount}
                                onSelect={(id) => {
                                  setSelectedCategoryId(id);
                                }}
                                hasChildren={mainCategories.length > 0}
                                isExpanded={isTotalExpanded}
                                onToggleExpand={() => {
                                  const newExpanded = new Set(expandedBudgetIds);
                                  if (newExpanded.has('total')) {
                                    newExpanded.delete('total');
                                  } else {
                                    newExpanded.add('total');
                                  }
                                  setExpandedBudgetIds(newExpanded);
                                }}
                                level="total"
                                isSelected={selectedCategoryId === totalCategoryId}
                              />
                            );
                          })()}

                          {/* 전체예산 펼침 시 대분류 표시 */}
                          {isTotalExpanded && mainCategories.length > 0 && (
                            <div className="bg-gray-50 border-l-2 border-gray-300 pl-2">
                              {mainCategories.map((mainBudget) => {
                                const isMainExpanded = expandedBudgetIds.has(mainBudget.categoryId || '');

                                // 모든 소분류 가져오기
                                const allSubCategories = categories.filter(
                                  (c) => c.parentId === mainBudget.categoryId && c.type === budgetType
                                );

                                // 예산 데이터와 매칭
                                const subBudgets = allSubCategories.map(subCat => {
                                  const budget = monthlyBudgets.find(b => b.categoryId === subCat.id && (b.type === budgetType || b.categoryType === budgetType));
                                  if (budget) {
                                    return {
                                      ...budget,
                                      monthlyAmount: budget.monthlyAmount || 0,
                                      usedAmount: budget.usedAmount || 0,
                                    };
                                  }
                                  return {
                                    budgetId: `placeholder-${subCat.id}`,
                                    categoryId: subCat.id,
                                    categoryName: subCat.name,
                                    monthlyAmount: 0,
                                    usedAmount: 0,
                                    type: budgetType,
                                    isOverridden: false,
                                    hasChildren: false,
                                  };
                                });

                                return (
                                  <div key={mainBudget.budgetId}>
                                    {(() => {
                                      const mainCategoryName = mainBudget.categoryName || getCategoryName(mainBudget.categoryId);
                                      return (
                                        <BudgetCard
                                          categoryId={mainBudget.categoryId}
                                          categoryName={mainCategoryName}
                                          monthlyAmount={mainBudget.monthlyAmount}
                                          usedAmount={mainBudget.usedAmount || 0}
                                          onSelect={(id) => {
                                            setSelectedCategoryId(id);
                                          }}
                                          hasChildren={mainBudget.hasChildren}
                                          isExpanded={isMainExpanded}
                                          onToggleExpand={() => {
                                            if (mainBudget.categoryId) {
                                              toggleBudgetExpanded(mainBudget.categoryId);
                                            }
                                          }}
                                          level="main"
                                          isSelected={selectedCategoryId === mainBudget.categoryId}
                                        />
                                      );
                                    })()}

                                    {/* 대분류 펼침 시 소분류 표시 */}
                                    {mainBudget.hasChildren && isMainExpanded && (
                                      <div>
                                        {subBudgets.map((subBudget) => {
                                          const subCategoryName = subBudget.categoryName || getCategoryName(subBudget.categoryId);
                                          return (
                                            <BudgetCard
                                              key={subBudget.budgetId}
                                              categoryId={subBudget.categoryId}
                                              categoryName={subCategoryName}
                                              monthlyAmount={subBudget.monthlyAmount}
                                              usedAmount={subBudget.usedAmount || 0}
                                              onSelect={(id) => {
                                                setSelectedCategoryId(id);
                                              }}
                                              hasChildren={false}
                                              level="sub"
                                              isSelected={selectedCategoryId === subBudget.categoryId}
                                            />
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 전체예산이 없으면 대분류만 표시 */}
                      {!totalBudget &&
                        mainCategories.map((mainBudget) => {
                          const isMainExpanded = expandedBudgetIds.has(mainBudget.categoryId || '');

                          // 모든 소분류 가져오기
                          const allSubCategories = categories.filter(
                            (c) => c.parentId === mainBudget.categoryId && c.type === budgetType
                          );

                          // 예산 데이터와 매칭
                          const subBudgets = allSubCategories.map(subCat => {
                            const budget = monthlyBudgets.find(b => b.categoryId === subCat.id && b.type === budgetType);
                            return budget || {
                              budgetId: `placeholder-${subCat.id}`,
                              categoryId: subCat.id,
                              categoryName: subCat.name,
                              monthlyAmount: 0,
                              usedAmount: 0,
                              type: budgetType,
                              isOverridden: false,
                              hasChildren: false,
                            };
                          });

                          return (
                            <div key={mainBudget.budgetId}>
                              <BudgetCard
                                categoryName={mainBudget.categoryName || getCategoryName(mainBudget.categoryId)}
                                monthlyAmount={mainBudget.monthlyAmount}
                                usedAmount={mainBudget.usedAmount || 0}
                                hasChildren={mainBudget.hasChildren}
                                isExpanded={isMainExpanded}
                                onToggleExpand={() => {
                                  if (mainBudget.categoryId) {
                                    toggleBudgetExpanded(mainBudget.categoryId);
                                  }
                                }}
                                level="main"
                                isSelected={selectedCategoryId === mainBudget.categoryId}
                              />

                              {mainBudget.hasChildren && isMainExpanded && (
                                <div>
                                  {subBudgets.map((subBudget) => (
                                    <BudgetCard
                                      key={subBudget.budgetId}
                                      categoryName={subBudget.categoryName || getCategoryName(subBudget.categoryId)}
                                      monthlyAmount={subBudget.monthlyAmount}
                                      usedAmount={subBudget.usedAmount || 0}
                                      hasChildren={false}
                                      level="sub"
                                      isSelected={selectedCategoryId === subBudget.categoryId}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </>
                  );
                })()}
              </div>
              </div>

              {selectedCategoryId && (
                <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">{selectedCategoryLabel} 상세 분석</h3>
                    {/* 보고 있는 분류의 예산을 그 자리에서 넣거나 고친다 */}
                    <button
                      onClick={openDetailBudgetModal}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 whitespace-nowrap"
                    >
                      예산 추가
                    </button>
                  </div>
                  <BudgetDetailModal
                    isOpen={true}
                    onClose={() => setSelectedCategoryId('')}
                    categoryId={selectedCategoryId}
                    categoryName={selectedCategoryLabel}
                    categories={categories}
                    isInline={true}
                    currentMonth={currentMonth}
                    currentYear={currentYear}
                    projectId={selectedProjectId}
                    filter={appliedFilter}
                  />
                </div>
              )}
            </div>
          )
        ) : isLoading ? (
          <p className="text-gray-600">로딩 중...</p>
        ) : viewType === 'payment-method' ? (
          /* 수단별 탭은 거래가 없어도 계좌·카드를 0원으로 보여준다.
             "거래가 없습니다"로 먼저 끊으면 그 화면에 도달할 수 없다. */
          <PaymentMethodTab
            currentMonth={currentMonth}
            currentYear={currentYear}
            projectId={selectedProjectId}
            filter={appliedFilter}
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
            <div className="lg:col-span-1">
              <TransactionCalendar
                entries={visibleEntries}
                year={currentYear}
                month={currentMonth}
                onDateSelect={handleCalendarDateSelect}
                onMonthChange={handleMonthChange}
                startDate={startDate}
                endDate={endDate}
              />
            </div>

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
        ) : null}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? '거래 수정' : '거래 추가'}
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
              {lockedPeriod && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
                  이미 결제한 청구서({lockedPeriod.start} ~ {lockedPeriod.end})에 포함된 내역입니다.
                  금액과 결제수단은 바꿀 수 없고, 날짜는 이 청구 기간 안에서만 고칠 수 있습니다.
                </div>
              )}

              {/* 유형을 맨 위에서 탭으로 고른다. 아래 입력이 유형에 따라 달라지므로 먼저 정한다. */}
              <div role="tablist" aria-label="거래 유형" className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {ENTRY_TYPE_TABS.map((tab) => {
                  // 카드는 지출만 만들 수 있고, 결제된 청구서에 속한 내역은 유형을 못 바꾼다.
                  const disabled =
                    Boolean(lockedPeriod) || (formData.method === 'card' && tab.id !== 'expense');
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

              {/* 금액은 유형 바로 아래에 둔다. 팝업이 열릴 때 여기로 포커스가 가므로
                  아래쪽에 있으면 본문이 스크롤돼 유형 탭이 가려진다. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  금액 (원)
                </label>
                <input
                  type="number"
                  required
                  /* 팝업이 열리면 여기부터 입력한다 (Modal이 이 표시를 찾아 포커스한다) */
                  data-autofocus
                  value={formData.amount}
                  disabled={Boolean(lockedPeriod)}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${Boolean(lockedPeriod) ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  placeholder="50000"
                />
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
                    /*
                     * 결제된 청구서에 속하면 그 청구 기간 밖으로는 못 나간다.
                     * 아니면 원장 하한(기초잔액 전표 날짜)까지만 거슬러 올라간다.
                     */
                    min={lockedPeriod?.start ?? LEDGER_MIN_ENTRY_DATE_KEY}
                    max={lockedPeriod?.end}
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
                  disabled={Boolean(lockedPeriod)}
                  onAddClick={() => setIsMethodChooserOpen(true)}
                  addButtonLabel="결제수단 추가"
                />
              </div>

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

              {formData.type !== 'transfer' && (
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
                      onAddClick={() => setIsCategoryModalOpen(true)}
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
                  // 소분류는 대분류 아래에 붙어야 해서 이 폼에서 만들 수 없다.
                  // 카테고리 화면으로 보낸다 ('/dashboard/categories'는 없는 경로였다).
                  onAddClick={() => router.push('/categories')}
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
                      options={accounts
                        .filter((acc) => acc.id !== formData.accountId)
                        .map((acc) => ({ id: acc.id, name: acc.name }))}
                      value={formData.toAccountId}
                      onChange={(value) => setFormData({ ...formData, toAccountId: value })}
                      placeholder="선택하세요"
                    />
                  </div>

                  <div>
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
                          onAddClick={() => setIsCategoryModalOpen(true)}
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

      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        title="카테고리 추가"
        footer={
          <button
            type="submit"
            form={CATEGORY_FORM_ID}
            disabled={categorySubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {categorySubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CATEGORY_FORM_ID} onSubmit={handleCategorySubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              대분류 이름
            </label>
            <input
              type="text"
              required
              value={categoryFormData.name}
              onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 음식"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              유형
            </label>
            <CustomSelect
              options={[
                { id: 'expense', name: '지출' },
                { id: 'income', name: '수입' },
              ]}
              value={categoryFormData.type}
              onChange={(value) => setCategoryFormData({ ...categoryFormData, type: value as any })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel=""
            />
          </div>

          <div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {categoryFormData.subCategories.map((subCat, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={subCat}
                    onChange={(e) => {
                      const newSubs = [...categoryFormData.subCategories];
                      newSubs[index] = e.target.value;
                      setCategoryFormData({ ...categoryFormData, subCategories: newSubs });
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="소분류 이름"
                  />
                  {categoryFormData.subCategories.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newSubs = categoryFormData.subCategories.filter((_, i) => i !== index);
                        setCategoryFormData({ ...categoryFormData, subCategories: newSubs });
                      }}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      제거
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCategoryFormData({ ...categoryFormData, subCategories: [...categoryFormData.subCategories, ''] })}
              className="mt-2 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              소분류 추가
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              색상 (선택)
            </label>
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded border-2 border-gray-300 flex-shrink-0"
                style={{ backgroundColor: categoryFormData.color || '#ffffff' }}
              ></div>
              <input
                type="color"
                value={categoryFormData.color}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, color: e.target.value })}
                className="flex-1 h-10 px-1 border border-gray-300 rounded-lg cursor-pointer"
              />
              {categoryFormData.color && (
                <span className="text-sm text-gray-600 flex-shrink-0 w-20">
                  {categoryFormData.color}
                </span>
              )}
            </div>
          </div>

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
                  {selectedTransaction.kind === 'card_payment'
                    ? '카드대금 결제는 수정할 수 없습니다'
                    : '잔액 조정은 수정할 수 없습니다'}
                </div>
              )}
              {/*
                결제가 끝난 청구서의 사용 내역은 지울 수 없다.
                지우면 청구액만 사라지고 결제 기록은 남아 카드 부채가 유령 잔액으로 뜬다.
              */}
              {selectedTransaction.lockedByStatement ? (
                <div className="flex-1 px-4 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg text-center">
                  결제한 청구서에 포함되어 삭제할 수 없습니다
                </div>
              ) : (
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
              )}
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

    </>
  );
}
