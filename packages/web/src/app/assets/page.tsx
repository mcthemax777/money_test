'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Person, Statement } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { useUserFilter } from '@/store/user-filter';
import { formatDate, formatDateMarker } from '@/lib/datetime';
import ChoiceModal from '@/components/ChoiceModal';
import { useDragReorder } from '@/hooks/useDragReorder';
// 드래그 핸들: 가로 실선 2줄. lucide의 Equal이 그 모양이라 이름만 바꿔 쓴다.
import { Equal as DragHandleIcon } from 'lucide-react';
import { DAY_OF_MONTH_HINT, DAY_OF_MONTH_OPTIONS } from '@/lib/day-of-month';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const PAYMENT_FORM_ID = 'card-payment-form';
const CARD_ADD_FORM_ID = 'card-add-form';
import { useProject, useProjectTimeZone } from '@/store/project';
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
  const { setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
  const timeZone = useProjectTimeZone();
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
  // 조회(상세정보)와 수정 폼은 서로 다른 모달이다. state를 공유하면 상세정보 버튼
  // 하나로 두 모달이 동시에 열려 "수정하기를 누르지도 않았는데 수정 화면이 나온다".
  const [isAccountDetailOpen, setIsAccountDetailOpen] = useState(false);
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

  // 자산 화면은 사람 필터를 쓰지 않는다. 필터는 가계 화면 전용이고,
  // 여기서 걸면 총자산(서버 계산, 전체 기준)과 계좌 목록이 어긋난다.
  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.paymentAccountId === accountId);

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
      setIsAccountDetailOpen(false);
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

  /** 드래그로 바꾼 구성원 순서 저장 */
  const handleReorderPeople = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderPeople(ids, selectedProjectId);
      setPeople((updated || []) as Person[]);
      setStorePeople((updated || []) as Person[]);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '순서 저장에 실패했습니다.');
    }
  };

  /**
   * 드래그로 바꾼 계좌 순서 저장.
   *
   * sortOrder는 프로젝트 단위지만 화면은 구성원별로 묶어 보여준다.
   * 한 묶음 안의 순서만 다시 매기므로 묶음끼리는 서로 영향을 주지 않는다.
   */
  const handleReorderAccounts = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderAccounts(ids, selectedProjectId);
      setAccounts((updated || []) as Account[]);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '순서 저장에 실패했습니다.');
    }
  };

  /** 드래그로 바꾼 카드 순서 저장. 계좌와 같은 규칙(묶음 안에서만 다시 매긴다). */
  const handleReorderCards = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderCards(ids, selectedProjectId);
      setCards((updated || []) as Card[]);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '순서 저장에 실패했습니다.');
    }
  };

  /** 조회 모달을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditAccountClick = () => {
    setIsAccountDetailOpen(false);
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

  // 계좌가 없는 구성원도 표시한다
  const displayPeople = people;

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

      {/* 총자산과 전체 추이는 계좌를 골라도 그대로 둔다. 고른 계좌는 아래 오른쪽에 펼친다. */}
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

      <AssetHistoryChart projectId={selectedProjectId} />

      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded mb-4">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : displayPeople.length === 0 ? (
        <p className="text-gray-600">선택된 사용자가 없습니다.</p>
      ) : (
        /*
          왼쪽은 항상 구성원·계좌·카드 목록, 오른쪽은 고른 계좌의 내역이다.
          예전에는 계좌를 누르면 목록이 사라지고 화면이 통째로 바뀌어서, 다른 계좌로
          옮기려면 매번 닫아야 했다.
        */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* 왼쪽: 구성원별 목록. 드래그로 순서를 바꿀 수 있다. */}
          <PersonAssetList
            people={displayPeople}
            accounts={accounts}
            cardsOf={getAccountCards}
            netWorthByPerson={netWorthByPerson}
            selectedAccountId={detailType === 'account' ? selectedAccount?.id ?? null : null}
            onPersonClick={(person) => {
              setSelectedPerson(person);
              setDetailType('person');
            }}
            onAccountClick={(account) => {
              setSelectedAccount(account);
              setDetailType('account');
            }}
            onCardClick={(card) => {
              setSelectedCard(card);
              setDetailType('card');
            }}
            onReorderPeople={handleReorderPeople}
            onReorderAccounts={handleReorderAccounts}
            onReorderCards={handleReorderCards}
          />

          {/* 오른쪽: 고른 계좌의 잔액 추이와 거래 내역 */}
          {detailType === 'account' && selectedAccount ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              {/* 헤더: 계좌명 및 버튼 */}
              <div className="flex justify-between items-start gap-4 mb-6">
                <div>
                  {/* 예전에는 상단 총자산 박스가 이 값을 보여줬다. 총자산을 그대로 두는 대신 여기에 적는다. */}
                  <h2 className="text-2xl font-bold text-gray-900">{selectedAccount.name}</h2>
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(selectedAccount.balance)}
                  </p>
                  {selectedAccount.institution?.name && (
                    <p className="text-sm text-gray-600 mt-1">{selectedAccount.institution.name}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsAccountDetailOpen(true)}
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
                              {formatDate(tx.date, timeZone)}
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
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
              <p className="text-gray-500">계좌를 누르면 잔액 추이와 거래 내역이 여기에 나옵니다.</p>
            </div>
          )}
        </div>
      )}

      {/* 계좌 상세정보 모달 */}
      {isAccountDetailOpen && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => setIsAccountDetailOpen(false)}
          title="계좌 상세정보"
          footer={
            <div className="flex gap-2">
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
          }
        >
          <div className="space-y-4">
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
          footer={
            <div className="flex gap-2">
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
          }
        >
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedPerson.name}
                </p>
              </div>
            </div>

          </>
        </Modal>
      )}


      {/* 카드 상세정보 모달. 수정 폼이 열리면 감춘다 (겹쳐 열리면 안 된다).
          detailType은 청구서 조회 effect가 쓰므로 그대로 둔다. */}
      {detailType === 'card' && selectedCard && !isEditCardModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedCard(null);
          }}
          title="카드 상세정보"
          footer={
            <div className="flex gap-2">
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
          }
        >
          <>
            <div className="space-y-4">
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
                              {formatDateMarker(statement.periodEnd)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">결제일</span>
                            <span className="text-sm font-medium">
                              {formatDateMarker(statement.dueDate)}
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
          footer={
            <div className="flex gap-2">
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
                form={PAYMENT_FORM_ID}
                disabled={isPaymentSubmitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isPaymentSubmitting ? '처리 중...' : '결제하기'}
              </button>
            </div>
          }
        >
          <form
            id={PAYMENT_FORM_ID}
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

      {/* 추가 유형 선택 팝업. 거래 입력 폼의 결제수단 추가 버튼과 같은 컴포넌트를 쓴다. */}
      <ChoiceModal
        isOpen={addType === 'select'}
        onClose={() => setAddType(null)}
        title="추가하기"
        choices={[
          {
            key: 'person',
            icon: '👤',
            label: '구성원 추가',
            description: '새로운 가족 구성원을 추가합니다',
            tone: 'blue',
            onSelect: () => {
              setAddType(null);
              setIsPersonAddModalOpen(true);
            },
          },
          {
            key: 'account',
            icon: '🏦',
            label: '계좌 추가',
            description: '새로운 계좌를 추가합니다',
            tone: 'green',
            onSelect: () => {
              setAddType(null);
              setIsAccountModalOpen(true);
            },
          },
          {
            key: 'card',
            icon: '💳',
            label: '카드 추가',
            description: '새로운 카드를 추가합니다',
            tone: 'purple',
            onSelect: () => setAddType('card'),
          },
        ]}
      />

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
        footer={
          <button
            type="submit"
            form={CARD_ADD_FORM_ID}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '추가 중...' : '추가하기'}
          </button>
        }
      >
        <form id={CARD_ADD_FORM_ID} onSubmit={handleAddCard} className="space-y-4">
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
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
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
                  {DAY_OF_MONTH_OPTIONS.map((option) => (
                    <option key={option.day} value={option.day}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
              </div>
            </>
          )}

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

        </form>
      </Modal>
    </>
  );
}

/**
 * 구성원별 자산 목록. 구성원과 계좌를 각각 드래그로 정렬한다.
 *
 * 계좌 목록은 구성원마다 별도 컴포넌트로 두어야 한다. 훅은 목록 하나를 다루므로
 * 한 컴포넌트에서 여러 묶음을 처리할 수 없다.
 */
function PersonAssetList({
  people,
  accounts,
  cardsOf,
  netWorthByPerson,
  selectedAccountId,
  onPersonClick,
  onAccountClick,
  onCardClick,
  onReorderPeople,
  onReorderAccounts,
  onReorderCards,
}: {
  people: Person[];
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  netWorthByPerson: Map<string, { total: string }>;
  /** 오른쪽 패널이 보고 있는 계좌. 목록에서 강조한다. */
  selectedAccountId: string | null;
  onPersonClick: (person: Person) => void;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  onReorderPeople: (ids: string[]) => void;
  onReorderAccounts: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
}) {
  const { items, dragProps, draggingId } = useDragReorder(people, onReorderPeople);

  return (
    <div className="space-y-8">
      {items.map((person) => (
        <div
          key={person.id}
          {...dragProps(person.id)}
          className={`bg-white rounded-lg shadow p-6 hover:shadow-md transition ${
            draggingId === person.id ? 'opacity-50' : ''
          }`}
        >
          <button onClick={() => onPersonClick(person)} className="w-full text-left mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  <DragHandleIcon className="inline w-5 h-5 text-gray-400 mr-2 cursor-grab align-[-3px]" aria-label="드래그해서 순서 변경" />
                  {person.name}
                </h2>
                <p className="text-sm text-gray-600">
                  소계: {formatCurrency(netWorthByPerson.get(person.id)?.total ?? 0)}
                </p>
              </div>
            </div>
          </button>

          <AccountList
            accounts={accounts.filter((account) => account.ownerId === person.id)}
            cardsOf={cardsOf}
            selectedAccountId={selectedAccountId}
            onAccountClick={onAccountClick}
            onCardClick={onCardClick}
            onReorder={onReorderAccounts}
            onReorderCards={onReorderCards}
          />
        </div>
      ))}
    </div>
  );
}

/** 한 구성원의 계좌 목록 */
function AccountList({
  accounts,
  cardsOf,
  selectedAccountId,
  onAccountClick,
  onCardClick,
  onReorder,
  onReorderCards,
}: {
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  selectedAccountId: string | null;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  onReorder: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
}) {
  const { items, dragProps, draggingId } = useDragReorder(accounts, onReorder);

  if (items.length === 0) {
    return <p className="text-gray-600">등록된 계좌가 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((account) => (
        <div
          key={account.id}
          {...dragProps(account.id)}
          /* 오른쪽 패널에 펼쳐 둔 계좌를 목록에서도 알 수 있게 표시한다 */
          className={`rounded-lg p-4 hover:shadow-md transition ${
            account.id === selectedAccountId
              ? 'border-2 border-blue-500 bg-blue-50'
              : 'border border-gray-200'
          } ${draggingId === account.id ? 'opacity-50' : ''}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccountClick(account);
            }}
            className="w-full text-left hover:opacity-70 transition"
          >
            <p className="text-sm text-gray-600">
              <DragHandleIcon className="inline w-4 h-4 text-gray-400 mr-2 cursor-grab align-[-2px]" aria-label="드래그해서 순서 변경" />
              {account.institution?.name}
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              {formatCurrency(account.balance)}
            </p>
            <p className="text-xs text-gray-500 mt-2">{account.name}</p>
            {account.accountNumber && (
              <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
            )}
          </button>

          <CardList
            cards={cardsOf(account.id)}
            onCardClick={onCardClick}
            onReorder={onReorderCards}
          />
        </div>
      ))}
    </div>
  );
}

/** 한 계좌에 연결된 카드 목록 */
function CardList({
  cards,
  onCardClick,
  onReorder,
}: {
  cards: Card[];
  onCardClick: (card: Card) => void;
  onReorder: (ids: string[]) => void;
}) {
  const { items, dragProps, draggingId } = useDragReorder(cards, onReorder);
  if (items.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
      {items.map((card) => (
        <div
          key={card.id}
          {...dragProps(card.id)}
          className={`px-3 py-2 bg-green-50 rounded border border-green-100 hover:bg-green-100 transition ${
            draggingId === card.id ? 'opacity-50' : ''
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCardClick(card);
            }}
            className="w-full text-left"
          >
            <p className="text-sm font-medium text-gray-900">
              <DragHandleIcon className="inline w-4 h-4 text-gray-400 mr-2 cursor-grab align-[-2px]" aria-label="드래그해서 순서 변경" />
              💳 {card.name}
            </p>
            <p className="text-xs text-gray-600">{card.issuer?.name}</p>
            <p className="text-xs text-gray-600">
              {card.cardType === 'debit' ? '체크카드' : '신용카드'}
            </p>
          </button>
        </div>
      ))}
    </div>
  );
}
