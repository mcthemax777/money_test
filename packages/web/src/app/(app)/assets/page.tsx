'use client';

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import type { Account, Card, Category, Person } from '@money/core/lib/types';
import { formatCurrency } from '@money/core/lib/money';
import {
  ASSET_TYPE_GROUPS,
  assetGroupAmount,
  groupAccountsOfPeople,
  type AssetGroupKey,
  sumNetWorth,
} from '@money/core/lib/net-worth';
import { mergeOrder } from '@money/core/lib/reorder';
import { isEveryPersonSelected, useUserFilter } from '@money/core/store/user-filter';
import { type ReportDto } from '@money/types';
import { Info } from 'lucide-react';
import { EMPTY_SEARCH, type TransactionSearch } from '@money/core/hooks/useTransactions';
import { accountsOfGroup, useAccountExclusion } from '@money/core/hooks/useAccountExclusion';
import NavIcon from '@/components/NavIcon';
import AssetAddChooser, { AssetAddIcon, type AssetAddKind } from '@/components/AssetAddChooser';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import {
  useCanEdit,
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
} from '@money/core/store/project';
import PersonModal from '@/components/PersonModal';
import EditAccountModal from '@/components/EditAccountModal';
import EditCardModal from '@/components/EditCardModal';
import AddAccountModal from '@/components/AddAccountModal';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import AssetTypeSummary from '@/components/AssetTypeSummary';
import HiddenItemsPanel from '@/components/HiddenItemsPanel';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import TransactionsView from '@/components/TransactionsView';
import type { EntryListItem } from '@/components/TransactionItem';
import CardDetailBody from '@/components/CardDetailBody';
import { LedgerList } from '@/components/AssetLedgerList';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import { useTranslation } from '@money/core/lib/i18n';
import { apiErrorCode, useApiError } from '@money/core/lib/api-error';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSwapScroll } from '@/hooks/useSwapScroll';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { RevealScope } from '@/components/ChartReveal';
import { ScreenVisibility } from '@/components/ScreenVisible';
import AssetList from '@/components/assets/AssetList';
import { AccountTypeBadge } from '@/components/assets/AssetBits';
import { AssetDetailHeader, DetailIconButton } from '@/components/assets/AssetDetailHeader';
import NetWorthBreakdown from '@/components/assets/NetWorthBreakdown';
import { AccountInfoModal, CardInfoModal, PersonInfoModal } from '@/components/assets/AssetInfoModals';
import AssetCardAddModal, { useAssetCardAdd } from '@/components/assets/AssetCardAddModal';
import RecentEntries from '@/components/assets/RecentEntries';
import { useAssetPageLedger } from '@/components/assets/useAssetPageLedger';

/** 구성원 상세에 보여 줄 최근 거래 수. 더 보려면 가계 화면에서 사람 필터를 쓴다. */
const PERSON_ENTRY_LIMIT = 30;

/**
 * 상세가 화면을 통째로 쓰는 너비. `hideOnNarrow` 의 `lg:` 와 같은 자리에서 갈린다.
 *
 * 이 너비에서만 목록이 접히므로, 스크롤 자리를 적고 되돌리는 것도 여기서만 한다.
 */
const DETAIL_ALONE = '(max-width: 1023px)';

/** 지우려다 거래·기록이 남아 거절당한 까닭들. 이때는 숨기기를 대신 묻는다 (`deleteOrAskToHide`). */
const HIDE_INSTEAD_CODES = [
  'PERSON_HAS_ENTRIES',
  'PERSON_HAS_RECORDS',
  'ACCOUNT_HAS_ENTRIES',
  'ACCOUNT_HAS_RECORDS',
  'CARD_HAS_ENTRIES',
  'CARD_HAS_RECORDS',
];

export default function DashboardPage() {
  const { t } = useTranslation();
  /** 읽기 전용 구성원에게는 쓰기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const { messageOf } = useApiError();
  const { setPeople: setStorePeople, selectedPersonIds, togglePersonId, setPersonFilter } =
    useUserFilter();
  const { selectedProjectId } = useProject();
  const myPersonId = useMyPersonId();
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
  const [detailType, setDetailType] = useState<'person' | 'account' | 'card' | 'group' | null>(
    null,
  );
  /** 자산유형별 목록에서 누른 묶음. 그 묶음 계좌들의 합계 추이와 최근 거래를 펼친다. */
  const [selectedGroup, setSelectedGroup] = useState<AssetGroupKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  /**
   * 상세에서 "거래내역 보기"로 건너간 검색. null이면 자산 화면을 그린다.
   *
   * 고른 항목(detailType·selected*)은 그대로 두므로 ←로 돌아오면 떠나온 상세가 그
   * 자리에 서 있다. 분류·태그 화면처럼 다시 펼 표시를 따로 들 필요가 없다.
   */
  const [entriesSearch, setEntriesSearchState] = useState<TransactionSearch | null>(null);
  /* 거래내역을 펴면 맨 위로, 닫으면 보던 자리로. 아래 화면을 숨겨 두므로 자리를 따로 맞춘다. */
  const rememberScroll = useSwapScroll(entriesSearch !== null);
  const setEntriesSearch = (next: TransactionSearch | null) => {
    if (next) rememberScroll();
    setEntriesSearchState(next);
  };
  /**
   * 사용자 상세에서 거래내역으로 건너가기 전의 자산주인 선택.
   *
   * 사용자의 거래는 검색 조건으로 걸지 않는다. "이 사람의 거래"는 **돈이 오간 계좌의
   * 주인**이 그 사람인 거래이고(상세의 최근 거래도 같은 기준이다), 그 조건을 가진
   * 것은 화면 위쪽의 자산주인 선택뿐이다. 검색 창의 사람 조건은 "거래를 낸 사람"이라
   * 남의 카드로 쓴 건에서 갈린다.
   *
   * 전역 선택을 건드리는 값이므로 떠나기 전 상태를 들고 있다가 돌아올 때 되돌린다.
   */
  const personScope = useRef<{
    selectedPersonIds: string[];
    personFilterTouched: boolean;
  } | null>(null);
  const [isEditAccountModalOpen, setIsEditAccountModalOpen] = useState(false);
  const [isEditCardModalOpen, setIsEditCardModalOpen] = useState(false);
  /**
   * 계좌 추가 폼의 통장 주인을 미리 채울 사람.
   *
   * 목록에서 그 사람의 "계좌 추가"를 눌러 들어오면 그 사람이고, 구성원 상세에서
   * 들어와도 마찬가지다. 폼에서 바꿀 수 있다.
   */
  const [addedForPersonId, setAddedForPersonId] = useState<string | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isPersonAddModalOpen, setIsPersonAddModalOpen] = useState(false);
  /** 붙박이 추가 단추가 연, 무엇을 만들지 고르는 팝업. */
  const [isAddChooserOpen, setIsAddChooserOpen] = useState(false);

  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  /**
   * 합계 제외. 맨 위 총액·추이와 목록의 소계는 뺀 계좌를 덜어 낸 값(`countedNetWorth`)을
   * 쓴다. 계좌 상세는 그 계좌를 보려고 고른 것이라 덜어 내지 않는다.
   */
  const exclusion = useAccountExclusion({
    projectId: selectedProjectId,
    accounts,
    cards,
    netWorth,
  });
  const countedNetWorth = exclusion.netWorth;
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 (계좌 통화) */
  const [accountProfit, setAccountProfit] = useState<Map<string, string>>(new Map());
  /*
   * 남이 고친 것도 이 화면에 들어와야 한다.
   *
   * 아래 counter 들은 이 화면이 제 손으로 고쳤을 때만 오른다. 그것만 보면 다른 기기에서
   * 만든 통장·카드·거래가 이 화면에는 영영 나타나지 않는다.
   */
  const mirrorVersion = useMirrorVersion();
  /**
   * 어느 프로젝트를 이미 그렸는가.
   *
   * 신호가 올 때마다 다시 받는데, 그때마다 로딩 화면을 씌우면 보고 있던 목록이 계속
   * 깜빡인다. 처음 여는 순간에만 씌운다.
   */
  const loadedProjectRef = useRef<string | null>(null);
  /** 항목을 숨기거나 되돌리면 올린다. 숨긴 항목 패널이 이 값을 보고 다시 읽는다. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  /** 거래를 고치거나 지우면 올린다. 구성원 거래와 계좌 원장이 이 값을 보고 다시 읽는다. */
  const [entryVersion, setEntryVersion] = useState(0);
  /** 거래 상세·추가 팝업. 가계 화면과 같은 컴포넌트를 쓴다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  /**
   * 원장 한 줄을 눌렀을 때. 그 전표를 읽어 거래 상세를 연다.
   *
   * 원장 줄이 들고 있는 것은 `entryId` 뿐이라, 상세 팝업이 받는 한 줄(`EntryListItem`)로
   * 펴려면 그 전표를 따로 읽어야 한다. 못 읽으면 조용히 아무것도 열지 않는다 --
   * 열리지 않는 팝업을 세우느니 누르지 않은 것처럼 두는 편이 낫다.
   */
  const openLedgerEntry = useCallback((entryId: string) => {
    void apiClient
      .getEntry(entryId)
      .then((entry) => entryEditorRef.current?.openDetail(entry))
      .catch(() => {});
  }, []);

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

    /*
     * 늦게 도착한 옛 응답은 버린다 (2026-10-16). 가계부를 바꾸거나 신호가 겹쳐 다시 받는 사이 앞 요청이
     * 나중에 끝나면, 앞 가계부의 통장·카드가 지금 가계부 화면에 남았다.
     */
    let stale = false;
    const loadData = async () => {
      try {
        if (loadedProjectRef.current !== selectedProjectId) setIsLoading(true);
        const [accountsData, peopleData, cardsData, categoriesData, netWorthData, profitData] =
          await Promise.all([
            apiClient.getAccountsV2(selectedProjectId),
            apiClient.getPeople(selectedProjectId),
            apiClient.getCards(selectedProjectId),
            apiClient.getCategories(selectedProjectId),
            apiClient.getNetWorth(selectedProjectId),
            apiClient.getAccountProfit(selectedProjectId),
          ]);
        if (stale) return;
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);
        setNetWorth(netWorthData ?? null);
        setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
      } catch (err) {
        if (!stale) setError(t('home.loadFailed'));
      } finally {
        if (!stale) {
          loadedProjectRef.current = selectedProjectId;
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, mirrorVersion]);

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

    // 묶음은 한 사람의 것이 아니다. 고른 사람이 바뀌면 그 사람들의 묶음으로 따라간다.
    if (detailType === 'group') return;

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
   * 거래내역 검색에 추이 그래프에서 누른 칸의 기간을 더한다 (2026-10-14 사용자 요청). 칸을
   * 누르면 거래내역 보기 단추와 같은 화면이 그 기간으로 좁혀 열린다.
   */
  const withPeriod = (search: TransactionSearch, range?: { from: string; to: string }) =>
    range ? { ...search, startDate: range.from, endDate: range.to } : search;

  /**
   * 한 사람의 거래내역으로 건너간다.
   *
   * 자산주인 선택을 그 사람만으로 좁힌다. 거래 화면은 이 선택으로 목록·합계를
   * 만들므로, 그렇게 해야 상세에 있던 최근 거래와 같은 기준이 된다.
   */
  const showPersonEntries = (personId: string, range?: { from: string; to: string }) => {
    const state = useUserFilter.getState();
    personScope.current = {
      selectedPersonIds: state.selectedPersonIds,
      personFilterTouched: state.personFilterTouched,
    };
    // 건드림 표시를 함께 켠다. 켜지 않으면 거래 화면의 usePersonFilterSync 가 이
    // 선택을 "한 번도 고르지 않은 상태"로 보고 전체 선택으로 되돌린다.
    setPersonFilter([personId], true);
    setEntriesSearch(withPeriod(EMPTY_SEARCH, range));
  };

  /**
   * 거래내역을 접고 떠나온 상세로 돌아간다.
   *
   * 좁혀 두었던 자산주인 선택을 떠나기 전 그대로 되돌린다. 거래 화면에서 사람을
   * 바꿔 봤더라도 되돌린다 -- 이 화면은 거래 탭이 아니라 자산 상세에서 한 걸음
   * 들어온 자리다. 그 걸음이 화면 전체의 자산주인 설정을 바꿔 놓고 끝나면, 돌아온
   * 자산 목록이 들어가기 전과 달라져 있다.
   */
  const closeEntries = () => {
    setEntriesSearch(null);

    const before = personScope.current;
    personScope.current = null;
    if (before) setPersonFilter(before.selectedPersonIds, before.personFilterTouched);
  };

  /**
   * 상세를 접는다.
   *
   * 좁은 화면의 ←, 넓은 화면의 ×, 그리고 브라우저의 뒤로가기가 함께 쓴다. 세 곳이
   * 각자 지우면 어느 하나가 빠져 목록에 없는 항목의 상세가 남는다.
   */
  const closeDetail = () => {
    setDetailType(null);
    setSelectedPerson(null);
    setSelectedAccount(null);
    setSelectedCard(null);
  };

  /**
   * 상세로 들어가기 전 목록에서 보던 자리. 좁은 화면에서만 쓴다.
   *
   * 좁은 화면에서는 상세가 화면을 통째로 쓰므로 위의 칸들이 접힌다(`hideOnNarrow`).
   * 접히는 순간 문서가 짧아져 브라우저가 스크롤을 끌어올리기 때문에, 상세를 여는
   * 손짓에서 미리 적어 둔다 -- 접힌 뒤에 읽으면 이미 0 이다.
   */
  const listScrollY = useRef(0);
  const rememberListScroll = () => {
    if (window.matchMedia(DETAIL_ALONE).matches) listScrollY.current = window.scrollY;
  };

  /*
   * 상세를 펼치면 맨 위로, 접으면 보던 자리로.
   *
   * 좁은 화면에서 목록이 접히고 펴지는 자리다. 펼 때 내려와 있던 자리에 그대로 두면
   * 상세의 가운데부터 보이고(상세가 길면 브라우저가 끌어올려 주지도 않는다), 접고
   * 나서 맨 위에 서 있으면 한참 내려가 고른 카드를 보고 나온 사람이 목록을 처음부터
   * 다시 훑어 내려야 한다.
   *
   * 넓은 화면은 목록과 상세가 나란해 접히는 것이 없으므로 건드리지 않는다.
   */
  const wasDetailOpen = useRef(false);
  useLayoutEffect(() => {
    const isOpen = detailType !== null;
    if (isOpen === wasDetailOpen.current) return;
    wasDetailOpen.current = isOpen;

    if (!window.matchMedia(DETAIL_ALONE).matches) return;
    window.scrollTo({ top: isOpen ? 0 : listScrollY.current });
  }, [detailType]);

  /*
   * 브라우저(그리고 휴대폰)의 뒤로가기는 머리글의 ← 를 누른 것과 같게 동작한다.
   *
   * 한 걸음 들어간 자리가 둘이다 -- 상세를 펴고, 거기서 거래내역까지 들어갈 수 있다.
   * 나중에 연 것이 먼저 닫힌다(useCloseOnBack 이 쌓인 차례대로 닫는다).
   */
  useCloseOnBack(detailType !== null, closeDetail);
  useCloseOnBack(entriesSearch !== null, closeEntries);

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

    // 다시 받기가 실패해도 거래는 이미 저장됐다. 처리되지 않은 거부로 두지 않고 화면 위에 알린다.
    try {
      const [accountsData, cardsData] = await Promise.all([
        apiClient.getAccountsV2(selectedProjectId),
        apiClient.getCards(selectedProjectId),
      ]);
      setAccounts(accountsData || []);
      setCards(cardsData || []);
      setSelectedAccount((prev) => (prev ? accountsData?.find((a) => a.id === prev.id) ?? prev : prev));
      setSelectedCard((prev) => (prev ? cardsData?.find((c) => c.id === prev.id) ?? prev : prev));
      await loadNetWorth();
    } catch {
      setError(t('home.loadFailed'));
    }
  }, [selectedProjectId, loadNetWorth, t]);

  /** 거래 팝업 안에서 계좌·카드·분류·사람을 새로 만들었을 때. */
  const handleReferenceDataChange = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  /**
   * 구성원의 최근 거래.
   *
   * 계좌 원장(posting)과 달리 전표 단위로 본다. 한 사람이 여러 계좌를 쓰므로
   * 계좌별 잔액 흐름보다 "이 사람이 무엇을 썼는가"가 알고 싶은 것이다.
   */
  /*
   * 묶음 상세도 같은 자리를 쓴다. 그 묶음 통장으로 오간 것과 그 통장에 딸린 카드로 쓰고
   * 갚은 것이다 (거래 검색의 결제수단 조건, 두 조건은 "또는"이다).
   */
  const groupMethods = useMemo(() => {
    if (detailType !== 'group' || !selectedGroup) return null;
    const visible = people.filter((person) => selectedPersonIds.includes(person.id));
    const grouped =
      groupAccountsOfPeople(visible, accounts).find((row) => row.group.key === selectedGroup)
        ?.accounts ?? [];
    const accountIds = grouped.map((account) => account.id);
    return {
      accountIds,
      cardIds: cards
        .filter((card) => accountIds.includes(card.paymentAccountId))
        .map((card) => card.id),
    };
  }, [detailType, selectedGroup, people, selectedPersonIds, accounts, cards]);

  useEffect(() => {
    const query =
      detailType === 'person' && selectedPerson
        ? { personId: selectedPerson.id }
        : groupMethods && groupMethods.accountIds.length > 0
          ? {
              paymentAccountIds: groupMethods.accountIds.join(','),
              ...(groupMethods.cardIds.length > 0
                ? { paymentCardIds: groupMethods.cardIds.join(',') }
                : {}),
            }
          : null;
    if (!query) {
      setPersonEntries([]);
      return;
    }

    let cancelled = false;
    apiClient
      .getEntries({ ...query, limit: PERSON_ENTRY_LIMIT }, selectedProjectId)
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
  }, [selectedPerson, detailType, groupMethods, selectedProjectId, entryVersion, mirrorVersion]);

  /** 계좌 상세의 원장 (`useAssetPageLedger`). 계좌 상세가 아니면 비어 있다. */
  const ledger = useAssetPageLedger(detailType === 'account' ? selectedAccount : null, {
    entryVersion,
    mirrorVersion,
  });

  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.paymentAccountId === accountId);

  /**
   * 없애기. **삭제를 먼저 시도하고, 거절당하면 숨기기를 묻는다.**
   *
   * 조용히 숨기면 지운 줄 알고, 아무 말 없이 실패하면 눌러도 안 되는 것으로 보인다.
   * 그래서 거래내역이 남아 있다는 이유를 그대로 보여 주고, 그 자리에서 숨기기로 이어
   * 갈지 묻는다. 사용자가 그만두면 false 를 돌려준다 (목록을 건드리지 않는다).
   */
  const deleteOrAskToHide = async (
    remove: () => Promise<void>,
    hide: () => Promise<void>,
  ): Promise<boolean> => {
    try {
      await remove();
      return true;
    } catch (err) {
      if (!HIDE_INSTEAD_CODES.includes(apiErrorCode(err) ?? '')) throw err;
      const reason = messageOf(err, 'assets.removeFailed');
      if (!window.confirm(`${reason}\n\n${t('assets.hideInstead')}`)) return false;
      await hide();
      return true;
    }
  };

  /**
   * 고른 항목 하나를 없앤다 (지우거나, 거절당하면 숨긴다). 구성원·계좌·카드가 같은 길을 쓴다.
   *
   * 지웠거나 숨겼으면 true. 묻는 창에서 그만두었거나 실패하면 false 라, 부른 창은 닫지 않는다.
   * 없앤 뒤에는 그 목록을 다시 받고(`reload`) 상세를 접는다(`clear`).
   */
  const removeSelected = async ({
    remove,
    reload,
    clear,
  }: {
    remove: (options?: { hide: true }) => Promise<void>;
    reload: () => Promise<void>;
    clear: () => void;
  }): Promise<boolean> => {
    if (!window.confirm(t('assets.deleteConfirm'))) return false;
    try {
      setIsSubmitting(true);
      const done = await deleteOrAskToHide(
        () => remove(),
        () => remove({ hide: true }),
      );
      if (!done) return false;
      await reload();
      clear();
      setDetailType(null);
      setHiddenVersion((v) => v + 1);
      await loadNetWorth();
      return true;
    } catch (err: any) {
      alert(messageOf(err, 'assets.removeFailed'));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePerson = async (): Promise<boolean> =>
    Boolean(selectedPerson) &&
    removeSelected({
      remove: (options) => apiClient.deletePerson(selectedPerson!.id, options),
      reload: async () => setPeople((await apiClient.getPeople(selectedProjectId)) || []),
      clear: () => {
        setIsPersonDetailOpen(false);
        setSelectedPerson(null);
      },
    });

  const handleDeleteAccount = async (): Promise<boolean> =>
    Boolean(selectedAccount) &&
    removeSelected({
      remove: (options) => apiClient.deleteAccountV2(selectedAccount!.id, options),
      reload: async () => setAccounts((await apiClient.getAccountsV2(selectedProjectId)) || []),
      clear: () => {
        setIsAccountDetailOpen(false);
        setSelectedAccount(null);
      },
    });

  const handleDeleteCard = async (): Promise<boolean> =>
    Boolean(selectedCard) &&
    removeSelected({
      remove: (options) => apiClient.deleteCard(selectedCard!.id, options),
      reload: async () => setCards((await apiClient.getCards(selectedProjectId)) || []),
      clear: () => {
        setIsCardDetailOpen(false);
        setSelectedCard(null);
      },
    });

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
    // 대금을 기록하면 거래가 하나 생긴다. 그 줄을 보는 목록들도 다시 읽어야 한다.
    setEntryVersion((version) => version + 1);
  }, [loadNetWorth, selectedProjectId]);

  /*
   * 추가는 오른쪽 아래 붙박이 단추 하나에서 시작한다 (거래 화면과 같은 자리).
   *
   * 예전에는 목록 곳곳에 추가 버튼이 서 있어, 통장이 늘수록 같은 버튼이 그만큼 쌓였다.
   * 지금은 단추가 무엇을 만들지 묻고, 주인·결제 통장은 폼에서 고른다. 상세의 버튼은
   * 그 자리가 주인·통장을 채운 채로 연다.
   */
  const openPersonAdd = () => setIsPersonAddModalOpen(true);

  const openAccountAdd = (personId: string | null) => {
    setAddedForPersonId(personId);
    setIsAccountModalOpen(true);
  };

  /** 카드 추가 팝업 (`useAssetCardAdd`). 만든 뒤 카드 목록과 총자산을 다시 받는다. */
  const cardAdd = useAssetCardAdd({
    projectId: selectedProjectId,
    setIsSubmitting,
    onAdded: async (cardsData) => {
      setCards(cardsData);
      await loadNetWorth();
    },
  });
  const openCardAdd = cardAdd.open;

  /**
   * 붙박이 단추로 연 폼에 미리 채울 주인과 결제 통장.
   *
   * 상세를 펼쳐 두었으면 그 항목에서 읽는다 -- 보고 있던 사람·통장 밑에 만들 때가
   * 가장 흔하다. 아니면 주인은 "나"(목록에 없으면 목록의 첫 사람)이고, 결제 통장은
   * 비워 둔다. 통장은 사람마다 여럿이라 아무것이나 골라 두면 모르고 저장하기 쉽다.
   */
  const addDefaults = (): { ownerId: string | null; accountId: string } => {
    if (detailType === 'person' && selectedPerson) {
      return { ownerId: selectedPerson.id, accountId: '' };
    }
    if (detailType === 'account' && selectedAccount) {
      return { ownerId: selectedAccount.ownerId ?? null, accountId: selectedAccount.id };
    }
    if (detailType === 'card' && selectedCard) {
      const account = accounts.find((item) => item.id === selectedCard.paymentAccountId);
      return { ownerId: account?.ownerId ?? null, accountId: selectedCard.paymentAccountId };
    }
    const fallbackOwner = displayPeople.some((person) => person.id === myPersonId)
      ? myPersonId
      : (displayPeople[0]?.id ?? null);
    return { ownerId: fallbackOwner, accountId: '' };
  };

  const chooseAdd = (kind: AssetAddKind) => {
    setIsAddChooserOpen(false);
    const { ownerId, accountId } = addDefaults();
    if (kind === 'person') openPersonAdd();
    else if (kind === 'account') openAccountAdd(ownerId);
    else openCardAdd(accountId);
  };

  /** 조회 팝업을 닫고 수정 폼을 연다. 둘이 겹쳐 열리지 않게 순서를 지킨다. */
  const handleEditPersonClick = () => {
    setIsPersonDetailOpen(false);
    setPersonModalMode('edit');
    setPersonModalOpen(true);
  };

  /**
   * 드래그로 바꾼 구성원 순서 저장.
   *
   * 목록에는 고른 자산주인만 서 있으므로 받은 차례도 그만큼이다. 서버는 **받은 목록에만**
   * 차례 값을 다시 매기므로 그대로 보내면 빠진 사람들의 자리가 그 사이로 뭉개진다.
   * 보이는 것들이 앉아 있던 자리에 새 차례를 끼워 넣어 전체를 만든 뒤 보낸다.
   */
  const handleReorderPeople = async (visibleIds: string[]) => {
    const ids = mergeOrder(
      people.map((person) => person.id),
      visibleIds,
    );

    try {
      const updated = await apiClient.reorderPeople(ids, selectedProjectId);
      setPeople((updated || []) as Person[]);
      setStorePeople((updated || []) as Person[]);
    } catch (err: any) {
      setError(messageOf(err, 'assets.orderSaveFailed'));
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
      setError(messageOf(err, 'assets.orderSaveFailed'));
    }
  };

  /** 드래그로 바꾼 카드 순서 저장. 계좌와 같은 규칙(묶음 안에서만 다시 매긴다). */
  const handleReorderCards = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderCards(ids, selectedProjectId);
      setCards((updated || []) as Card[]);
    } catch (err: any) {
      setError(messageOf(err, 'assets.orderSaveFailed'));
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
          : detailType === 'group'
            ? (selectedGroup ?? undefined)
            : undefined;

  type PersonNetWorth = ReportDto.NetWorth['byPerson'][number];
  const netWorthByPerson = new Map<string, PersonNetWorth>(
    (countedNetWorth?.byPerson ?? []).map((row) => [row.personId, row]),
  );
  /** 덜어 내기 전의 사람별 값. 계좌를 모두 뺀 유형 칸이 원래 금액을 보인다. */
  const rawNetWorthByPerson = new Map<string, PersonNetWorth>(
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
  const allPeopleSelected = isEveryPersonSelected(people, selectedPersonIds);
  /** 펼쳐 둔 묶음의 이름과 유형. 묶음 상세의 머리글과 소계가 쓴다. */
  const groupInfo = ASSET_TYPE_GROUPS.find((group) => group.key === selectedGroup);
  const scopedNetWorth = allPeopleSelected
    ? countedNetWorth
    : sumNetWorth(selectedPersonIds.map((id) => netWorthByPerson.get(id)));
  const scopedRawNetWorth = allPeopleSelected
    ? netWorth
    : sumNetWorth(selectedPersonIds.map((id) => rawNetWorthByPerson.get(id)));
  /** 유형 칸을 눌렀을 때 목록에 설 계좌. 전원을 고른 때는 주인 없는 계좌도 넣는다. */
  const accountsOfScope = (group: AssetGroupKey) =>
    accountsOfGroup(accounts, group, displayPeople, allPeopleSelected);
  const personNameOf = new Map(people.map((person) => [person.id, person.name]));


  /*
   * 좁은 화면에서 상세를 펼쳐 두었을 때 접는 자리.
   *
   * 넓은 화면은 목록과 상세가 나란하다. 좁은 화면에서는 둘이 위아래로 쌓여 상세가
   * 목록 한참 아래에 서고, 그래프를 보려면 그만큼 훑어 내려야 한다. 그래서 고른
   * 항목의 상세가 화면을 통째로 쓰고 나머지는 접는다 (앱과 같은 규칙이다).
   *
   * 닫으면 접었던 것이 그대로 돌아온다. 좁은 화면에서는 상세 머리글의 ← 가, 넓은
   * 화면에서는 닫기(×)가 그 일을 한다 (`AssetDetailHeader`).
   */
  const hideOnNarrow = detailType ? 'hidden lg:block' : '';

  return (
    /*
      좁은 화면에서 상세를 펼치면 위의 칸들이 접힌다(hideOnNarrow). 접힌 칸도 줄
      간격의 대상이라 상세만 남아도 위에 한 칸이 비는데, 그러면 보관함처럼 화면 맨
      위에서 시작하지 않는다. 그때는 간격을 넓은 화면에만 둔다 -- 좁은 화면에 남는
      칸은 상세 하나뿐이라 벌릴 사이가 없다.
    */
    <>
      {/*
        거래내역을 펼쳐 둔 동안에는 그것만 보인다 (분류·태그 화면과 같은 규칙). 자산 화면은 지우지
        않고 숨겨 두어 닫으면 다시 받지 않고 보던 그대로 돌아온다 (2026-10-15 사용자 요청).
        거래 화면이 제 머리글을 그대로 들고 오므로 돌아가는 길인 ←만 얹는다.
      */}
      {entriesSearch ? (
        <div className="screen-push">
          <TransactionsView
            projectId={selectedProjectId}
            search={entriesSearch}
            onBack={closeEntries}
          />
        </div>
      ) : null}
    <div
      className={
        entriesSearch ? 'hidden' : detailType ? 'space-y-0 lg:space-y-6' : 'space-y-6'
      }
    >
      {/* 거래내역을 닫고 돌아오면 추이 그래프도 다시 그려진다 (ChartReveal). */}
      <ScreenVisibility visible={!entriesSearch}>
      <RevealScope visible={!entriesSearch}>
      {/*
        화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을, 유형 카드를 누르면
        무엇을 더한 금액인지 고른다. 홈에 있던 칸을 그대로 옮겨 왔다. 자산 금액은
        자산 화면에서 보는 것이 제자리고, 홈에서는 이 달의 흐름만 본다.
      */}
      <div className={hideOnNarrow}>
        <AssetTypeSummary
          parts={scopedNetWorth ?? undefined}
          rawParts={scopedRawNetWorth ?? undefined}
          accountsOf={accountsOfScope}
          ownerNameOf={(account) => personNameOf.get(account.ownerId ?? '')}
          exclusion={exclusion}
          hasNoScope={people.length > 0 && selectedPersonIds.length === 0}
          scopeTitle={
            <PersonScopeTitle
              noun={t('home.assetsNoun')}
              people={people}
              myPersonId={myPersonId}
              selectedPersonIds={selectedPersonIds}
              /*
                구성원을 더하고, 열고, 차례를 바꾸는 일은 여기 없다. 추가는 오른쪽 아래
                붙박이 단추, 상세는 상자의 머리글, 차례는 상자를 끌어 정한다. 이 창은
                보는 범위만 고른다.
              */
              onTogglePerson={togglePersonId}
            />
          }
        />
      </div>

      {/*
        전체 추이는 계좌를 골라도 그대로 둔다. 고른 계좌는 아래 오른쪽에 펼친다.
        고른 자산주인만 그린다. 전원이면 ownerIds를 빼서 주인 없는 계좌까지 담는다.
      */}
      <div className={hideOnNarrow}>
        <AssetHistoryChart
          projectId={selectedProjectId}
          ownerIds={allPeopleSelected ? undefined : selectedPersonIds}
          excludeAccountIds={exclusion.excludeKey}
          // 자산주인 선택은 거래 화면도 같은 것을 쓴다 -- 그래프가 세는 사람과 같다.
          onOpenPeriod={(range) => setEntriesSearch(withPeriod(EMPTY_SEARCH, range))}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
          {error}
        </div>
      )}

      {/*
        왼쪽은 항상 구성원·계좌·카드 목록, 오른쪽은 고른 계좌의 내역이다.
        예전에는 계좌를 누르면 목록이 사라지고 화면이 통째로 바뀌어서, 다른 계좌로
        옮기려면 매번 닫아야 했다.

        불러오는 중이나 고른 자산주인이 없을 때도 이 짜임을 그대로 둔다. 예전에는 그때
        두 단이 통째로 사라져, 구성원을 만들 자리(탭 줄의 더하기)까지 함께 없어졌다 --
        아무도 고르지 않은 가계부에서는 구성원을 더할 길이 아예 막혔다. 고쳐 놓고 다시
        읽는 동안 오른쪽 상세가 깜빡이던 것도 함께 가라앉는다 (앱과 같은 규칙이다).
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* 왼쪽: 통장과 카드 목록. 드래그로 순서를 바꿀 수 있다. */}
          <div className={hideOnNarrow}>
          {isLoading ? (
            <p className="text-gray-600">{t('common.loading')}</p>
          ) : (
          /*
            고른 자산주인이 없어도 목록 자체는 그린다. 비었다는 안내가 그 안에 있다.
            구성원·계좌·카드 추가는 오른쪽 아래 붙박이 단추가 맡는다.
          */
          <AssetList
            people={displayPeople}
            accounts={accounts}
            cardsOf={getAccountCards}
            netWorthByPerson={netWorthByPerson}
            accountProfit={accountProfit}
            /*
              지금 펼쳐 둔 항목. detailType과 함께 넘겨야 한다. 고른 구성원·계좌·카드는
              닫아도 state에 남으므로 id만 보면 오른쪽에 없는 항목까지 강조된다.
            */
            selected={
              detailType && selectedIdOfDetail ? { type: detailType, id: selectedIdOfDetail } : null
            }
            onPersonClick={(person) => {
              rememberListScroll();
              setSelectedPerson(person);
              setDetailType('person');
            }}
            onAccountClick={(account) => {
              rememberListScroll();
              setSelectedAccount(account);
              setDetailType('account');
            }}
            onCardClick={(card) => {
              rememberListScroll();
              setSelectedCard(card);
              setDetailType('card');
            }}
            onReorderPeople={handleReorderPeople}
            onReorderAccounts={handleReorderAccounts}
            onReorderCards={handleReorderCards}
            groupTotals={scopedNetWorth ?? undefined}
            isExcluded={exclusion.isExcluded}
            onGroupClick={(group) => {
              rememberListScroll();
              setSelectedGroup(group);
              setDetailType('group');
            }}
          />
          )}
          </div>

          {/* 오른쪽: 고른 계좌의 잔액 추이와 거래 내역 */}
          {detailType === 'account' && selectedAccount ? (
            /*
              좁은 화면에서는 상세가 화면을 통째로 쓰므로 감싸는 상자를 두지 않는다
              (보관함과 같은 모양이다). 그래프가 제 상자를 갖고 있어 두 겹이 되기도 한다.
              넓은 화면에서는 목록 옆에 놓이는 칸이라 상자가 그 경계를 그린다.
            */
            <div className="lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              {/* 헤더: 계좌명 및 버튼 */}
              <div className="mb-6">
                <AssetDetailHeader
                  title={selectedAccount.name}
                  onClose={closeDetail}
                  actions={
                    <>
                      <DetailIconButton
                        label={t('assets.viewEntries')}
                        onClick={() =>
                          setEntriesSearch({
                            ...EMPTY_SEARCH,
                            paymentAccountIds: [selectedAccount.id],
                          })
                        }
                      >
                        <NavIcon name="transactions" className="h-5 w-5" />
                      </DetailIconButton>
                      <DetailIconButton
                        label={t('account.detail')}
                        onClick={() => setIsAccountDetailOpen(true)}
                      >
                        <Info className="h-5 w-5" aria-hidden />
                      </DetailIconButton>
                    </>
                  }
                >
                  {/* 예전에는 상단 총자산 박스가 이 값을 보여줬다. 총자산을 그대로 두는 대신 여기에 적는다. */}
                  <p className="text-xl font-bold text-blue-600 mt-1">
                    {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {selectedAccount.institution?.name && (
                      <p className="text-sm text-gray-600">{selectedAccount.institution.name}</p>
                    )}
                    <AccountTypeBadge type={selectedAccount.type} />
                  </div>
                </AssetDetailHeader>
              </div>

              {/* 이 계좌의 잔액 추이 */}
              <AssetHistoryChart accountId={selectedAccount.id} projectId={selectedProjectId} />

              {/*
                거래 내역. 앱의 통장 상세와 같은 머리글·같은 줄이다.

                위에 선을 하나 긋는다. 추이 그래프가 제 상자 없이 바로 위에 서 있어,
                선이 없으면 그래프의 가로축과 첫 거래 줄이 한 덩어리로 읽힌다
                (카드 상세의 사용·결제 내역과 같은 구분선이다).

                이 칸을 감싸는 상자에는 자식 사이 간격이 없다. 선에 위 여백을 주지 않으면
                그래프의 가로축 글자에 그대로 붙는다 -- 아래(pt-4)보다 위(mt-8)를 넓게 두어
                선이 그래프가 아니라 이 칸의 머리로 읽히게 한다.
              */}
              <div className="mt-8 space-y-3 border-t pt-4">
                <h3 className="text-sm font-medium text-gray-700">{t('assets.accountLedger')}</h3>
                <LedgerList
                  rows={ledger.rows}
                  currency={selectedAccount.currency}
                  kind="asset"
                  hasMore={ledger.hasMore}
                  isLoading={ledger.isLoading}
                  onMore={ledger.loadMore}
                  onOpenEntry={openLedgerEntry}
                />
              </div>
            </div>
          ) : detailType === 'person' && selectedPerson ? (
            /* 구성원: 그 사람 계좌들의 합계 추이와 최근 거래 */
            <div className="space-y-4 lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              <AssetDetailHeader
                title={selectedPerson.name}
                onClose={closeDetail}
                actions={
                  <>
                    <DetailIconButton
                      label={t('assets.viewEntries')}
                      onClick={() => showPersonEntries(selectedPerson.id)}
                    >
                      <NavIcon name="transactions" className="h-5 w-5" />
                    </DetailIconButton>
                    <DetailIconButton
                      label={t('assets.detail')}
                      onClick={() => setIsPersonDetailOpen(true)}
                    >
                      <Info className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                  </>
                }
              >
                <p className="text-xl font-bold text-blue-600 mt-1">
                  {formatCurrency(netWorthByPerson.get(selectedPerson.id)?.total ?? 0, displayCurrency)}
                </p>
                {/* 전체 총자산 상자와 같은 형식으로 무엇이 얼마인지 쪼개 보여 준다 */}
                <NetWorthBreakdown
                  parts={netWorthByPerson.get(selectedPerson.id)}
                  className="text-sm text-gray-600 mt-1"
                />
              </AssetDetailHeader>

              {/* 이 사람이 가진 계좌들의 합계 추이 */}
              <AssetHistoryChart
                ownerId={selectedPerson.id}
                projectId={selectedProjectId}
                excludeAccountIds={exclusion.excludeKey}
                onOpenPeriod={(range) => showPersonEntries(selectedPerson.id, range)}
              />

              <RecentEntries
                entries={personEntries}
                limit={PERSON_ENTRY_LIMIT}
                noteKey="assets.personEntriesNote"
                onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
              />
            </div>
          ) : detailType === 'group' && selectedGroup && groupInfo ? (
            /*
              자산 묶음: 고른 사람들의 그 묶음 계좌를 하나로 본다. 구성원 상세와 같은 짜임이다
              -- 합계, 합계 추이, 최근 거래. 카드 대금은 결제 통장의 묶음에 든다 (byGroup).
            */
            <div className="space-y-4 lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              <AssetDetailHeader
                title={t(groupInfo.labelKey)}
                onClose={closeDetail}
                actions={
                  <DetailIconButton
                    label={t('assets.viewEntries')}
                    onClick={() =>
                      setEntriesSearch({
                        ...EMPTY_SEARCH,
                        paymentAccountIds: groupMethods?.accountIds ?? [],
                        paymentCardIds: groupMethods?.cardIds ?? [],
                      })
                    }
                  >
                    <NavIcon name="transactions" className="h-5 w-5" />
                  </DetailIconButton>
                }
              >
                <p className="text-xl font-bold text-blue-600 mt-1">
                  {formatCurrency(
                    assetGroupAmount(scopedNetWorth ?? undefined, groupInfo),
                    displayCurrency,
                  )}
                </p>
              </AssetDetailHeader>

              {/* 고른 사람들의 이 묶음 계좌 합계 추이. 위의 총자산 그래프와 같은 사람 범위다. */}
              <AssetHistoryChart
                projectId={selectedProjectId}
                ownerIds={allPeopleSelected ? undefined : selectedPersonIds}
                group={selectedGroup}
                excludeAccountIds={exclusion.excludeKey}
                onOpenPeriod={(range) =>
                  setEntriesSearch(
                    withPeriod(
                      {
                        ...EMPTY_SEARCH,
                        paymentAccountIds: groupMethods?.accountIds ?? [],
                        paymentCardIds: groupMethods?.cardIds ?? [],
                      },
                      range,
                    ),
                  )
                }
              />

              <RecentEntries
                entries={personEntries}
                limit={PERSON_ENTRY_LIMIT}
                noteKey="assets.groupEntriesNote"
                onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
              />
            </div>
          ) : detailType === 'card' && selectedCard ? (
            /*
              카드: 대금과 청구 주기.
              카드 번호나 유효기간 같은 기본 정보는 "카드 상세정보" 팝업으로 옮겼다.
              이 자리에서 자주 보는 것은 남은 대금과 이번 주기 사용액이다.
            */
            <div className="space-y-4 lg:rounded-lg lg:bg-white lg:p-6 lg:shadow">
              <AssetDetailHeader
                title={selectedCard.name}
                onClose={closeDetail}
                actions={
                  <>
                    <DetailIconButton
                      label={t('assets.viewEntries')}
                      onClick={() =>
                        setEntriesSearch({ ...EMPTY_SEARCH, paymentCardIds: [selectedCard.id] })
                      }
                    >
                      <NavIcon name="transactions" className="h-5 w-5" />
                    </DetailIconButton>
                    <DetailIconButton
                      label={t('card.detail')}
                      onClick={() => setIsCardDetailOpen(true)}
                    >
                      <Info className="h-5 w-5" aria-hidden />
                    </DetailIconButton>
                  </>
                }
              >
                {/*
                  카드에는 큰 금액을 적지 않는다.

                  여기 있던 값은 이번 주기의 사용액이었는데, 바로 아래 실적 판과
                  사용액 그래프가 같은 값을 구간까지 밝혀 다시 말한다. 머리글에 한 번
                  더 두면 같은 숫자가 한 화면에 셋이 되고, 그중 이것만 무엇을 센
                  값인지 적혀 있지 않아 "남은 대금"으로 읽혔다.
                */}
                {selectedCard.issuer?.name && (
                  <p className="text-sm text-gray-600 mt-1">{selectedCard.issuer.name}</p>
                )}
              </AssetDetailHeader>

              <CardDetailBody
                card={selectedCard}
                accounts={accounts}
                reloadToken={entryVersion}
                onChange={refreshAfterCardChange}
                onOpenEntry={openLedgerEntry}
              />
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
              <p className="text-gray-500">
                {t('assets.emptyHint')}
              </p>
            </div>
          )}
      </div>

      {/*
        숨긴 항목은 **목록 맨 아래**다.

        되돌리는 일은 드물다. 위에 두면 오늘의 자산을 보러 온 사람이 치워 둔 것을 먼저
        읽고, 목록은 그만큼 아래로 밀린다. 다 보고 나서 "숨긴 게 있었나" 할 때 그 자리에
        있으면 된다.
      */}
      <div className={hideOnNarrow}>
      <HiddenItemsPanel
        projectId={selectedProjectId}
        reloadToken={hiddenVersion}
        onRestored={async () => {
          try {
            const [accountsData, peopleData, cardsData] = await Promise.all([
              apiClient.getAccountsV2(selectedProjectId),
              apiClient.getPeople(selectedProjectId),
              apiClient.getCards(selectedProjectId),
            ]);
            setAccounts(accountsData || []);
            setPeople(peopleData || []);
            setCards(cardsData || []);
            await loadNetWorth();
          } catch {
            setError(t('home.loadFailed'));
          }
        }}
      />
      </div>

      {/* 계좌 상세정보 모달 */}
      {isAccountDetailOpen && selectedAccount && (
        <AccountInfoModal
          account={selectedAccount}
          onClose={() => setIsAccountDetailOpen(false)}
          onAddCard={() => {
            setIsAccountDetailOpen(false);
            openCardAdd(selectedAccount.id);
          }}
          onEdit={handleEditAccountClick}
          onRemove={handleDeleteAccount}
          isSubmitting={isSubmitting}
        />
      )}

      {/* 구성원 상세정보 모달. 오른쪽 패널의 "상세정보" 버튼으로 연다. */}
      {isPersonDetailOpen && selectedPerson && (
        <PersonInfoModal
          person={selectedPerson}
          onClose={() => setIsPersonDetailOpen(false)}
          onAddAccount={() => {
            setIsPersonDetailOpen(false);
            openAccountAdd(selectedPerson.id);
          }}
          onEdit={handleEditPersonClick}
          onRemove={handleDeletePerson}
          isSubmitting={isSubmitting}
        />
      )}

      {/* 카드 상세정보 모달. 수정 폼이 열리면 감춘다 (겹쳐 열리면 안 된다).
          detailType은 청구서 조회 effect가 쓰므로 그대로 둔다. */}
      {isCardDetailOpen && selectedCard && !isEditCardModalOpen && (
        <CardInfoModal
          card={selectedCard}
          accounts={accounts}
          onClose={() => setIsCardDetailOpen(false)}
          onEdit={handleEditCardClick}
          onRemove={handleDeleteCard}
          isSubmitting={isSubmitting}
        />
      )}

      <PersonModal
        isOpen={personModalOpen}
        onClose={() => setPersonModalOpen(false)}
        person={selectedPerson}
        mode={personModalMode}
        projectId={selectedProjectId}
        onSuccess={(updatedPeople) => {
          setPeople(updatedPeople);
          /*
           * 고른 것은 비우지 않고 새로 받은 줄로 바꾼다 (2026-10-16). 비우면 상세가 열린 채 대상만 사라져, 좁은
           * 화면에서는 뒤로 갈 길 없는 빈 화면이 남았다. 새 줄로 바꾸면 머리글도 고친 값으로 선다.
           */
          setSelectedPerson((prev) => updatedPeople.find((row) => row.id === prev?.id) ?? null);
          setPersonModalOpen(false);
        }}
        onDelete={handleDeletePerson}
      />

      <EditAccountModal
        isOpen={isEditAccountModalOpen}
        onClose={() => setIsEditAccountModalOpen(false)}
        account={selectedAccount as any}
        people={people}
        projectId={selectedProjectId}
        onSuccess={(updatedAccounts) => {
          setAccounts(updatedAccounts as Account[]);
          // 비우지 않고 새로 받은 줄로 바꾼다 (위 구성원 저장의 주석).
          setSelectedAccount(
            (prev) => (updatedAccounts as Account[]).find((row) => row.id === prev?.id) ?? null,
          );
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
        projectId={selectedProjectId}
        onSuccess={(updatedCards) => {
          setCards(updatedCards || []);
          // 비우지 않고 새로 받은 줄로 바꾼다 (위 구성원 저장의 주석).
          setSelectedCard((prev) => (updatedCards || []).find((row) => row.id === prev?.id) ?? null);
          setIsEditCardModalOpen(false);
          // 한도나 결제 통장을 바꾸면 부채가 걸리는 자리가 달라진다.
          loadNetWorth();
        }}
        onDelete={handleDeleteCard}
      />

      {/*
        자산 추가. 화면 오른쪽 아래에 붙박인다 (거래 화면의 추가 단추와 같은 자리·모양).

        목록 위에 두지 않는다 -- 사람·통장이 늘면 목록이 길어져, 위에 둔 단추는 몇 번만
        굴려도 화면 밖으로 사라진다. 좁은 화면에서는 아래쪽 탭 막대를 피해 그 위에 선다.
        읽기 전용 구성원에게는 그리지 않는다. 그림은 +가 아니라 지갑이다
        (`AssetAddIcon`) -- 거래 추가 단추와 헷갈리지 않게.
      */}
      {canEdit ? (
        <button
          type="button"
          onClick={() => setIsAddChooserOpen(true)}
          aria-label={t('assets.addTitle')}
          title={t('assets.addTitle')}
          className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 md:bottom-6 md:right-6"
        >
          <AssetAddIcon />
        </button>
      ) : null}

      <AssetAddChooser
        isOpen={isAddChooserOpen}
        onClose={() => setIsAddChooserOpen(false)}
        onChoose={chooseAdd}
        hasPeople={people.length > 0}
        hasAccounts={accounts.length > 0}
      />

      {/* 구성원 추가 모달 */}
      <PersonModal
        isOpen={isPersonAddModalOpen}
        onClose={() => setIsPersonAddModalOpen(false)}
        person={null}
        mode="add"
        projectId={selectedProjectId}
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
        /* 상세에서 들어왔으면 그 사람이, 아니면 "나"가 주인이다. 폼에서 바꿀 수 있다. */
        defaultOwnerId={addedForPersonId}
      />

      {/* 카드 추가 모달 */}
      <AssetCardAddModal form={cardAdd} accounts={accounts} isSubmitting={isSubmitting} />

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
      </RevealScope>
      </ScreenVisibility>
    </div>
    </>
  );
}
