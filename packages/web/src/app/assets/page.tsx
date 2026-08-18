'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useUserFilter } from '@/store/user-filter';
import { useProject } from '@/store/project';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';

interface Person {
  id: string;
  name: string;
  relationship?: string | null;
}

interface Account {
  id: string;
  ownerId: string;
  name: string;
  balance: number;
  bankName: string;
  currency: string;
  accountNumber?: string;
  owner: Person;
}

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardType: 'debit' | 'credit';
  issuer: string;
  cardNumberMasked: string;
  creditLimit?: number;
  currentBalance?: number;
  expiryDate?: string;
  billingDayOfMonth?: number;
}

interface CardPayment {
  id: string;
  totalAmount: number;
  paidAmount: number;
  status: 'pending' | 'completed';
  paymentDate: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedPersonIds, setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [detailType, setDetailType] = useState<'person' | 'account' | 'card' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [personModalMode, setPersonModalMode] = useState<'view' | 'edit'>('view');
  const [isEditAccountModalOpen, setIsEditAccountModalOpen] = useState(false);
  const [isEditCardModalOpen, setIsEditCardModalOpen] = useState(false);

  const [addType, setAddType] = useState<'select' | 'card' | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isPersonAddModalOpen, setIsPersonAddModalOpen] = useState(false);
  const [cardForm, setCardForm] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit' as 'debit' | 'credit',
    issuer: '',
    expiryDate: '',
    creditLimit: '',
    billingDayOfMonth: 1,
  });
  const [addError, setAddError] = useState('');

  const [editPersonForm, setEditPersonForm] = useState({ name: '', relationship: '' });
  const [editAccountForm, setEditAccountForm] = useState({
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
  });
  const [editCardForm, setEditCardForm] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    issuer: '',
    expiryDate: '',
    creditLimit: '',
  });
  const [cardPayment, setCardPayment] = useState<CardPayment | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    paymentType: 'full' as 'full' | 'partial',
    amount: '',
  });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);

  const [accountTransactions, setAccountTransactions] = useState<any[]>([]);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [transactionFormData, setTransactionFormData] = useState({
    method: 'account',
    personId: '',
    type: 'expense',
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    description: '',
    merchant: '',
    detailedNote: '',
    date: new Date().toISOString().split('T')[0],
    isFixed: false,
  });
  const [transactionSubmitting, setTransactionSubmitting] = useState(false);
  const [transactionError, setTransactionError] = useState('');

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
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
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [selectedProjectId]);

  // 계좌의 거래 내역 조회
  const loadAccountTransactions = useCallback(async (accountId: string) => {
    try {
      const response = await apiClient.getTransactionsV2({ accountId }, selectedProjectId);
      const txs = (response?.data || []).map((tx: any) => ({
        ...tx,
        mainCategory: typeof tx.mainCategory === 'object' ? tx.mainCategory?.name : tx.mainCategory,
        subCategory: typeof tx.subCategory === 'object' ? tx.subCategory?.name : tx.subCategory,
      }));
      setAccountTransactions(txs);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
      setAccountTransactions([]);
    }
  }, [selectedProjectId]);

  // 카드 선택 시 미납액 조회
  const loadCardPayment = useCallback(async (cardId: string) => {
    try {
      console.log('[loadCardPayment] Loading payment for card:', cardId);
      const response = await apiClient.getPendingCardPayments(selectedProjectId, cardId);
      console.log('[loadCardPayment] Response:', response);
      const payments = response?.data || [];
      console.log('[loadCardPayment] Payments:', payments);
      if (payments.length > 0) {
        console.log('[loadCardPayment] Setting cardPayment:', payments[0]);
        setCardPayment(payments[0]); // 가장 가까운 결제일 기준
      } else {
        console.log('[loadCardPayment] No payments found');
        setCardPayment(null);
      }
    } catch (err) {
      console.error('[loadCardPayment] Error:', err);
      setCardPayment(null);
    }
  }, [selectedProjectId]);

  // 계좌 선택 시 거래 내역 로드
  useEffect(() => {
    if (selectedAccount && detailType === 'account') {
      loadAccountTransactions(selectedAccount.id);
    } else {
      setAccountTransactions([]);
    }
  }, [selectedAccount, detailType, loadAccountTransactions]);

  // 카드 선택 시 미납액 로드
  useEffect(() => {
    if (selectedCard && detailType === 'card') {
      loadCardPayment(selectedCard.id);
    } else {
      setCardPayment(null);
    }
  }, [selectedCard, detailType, loadCardPayment]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => selectedPersonIds.includes(acc.owner?.id || ''));
  }, [accounts, selectedPersonIds]);

  const filteredCards = useMemo(() => {
    const userAccountIds = filteredAccounts.map((acc) => acc.id);
    return cards.filter((card) => userAccountIds.includes(card.accountId));
  }, [cards, filteredAccounts]);

  const getAccountCards = (accountId: string) =>
    filteredCards.filter((c) => c.accountId === accountId);

  const handleDeletePerson = async () => {
    if (!selectedPerson || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deletePerson(selectedPerson.id);
      const peopleData = await apiClient.getPeople();
      setPeople(peopleData || []);
      setDetailType(null);
      setSelectedPerson(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteAccountV2(selectedAccount.id);
      const accountsData = await apiClient.getAccountsV2();
      setAccounts(accountsData || []);
      setDetailType(null);
      setSelectedAccount(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!selectedCard || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteCard(selectedCard.id);
      const cardsData = await apiClient.getCards();
      setCards(cardsData || []);
      setDetailType(null);
      setSelectedCard(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;

    try {
      setTransactionSubmitting(true);
      setTransactionError('');

      let dateValue = transactionFormData.date;
      const dateObj = new Date(transactionFormData.date);
      dateValue = dateObj.toISOString();

      const payload: any = {
        accountId: selectedAccount.id,
        personId: transactionFormData.personId,
        type: transactionFormData.type,
        amount: parseInt(transactionFormData.amount),
        description: transactionFormData.description,
        date: dateValue,
        mainCategoryId: transactionFormData.mainCategoryId,
        subCategoryId: transactionFormData.subCategoryId || undefined,
        isFixed: transactionFormData.isFixed,
      };

      if (transactionFormData.merchant) payload.merchant = transactionFormData.merchant;
      if (transactionFormData.detailedNote) payload.detailedNote = transactionFormData.detailedNote;

      await apiClient.createTransactionV2(payload);

      // 거래 내역 다시 로드
      await loadAccountTransactions(selectedAccount.id);

      // 폼 초기화
      setTransactionFormData({
        method: 'account',
        personId: '',
        type: 'expense',
        mainCategoryId: '',
        subCategoryId: '',
        amount: '',
        description: '',
        merchant: '',
        detailedNote: '',
        date: new Date().toISOString().split('T')[0],
        isFixed: false,
      });
      setIsTransactionModalOpen(false);
    } catch (err: any) {
      setTransactionError(err?.response?.data?.error?.message || '거래 추가에 실패했습니다.');
    } finally {
      setTransactionSubmitting(false);
    }
  };

  // 카드 결제 실행
  const handlePayCard = async () => {
    if (!cardPayment || !selectedCard) return;

    try {
      setIsPaymentSubmitting(true);
      const paymentAmount = paymentForm.paymentType === 'full'
        ? cardPayment.totalAmount - cardPayment.paidAmount
        : parseInt(paymentForm.amount);

      await apiClient.payCardPayment(cardPayment.id, {
        amount: paymentAmount,
      });

      alert('결제가 완료되었습니다.');
      setIsPaymentModalOpen(false);
      setPaymentForm({ paymentType: 'full', amount: '' });

      // 미납액 다시 로드
      await loadCardPayment(selectedCard.id);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '결제에 실패했습니다.');
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');
      const isoDate = cardForm.expiryDate ? new Date(cardForm.expiryDate).toISOString() : undefined;
      await apiClient.createCard({
        accountId: cardForm.accountId,
        name: cardForm.name,
        cardNumber: cardForm.cardNumber || undefined,
        cardType: cardForm.cardType,
        issuer: cardForm.issuer,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit:
          cardForm.cardType === 'credit' ? parseInt(cardForm.creditLimit) : undefined,
        billingDayOfMonth:
          cardForm.cardType === 'credit' ? cardForm.billingDayOfMonth : undefined,
      });
      const cardsData = await apiClient.getCards();
      setCards(cardsData || []);
      setCardForm({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuer: '',
        expiryDate: '',
        creditLimit: '',
        billingDayOfMonth: 1,
      });
      setAddType(null);
    } catch (err: any) {
      setAddError(err?.response?.data?.error?.message || '카드 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditPersonClick = () => {
    setPersonModalMode('edit');
    setPersonModalOpen(true);
  };

  const handleSavePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) return;
    try {
      setIsSubmitting(true);
      await apiClient.updatePerson(selectedPerson.id, {
        name: editPersonForm.name,
        relationship: editPersonForm.relationship || undefined,
      });
      const peopleData = await apiClient.getPeople();
      setPeople(peopleData || []);
      const updatedPerson = peopleData?.find((p: Person) => p.id === selectedPerson.id);
      if (updatedPerson) setSelectedPerson(updatedPerson);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditAccountClick = () => {
    setIsEditAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    try {
      setIsSubmitting(true);
      await apiClient.updateAccountV2(selectedAccount.id, {
        name: editAccountForm.name,
        balance: parseInt(editAccountForm.balance),
        bankName: editAccountForm.bankName,
        accountNumber: editAccountForm.accountNumber || undefined,
      });
      const accountsData = await apiClient.getAccountsV2();
      setAccounts(accountsData || []);
      const updatedAccount = accountsData?.find((a: Account) => a.id === selectedAccount.id);
      if (updatedAccount) setSelectedAccount(updatedAccount);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCardClick = () => {
    setIsEditCardModalOpen(true);
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    try {
      setIsSubmitting(true);
      await apiClient.updateCard(selectedCard.id, {
        name: editCardForm.name,
        issuer: editCardForm.issuer,
        creditLimit: selectedCard.cardType === 'credit' ? parseInt(editCardForm.creditLimit) : undefined,
      });
      const cardsData = await apiClient.getCards();
      setCards(cardsData || []);
      const updatedCard = cardsData?.find((c: Card) => c.id === selectedCard.id);
      if (updatedCard) setSelectedCard(updatedCard);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalBalance = filteredAccounts.reduce((sum, acc) => sum + acc.balance, 0);

  // selectedPersonIds가 없으면 모든 사용자 사용
  const effectivePersonIds = selectedPersonIds.length > 0 ? selectedPersonIds : people.map(p => p.id);
  const displayPeople = people.filter((p) => effectivePersonIds.includes(p.id));

  // 계좌가 없어도 모든 선택된 사용자를 표시
  const allGroupedAccounts = displayPeople.reduce(
    (acc, person) => {
      acc[person.id] = {
        person,
        accounts: filteredAccounts.filter((a) => a.owner.id === person.id),
      };
      return acc;
    },
    {} as Record<string, { person: Person; accounts: Account[] }>
  );

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">자산</h2>
        <button
          onClick={() => setAddType('select')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          추가하기
        </button>
      </div>

      <div className="bg-blue-600 text-white rounded-lg p-8 mb-8">
        <p className="text-sm opacity-90">총 자산</p>
        <p className="text-4xl font-bold mt-2">
          {new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
          }).format(totalBalance)}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded mb-4">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : displayPeople.length === 0 ? (
        <p className="text-gray-600">선택된 사용자가 없습니다.</p>
      ) : detailType === 'account' && selectedAccount ? (
        /* 계좌 선택 상태: 거래 내역 표시 */
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* 헤더: 계좌명 및 버튼 */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">{selectedAccount.name}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditAccountModalOpen(true)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                계좌 상세정보
              </button>
              <button
                onClick={() => setIsTransactionModalOpen(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                거래 추가
              </button>
              <button
                onClick={() => {
                  setDetailType(null);
                  setSelectedAccount(null);
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                닫기
              </button>
            </div>
          </div>

          {/* 거래 내역 */}
          {accountTransactions.length === 0 ? (
            <p className="text-gray-600 text-center py-8">거래 내역이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {accountTransactions.map((tx: any) => (
                <div key={tx.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-bold text-gray-900">{tx.description}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {tx.mainCategory} {tx.subCategory && `> ${tx.subCategory}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(tx.date).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                    <p className={`font-bold text-lg ${
                      tx.type === 'income' ? 'text-green-600' : tx.type === 'transfer' ? 'text-gray-600' : 'text-red-600'
                    }`}>
                      {tx.type === 'transfer'
                        ? new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(tx.amount)
                        : `${tx.type === 'income' ? '+' : '-'}${new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(tx.amount)}`
                      }
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 계좌 미선택: 기존 레이아웃 */
        <div className="space-y-8">
          {Object.entries(allGroupedAccounts).map(([personId, { person, accounts: personAccounts }]) => (
            <div
              key={personId}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md hover:bg-gray-50 transition"
            >
              <button
                onClick={() => {
                  setSelectedPerson(person);
                  setDetailType('person');
                }}
                className="w-full text-left mb-6"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{person.name}</h2>
                    <p className="text-sm text-gray-600">
                      소계: {new Intl.NumberFormat('ko-KR', {
                        style: 'currency',
                        currency: 'KRW',
                      }).format(personAccounts.reduce((sum, acc) => sum + acc.balance, 0))}
                    </p>
                  </div>
                </div>
              </button>

              {personAccounts.length === 0 ? (
                <p className="text-gray-600">등록된 계좌가 없습니다.</p>
              ) : (
                <div className="space-y-4">
                  {personAccounts.map((account) => {
                    const accountCards = getAccountCards(account.id);
                    return (
                      <div
                        key={account.id}
                        className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAccount(account);
                            setDetailType('account');
                          }}
                          className="w-full text-left hover:opacity-70 transition"
                        >
                          <p className="text-sm text-gray-600">{account.bankName}</p>
                          <p className="text-2xl font-bold text-gray-900 mt-2">
                            {new Intl.NumberFormat('ko-KR', {
                              style: 'currency',
                              currency: account.currency,
                            }).format(account.balance)}
                          </p>
                          <p className="text-xs text-gray-500 mt-2">{account.name}</p>
                          {account.accountNumber && (
                            <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
                          )}
                        </button>

                        {accountCards.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                            {accountCards.map((card) => (
                              <button
                                key={card.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCard(card);
                                  setDetailType('card');
                                }}
                                className="w-full text-left px-3 py-2 bg-green-50 rounded border border-green-100 hover:bg-green-100 transition"
                              >
                                <p className="text-sm font-medium text-gray-900">
                                  💳 {card.name}
                                </p>
                                <p className="text-xs text-gray-600">{card.issuer}</p>
                                <p className="text-xs text-gray-600">
                                  {card.cardType === 'debit' ? '체크카드' : '신용카드'}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 거래 추가 팝업 */}
      {isTransactionModalOpen && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsTransactionModalOpen(false);
            setTransactionError('');
          }}
          title="거래 추가"
        >
          <form onSubmit={handleAddTransaction} className="space-y-4 max-h-96 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  사용자
                </label>
                <CustomSelect
                  options={people.map((p) => ({ id: p.id, name: p.name }))}
                  value={transactionFormData.personId}
                  onChange={(value) => setTransactionFormData({ ...transactionFormData, personId: value })}
                  placeholder="선택하세요"
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
                  value={transactionFormData.type}
                  onChange={(value) => setTransactionFormData({ ...transactionFormData, type: value as any, mainCategoryId: '', subCategoryId: '' })}
                  placeholder="선택하세요"
                />
              </div>

              {transactionFormData.type !== 'transfer' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      대분류
                    </label>
                    <CustomSelect
                      options={categories
                        .filter((c) => c.level === 1 && c.type === transactionFormData.type)
                        .map((cat) => ({ id: cat.id, name: cat.name }))}
                      value={transactionFormData.mainCategoryId}
                      onChange={(value) => setTransactionFormData({ ...transactionFormData, mainCategoryId: value, subCategoryId: '' })}
                      placeholder="선택하세요"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      소분류 (선택)
                    </label>
                    <CustomSelect
                      options={
                        transactionFormData.mainCategoryId
                          ? categories
                              .filter(
                                (c) =>
                                  c.level === 2 &&
                                  c.parentId === transactionFormData.mainCategoryId
                              )
                              .map((cat) => ({ id: cat.id, name: cat.name }))
                          : [{ id: '', name: '없음' }]
                      }
                      value={transactionFormData.subCategoryId}
                      onChange={(value) => setTransactionFormData({ ...transactionFormData, subCategoryId: value })}
                      placeholder="없음"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  금액 (원)
                </label>
                <input
                  type="number"
                  required
                  value={transactionFormData.amount}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설명
                </label>
                <input
                  type="text"
                  value={transactionFormData.description}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, description: e.target.value })}
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
                  value={transactionFormData.merchant}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, merchant: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="가맹점, 송금 계좌주 등"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상세설명 (선택)
                </label>
                <input
                  type="text"
                  value={transactionFormData.detailedNote}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, detailedNote: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="추가 설명"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isFixed"
                  checked={transactionFormData.isFixed}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, isFixed: e.target.checked })}
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
                  value={transactionFormData.date}
                  onChange={(e) => setTransactionFormData({ ...transactionFormData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {transactionError && (
                <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
                  {transactionError}
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsTransactionModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={transactionSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {transactionSubmitting ? '추가 중...' : '추가하기'}
                </button>
              </div>
            </form>
          </Modal>
      )}

      {/* 계좌 상세정보 모달 */}
      {isEditAccountModalOpen && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => setIsEditAccountModalOpen(false)}
          title="계좌 상세정보"
        >
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                통장 주인
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.owner?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                계좌명
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                은행
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.bankName}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                잔액
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 font-semibold">
                {new Intl.NumberFormat('ko-KR', {
                  style: 'currency',
                  currency: selectedAccount.currency,
                }).format(selectedAccount.balance)}
              </p>
            </div>

            {selectedAccount.accountNumber && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  계좌번호
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedAccount.accountNumber}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
            <button
              onClick={handleEditAccountClick}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              수정하기
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              삭제하기
            </button>
          </div>
        </Modal>
      )}

      {/* 계좌 미선택: 기존 레이아웃 */}
      {detailType !== 'account' && (
        <div className="space-y-8">
          {Object.entries(allGroupedAccounts).map(([personId, { person, accounts: personAccounts }]) => (
            <div
              key={personId}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md hover:bg-gray-50 transition"
            >
              <button
                onClick={() => {
                  setSelectedPerson(person);
                  setDetailType('person');
                }}
                className="w-full text-left mb-6"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{person.name}</h2>
                    <p className="text-sm text-gray-600">
                      소계: {new Intl.NumberFormat('ko-KR', {
                        style: 'currency',
                        currency: 'KRW',
                      }).format(personAccounts.reduce((sum, acc) => sum + acc.balance, 0))}
                    </p>
                  </div>
                </div>
              </button>

              {personAccounts.length === 0 ? (
                <p className="text-gray-600">등록된 계좌가 없습니다.</p>
              ) : (
                <div className="space-y-4">
                  {personAccounts.map((account) => {
                    const accountCards = getAccountCards(account.id);
                    return (
                      <div
                        key={account.id}
                        className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAccount(account);
                            setDetailType('account');
                          }}
                          className="w-full text-left hover:opacity-70 transition"
                        >
                          <p className="text-sm text-gray-600">{account.bankName}</p>
                          <p className="text-2xl font-bold text-gray-900 mt-2">
                            {new Intl.NumberFormat('ko-KR', {
                              style: 'currency',
                              currency: account.currency,
                            }).format(account.balance)}
                          </p>
                          <p className="text-xs text-gray-500 mt-2">{account.name}</p>
                          {account.accountNumber && (
                            <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
                          )}
                        </button>

                        {accountCards.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                            {accountCards.map((card) => (
                              <button
                                key={card.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCard(card);
                                  setDetailType('card');
                                }}
                                className="w-full text-left px-3 py-2 bg-green-50 rounded border border-green-100 hover:bg-green-100 transition"
                              >
                                <p className="text-sm font-medium text-gray-900">
                                  💳 {card.name}
                                </p>
                                <p className="text-xs text-gray-600">{card.issuer}</p>
                                <p className="text-xs text-gray-600">
                                  {card.cardType === 'debit' ? '체크카드' : '신용카드'}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 계좌 수정 모달 */}
      {isEditAccountModalOpen && selectedAccount && isEditing && (
        <Modal
          isOpen={true}
          onClose={() => setIsEditing(false)}
          title="계좌 수정"
        >
          <form onSubmit={handleSaveAccount} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                통장 주인
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount?.owner?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                계좌명
              </label>
              <input
                type="text"
                required
                value={editAccountForm.name}
                onChange={(e) =>
                  setEditAccountForm({ ...editAccountForm, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                은행명
              </label>
              <input
                type="text"
                required
                value={editAccountForm.bankName}
                onChange={(e) =>
                  setEditAccountForm({ ...editAccountForm, bankName: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                잔액 (원)
              </label>
              <input
                type="number"
                required
                value={editAccountForm.balance}
                onChange={(e) =>
                  setEditAccountForm({ ...editAccountForm, balance: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                계좌번호 (선택)
              </label>
              <input
                type="text"
                value={editAccountForm.accountNumber}
                onChange={(e) =>
                  setEditAccountForm({ ...editAccountForm, accountNumber: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="예: 123-456-7890"
              />
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 구성원 상세정보 모달 */}
      {detailType === 'person' && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedPerson(null);
            setIsEditing(false);
          }}
          title={isEditing ? '구성원 수정' : '구성원 상세정보'}
        >
          {isEditing ? (
            <form onSubmit={handleSavePerson} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름
                </label>
                <input
                  type="text"
                  required
                  value={editPersonForm.name}
                  onChange={(e) =>
                    setEditPersonForm({ ...editPersonForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  관계 (선택)
                </label>
                <input
                  type="text"
                  value={editPersonForm.relationship}
                  onChange={(e) =>
                    setEditPersonForm({ ...editPersonForm, relationship: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="배우자, 자녀 등"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    이름
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedPerson.name}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
                <button
                  onClick={handleEditPersonClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
                <button
                  onClick={handleDeletePerson}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  삭제하기
                </button>
              </div>
            </>
          )}
        </Modal>
      )}


      {/* 카드 상세정보 모달 */}
      {detailType === 'card' && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedCard(null);
            setIsEditing(false);
          }}
          title={isEditing ? '카드 수정' : '카드 상세정보'}
        >
          {isEditing ? (
            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  계좌
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {accounts.find((a) => a.id === editCardForm.accountId)?.name || '-'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 이름
                </label>
                <input
                  type="text"
                  required
                  value={editCardForm.name}
                  onChange={(e) =>
                    setEditCardForm({ ...editCardForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 번호
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.cardNumberMasked}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 유형
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.cardType === 'debit' ? '체크카드' : '신용카드'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  발급사
                </label>
                <input
                  type="text"
                  required
                  value={editCardForm.issuer}
                  onChange={(e) =>
                    setEditCardForm({ ...editCardForm, issuer: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {selectedCard.cardType === 'credit' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    신용한도 (원)
                  </label>
                  <input
                    type="number"
                    value={editCardForm.creditLimit}
                    onChange={(e) =>
                      setEditCardForm({ ...editCardForm, creditLimit: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 이름
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.name}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    계좌
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {accounts.find((a) => a.id === selectedCard.accountId)?.name || '-'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 번호
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.cardNumberMasked}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 유형
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.cardType === 'debit' ? '체크카드' : '신용카드'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    발급사
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.issuer}
                  </p>
                </div>

                {selectedCard.cardType === 'credit' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        사용액
                      </label>
                      <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                        {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(selectedCard.currentBalance || 0)}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        신용한도
                      </label>
                      <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                        {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(selectedCard.creditLimit || 0)}
                      </p>
                    </div>

                    {/* 신용카드 미납액 섹션 */}
                    {cardPayment && (
                      <div className="pt-4 border-t">
                        <div className="bg-red-50 rounded-lg p-4 space-y-3">
                          <h3 className="font-semibold text-gray-900">신용카드 미납액</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">결제일</span>
                              <span className="text-sm font-medium">
                                {new Date(cardPayment.paymentDate).toLocaleDateString('ko-KR')}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">총 결제액</span>
                              <span className="text-sm font-medium">
                                {new Intl.NumberFormat('ko-KR', {
                                  style: 'currency',
                                  currency: 'KRW',
                                }).format(cardPayment.totalAmount)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">결제 완료</span>
                              <span className="text-sm font-medium">
                                {new Intl.NumberFormat('ko-KR', {
                                  style: 'currency',
                                  currency: 'KRW',
                                }).format(cardPayment.paidAmount)}
                              </span>
                            </div>
                            <div className="flex justify-between pt-2 border-t">
                              <span className="text-sm font-semibold text-red-600">미납액</span>
                              <span className="text-lg font-bold text-red-600">
                                {new Intl.NumberFormat('ko-KR', {
                                  style: 'currency',
                                  currency: 'KRW',
                                }).format(cardPayment.totalAmount - cardPayment.paidAmount)}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                          >
                            결제하기
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
                <button
                  onClick={handleEditCardClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
                <button
                  onClick={handleDeleteCard}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  삭제하기
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* 신용카드 결제 모달 */}
      {isPaymentModalOpen && cardPayment && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => {
            setIsPaymentModalOpen(false);
            setPaymentForm({ paymentType: 'full', amount: '' });
          }}
          title="신용카드 결제"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handlePayCard();
            }}
            className="space-y-4"
          >
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-600">미납액</span>
                <span className="font-semibold">
                  {new Intl.NumberFormat('ko-KR', {
                    style: 'currency',
                    currency: 'KRW',
                  }).format(cardPayment.totalAmount - cardPayment.paidAmount)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                결제 유형
              </label>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center">
                  <input
                    type="radio"
                    value="full"
                    checked={paymentForm.paymentType === 'full'}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, paymentType: 'full' })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm">전체 결제</span>
                </label>
                <label className="flex-1 flex items-center">
                  <input
                    type="radio"
                    value="partial"
                    checked={paymentForm.paymentType === 'partial'}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, paymentType: 'partial' })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm">부분 결제</span>
                </label>
              </div>
            </div>

            {paymentForm.paymentType === 'partial' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제 금액 (원)
                </label>
                <input
                  type="number"
                  required
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, amount: e.target.value })
                  }
                  placeholder="0"
                  max={cardPayment.totalAmount - cardPayment.paidAmount}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={() => {
                  setIsPaymentModalOpen(false);
                  setPaymentForm({ paymentType: 'full', amount: '' });
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isPaymentSubmitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isPaymentSubmitting ? '처리 중...' : '결제하기'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <PersonModal
        isOpen={personModalOpen}
        onClose={() => setPersonModalOpen(false)}
        person={selectedPerson}
        mode={personModalMode as 'view' | 'edit'}
        onSuccess={(updatedPeople) => {
          setPeople(updatedPeople);
          setSelectedPerson(null);
          setPersonModalOpen(false);
        }}
        onDelete={handleDeletePerson}
      />

      <EditAccountModal
        isOpen={isEditAccountModalOpen}
        onClose={() => setIsEditAccountModalOpen(false)}
        account={selectedAccount as any}
        people={people}
        onSuccess={(updatedAccounts) => {
          setAccounts(updatedAccounts as Account[]);
          setSelectedAccount(null);
          setIsEditAccountModalOpen(false);
        }}
        onDelete={handleDeleteAccount}
      />

      <EditCardModal
        isOpen={isEditCardModalOpen}
        onClose={() => setIsEditCardModalOpen(false)}
        card={selectedCard}
        accounts={accounts}
        onSuccess={(updatedCards) => {
          setCards(updatedCards || []);
          setSelectedCard(null);
          setIsEditCardModalOpen(false);
        }}
        onDelete={handleDeleteCard}
      />

      {/* 추가 유형 선택 팝업 */}
      <Modal
        isOpen={addType === 'select'}
        onClose={() => setAddType(null)}
        title="추가하기"
      >
        <div className="space-y-3">
          <button
            onClick={() => {
              setAddType(null);
              setIsPersonAddModalOpen(true);
            }}
            className="w-full px-4 py-3 text-left bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
          >
            <p className="font-semibold text-gray-900">👤 구성원 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 가족 구성원을 추가합니다</p>
          </button>

          <button
            onClick={() => {
              setAddType(null);
              setIsAccountModalOpen(true);
            }}
            className="w-full px-4 py-3 text-left bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition"
          >
            <p className="font-semibold text-gray-900">🏦 계좌 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 계좌를 추가합니다</p>
          </button>

          <button
            onClick={() => setAddType('card')}
            className="w-full px-4 py-3 text-left bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition"
          >
            <p className="font-semibold text-gray-900">💳 카드 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 카드를 추가합니다</p>
          </button>
        </div>
      </Modal>

      {/* 구성원 추가 모달 */}
      <PersonModal
        isOpen={isPersonAddModalOpen}
        onClose={() => setIsPersonAddModalOpen(false)}
        person={null}
        mode="add"
        onSuccess={(updatedPeople) => {
          setPeople(updatedPeople);
          setStorePeople(updatedPeople);
          setIsPersonAddModalOpen(false);
        }}
        onDelete={async () => {}}
      />

      {/* 계좌 추가 모달 */}
      <AddAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAccounts) => setAccounts(newAccounts)}
        people={people}
      />

      {/* 카드 추가 모달 */}
      <Modal
        isOpen={addType === 'card'}
        onClose={() => {
          setAddType(null);
          setCardForm({
            accountId: '',
            name: '',
            cardNumber: '',
            cardType: 'debit',
            issuer: '',
            expiryDate: '',
            creditLimit: '',
            billingDayOfMonth: 1,
          });
          setAddError('');
        }}
        title="카드 추가"
      >
        <form onSubmit={handleAddCard} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={cardForm.accountId}
              onChange={(value) => setCardForm({ ...cardForm, accountId: value })}
              placeholder="선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 이름
            </label>
            <input
              type="text"
              required
              value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
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
              value={cardForm.cardNumber}
              onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
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
              value={cardForm.cardType}
              onChange={(value) => setCardForm({ ...cardForm, cardType: value as 'debit' | 'credit' })}
              placeholder="선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              발급사
            </label>
            <input
              type="text"
              required
              value={cardForm.issuer}
              onChange={(e) => setCardForm({ ...cardForm, issuer: e.target.value })}
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
              value={cardForm.expiryDate}
              onChange={(e) => setCardForm({ ...cardForm, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {cardForm.cardType === 'credit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  신용한도 (원)
                </label>
                <input
                  type="number"
                  value={cardForm.creditLimit}
                  onChange={(e) => setCardForm({ ...cardForm, creditLimit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제일 (매월 몇 일?)
                </label>
                <select
                  value={cardForm.billingDayOfMonth}
                  onChange={(e) => setCardForm({ ...cardForm, billingDayOfMonth: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}일
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>
    </>
  );
}
