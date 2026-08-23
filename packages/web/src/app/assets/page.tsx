'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, CardUsage, Person } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { useUserFilter } from '@/store/user-filter';
import { formatDate, formatDateMarker, monthInputToIso, todayKey } from '@/lib/datetime';
import {
  LEDGER_MIN_ENTRY_DATE_KEY,
  ledgerMaxEntryDateKey,
  zonedFormValueToUtc,
  type CardTransferDirection,
} from '@money/types';
import ChoiceModal from '@/components/ChoiceModal';
import { useDragReorder } from '@/hooks/useDragReorder';
import { DAY_OF_MONTH_HINT, DAY_OF_MONTH_OPTIONS } from '@/lib/day-of-month';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
/** 구성원 상세에 보여 줄 최근 거래 수. 더 보려면 가계 화면에서 사람 필터를 쓴다. */
const PERSON_ENTRY_LIMIT = 30;

const PAYMENT_FORM_ID = 'card-payment-form';
const CARD_ADD_FORM_ID = 'card-add-form';

/** 카드사와 통장 사이 자금이 오가는 방향 */
const TRANSFER_DIRECTIONS = [
  { id: 'payment' as CardTransferDirection, label: '대금 결제' },
  { id: 'refund' as CardTransferDirection, label: '환불 입금' },
];
import { useProject, useProjectDisplayCurrency, useProjectTimeZone } from '@/store/project';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';
import PageHeader from '@/components/PageHeader';
import HiddenItemsPanel from '@/components/HiddenItemsPanel';
import PendingRatePanel from '@/components/PendingRatePanel';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import TransactionListView from '@/components/TransactionListView';
import type { EntryListItem } from '@/components/TransactionItem';
import { useInstitutions } from '@/hooks/useInstitutions';



export default function DashboardPage() {
  const router = useRouter();
  const { setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
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
  /*
   * 상세정보 팝업.
   *
   * 구성원과 카드도 계좌와 같은 방식으로 다룬다. 고르면 오른쪽에 그래프와 내역이
   * 나오고, 기본 정보는 이 버튼으로 연다. 예전에는 고르는 즉시 팝업이 떠서
   * 그래프를 볼 자리가 없었다.
   */
  const [isPersonDetailOpen, setIsPersonDetailOpen] = useState(false);
  const [isCardDetailOpen, setIsCardDetailOpen] = useState(false);
  /** 고른 구성원의 최근 거래. 계좌 원장과 달리 전표 단위다. */
  const [personEntries, setPersonEntries] = useState<EntryListItem[]>([]);
  const [isEditAccountModalOpen, setIsEditAccountModalOpen] = useState(false);
  const [isEditCardModalOpen, setIsEditCardModalOpen] = useState(false);

  /**
   * 무엇을 추가하는 중인지.
   *
   * 'select'      : 상단 추가 버튼. 구성원·계좌·카드 셋 중에 고른다.
   * 'select-person': 구성원 상세에서 들어온 경우. 그 사람은 이미 정해졌으므로
   *                  계좌와 카드 둘만 고른다.
   */
  const [addType, setAddType] = useState<'select' | 'select-person' | 'card' | null>(null);
  /**
   * 구성원 상세에서 시작한 추가인지.
   *
   * 계좌 추가 폼의 통장 주인을 미리 채우는 데만 쓴다. 상단 추가 버튼으로
   * 들어오면 주인이 정해져 있지 않으므로 null이다.
   */
  const [addedForPersonId, setAddedForPersonId] = useState<string | null>(null);
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

  const [usage, setUsage] = useState<CardUsage | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    direction: 'payment' as CardTransferDirection,
    amount: '',
    /**
     * 대금이 통장에서 빠진 날.
     *
     * 예전에는 서버가 저장 시각을 박았다. 결제일에 맞춰 뒤늦게 입력하거나 미리
     * 기록해 두는 경우 통장 잔액의 날짜가 실제와 어긋났다. 그래서 사용자가 고른다.
     */
    date: '',
  });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);

  const [accountTransactions, setAccountTransactions] = useState<any[]>([]);
  /** 원장의 다음 페이지 커서. null이면 끝까지 봤다는 뜻이다. */
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [netWorth, setNetWorth] = useState<any | null>(null);
  /** 항목을 숨기거나 되돌리면 올린다. 숨긴 항목 패널이 이 값을 보고 다시 읽는다. */
  const [hiddenVersion, setHiddenVersion] = useState(0);

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
  const LEDGER_PAGE_SIZE = 100;

  const loadAccountTransactions = useCallback(async (accountId: string) => {
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(accountId, { limit: LEDGER_PAGE_SIZE });
      setAccountTransactions(response?.data ?? []);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
      setAccountTransactions([]);
      setLedgerCursor(null);
    } finally {
      setIsLoadingLedger(false);
    }
  }, []);

  /**
   * 원장 다음 페이지.
   *
   * 예전에는 100건만 받고 커서를 버려서, 그보다 오래된 거래를 볼 방법이 없었다.
   * 서버는 페이지마다 그 구간의 잔액 추이를 맞춰서 준다.
   */
  const loadMoreAccountTransactions = useCallback(async () => {
    if (!selectedAccount || !ledgerCursor) return;
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(selectedAccount.id, {
        limit: LEDGER_PAGE_SIZE,
        cursor: ledgerCursor,
      });
      setAccountTransactions((prev) => [...prev, ...(response?.data ?? [])]);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
    } finally {
      setIsLoadingLedger(false);
    }
  }, [selectedAccount, ledgerCursor]);

  /** 카드 선택 시 미결제 청구서 조회. 가장 오래된 것부터 갚는다. */
  /**
   * 카드 사용 현황.
   *
   * 청구서를 저장하지 않는다. 남은 대금과 마감일 기준 주기별 사용액을 서버가
   * 그때그때 계산해 준다. 마감일을 바꾸면 과거 주기까지 곧바로 다시 그려진다.
   */
  const loadCardUsage = useCallback(async (cardId: string) => {
    try {
      setUsage(await apiClient.getCardUsage(cardId));
    } catch (err) {
      console.error('카드 사용 현황 조회 실패:', err);
      setUsage(null);
    }
  }, []);

  /**
   * 구성원의 최근 거래.
   *
   * 계좌 원장(posting)과 달리 전표 단위로 본다. 한 사람이 여러 계좌를 쓰므로
   * 계좌별 잔액 흐름보다 "이 사람이 무엇을 썼는가"가 알고 싶은 것이다.
   */
  useEffect(() => {
    if (!selectedPerson || detailType !== 'person') {
      setPersonEntries([]);
      return;
    }

    let cancelled = false;
    apiClient
      .getEntries({ personId: selectedPerson.id, limit: PERSON_ENTRY_LIMIT }, selectedProjectId)
      .then((res) => {
        if (!cancelled) setPersonEntries((res?.data ?? []) as EntryListItem[]);
      })
      .catch((err) => {
        console.error('구성원 거래 조회 실패:', err);
        if (!cancelled) setPersonEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPerson, detailType, selectedProjectId]);

  // 계좌 선택 시 거래 내역 로드
  useEffect(() => {
    if (selectedAccount && detailType === 'account') {
      loadAccountTransactions(selectedAccount.id);
    } else {
      setAccountTransactions([]);
      setLedgerCursor(null);
    }
  }, [selectedAccount, detailType, loadAccountTransactions]);

  // 카드 선택 시 사용 현황 로드
  useEffect(() => {
    if (selectedCard && detailType === 'card' && selectedCard.cardType === 'credit') {
      loadCardUsage(selectedCard.id);
    } else {
      setUsage(null);
    }
  }, [selectedCard, detailType, loadCardUsage]);

  // 자산 화면은 사람 필터를 쓰지 않는다. 필터는 가계 화면 전용이고,
  // 여기서 걸면 총자산(서버 계산, 전체 기준)과 계좌 목록이 어긋난다.
  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.paymentAccountId === accountId);

  /**
   * 카드 금액의 통화. 사용액·한도·남은 대금은 전부 결제 통장의 통화다.
   * 기준통화 환산액이 아니라서 원으로 찍으면 달러 카드가 1/1380로 보인다.
   */
  const currencyOfCard = (card: { paymentAccountId?: string } | null): string =>
    accounts.find((a) => a.id === card?.paymentAccountId)?.currency ?? 'KRW';

  /**
   * 숨기기는 기록을 지우지 않는다. 과거 거래는 그대로 남고 목록에서만 빠지며,
   * 아래 "숨긴 항목"에서 되돌릴 수 있다. 문구도 그렇게 맞춘다.
   */
  const HIDE_CONFIRM = '목록에서 숨깁니다. 기록은 남고 나중에 다시 표시할 수 있습니다. 계속할까요?';

  const handleDeletePerson = async () => {
    if (!selectedPerson || !window.confirm(HIDE_CONFIRM)) return;
    try {
      setIsSubmitting(true);
      await apiClient.deletePerson(selectedPerson.id);
      const peopleData = await apiClient.getPeople(selectedProjectId);
      setPeople(peopleData || []);
      setIsPersonDetailOpen(false);
      setDetailType(null);
      setSelectedPerson(null);
      setHiddenVersion((v) => v + 1);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '숨기지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount || !window.confirm(HIDE_CONFIRM)) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteAccountV2(selectedAccount.id);
      const accountsData = await apiClient.getAccountsV2(selectedProjectId);
      setAccounts(accountsData || []);
      setIsAccountDetailOpen(false);
      setDetailType(null);
      setSelectedAccount(null);
      setHiddenVersion((v) => v + 1);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '숨기지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!selectedCard || !window.confirm(HIDE_CONFIRM)) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteCard(selectedCard.id);
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      setIsCardDetailOpen(false);
      setDetailType(null);
      setSelectedCard(null);
      setHiddenVersion((v) => v + 1);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '숨기지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 카드 쪽 숫자가 바뀐 뒤의 새로고침.
   *
   * 남은 대금(usage)과 카드 목록의 사용액은 같은 부채 잔액에서 나온다. 한쪽만
   * 다시 읽으면 같은 화면에 두 숫자가 서로 다르게 남는다.
   */
  const refreshAfterCardChange = useCallback(
    async (cardId: string) => {
      await loadCardUsage(cardId);
      if (!selectedProjectId) return;
      setCards((await apiClient.getCards(selectedProjectId)) || []);
    },
    [loadCardUsage, selectedProjectId],
  );

  /**
   * 카드사와 통장 사이 자금 이동 기록.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수(환불 예정)로 남아야 한다.
   */
  const handleCardTransfer = async () => {
    if (!selectedCard || !usage) return;

    // 대금은 카드에 연결된 결제 통장에서 오간다.
    const paymentAccount = accounts.find((a) => a.id === selectedCard.paymentAccountId);
    if (!paymentAccount?.ownerId) {
      alert('결제 통장을 찾을 수 없습니다.');
      return;
    }

    try {
      setIsPaymentSubmitting(true);
      await apiClient.createCardTransfer(selectedCard.id, {
        accountId: selectedCard.paymentAccountId,
        personId: paymentAccount.ownerId,
        amount: toAmountString(paymentForm.amount),
        direction: paymentForm.direction,
        // 입력한 날짜는 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
        date: zonedFormValueToUtc(
          paymentForm.date || todayKey(timeZone),
          undefined,
          timeZone,
        ).toISOString(),
      });

      closePaymentModal();
      await refreshAfterCardChange(selectedCard.id);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '기록에 실패했습니다.');
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  // 남은 대금이 음수면 카드사가 갚을 돈이 남은 상태다.
  const outstanding = Number(usage?.outstanding ?? 0);
  const refundPending = outstanding < 0;
  /** 입력 금액이 남은 쪽 잔액을 넘는 정도. 막지는 않고 알리기만 한다. */
  const overTransfer = (() => {
    const amount = toNumber(paymentForm.amount);
    if (!amount) return 0;
    const room = paymentForm.direction === 'refund' ? -outstanding : outstanding;
    return amount > room ? amount - Math.max(room, 0) : 0;
  })();

  /** 이체 팝업 닫기. 취소·닫기·성공 세 경로가 같은 초기화를 쓴다. */
  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setPaymentForm({ direction: 'payment', amount: '', date: '' });
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

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardForm.expiryDate) ?? undefined;
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

  /** 조회 팝업을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditPersonClick = () => {
    setIsPersonDetailOpen(false);
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

  /** 조회 팝업을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditCardClick = () => {
    setIsCardDetailOpen(false);
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
    <div className="space-y-6">
      <PageHeader
        title="자산"
        action={
          <button
            onClick={() => {
              setAddedForPersonId(null);
              setAddType('select');
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            추가하기
          </button>
        }
      />

      <HiddenItemsPanel
        projectId={selectedProjectId}
        reloadToken={hiddenVersion}
        onRestored={async () => {
          const [accountsData, peopleData, cardsData] = await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
          ]);
          setAccounts(accountsData || []);
          setPeople(peopleData || []);
          setCards(cardsData || []);
        }}
      />

      {/* 총자산과 전체 추이는 계좌를 골라도 그대로 둔다. 고른 계좌는 아래 오른쪽에 펼친다. */}
      <div className="bg-blue-600 text-white rounded-lg p-6">
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
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
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
            <div className="bg-white rounded-lg shadow p-6">
              {/* 헤더: 계좌명 및 버튼 */}
              <div className="flex justify-between items-start gap-4 mb-6">
                <div>
                  {/* 예전에는 상단 총자산 박스가 이 값을 보여줬다. 총자산을 그대로 두는 대신 여기에 적는다. */}
                  <h2 className="text-2xl font-bold text-gray-900">{selectedAccount.name}</h2>
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
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
              {/*
                추이는 기준통화 장부가다. 위 잔액(계좌 통화)과 단위가 다르므로 밝혀 둔다.
                거래마다 그때의 환율로 쌓인 값이라 최신 환율로 다시 환산한 값과도 다르다.
              */}
              {selectedAccount.currency !== displayCurrency && (
                <p className="-mt-2 text-xs text-gray-500">
                  추이는 {displayCurrency} 환산 장부가입니다. 거래 시점의 환율로 쌓인 값이라 위
                  잔액({selectedAccount.currency})과 단위가 다릅니다.
                </p>
              )}

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
                            {/*
                              원장의 금액과 잔액은 이 계좌의 통화다 (기준통화 환산액이 아니다).
                              통화를 넘기지 않으면 달러 통장의 $100이 ₩100으로 보인다.
                            */}
                            <p className={`font-bold text-lg ${isIncoming ? 'text-green-600' : 'text-red-600'}`}>
                              {isIncoming ? '+' : '-'}
                              {formatCurrency(Math.abs(amount), selectedAccount.currency)}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              잔액 {formatCurrency(tx.balanceAfter, selectedAccount.currency)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {ledgerCursor && (
                    <button
                      type="button"
                      onClick={loadMoreAccountTransactions}
                      disabled={isLoadingLedger}
                      className="w-full py-3 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                    >
                      {isLoadingLedger ? '불러오는 중...' : '더 보기'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : detailType === 'person' && selectedPerson ? (
            /* 구성원: 그 사람 계좌들의 합계 추이와 최근 거래 */
            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedPerson.name}</h2>
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(netWorthByPerson.get(selectedPerson.id)?.total ?? 0)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsPersonDetailOpen(true)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    상세정보
                  </button>
                  <button
                    onClick={() => {
                      setDetailType(null);
                      setSelectedPerson(null);
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                  >
                    닫기
                  </button>
                </div>
              </div>

              {/* 이 사람이 가진 계좌들의 합계 추이 */}
              <AssetHistoryChart ownerId={selectedPerson.id} projectId={selectedProjectId} />

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">최근 거래</h3>
                {personEntries.length === 0 ? (
                  <p className="text-gray-600 text-center py-8">거래 내역이 없습니다.</p>
                ) : (
                  <>
                    {/* 자산 화면에는 거래 상세 팝업이 없다. 고치는 일은 가계 화면에서 한다. */}
                    <TransactionListView entries={personEntries} onEntryClick={() => {}} />
                    {personEntries.length >= PERSON_ENTRY_LIMIT && (
                      <p className="mt-2 text-xs text-gray-500">
                        최근 {PERSON_ENTRY_LIMIT}건까지 보여 줍니다. 더 보려면 가계 화면에서
                        사람 필터를 쓰세요.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : detailType === 'card' && selectedCard ? (
            /*
              카드: 대금과 청구 주기.
              카드 번호나 유효기간 같은 기본 정보는 "카드 상세정보" 팝업으로 옮겼다.
              이 자리에서 자주 보는 것은 남은 대금과 이번 주기 사용액이다.
            */
            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedCard.name}</h2>
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(selectedCard.currentUsage, currencyOfCard(selectedCard))}
                  </p>
                  {selectedCard.issuer?.name && (
                    <p className="text-sm text-gray-600 mt-1">{selectedCard.issuer.name}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsCardDetailOpen(true)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    카드 상세정보
                  </button>
                  <button
                    onClick={() => {
                      setDetailType(null);
                      setSelectedCard(null);
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                  >
                    닫기
                  </button>
                </div>
              </div>

              {selectedCard.cardType !== 'credit' ? (
                <p className="text-gray-600">
                  체크카드는 결제 즉시 통장에서 빠집니다. 청구 주기와 남은 대금이 없습니다.
                </p>
              ) : !usage ? (
                <p className="text-gray-600">사용 현황을 불러오는 중입니다...</p>
              ) : (

            <div className="pt-4 border-t space-y-3">
              <div
                className={`rounded-lg p-4 space-y-3 ${
                  refundPending ? 'bg-emerald-50' : 'bg-red-50'
                }`}
              >
                <div className="flex justify-between items-baseline">
                  <span
                    className={`text-sm font-semibold ${
                      refundPending ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {refundPending ? '환불 예정' : '남은 대금'}
                  </span>
                  <span
                    className={`text-lg font-bold ${
                      refundPending ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(Math.abs(Number(usage.outstanding)), usage.currency)}
                  </span>
                </div>
                {refundPending && (
                  <p className="text-xs text-emerald-700">
                    카드사가 갚을 돈입니다. 맞지 않으면 대금 기록을 확인하세요.
                  </p>
                )}
                <button
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  대금 기록하기
                </button>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  마감일 기준 사용액
                </h3>
                <div className="space-y-1">
                  {usage.periods.map((period) => (
                    <div
                      key={period.periodEnd}
                      className="flex justify-between items-center px-3 py-2 bg-gray-50 rounded-lg"
                    >
                      <div className="text-sm text-gray-700">
                        {formatDateMarker(period.periodStart)} ~{' '}
                        {formatDateMarker(period.periodEnd)}
                        <span className="ml-2 text-xs text-gray-500">
                          {period.closed ? '마감' : '진행'}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">
                        {formatCurrency(period.usage, usage.currency)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  할부는 회차분만 들어갑니다. 남은 대금은 결제까지 반영한 값이라 합계와 다릅니다.
                </p>
              </div>

              {/*
                외화 결제의 청구액 확정.
                추정 환율로 들어간 건이 남아 있으면 남은 대금이 명세서와
                어긋나므로, 그 건들을 여기 모아 한 번에 맞춘다.
              */}
              <PendingRatePanel
                cardId={selectedCard.id}
                onSettled={() => refreshAfterCardChange(selectedCard.id)}
              />
            </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
              <p className="text-gray-500">
                구성원·계좌·카드를 누르면 추이와 내역이 여기에 나옵니다.
              </p>
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
              {/*
                계좌 밑에 만들 수 있는 것은 카드뿐이라 선택 팝업을 거치지 않는다.
                결제 통장은 이 계좌로 미리 채워 둔다.
              */}
              <button
                onClick={() => {
                  setIsAccountDetailOpen(false);
                  setCardForm((prev) => ({ ...prev, accountId: selectedAccount.id }));
                  setAddType('card');
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                카드 추가
              </button>
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
                숨기기
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
                {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
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

      {/* 구성원 상세정보 모달. 오른쪽 패널의 "상세정보" 버튼으로 연다. */}
      {isPersonDetailOpen && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => setIsPersonDetailOpen(false)}
          title="구성원 상세정보"
          footer={
            <div className="flex gap-2">
              {/*
                이 사람 밑에 계좌나 카드를 바로 만든다. 상세를 닫고 여는 이유는
                이 화면의 다른 팝업과 같다. 모달을 겹쳐 띄우지 않는다.
              */}
              <button
                onClick={() => {
                  // 상세 팝업을 닫고 선택 팝업을 연다. 이 화면은 팝업을 겹쳐 띄우지 않는다.
                  setIsPersonDetailOpen(false);
                  setAddedForPersonId(selectedPerson.id);
                  setAddType('select-person');
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                추가하기
              </button>
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
                숨기기
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
      {isCardDetailOpen && selectedCard && !isEditCardModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsCardDetailOpen(false)}
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
                숨기기
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
                      {formatCurrency(selectedCard.currentUsage, currencyOfCard(selectedCard))}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      신용한도
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {formatCurrency(selectedCard.creditLimit, currencyOfCard(selectedCard))}
                    </p>
                  </div>

                </>
              )}
            </div>

          </>
        </Modal>
      )}

      {/* 카드사 자금 이동 모달 */}
      {isPaymentModalOpen && usage && selectedCard && (
        <Modal
          isOpen={true}
          onClose={closePaymentModal}
          title="카드 대금 기록"
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closePaymentModal}
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
                {isPaymentSubmitting ? '처리 중...' : '기록하기'}
              </button>
            </div>
          }
        >
          <form
            id={PAYMENT_FORM_ID}
            onSubmit={(e) => {
              e.preventDefault();
              handleCardTransfer();
            }}
            className="space-y-4"
          >
            <div className="bg-gray-50 p-3 rounded-lg flex justify-between">
              <span className="text-sm text-gray-600">
                {refundPending ? '환불 예정' : '남은 대금'}
              </span>
              <span className="font-semibold">
                {formatCurrency(Math.abs(Number(usage.outstanding)), usage.currency)}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">방향</label>
              <div className="flex gap-2">
                {TRANSFER_DIRECTIONS.map((option) => (
                  <label key={option.id} className="flex-1 flex items-center">
                    <input
                      type="radio"
                      value={option.id}
                      checked={paymentForm.direction === option.id}
                      onChange={() => setPaymentForm({ ...paymentForm, direction: option.id })}
                      className="mr-2"
                    />
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {paymentForm.direction === 'refund'
                  ? '카드사가 통장에 넣어 준 돈입니다.'
                  : '통장에서 카드사로 나간 돈입니다.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
              <input
                type="date"
                required
                value={paymentForm.date || todayKey(timeZone)}
                min={LEDGER_MIN_ENTRY_DATE_KEY}
                // 연도 오타(2026 -> 2926)를 서버 400 전에 브라우저가 막는다
                max={ledgerMaxEntryDateKey()}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                통장에서 돈이 실제로 오간 날입니다.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">금액 (원)</label>
              <input
                type="number"
                required
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {/*
                상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
                입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수로 남아야 한다.
              */}
              {overTransfer && (
                <p className="mt-1 text-xs text-amber-700">
                  {refundPending ? '환불 예정액' : '남은 대금'}보다{' '}
                  {formatCurrency(overTransfer)} 많습니다. 차액은{' '}
                  {paymentForm.direction === 'refund' ? '대금' : '환불 예정'}으로 남습니다.
                </p>
              )}
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

      {/*
        추가 유형 선택 팝업. 거래 입력 폼의 결제수단 추가 버튼과 같은 컴포넌트를 쓴다.

        구성원 상세에서 들어오면(select-person) 구성원 항목을 뺀다. 그 사람 밑에
        무엇을 만들지를 고르는 자리이지, 다른 사람을 만드는 자리가 아니다.
      */}
      <ChoiceModal
        isOpen={addType === 'select' || addType === 'select-person'}
        onClose={() => setAddType(null)}
        title={addType === 'select-person' ? `${selectedPerson?.name ?? ''} 항목 추가` : '추가하기'}
        choices={[
          ...(addType === 'select-person'
            ? []
            : [
                {
                  key: 'person',
                  icon: '👤',
                  label: '구성원 추가',
                  description: '새로운 가족 구성원을 추가합니다',
                  tone: 'blue' as const,
                  onSelect: () => {
                    setAddType(null);
                    setIsPersonAddModalOpen(true);
                  },
                },
              ]),
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
        /* 구성원 상세에서 들어왔으면 그 사람이 주인이다. 폼에서 바꿀 수 있다. */
        defaultOwnerId={addedForPersonId}
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
              만료 월 (선택)
            </label>
            <input
              type="month"
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
                  마감일
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
                  결제일
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
    </div>
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
              {account.institution?.name}
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              {formatCurrency(account.balance, account.currency)}
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
