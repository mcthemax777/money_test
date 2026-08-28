'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Account, Card, Category, Person } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { sumNetWorth, type NetWorthParts } from '@/lib/net-worth';
import { useUserFilter } from '@/store/user-filter';
import { formatDate, monthInputToIso } from '@/lib/datetime';
import { type ReportDto } from '@money/types';
import ChoiceModal from '@/components/ChoiceModal';
import { useDragReorder } from '@/hooks/useDragReorder';
import { usePersonFilterSync } from '@/hooks/usePersonFilterSync';
import {
  DAY_OF_MONTH_HINT,
  DAY_OF_MONTH_OPTIONS,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@/lib/day-of-month';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
/** 구성원 상세에 보여 줄 최근 거래 수. 더 보려면 가계 화면에서 사람 필터를 쓴다. */
const PERSON_ENTRY_LIMIT = 30;

const CARD_ADD_FORM_ID = 'card-add-form';

/**
 * 오른쪽 패널이 지금 보고 있는 항목 표시.
 *
 * 구성원·계좌·카드 세 목록이 같은 모양을 쓴다. 예전에는 계좌만 표시가 있어서,
 * 사용자나 카드를 누르면 오른쪽만 바뀌고 목록에서는 무엇을 눌렀는지 알 수 없었다.
 *
 * 테두리 두께를 바꾸는 대신 ring을 쓴다. border를 굵히면 그 줄만 1px 커져서
 * 누를 때마다 목록이 미세하게 움직인다.
 */
const SELECTED_MARK = 'ring-2 ring-blue-500';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@/store/project';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';
import PageHeader from '@/components/PageHeader';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import HiddenItemsPanel from '@/components/HiddenItemsPanel';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import CardColorPicker from '@/components/CardColorPicker';
import TransactionListView from '@/components/TransactionListView';
import type { EntryListItem } from '@/components/TransactionItem';
import CardPerformanceField from '@/components/CardPerformanceField';
import CardPerformancePanel from '@/components/CardPerformancePanel';
import CardSettlementPanel from '@/components/CardSettlementPanel';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import { useInstitutions } from '@/hooks/useInstitutions';
import { accountTypeLabel } from '@/lib/account-type';



/**
 * 투자·저축 계좌의 누적 수익.
 *
 * 이체로 넣은 돈은 원금이라 잔액만 보면 불었는지 알 수 없다. 그 계좌에 수입·지출로
 * 기록한 것(배당, 매매 차익, 이자, 수수료)의 합이 수익이다.
 *
 * 어느 유형에 수익이 있는지는 서버가 정한다(reports.service.ts의 PROFIT_TYPES).
 * 화면이 유형을 한 번 더 적어 두면 한쪽만 고쳤을 때 어긋나므로, 서버가 그 계좌를
 * 돌려줬는지만 본다.
 *
 * 아직 기록이 없으면 아무것도 그리지 않는다. 0원을 적어 두면 "계산이 안 됐다"와
 * "아직 수익이 없다"를 구별할 수 없다.
 */
function AccountProfitLine({
  account,
  profit,
}: {
  account: Account;
  profit: string | undefined;
}) {
  if (profit === undefined) return null;

  const value = toNumber(profit);
  if (value === 0) return null;

  return (
    <p
      className={`mt-1 text-sm font-semibold ${value > 0 ? 'text-green-600' : 'text-red-600'}`}
    >
      {/* 손실에 "수익 -"를 붙이면 두 번 읽어야 한다. 부호 대신 이름을 바꾼다. */}
      {value > 0 ? '수익 +' : '손실 -'}
      {formatCurrency(Math.abs(value), account.currency)}
    </p>
  );
}

/** 계좌 유형 배지. 목록과 상세 머리글이 같은 모양을 쓴다. */
function AccountTypeBadge({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
      {accountTypeLabel(type)}
    </span>
  );
}

/**
 * "현금성 · 투자 · 부채" 한 줄.
 *
 * 전체 총자산 상자와 구성원 패널이 같은 형식을 쓴다.
 *
 * 부채도 투자도 없으면 총자산이 곧 현금성이라 쪼갤 것이 없어 아무것도 그리지 않는다.
 */
function NetWorthBreakdown({
  parts,
  className,
}: {
  parts: NetWorthParts | undefined;
  className: string;
}) {
  const displayCurrency = useProjectDisplayCurrency();

  if (!parts) return null;
  if (toNumber(parts.liability) === 0 && toNumber(parts.investment) === 0) return null;

  return (
    <p className={className}>
      현금성 {formatCurrency(parts.cash, displayCurrency)} · 투자{' '}
      {formatCurrency(parts.investment, displayCurrency)} · 부채{' '}
      {formatCurrency(parts.liability, displayCurrency)}
    </p>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { setPeople: setStorePeople, selectedPersonIds, togglePersonId } = useUserFilter();
  const { selectedProjectId } = useProject();
  const myPersonId = useMyPersonId();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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
    /** 혜택 조건이 되는 사용액. 체크카드도 쓴다 (달력 월로 센다). */
    performanceAmount: '',
    /** 카드 앞면 색. 빈 값이면 카드 종류의 기본색으로 그린다. */
    color: '',
    // 청구 주기는 마감일과 결제일 두 값으로 계산한다
    statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
    paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
  });
  const [addError, setAddError] = useState('');

  const [accountTransactions, setAccountTransactions] = useState<any[]>([]);
  /** 원장의 다음 페이지 커서. null이면 끝까지 봤다는 뜻이다. */
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 (계좌 통화) */
  const [accountProfit, setAccountProfit] = useState<Map<string, string>>(new Map());
  /** 항목을 숨기거나 되돌리면 올린다. 숨긴 항목 패널이 이 값을 보고 다시 읽는다. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  /** 거래를 고치거나 지우면 올린다. 구성원 거래와 계좌 원장이 이 값을 보고 다시 읽는다. */
  const [entryVersion, setEntryVersion] = useState(0);
  /** 거래 상세·추가 팝업. 가계 화면과 같은 컴포넌트를 쓴다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  /**
   * 총자산과 사람별 소계, 그리고 계좌 수익.
   *
   * 계좌 잔액이나 카드 부채가 바뀌면 이 값도 함께 다시 받아야 한다. 목록만
   * 갱신하면 왼쪽의 총자산이 옛 값으로 남아, 새로고침해야 맞는 숫자가 나온다.
   * 계좌 수익도 같은 거래에서 나오는 값이라 한 함수에서 함께 받는다.
   */
  const loadNetWorth = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const [netWorthData, profitData] = await Promise.all([
        apiClient.getNetWorth(selectedProjectId),
        apiClient.getAccountProfit(selectedProjectId),
      ]);
      setNetWorth(netWorthData ?? null);
      setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
    } catch (err) {
      console.error('총자산 조회 실패:', err);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
        const [accountsData, peopleData, cardsData, categoriesData, netWorthData, profitData] =
          await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
            apiClient.getCategories(selectedProjectId),
            apiClient.getNetWorth(selectedProjectId),
            apiClient.getAccountProfit(selectedProjectId),
          ]);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);
        setNetWorth(netWorthData ?? null);
        setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [selectedProjectId]);

  usePersonFilterSync(selectedProjectId, people);

  /*
   * 자산주인에서 빠진 항목은 오른쪽 패널에서도 내린다.
   *
   * 왼쪽 목록에 없는 계좌의 내역이 오른쪽에 남아 있으면 어디서 온 것인지 알 수 없고,
   * 위의 총자산에도 들어가지 않아 화면 안에서 숫자가 어긋난다.
   *
   * 주인을 알 수 없는 경우(주인 없는 계좌, 계좌 목록을 아직 못 받은 경우)는 그대로 둔다.
   * 걸러낼 근거가 없는데 닫으면 열자마자 닫히는 것처럼 보인다.
   */
  useEffect(() => {
    if (!detailType) return;

    const ownerId =
      detailType === 'person'
        ? selectedPerson?.id ?? null
        : detailType === 'account'
          ? selectedAccount?.ownerId ?? null
          : accounts.find((account) => account.id === selectedCard?.paymentAccountId)?.ownerId ??
            null;

    if (!ownerId || selectedPersonIds.includes(ownerId)) return;
    setDetailType(null);
  }, [detailType, selectedPersonIds, accounts, selectedPerson, selectedAccount, selectedCard]);

  /**
   * 거래를 저장하거나 지운 뒤.
   *
   * 목록(구성원 거래, 계좌 원장)은 entryVersion을 보고 각자 다시 읽는다. 잔액과
   * 총자산은 여기서 받는다. 고른 계좌·카드는 목록에서 다시 집어 온다 — 상세 패널이
   * 들고 있는 것은 렌더 시점의 사본이라 그대로 두면 옛 잔액이 남는다.
   */
  const handleEntryChange = useCallback(async () => {
    setEntryVersion((version) => version + 1);
    if (!selectedProjectId) return;

    const [accountsData, cardsData] = await Promise.all([
      apiClient.getAccountsV2(selectedProjectId),
      apiClient.getCards(selectedProjectId),
    ]);
    setAccounts(accountsData || []);
    setCards(cardsData || []);
    setSelectedAccount((prev) => (prev ? accountsData?.find((a) => a.id === prev.id) ?? prev : prev));
    setSelectedCard((prev) => (prev ? cardsData?.find((c) => c.id === prev.id) ?? prev : prev));
    await loadNetWorth();
  }, [selectedProjectId, loadNetWorth]);

  /** 거래 팝업 안에서 계좌·카드·분류·사람을 새로 만들었을 때. */
  const handleReferenceDataChange = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

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
  }, [selectedPerson, detailType, selectedProjectId, entryVersion]);

  // 계좌 선택 시 거래 내역 로드
  useEffect(() => {
    if (selectedAccount && detailType === 'account') {
      loadAccountTransactions(selectedAccount.id);
    } else {
      setAccountTransactions([]);
      setLedgerCursor(null);
    }
  }, [selectedAccount, detailType, loadAccountTransactions, entryVersion]);

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
      await loadNetWorth();
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
      await loadNetWorth();
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
      await loadNetWorth();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '숨기지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 카드 쪽 숫자가 바뀐 뒤의 새로고침.
   *
   * 카드 목록의 사용액과 총자산은 같은 부채 잔액에서 나온다. 한쪽만 다시 읽으면
   * 같은 화면에 두 숫자가 서로 다르게 남는다.
   *
   * 남은 대금은 CardSettlementPanel이 스스로 다시 읽는다.
   */
  const refreshAfterCardChange = useCallback(async () => {
    if (!selectedProjectId) return;
    setCards((await apiClient.getCards(selectedProjectId)) || []);
    // 카드 부채는 총자산에서 빠지는 값이라 함께 다시 받는다.
    await loadNetWorth();
  }, [loadNetWorth, selectedProjectId]);

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
        // 실적은 카드 종류를 가리지 않는다. 비워 두면 조건 없음이라 빈 문자열로 보낸다.
        performanceAmount: cardForm.performanceAmount
          ? toAmountString(cardForm.performanceAmount)
          : '',
        // 비워 두면 보내지 않는다. 서버는 null로 두고 화면이 종류별 기본색을 쓴다.
        color: cardForm.color || undefined,
        statementClosingDay:
          cardForm.cardType === 'credit' ? cardForm.statementClosingDay : undefined,
        paymentDueDay: cardForm.cardType === 'credit' ? cardForm.paymentDueDay : undefined,
      });
      const cardsData = await apiClient.getCards(selectedProjectId);
      setCards(cardsData || []);
      await loadNetWorth();
      setCardForm({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuerId: '',
        expiryDate: '',
        creditLimit: '',
        performanceAmount: '',
        color: '',
        statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
        paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
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
  /** 오른쪽 패널이 지금 보고 있는 항목의 id */
  const selectedIdOfDetail =
    detailType === 'person'
      ? selectedPerson?.id
      : detailType === 'account'
        ? selectedAccount?.id
        : detailType === 'card'
          ? selectedCard?.id
          : undefined;

  type PersonNetWorth = ReportDto.NetWorth['byPerson'][number];
  const netWorthByPerson = new Map<string, PersonNetWorth>(
    (netWorth?.byPerson ?? []).map((row) => [row.personId, row]),
  );

  // 계좌가 없는 구성원도 표시한다. 제목에서 고른 자산주인만 남는다.
  const displayPeople = people.filter((person) => selectedPersonIds.includes(person.id));

  /*
   * 전원을 고른 상태인지.
   *
   * 총자산과 추이 그래프는 이때만 서버의 전체 기준 값을 그대로 쓴다. 주인이 없는
   * 계좌는 사람별 소계에 들어가지 않으므로, 전체를 보고 있는데 소계를 더해 쓰면
   * 그만큼 금액이 빠진다. 목록 필터(personIds)가 전체일 때 조건을 빼는 것과 같은 규칙이다.
   */
  const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;
  const scopedNetWorth = allPeopleSelected
    ? netWorth
    : sumNetWorth(selectedPersonIds.map((id) => netWorthByPerson.get(id)));
  const totalBalance = toNumber(scopedNetWorth?.total);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <PersonScopeTitle
            noun="자산"
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
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
          await loadNetWorth();
        }}
      />

      {/* 총자산과 전체 추이는 계좌를 골라도 그대로 둔다. 고른 계좌는 아래 오른쪽에 펼친다. */}
      <div className="bg-blue-600 text-white rounded-lg p-6">
        <p className="text-sm opacity-90">총 자산</p>
        <p className="text-4xl font-bold mt-2">
          {formatCurrency(totalBalance, displayCurrency)}
        </p>
        <NetWorthBreakdown parts={scopedNetWorth ?? undefined} className="text-sm opacity-90 mt-2" />
      </div>

      {/* 고른 자산주인만 그린다. 전원이면 ownerIds를 빼서 주인 없는 계좌까지 담는다. */}
      <AssetHistoryChart
        projectId={selectedProjectId}
        ownerIds={allPeopleSelected ? undefined : selectedPersonIds}
      />

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
            accountProfit={accountProfit}
            /*
              지금 펼쳐 둔 항목. detailType과 함께 넘겨야 한다. 고른 계좌·카드·구성원은
              닫아도 state에 남으므로 id만 보면 오른쪽에 없는 항목까지 강조된다.
            */
            selected={
              detailType && selectedIdOfDetail ? { type: detailType, id: selectedIdOfDetail } : null
            }
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
                  <div className="mt-1 flex items-center gap-1.5">
                    {selectedAccount.institution?.name && (
                      <p className="text-sm text-gray-600">{selectedAccount.institution.name}</p>
                    )}
                    <AccountTypeBadge type={selectedAccount.type} />
                  </div>
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
                    {formatCurrency(netWorthByPerson.get(selectedPerson.id)?.total ?? 0, displayCurrency)}
                  </p>
                  {/* 전체 총자산 상자와 같은 형식으로 무엇이 얼마인지 쪼개 보여 준다 */}
                  <NetWorthBreakdown
                    parts={netWorthByPerson.get(selectedPerson.id)}
                    className="text-sm text-gray-600 mt-1"
                  />
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
                    <TransactionListView
                      entries={personEntries}
                      onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
                    />
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

              {/* 실적은 카드 종류를 가리지 않는다. 세는 구간만 다르다. */}
              <CardPerformancePanel cardId={selectedCard.id} reloadToken={entryVersion} />

              <div className="pt-4 border-t">
                <CardSettlementPanel
                  card={selectedCard}
                  paymentAccountOwnerId={
                    accounts.find((a) => a.id === selectedCard.paymentAccountId)?.ownerId
                  }
                  reloadToken={entryVersion}
                  onChange={refreshAfterCardChange}
                />
              </div>
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
                유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {accountTypeLabel(selectedAccount.type)}
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
          // 잔액을 고치면 총자산도 달라진다.
          loadNetWorth();
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
          // 한도나 결제 통장을 바꾸면 부채가 걸리는 자리가 달라진다.
          loadNetWorth();
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
        onSuccess={(newAccounts) => {
          setAccounts(newAccounts);
          loadNetWorth();
        }}
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
            performanceAmount: '',
            color: '',
            statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
            paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 색 (선택)
            </label>
            <CardColorPicker
              value={cardForm.color}
              onChange={(color) => setCardForm({ ...cardForm, color })}
            />
            <p className="mt-1 text-xs text-gray-500">
              홈 화면의 카드 앞면 색입니다. 고르지 않으면{' '}
              {cardForm.cardType === 'credit' ? '신용카드 기본색(파랑)' : '체크카드 기본색(초록)'}
              으로 보입니다.
            </p>
          </div>

          <CardPerformanceField
            cardType={cardForm.cardType}
            value={cardForm.performanceAmount}
            onChange={(performanceAmount) => setCardForm({ ...cardForm, performanceAmount })}
            statementClosingDay={cardForm.statementClosingDay}
          />

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
    </div>
  );
}

/**
 * 구성원별 자산 목록. 구성원과 계좌를 각각 드래그로 정렬한다.
 *
 * 계좌 목록은 구성원마다 별도 컴포넌트로 두어야 한다. 훅은 목록 하나를 다루므로
 * 한 컴포넌트에서 여러 묶음을 처리할 수 없다.
 */
/** 오른쪽 패널이 보고 있는 항목. 세 목록이 이것을 보고 저마다 한 줄을 강조한다. */
type SelectedItem = { type: 'person' | 'account' | 'card'; id: string } | null;

function PersonAssetList({
  people,
  accounts,
  cardsOf,
  netWorthByPerson,
  accountProfit,
  selected,
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
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 */
  accountProfit: Map<string, string>;
  selected: SelectedItem;
  onPersonClick: (person: Person) => void;
  onAccountClick: (account: Account) => void;
  onCardClick: (card: Card) => void;
  onReorderPeople: (ids: string[]) => void;
  onReorderAccounts: (ids: string[]) => void;
  onReorderCards: (ids: string[]) => void;
}) {
  const displayCurrency = useProjectDisplayCurrency();
  const { items, dragProps, draggingId } = useDragReorder(people, onReorderPeople);

  return (
    <div className="space-y-8">
      {items.map((person) => (
        <div
          key={person.id}
          {...dragProps(person.id)}
          className={`bg-white rounded-lg shadow p-6 hover:shadow-md transition ${
            selected?.type === 'person' && selected.id === person.id ? SELECTED_MARK : ''
          } ${draggingId === person.id ? 'opacity-50' : ''}`}
        >
          <button onClick={() => onPersonClick(person)} className="w-full text-left mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {person.name}
                </h2>
                <p className="text-sm text-gray-600">
                  소계: {formatCurrency(netWorthByPerson.get(person.id)?.total ?? 0, displayCurrency)}
                </p>
              </div>
            </div>
          </button>

          <AccountList
            accounts={accounts.filter((account) => account.ownerId === person.id)}
            cardsOf={cardsOf}
            accountProfit={accountProfit}
            selected={selected}
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
  accountProfit,
  selected,
  onAccountClick,
  onCardClick,
  onReorder,
  onReorderCards,
}: {
  accounts: Account[];
  cardsOf: (accountId: string) => Card[];
  accountProfit: Map<string, string>;
  selected: SelectedItem;
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
          className={`rounded-lg border border-gray-200 p-4 hover:shadow-md transition ${
            selected?.type === 'account' && selected.id === account.id
              ? `${SELECTED_MARK} bg-blue-50`
              : ''
          } ${draggingId === account.id ? 'opacity-50' : ''}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccountClick(account);
            }}
            className="w-full text-left hover:opacity-70 transition"
          >
            {/*
              위에는 계좌명, 아래에는 개설 기관을 둔다. 어느 계좌인지 먼저 알아야 하고,
              은행은 계좌를 여러 개 가진 사람에게만 필요한 부속 정보다.

              유형은 총자산을 현금성·투자·부채로 나누는 기준이라 목록에서 바로 보여야
              하므로 계좌명 옆에 붙인다.
            */}
            <div className="flex items-center gap-1.5">
              <p className="text-sm text-gray-600">{account.name}</p>
              <AccountTypeBadge type={account.type} />
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              {formatCurrency(account.balance, account.currency)}
            </p>
            <AccountProfitLine
              account={account}
              profit={accountProfit.get(account.id)}
            />
            {/* 현금과 부동산은 개설 기관이 없다 */}
            {account.institution?.name && (
              <p className="text-xs text-gray-500 mt-2">{account.institution.name}</p>
            )}
            {account.accountNumber && (
              <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
            )}
          </button>

          <CardList
            cards={cardsOf(account.id)}
            selected={selected}
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
  selected,
  onCardClick,
  onReorder,
}: {
  cards: Card[];
  selected: SelectedItem;
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
          className={`px-3 py-2 rounded border transition ${
            selected?.type === 'card' && selected.id === card.id
              ? `${SELECTED_MARK} border-blue-200 bg-blue-50`
              : 'border-green-100 bg-green-50 hover:bg-green-100'
          } ${draggingId === card.id ? 'opacity-50' : ''}`}
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
