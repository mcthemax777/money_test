'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { useProject } from '@/store/project';
import { useBudget } from '@/store/budget';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import CustomSelect from '@/components/CustomSelect';
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
import { useInstitutions } from '@/hooks/useInstitutions';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

const ENTRY_KIND_LABEL: Record<string, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
  card_payment: '카드대금 결제',
  adjustment: '잔액 조정',
};






export default function TransactionsPage() {
  const { isAuthenticated, loadUser, user, defaultProjectData } = useAuth();
  const { selectedPersonIds, setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
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
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
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
  const [formData, setFormData] = useState({
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
    date: new Date().toISOString().split('T')[0],
    time: '',
    isFixed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * 수정 중인 거래가 이미 결제된 청구서에 포함되어 있으면 그 청구 기간.
   *
   * 금액·결제수단은 잠그되, 날짜는 이 기간 안에서 고칠 수 있게 둔다.
   * 같은 청구서에 머무르면 청구액이 달라지지 않으므로 오타 정정에 문제가 없다.
   */
  const [lockedPeriod, setLockedPeriod] = useState<{ start: string; end: string } | null>(null);

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
        setCards(cardsData || []);
        setCategories(categoriesData || []);

        // 초기 월 설정. 거래는 아래 월별 useEffect가 불러온다.
        const today = new Date();
        setDisplayEntries([]);
        setCurrentMonth(today.getMonth() + 1);
        setCurrentYear(today.getFullYear());
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router, selectedProjectId, defaultProjectData]);

  useEffect(() => {
    if (selectedProjectId && currentYear && currentMonth) {
      fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId);
    }
  }, [selectedProjectId, currentYear, currentMonth, fetchMonthlyBudgets]);

  /**
   * 표시 중인 달의 거래와 합계를 가져온다.
   *
   * 예전에는 거래 전량을 받아 브라우저에서 월별로 나누고 합산했다.
   * 이제 조회 범위도 합계도 서버가 처리한다.
   */
  const reloadMonth = useCallback(async () => {
    if (!selectedProjectId || !currentYear || !currentMonth) return;

    const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const monthStart = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
    const monthEnd = new Date(Date.UTC(currentYear, currentMonth, 0));

    const [entriesRes, summaryRes] = await Promise.all([
      apiClient.getEntries(
        { startDate: monthStart.toISOString(), endDate: monthEnd.toISOString(), limit: 200 },
        selectedProjectId,
      ),
      apiClient.getSummary(yearMonth, selectedProjectId),
    ]);

    setEntries(entriesRes?.data ?? []);
    setSummary(summaryRes ?? { income: '0', expense: '0' });
  }, [selectedProjectId, currentYear, currentMonth]);

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

  // 사람 필터만 클라이언트에서 건다 (이미 이 달 것만 받아 왔다).
  // 카드대금 결제는 소비가 아니므로 목록에서 뺀다.
  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) => entry.kind !== 'card_payment' && selectedPersonIds.includes(entry.personId),
      ),
    [entries, selectedPersonIds],
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

    try {
      setIsSubmitting(true);
      let dateValue = formData.date;
      if (formData.time) {
        const dateObj = new Date(`${formData.date}T${formData.time}`);
        dateValue = dateObj.toISOString();
      } else {
        const dateObj = new Date(formData.date);
        dateValue = dateObj.toISOString();
      }

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
        fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId);
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
        date: new Date().toISOString().split('T')[0],
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
      date: new Date().toISOString().split('T')[0],
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

  /** 자정이면 사용자가 시간을 비워둔 것이므로 빈 값으로 되돌린다. */
  const extractTime = (isoDate: string) => {
    const date = new Date(isoDate);
    if (date.getHours() === 0 && date.getMinutes() === 0) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  /** 로컬 날짜 기준 YYYY-MM-DD. toISOString은 UTC라 하루 밀릴 수 있다. */
  const toDateInput = (isoDate: string) => {
    const date = new Date(isoDate);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
            start: toDateInput(entry.statementPeriodStart),
            end: toDateInput(entry.statementPeriodEnd),
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
      date: toDateInput(entry.date),
      time: extractTime(entry.date),
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

      const isoDate = cardFormData.expiryDate ? new Date(cardFormData.expiryDate).toISOString() : undefined;
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

      await fetchMonthlyBudgets(currentYear, currentMonth, selectedProjectId);
      setShowDetailBudgetModal(false);
    } catch (err: any) {
      setDetailBudgetError(err.message || '저장에 실패했습니다.');
    } finally {
      setDetailBudgetSubmitting(false);
    }
  };

  const getCategoryIcon = (categoryId?: string) => {
    if (!categoryId) return null;
    const category = categories.find((c) => c.id === categoryId);
    return category ? '📁' : null;
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
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              거래 추가
            </button>
          </>
        }
      />

      <div>
        {viewType === 'budget' ? (
          // 예산 뷰
          monthlyBudgets.length === 0 ? (
            <p className="text-gray-600">설정된 예산이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 p-6">
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

                <div className="space-y-2">
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
                                icon={budgetType === 'income' ? '💰' : '💸'}
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
                                isChild={false}
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
                                          icon={getCategoryIcon(mainBudget.categoryId)}
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
                                          isChild={false}
                                        />
                                      );
                                    })()}

                                    {/* 대분류 펼침 시 소분류 표시 */}
                                    {mainBudget.hasChildren && isMainExpanded && (
                                      <div className="bg-blue-50 border-l-2 border-blue-200 pl-2">
                                        {subBudgets.map((subBudget) => {
                                          const subCategoryName = subBudget.categoryName || getCategoryName(subBudget.categoryId);
                                          return (
                                            <BudgetCard
                                              key={subBudget.budgetId}
                                              categoryId={subBudget.categoryId}
                                              categoryName={subCategoryName}
                                              icon={getCategoryIcon(subBudget.categoryId)}
                                              monthlyAmount={subBudget.monthlyAmount}
                                              usedAmount={subBudget.usedAmount || 0}
                                              onSelect={(id) => {
                                                setSelectedCategoryId(id);
                                              }}
                                              hasChildren={false}
                                              isChild={true}
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
                                icon={getCategoryIcon(mainBudget.categoryId)}
                                monthlyAmount={mainBudget.monthlyAmount}
                                usedAmount={mainBudget.usedAmount || 0}
                                hasChildren={mainBudget.hasChildren}
                                isExpanded={isMainExpanded}
                                onToggleExpand={() => {
                                  if (mainBudget.categoryId) {
                                    toggleBudgetExpanded(mainBudget.categoryId);
                                  }
                                }}
                                isChild={false}
                              />

                              {mainBudget.hasChildren && isMainExpanded && (
                                <div className="bg-blue-50 border-l-2 border-blue-200 pl-2">
                                  {subBudgets.map((subBudget) => (
                                    <BudgetCard
                                      key={subBudget.budgetId}
                                      categoryName={subBudget.categoryName || getCategoryName(subBudget.categoryId)}
                                      icon={getCategoryIcon(subBudget.categoryId)}
                                      monthlyAmount={subBudget.monthlyAmount}
                                      usedAmount={subBudget.usedAmount || 0}
                                      hasChildren={false}
                                      isChild={true}
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
                  />
                </div>
              )}
            </div>
          )
        ) : isLoading ? (
          <p className="text-gray-600">로딩 중...</p>
        ) : entries.length === 0 ? (
          <p className="text-gray-600">거래가 없습니다.</p>
        ) : viewType === 'payment-method' ? (
          <PaymentMethodTab
            currentMonth={currentMonth}
            currentYear={currentYear}
            projectId={selectedProjectId}
          />
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
      >
        <form onSubmit={handleSubmit} className="space-y-4">
              {lockedPeriod && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
                  이미 결제한 청구서({lockedPeriod.start} ~ {lockedPeriod.end})에 포함된 내역입니다.
                  금액과 결제수단은 바꿀 수 없고, 날짜는 이 청구 기간 안에서만 고칠 수 있습니다.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  수단 선택
                </label>
                <div className="flex gap-4 mb-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="account"
                      checked={formData.method === 'account'}
                      disabled={Boolean(lockedPeriod)}
                      onChange={(e) => setFormData({ ...formData, method: e.target.value as any, accountId: '', cardId: '' })}
                      className="mr-2"
                    />
                    <span className="text-sm">계좌</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="card"
                      checked={formData.method === 'card'}
                      disabled={Boolean(lockedPeriod)}
                      onChange={(e) => setFormData({ ...formData, method: 'card', type: 'expense', mainCategoryId: '', subCategoryId: '', accountId: '', cardId: '' })}
                      className="mr-2"
                    />
                    <span className="text-sm">카드</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.method === 'account' ? '계좌' : '카드'}
                </label>
                {formData.method === 'account' ? (
                  <CustomSelect
                    options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
                    value={formData.accountId}
                    onChange={(value) => setFormData({ ...formData, accountId: value })}
                    placeholder="선택하세요"
                    disabled={Boolean(lockedPeriod)}
                    onAddClick={() => setIsAccountModalOpen(true)}
                    addButtonLabel="계좌 추가"
                  />
                ) : (
                  <CustomSelect
                    options={cards.map((card) => ({
                      id: card.id,
                      name: `${card.name} (${card.issuer?.name})`,
                    }))}
                    value={formData.cardId}
                    onChange={(value) => setFormData({ ...formData, cardId: value })}
                    placeholder="선택하세요"
                    disabled={Boolean(lockedPeriod)}
                    onAddClick={() => setIsCardModalOpen(true)}
                    addButtonLabel="카드 추가"
                  />
                )}
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  유형
                </label>
                <CustomSelect
                  options={
                    formData.method === 'card'
                      ? [{ id: 'expense', name: '지출' }]
                      : [
                          { id: 'expense', name: '지출' },
                          { id: 'income', name: '수입' },
                          { id: 'transfer', name: '이체' },
                        ]
                  }
                  disabled={Boolean(lockedPeriod)}
                  value={formData.type}
                  onChange={(value) => setFormData({
                    ...formData,
                    type: value as any,
                    mainCategoryId: '',
                    subCategoryId: '',
                  })}
                  placeholder="선택하세요"
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
                        const selectedCategory = categories.find((c) => c.id === value);
                        setFormData({
                          ...formData,
                          subCategoryId: value,
                          isFixed: selectedCategory?.defaultIsFixed || false,
                    });
                  }}
                  placeholder="없음"
                  onAddClick={() => router.push('/dashboard/categories')}
                  addButtonLabel="소분류 추가"
                />
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
                          onChange={(value) => setFormData({ ...formData, transferFeeMainCategoryId: value, transferFeeSubCategoryId: '' })}
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
                          onChange={(value) => setFormData({ ...formData, transferFeeSubCategoryId: value })}
                          placeholder="없음"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  금액 (원)
                </label>
                <input
                  type="number"
                  required
                  value={formData.amount}
                  disabled={Boolean(lockedPeriod)}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${Boolean(lockedPeriod) ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  placeholder="50000"
                />
              </div>

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

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isFixed"
                  checked={formData.isFixed}
                  onChange={(e) => setFormData({ ...formData, isFixed: e.target.checked })}
                  className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
                />
                <label htmlFor="isFixed" className="text-sm font-medium text-gray-700">
                  고정 지출/수입
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  날짜
                </label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  // 결제된 청구서에 속하면 그 청구 기간 밖으로는 못 나간다
                  min={lockedPeriod?.start}
                  max={lockedPeriod?.end}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  시간 (선택)
                </label>
                <input
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
                  {error}
                </div>
              )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        </form>
      </Modal>

      {/* 상세 분석에서 여는 예산 입력. 분류가 정해져 있으므로 금액만 받는다. */}
      <Modal
        isOpen={showDetailBudgetModal}
        onClose={() => setShowDetailBudgetModal(false)}
        title={`${selectedCategoryLabel} 예산`}
      >
        <form onSubmit={handleDetailBudgetSubmit} className="space-y-4">
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

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={() => setShowDetailBudgetModal(false)}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              취소
            </button>
            <button
              type="submit"
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
      >
        <form onSubmit={handleCardSubmit} className="space-y-4">
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
              만료일 (선택)
            </label>
            <input
              type="date"
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
                  마감일 (매월 몇 일?)
                </label>
                <select
                  value={cardFormData.statementClosingDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>{day}일</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제일 (매월 몇 일?)
                </label>
                <select
                  value={cardFormData.paymentDueDay}
                  onChange={(e) =>
                    setCardFormData({ ...cardFormData, paymentDueDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>{day}일</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={cardSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {cardSubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        title="카테고리 추가"
      >
        <form onSubmit={handleCategorySubmit} className="space-y-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              소분류 (선택)
            </label>
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

          <button
            type="submit"
            disabled={categorySubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {categorySubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="거래 상세내역"
      >
        {selectedTransaction && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
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
                {new Date(selectedTransaction.date).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  ...(extractTime(selectedTransaction.date)
                    ? { hour: '2-digit', minute: '2-digit' }
                    : {}),
                })}
              </p>
            </div>

            <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
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
          </div>
        )}
      </Modal>

    </>
  );
}
