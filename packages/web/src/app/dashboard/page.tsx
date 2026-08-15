'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import TransactionCalendar from '@/components/TransactionCalendar';
import TransactionListView from '@/components/TransactionListView';
import MonthHeader from '@/components/MonthHeader';
import AddAccountModal from '@/components/AddAccountModal';
import PersonModal from '@/components/PersonModal';
import TransactionItem from '@/components/TransactionItem';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
  isFixed?: boolean;
}

interface Account {
  id: string;
  name: string;
}

interface Person {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  level: number;
  parentId?: string | null;
  defaultIsFixed?: boolean;
  isDefault?: boolean;
}

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardType: 'debit' | 'credit';
  issuer: string;
}

export default function TransactionsPage() {
  const { isAuthenticated, loadUser, user, defaultProjectData } = useAuth();
  const { selectedPersonIds, setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [displayTransactions, setDisplayTransactions] = useState<Transaction[]>([]);
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [viewType, setViewType] = useState<'calendar' | 'list'>('calendar');
  const dateTransactionsRef = useRef<HTMLDivElement>(null);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [accountFormData, setAccountFormData] = useState({
    ownerId: '',
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
  });
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [cardFormData, setCardFormData] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit',
    issuer: '',
    expiryDate: '',
    creditLimit: '',
  });
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    type: 'expense',
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
    date: new Date().toISOString().split('T')[0],
    time: '',
    isFixed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const initializeProject = async () => {
      await loadUser();

      // 프로젝트 목록 불러오기
      try {
        const projects = await apiClient.getMyProjects();
        if (projects && projects.length > 0 && !selectedProjectId) {
          // 첫 번째 프로젝트 자동 선택
          const { setSelectedProjectId } = useProject.getState();
          setSelectedProjectId(projects[0].id);
        }
      } catch (err) {
        console.error('프로젝트 로드 실패:', err);
      }
    };

    initializeProject();
  }, [loadUser, selectedProjectId]);

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

        // defaultProjectData가 현재 프로젝트와 일치하면 캐시 사용
        const isCached = defaultProjectData?.project?.id === selectedProjectId;

        let transactionsData, accountsData, peopleData, cardsData, categoriesData;

        if (isCached) {
          // 캐시된 데이터 활용 (API 호출 제거)
          console.log('[Dashboard] ✅ Using cached data for project:', selectedProjectId);
          transactionsData = { data: defaultProjectData.recentTransactions || [] };
          accountsData = defaultProjectData.accounts || [];
          peopleData = defaultProjectData.people || [];
          cardsData = defaultProjectData.cards || [];
          categoriesData = defaultProjectData.categories || [];
        } else {
          // 캐시가 없으면 API 호출
          console.log('[Dashboard] 📡 Fetching data for project:', selectedProjectId);
          const results = await Promise.all([
            apiClient.getTransactionsV2({}, selectedProjectId),
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
            apiClient.getCategories(selectedProjectId),
          ]);
          transactionsData = results[0];
          accountsData = results[1];
          peopleData = results[2];
          cardsData = results[3];
          categoriesData = results[4];
        }

        const txs = (transactionsData?.data || []).map((tx: any) => ({
          ...tx,
          mainCategory: typeof tx.mainCategory === 'object' ? tx.mainCategory?.name : tx.mainCategory,
          subCategory: typeof tx.subCategory === 'object' ? tx.subCategory?.name : tx.subCategory,
        }));
        setTransactions(txs);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);

        // 초기 월 설정
        const today = new Date();
        const thisMonth = today.getMonth() + 1;
        const thisYear = today.getFullYear();
        setDisplayTransactions([]);
        setCurrentMonth(thisMonth);
        setCurrentYear(thisYear);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router, selectedProjectId, defaultProjectData]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      return selectedPersonIds.includes(tx.personId || '');
    });
  }, [transactions, selectedPersonIds]);

  const currentMonthTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = new Date(tx.date);
      return txDate.getFullYear() === currentYear && txDate.getMonth() + 1 === currentMonth;
    });
  }, [transactions, currentMonth, currentYear]);

  const monthlyTotals = useMemo(() => {
    let incomeTotal = 0;
    let expenseTotal = 0;

    currentMonthTransactions.forEach((tx) => {
      if (tx.type === 'income') {
        incomeTotal += tx.amount;
      } else if (tx.type === 'expense') {
        expenseTotal += tx.amount;
      }
    });

    return { incomeTotal, expenseTotal };
  }, [currentMonthTransactions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      if (editingId) {
        let cardId: string | undefined = undefined;
        if (formData.method === 'card' && formData.cardId) {
          cardId = formData.cardId;
        }

        await apiClient.updateTransaction(editingId, {
          type: formData.type,
          amount: parseInt(formData.amount),
          description: formData.description,
          date: dateValue,
          personId: formData.personId,
          cardId,
          mainCategoryId: formData.mainCategoryId,
          subCategoryId: formData.subCategoryId || undefined,
          isFixed: formData.isFixed,
        });
      } else {
        let accountId = formData.accountId;
        if (formData.method === 'card' && formData.cardId) {
          const selectedCard = cards.find((c) => c.id === formData.cardId);
          accountId = selectedCard?.accountId || formData.accountId;
        }

        await apiClient.createTransactionV2({
          accountId,
          personId: formData.personId,
          type: formData.type,
          amount: parseInt(formData.amount),
          description: formData.description,
          date: dateValue,
          mainCategoryId: formData.mainCategoryId,
          subCategoryId: formData.subCategoryId || undefined,
          cardId: formData.method === 'card' ? formData.cardId || undefined : undefined,
          isFixed: formData.isFixed,
        });
      }
      const data = await apiClient.getTransactionsV2();
      setTransactions(data?.data || []);
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
        date: new Date().toISOString().split('T')[0],
        time: '',
        isFixed: false,
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
      date: new Date().toISOString().split('T')[0],
      time: '',
      isFixed: false,
    });
    setEditingId(null);
    setError('');
  };

  const handleTransactionClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDetailModalOpen(true);
  };

  const handleCalendarDateSelect = (clickedDate: Date, dayTransactions: Transaction[]) => {
    if (startDate &&
        clickedDate.getFullYear() === startDate.getFullYear() &&
        clickedDate.getMonth() === startDate.getMonth() &&
        clickedDate.getDate() === startDate.getDate()
    ) {
      setStartDate(null);
      setDisplayTransactions([]);
    } else {
      setStartDate(clickedDate);
      setDisplayTransactions(dayTransactions);
    }

    setTimeout(() => {
      dateTransactionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const handleMonthChange = (year: number, month: number) => {
    setCurrentYear(year);
    setCurrentMonth(month);
    setStartDate(null);
    setDisplayTransactions([]);
  };

  const handleDetailEditClick = () => {
    if (!selectedTransaction) return;
    setEditingId(selectedTransaction.id);
    const method = selectedTransaction.cardId ? 'card' : 'account';
    setFormData({
      method,
      accountId: selectedTransaction.accountId || '',
      cardId: selectedTransaction.cardId || '',
      personId: selectedTransaction.personId || '',
      type: selectedTransaction.type as any,
      mainCategoryId: selectedTransaction.mainCategoryId || '',
      subCategoryId: selectedTransaction.subCategoryId || '',
      amount: selectedTransaction.amount.toString(),
      description: selectedTransaction.description || '',
      date: selectedTransaction.date.split('T')[0],
      time: '',
      isFixed: selectedTransaction.isFixed || false,
    });
    setIsDetailModalOpen(false);
    setIsModalOpen(true);
    setError('');
  };

  const handleEditClick = (transaction: Transaction) => {
    setEditingId(transaction.id);
    const method = transaction.cardId ? 'card' : 'account';
    setFormData({
      method,
      accountId: transaction.accountId || '',
      cardId: transaction.cardId || '',
      personId: transaction.personId || '',
      type: transaction.type as any,
      mainCategoryId: transaction.mainCategoryId || '',
      subCategoryId: transaction.subCategoryId || '',
      amount: transaction.amount.toString(),
      description: transaction.description || '',
      date: transaction.date.split('T')[0],
      time: '',
      isFixed: transaction.isFixed || false,
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteTransaction(id);
      const data = await apiClient.getTransactionsV2();
      setTransactions(data?.data || []);
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
      const isoDate = cardFormData.expiryDate ? new Date(cardFormData.expiryDate).toISOString() : undefined;
      await apiClient.createCard({
        accountId: cardFormData.accountId,
        name: cardFormData.name,
        ...(cardFormData.cardNumber && { cardNumber: cardFormData.cardNumber }),
        cardType: cardFormData.cardType,
        issuer: cardFormData.issuer,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: cardFormData.cardType === 'credit' ? parseInt(cardFormData.creditLimit) : undefined,
      });
      const data = await apiClient.getCards();
      setCards(data || []);
      setCardFormData({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuer: '',
        expiryDate: '',
        creditLimit: '',
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
        color: categoryFormData.color || undefined,
      });
      const categoryList = await apiClient.getCategories();
      const mainCategory = categoryList?.find((c: Category) => c.name === categoryFormData.name && c.level === 1);

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

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">거래 기록</h1>
        <div className="flex gap-3">
          <div className="flex gap-2 bg-gray-200 rounded-lg p-1">
            <button
              onClick={() => setViewType('calendar')}
              className={`px-4 py-2 rounded-md font-medium transition ${
                viewType === 'calendar'
                  ? 'bg-white text-blue-600 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              달력
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`px-4 py-2 rounded-md font-medium transition ${
                viewType === 'list'
                  ? 'bg-white text-blue-600 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              리스트
            </button>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            거래 추가
          </button>
        </div>
      </div>

      <div>
        {isLoading ? (
          <p className="text-gray-600">로딩 중...</p>
        ) : transactions.length === 0 ? (
          <p className="text-gray-600">거래가 없습니다.</p>
        ) : viewType === 'calendar' ? (
          <div>
            <MonthHeader
              year={currentYear}
              month={currentMonth}
              incomeTotal={monthlyTotals.incomeTotal}
              expenseTotal={monthlyTotals.expenseTotal}
              onPrevMonth={() => {
                const newMonth = currentMonth === 1 ? 12 : currentMonth - 1;
                const newYear = currentMonth === 1 ? currentYear - 1 : currentYear;
                setCurrentYear(newYear);
                setCurrentMonth(newMonth);
                setStartDate(null);
                setDisplayTransactions([]);
              }}
              onNextMonth={() => {
                const newMonth = currentMonth === 12 ? 1 : currentMonth + 1;
                const newYear = currentMonth === 12 ? currentYear + 1 : currentYear;
                setCurrentYear(newYear);
                setCurrentMonth(newMonth);
                setStartDate(null);
                setDisplayTransactions([]);
              }}
            />
            <TransactionCalendar
              transactions={filteredTransactions}
              onDateSelect={handleCalendarDateSelect}
              onMonthChange={handleMonthChange}
              startDate={startDate}
              endDate={endDate}
            />

            {displayTransactions.length > 0 && (
              <div ref={dateTransactionsRef} className="mt-8">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  {endDate
                    ? `${startDate?.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}의 거래`
                    : startDate
                    ? `${startDate.toISOString().split('T')[0]}의 거래`
                    : `${currentYear}년 ${currentMonth}월의 거래`}
                </h3>
                <div className="space-y-2">
                  {displayTransactions.map((tx) => (
                    <TransactionItem
                      key={tx.id}
                      id={tx.id}
                      description={tx.description}
                      amount={tx.amount}
                      type={tx.type}
                      date={tx.date}
                      mainCategory={tx.mainCategory}
                      subCategory={tx.subCategory}
                      onClick={() => handleTransactionClick(tx)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <MonthHeader
              year={currentYear}
              month={currentMonth}
              incomeTotal={monthlyTotals.incomeTotal}
              expenseTotal={monthlyTotals.expenseTotal}
              onPrevMonth={() => {
                const newMonth = currentMonth === 1 ? 12 : currentMonth - 1;
                const newYear = currentMonth === 1 ? currentYear - 1 : currentYear;
                setCurrentYear(newYear);
                setCurrentMonth(newMonth);
              }}
              onNextMonth={() => {
                const newMonth = currentMonth === 12 ? 1 : currentMonth + 1;
                const newYear = currentMonth === 12 ? currentYear + 1 : currentYear;
                setCurrentYear(newYear);
                setCurrentMonth(newMonth);
              }}
            />
            {currentMonthTransactions.length > 0 ? (
              <TransactionListView
                transactions={currentMonthTransactions}
                onTransactionClick={handleTransactionClick}
              />
            ) : (
              <p className="text-gray-600">이 달에 거래가 없습니다.</p>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? '거래 수정' : '거래 추가'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
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
                      onChange={(e) => setFormData({ ...formData, method: e.target.value as any, accountId: '', cardId: '' })}
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
                    onAddClick={() => setIsAccountModalOpen(true)}
                    addButtonLabel="계좌 추가"
                  />
                ) : (
                  <CustomSelect
                    options={cards.map((card) => ({
                      id: card.id,
                      name: `${card.name} (${card.issuer})`,
                    }))}
                    value={formData.cardId}
                    onChange={(value) => setFormData({ ...formData, cardId: value })}
                    placeholder="선택하세요"
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
                  options={[
                    { id: 'expense', name: '지출' },
                    { id: 'income', name: '수입' },
                    { id: 'transfer', name: '이체' },
                  ]}
                  value={formData.type}
                  onChange={(value) => setFormData({ ...formData, type: value as any, mainCategoryId: '', subCategoryId: '' })}
                  placeholder="선택하세요"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  대분류
                </label>
                <CustomSelect
                  options={categories
                    .filter((c) => c.level === 1 && c.type === formData.type)
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
                              c.level === 2 &&
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  금액 (원)
                </label>
                <input
                  type="number"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명 (선택)
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="거래 설명 (선택사항)"
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
              onChange={(value) => setCardFormData({ ...cardFormData, cardType: value })}
              placeholder="선택하세요"
              onAddClick={() => {}}
              addButtonLabel=""
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              발급사
            </label>
            <input
              type="text"
              required
              value={cardFormData.issuer}
              onChange={(e) => setCardFormData({ ...cardFormData, issuer: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="KB Bank, Samsung Card 등"
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
                {people.find(p => p.id === selectedTransaction.personId)?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.type === 'income' ? '수입' : selectedTransaction.type === 'expense' ? '지출' : '이체'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                대분류
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedTransaction.mainCategoryId
                  ? categories.find(c => c.id === selectedTransaction.mainCategoryId)?.name || '-'
                  : '-'}
              </p>
            </div>

            {selectedTransaction.subCategoryId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소분류
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {categories.find(c => c.id === selectedTransaction.subCategoryId)?.name || '-'}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                금액
              </label>
              <p className={`px-3 py-2 bg-gray-50 rounded-lg text-lg font-bold ${
                selectedTransaction.type === 'income' ? 'text-green-600' : 'text-red-600'
              }`}>
                {selectedTransaction.type === 'income' ? '+' : '-'}
                {new Intl.NumberFormat('ko-KR', {
                  style: 'currency',
                  currency: 'KRW',
                }).format(selectedTransaction.amount)}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                날짜
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {new Date(selectedTransaction.date).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>

            <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
              <button
                onClick={handleDetailEditClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                수정하기
              </button>
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
          </div>
        )}
      </Modal>

    </>
  );
}
