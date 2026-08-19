'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Person, Statement } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { useUserFilter } from '@/store/user-filter';
import { useProject } from '@/store/project';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import { useInstitutions } from '@/hooks/useInstitutions';



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
  const { options: issuerOptions } = useInstitutions('card_issuer');

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
    issuerId: '',
    expiryDate: '',
    creditLimit: '',
    // 청구 주기는 마감일과 결제일 두 값으로 계산한다
    statementClosingDay: 15,
    paymentDueDay: 25,
  });
  const [addError, setAddError] = useState('');

  const [statement, setStatement] = useState<Statement | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    paymentType: 'full' as 'full' | 'partial',
    amount: '',
  });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);

  const [accountTransactions, setAccountTransactions] = useState<any[]>([]);
  const [netWorth, setNetWorth] = useState<any | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
        const [accountsData, peopleData, cardsData, categoriesData, netWorthData] =
          await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
            apiClient.getCategories(selectedProjectId),
            apiClient.getNetWorth(selectedProjectId),
          ]);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);
        setNetWorth(netWorthData ?? null);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [selectedProjectId]);

  /**
   * 계좌 원장 조회.
   *
   * 예전에는 거래 목록에서 accountId/toAccountId를 조합하고 credit_usage를 빼야 했다.
   * 원장 구조에서는 이 계좌의 posting만 시간순으로 오고 잔액 추이까지 함께 온다.
   */
  const loadAccountTransactions = useCallback(async (accountId: string) => {
    try {
      const response = await apiClient.getAccountPostings(accountId, { limit: 100 });
      setAccountTransactions(response?.data ?? []);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
      setAccountTransactions([]);
    }
  }, []);

  /** 카드 선택 시 미결제 청구서 조회. 가장 오래된 것부터 갚는다. */
  const loadCardPayment = useCallback(async (cardId: string) => {
    try {
      const response = await apiClient.getStatements(selectedProjectId, { cardId });
      const rows: Statement[] = response ?? [];
      const unpaid = rows
        .filter((row) => Number(row.outstanding) > 0)
        .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
      setStatement(unpaid[0] ?? null);
    } catch (err) {
      console.error('청구서 조회 실패:', err);
      setStatement(null);
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
      setStatement(null);
    }
  }, [selectedCard, detailType, loadCardPayment]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => selectedPersonIds.includes(acc.owner?.id || ''));
  }, [accounts, selectedPersonIds]);

  const filteredCards = useMemo(() => {
    const userAccountIds = filteredAccounts.map((acc) => acc.id);
    return cards.filter((card) => userAccountIds.includes(card.paymentAccountId));
  }, [cards, filteredAccounts]);

  const getAccountCards = (accountId: string) =>
    filteredCards.filter((c) => c.paymentAccountId === accountId);

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
      const accountsData = await apiClient.getAccountsV2(selectedProjectId);
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
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      setDetailType(null);
      setSelectedCard(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 카드 결제 실행
  const handlePayCard = async () => {
    if (!statement || !selectedCard) return;

    // 대금은 카드에 연결된 결제 통장에서 빠진다.
    const paymentAccount = accounts.find((a) => a.id === selectedCard.paymentAccountId);
    if (!paymentAccount?.ownerId) {
      alert('결제 통장을 찾을 수 없습니다.');
      return;
    }

    try {
      setIsPaymentSubmitting(true);
      await apiClient.payStatement(statement.id, {
        accountId: selectedCard.paymentAccountId,
        personId: paymentAccount.ownerId,
        // 전액 결제면 금액을 생략한다 (서버가 미결제 전액으로 처리)
        ...(paymentForm.paymentType === 'full'
          ? {}
          : { amount: toAmountString(paymentForm.amount) }),
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

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardForm.issuerId) {
        setAddError('발급사를 선택하세요.');
        setIsSubmitting(false);
        return;
      }

      const isoDate = cardForm.expiryDate ? new Date(cardForm.expiryDate).toISOString() : undefined;
      await apiClient.createCard({
        paymentAccountId: cardForm.accountId,
        name: cardForm.name,
        cardNumber: cardForm.cardNumber || undefined,
        cardType: cardForm.cardType,
        issuerId: cardForm.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit:
          cardForm.cardType === 'credit' ? toAmountString(cardForm.creditLimit) : undefined,
        statementClosingDay:
          cardForm.cardType === 'credit' ? cardForm.statementClosingDay : undefined,
        paymentDueDay: cardForm.cardType === 'credit' ? cardForm.paymentDueDay : undefined,
      });
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      setCardForm({
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

  const handleEditAccountClick = () => {
    setIsEditAccountModalOpen(true);
  };

  const handleEditCardClick = () => {
    setIsEditCardModalOpen(true);
  };

  // 총자산과 사람별 소계는 서버가 계산한다 (/reports/net-worth).
  // 투자성 계좌는 최신 시가로 환산되고, 카드 부채가 차감되며, 자본 계정은 제외된다.
  // 계좌 잔액만 더하던 예전 계산으로는 이 셋 중 아무것도 반영되지 않았다.
  const totalBalance = toNumber(netWorth?.total);
  const netWorthByPerson = new Map<string, { total: string }>(
    (netWorth?.byPerson ?? []).map((row: any) => [row.personId as string, row]),
  );

  // selectedPersonIds가 없으면 모든 사용자 사용
  const effectivePersonIds = selectedPersonIds.length > 0 ? selectedPersonIds : people.map(p => p.id);
  const displayPeople = people.filter((p) => effectivePersonIds.includes(p.id));

  // 계좌가 없어도 모든 선택된 사용자를 표시
  const allGroupedAccounts = displayPeople.reduce(
    (acc, person) => {
      acc[person.id] = {
        person,
        accounts: filteredAccounts.filter((a) => a.ownerId === person.id),
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

      {/* 계좌를 보고 있으면 그 계좌 잔액을, 아니면 전체 자산을 띄운다 */}
      {detailType === 'account' && selectedAccount ? (
        <div className="bg-blue-600 text-white rounded-lg p-8 mb-8">
          <p className="text-sm opacity-90">{selectedAccount.name}</p>
          <p className="text-4xl font-bold mt-2">{formatCurrency(selectedAccount.balance)}</p>
        </div>
      ) : (
        <div className="bg-blue-600 text-white rounded-lg p-8 mb-8">
          <p className="text-sm opacity-90">총 자산</p>
          <p className="text-4xl font-bold mt-2">
            {formatCurrency(totalBalance)}
          </p>
          {netWorth && toNumber(netWorth.liability) !== 0 && (
            <p className="text-sm opacity-90 mt-2">
              현금성 {formatCurrency(netWorth.cash)} · 투자 {formatCurrency(netWorth.investment)} ·
              부채 {formatCurrency(netWorth.liability)}
            </p>
          )}
        </div>
      )}

      {/* 전체 자산 추이. 계좌를 골라 보고 있을 때는 아래에서 그 계좌 것을 따로 보여준다. */}
      {detailType !== 'account' && (
        <AssetHistoryChart projectId={selectedProjectId} />
      )}

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

          {/* 이 계좌의 잔액 추이 */}
          <AssetHistoryChart accountId={selectedAccount.id} projectId={selectedProjectId} />

          {/* 거래 내역 */}
          {accountTransactions.length === 0 ? (
            <p className="text-gray-600 text-center py-8">거래 내역이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {accountTransactions.map((tx: any) => {
                // 원장 posting의 amount는 이미 부호를 갖는다 (자산 증가 +, 감소 -).
                // 부호를 그대로 두고 앞에 '-'를 또 붙이면 '--₩10,000'이 된다. 절댓값으로 찍는다.
                const amount = toNumber(tx.amount);
                const isIncoming = amount > 0;
                const label = tx.merchant || tx.cardName || '';
                return (
                  <div key={tx.postingId} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900">{tx.description || '(내용 없음)'}</p>
                        {label && (
                          <p className="text-sm text-gray-600 mt-1">{label}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(tx.date).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className={`font-bold text-lg ${isIncoming ? 'text-green-600' : 'text-red-600'}`}>
                          {isIncoming ? '+' : '-'}
                          {formatCurrency(Math.abs(amount))}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          잔액 {formatCurrency(tx.balanceAfter)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
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
                      소계: {formatCurrency(netWorthByPerson.get(person.id)?.total ?? 0)}
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
                          <p className="text-sm text-gray-600">{account.institution?.name}</p>
                          <p className="text-2xl font-bold text-gray-900 mt-2">
                            {formatCurrency(account.balance)}
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
                                <p className="text-xs text-gray-600">{card.issuer?.name}</p>
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
                {selectedAccount.institution?.name || '-'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                잔액
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 font-semibold">
                {formatCurrency(selectedAccount.balance)}
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

      {/* 계좌 수정 모달 */}

      {/* 구성원 상세정보 모달 */}
      {detailType === 'person' && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedPerson(null);
          }}
          title="구성원 상세정보"
        >
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
        </Modal>
      )}


      {/* 카드 상세정보 모달 */}
      {detailType === 'card' && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedCard(null);
          }}
          title="카드 상세정보"
        >
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
                  {accounts.find((a) => a.id === selectedCard.paymentAccountId)?.name || '-'}
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
                  {selectedCard.issuer?.name}
                </p>
              </div>

              {selectedCard.cardType === 'credit' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      사용액
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {formatCurrency(selectedCard.currentUsage)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      신용한도
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {formatCurrency(selectedCard.creditLimit)}
                    </p>
                  </div>

                  {/* 청구서 미결제액. SUM(Posting.amount WHERE statementId=X)로 서버가 계산한다 */}
                  {statement && (
                    <div className="pt-4 border-t">
                      <div className="bg-red-50 rounded-lg p-4 space-y-3">
                        <h3 className="font-semibold text-gray-900">카드 청구서</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">마감일</span>
                            <span className="text-sm font-medium">
                              {new Date(statement.periodEnd).toLocaleDateString('ko-KR')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">결제일</span>
                            <span className="text-sm font-medium">
                              {new Date(statement.dueDate).toLocaleDateString('ko-KR')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">청구액</span>
                            <span className="text-sm font-medium">
                              {formatCurrency(statement.chargedAmount)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">결제 완료</span>
                            <span className="text-sm font-medium">
                              {formatCurrency(statement.paidAmount)}
                            </span>
                          </div>
                          <div className="flex justify-between pt-2 border-t">
                            <span className="text-sm font-semibold text-red-600">미결제액</span>
                            <span className="text-lg font-bold text-red-600">
                              {formatCurrency(statement.outstanding)}
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
        </Modal>
      )}

      {/* 신용카드 결제 모달 */}
      {isPaymentModalOpen && statement && selectedCard && (
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
                  }).format(Number(statement.outstanding))}
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
                  max={Number(statement.outstanding)}
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
        projectId={selectedProjectId}
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
            issuerId: '',
            expiryDate: '',
            creditLimit: '',
            statementClosingDay: 15,
            paymentDueDay: 25,
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
            <CustomSelect
              options={issuerOptions}
              value={cardForm.issuerId}
              onChange={(value) => setCardForm({ ...cardForm, issuerId: value })}
              placeholder="카드사를 선택하세요"
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
                  마감일 (매월 몇 일?)
                </label>
                <select
                  value={cardForm.statementClosingDay}
                  onChange={(e) =>
                    setCardForm({ ...cardForm, statementClosingDay: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}일
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  결제일 (매월 몇 일?)
                </label>
                <select
                  value={cardForm.paymentDueDay}
                  onChange={(e) =>
                    setCardForm({ ...cardForm, paymentDueDay: parseInt(e.target.value) })
                  }
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
