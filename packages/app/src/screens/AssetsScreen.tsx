import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useAssetsData } from '@money/core/hooks/useAssetsData';
import { accountsOfGroup } from '@money/core/hooks/useAccountExclusion';
import { homeDataPort } from '@money/core/data/home-port';
import { DEFAULT_ENTRY_PERIOD } from '@money/types';
import { EMPTY_SEARCH, type TransactionSearch } from '@money/core/hooks/useTransactions';
import {
  ASSET_TYPE_GROUPS,
  assetGroupAmount,
  groupAccountsOfPeople,
} from '@money/core/lib/net-worth';
import { mergeOrder } from '@money/core/lib/reorder';
import { useAssetListView } from '@money/core/store/asset-list-view';
import { useTranslation } from '@money/core/lib/i18n';
import type { Account, Card, Person } from '@money/core/lib/types';
import type { EntryListItem } from '@money/types';
import {
  useCanEdit,
  useProject,
  useProjectDisplayCurrency,
} from '@money/core/store/project';
import { useEntryFocus } from '@money/core/store/entry-focus';
import { useUserFilter } from '@money/core/store/user-filter';

import { useCloseOnBack } from '../shell/navigation';
import { useScrollRestore, useScrollToTop } from '../shell/scroll';
import { ScreenPush, ScreenReturn } from '../shell/ScreenSlide';
import TransactionsScreen from './TransactionsScreen';
import { useFloatingActionSlot } from '../shell/floating-action';
import { AssetPersonList, AssetTypeList } from '../components/AssetAccountLists';
import AssetAddChooser, { AssetAddIcon, type AssetAddKind } from '../components/AssetAddChooser';
import AssetDetailView, { type AssetDetailTarget } from '../components/AssetDetailView';
import AssetHistoryChart from '../components/AssetHistoryChart';
import AssetTypeSummary from '../components/AssetTypeSummary';
import SegmentedTabs from '../components/SegmentedTabs';
import EntryDetailModal from '../components/EntryDetailModal';
import EntryEditor from '../components/EntryEditor';
import PaybackEditor, { type PaybackTarget } from '../components/PaybackEditor';
import PersonScopeTitle from '../components/PersonScopeTitle';
import { AddAccountModal, AddCardModal, AddPersonModal } from '../components/AssetAddModals';
import {
  EditAccountModal,
  EditCardModal,
  EditPersonModal,
} from '../components/AssetEditModals';
import { useScreenVisible } from '../shell/after-paint';

/**
 * 자산. 웹의 /assets 를 옮긴 것이다.
 *
 * 총자산과 구성원별 계좌·카드 목록을 보여 주고, 오른쪽 아래 붙박이 단추로 구성원·계좌·카드를
 * 만든다.
 * 목록에서 하나를 누르면 그 상세(잔액 추이, 카드 실적)가 화면을 통째로 쓴다.
 */
export default function AssetsScreen() {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const canEdit = useCanEdit();
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const assets = useAssetsData(selectedProjectId);
  const { view: listView, setView: setListView } = useAssetListView();
  /*
   * 자산유형별 상자. 사람 차례 → 그 사람 안의 차례로 늘어놓은 뒤 네 묶음으로 나눈다
   * (웹과 같다). 한 묶음 안에서도 같은 사람의 계좌가 이웃하고, 각자 정한 차례가 남는다.
   */
  const personNameOf = new Map(assets.people.map((person) => [person.id, person.name]));
  const byAssetType = groupAccountsOfPeople(assets.visiblePeople, assets.accounts);
  const narrowPersonScope = useEntryFocus((state) => state.narrowPersonScope);
  const reopen = useEntryFocus((state) => state.reopen);
  const clearReopen = useEntryFocus((state) => state.clearReopen);

  /*
   * 열려 있는 만들기 창.
   *
   * 계좌·카드 창은 처음 골라 둘 주인·결제 통장을 함께 든다. 폼에서 바꿀 수 있다.
   */
  const [isAddChooserOpen, setIsAddChooserOpen] = useState(false);
  const [isPersonAddOpen, setIsPersonAddOpen] = useState(false);
  /** 고치는 중인 대상. 한 번에 하나만 연다 (만들기 창과 같은 규칙). */
  const [personEdit, setPersonEdit] = useState<Person | null>(null);
  const [accountEdit, setAccountEdit] = useState<Account | null>(null);
  const [cardEdit, setCardEdit] = useState<Card | null>(null);
  const [accountAdd, setAccountAdd] = useState<{ ownerId: string | null } | null>(null);
  const [cardAdd, setCardAdd] = useState<{ accountId: string | null } | null>(null);


  /**
   * 원장 줄에서 연 거래. 상세와 고치기는 거래 화면과 같은 짝을 쓴다.
   *
   * 원장 줄이 들고 있는 것은 전표 id 뿐이라 여기서 그 거래를 읽어 온다. 사본에 없으면
   * (아직 내려받지 못한 달) 조용히 아무것도 열지 않는다 -- 열리지 않는 팝업을 세우느니
   * 누르지 않은 것처럼 두는 편이 낫다.
   */
  const [entryDetail, setEntryDetail] = useState<EntryListItem | null>(null);
  const [entryEditing, setEntryEditing] = useState<EntryListItem | null>(null);
  /** 열려 있는 페이백 편집기. null 이면 닫혔다. */
  const [paybackTarget, setPaybackTarget] = useState<PaybackTarget | null>(null);

  const openEntry = useCallback(
    (entryId: string) => {
      void homeDataPort()
        .getEntry(entryId, selectedProjectId)
        .then((entry) => {
          // 받는 사이 가계부를 바꿨으면 열지 않는다 (홈과 같다).
          if (entry && useProject.getState().selectedProjectId === selectedProjectId) setEntryDetail(entry);
        })
        .catch(() => {
          /* 못 읽었으면 열지 않는다. 다음 누름에 다시 해 본다. */
        });
    },
    [selectedProjectId],
  );

  /**
   * 펼쳐 둔 상세. 항목 자체가 아니라 종류와 id 만 들고 있는다.
   *
   * 목록을 다시 읽으면(고친 뒤, 사본이 바뀐 뒤) 항목은 새 객체가 된다. 사본을 들고
   * 있으면 그 상세가 옛 잔액을 그대로 적는다.
   */
  const [detail, setDetail] = useState<{
    kind: AssetDetailTarget['kind'];
    id: string;
  } | null>(null);
  /*
   * 상세를 펼치면 맨 위로 올리고, 접으면 목록에서 보던 자리로 되돌린다.
   *
   * 화면에 보이는 것이 통째로 바뀌는 자리다. 펼 때 내려와 있던 자리에 그대로 두면 새로
   * 그린 칸의 가운데부터 보인다. 접을 때도 맨 위로 올리면, 한참 내려가 고른 카드를
   * 보고 나온 사람이 목록의 맨 처음부터 다시 훑어 내려야 한다.
   */
  const scrollToTop = useScrollToTop();
  const { offsetOf, restoreTo } = useScrollRestore();
  /** 상세로 들어가기 전 목록에서 보던 자리. */
  const listOffset = useRef(0);

  const openDetail = (next: { kind: AssetDetailTarget['kind']; id: string } | null) => {
    /* 목록에서 들어가는 걸음에서만 적는다. 상세끼리 갈아타도 떠나온 자리는 그대로다. */
    if (next && !detail) listOffset.current = offsetOf();

    setDetail(next);
    if (next) scrollToTop();
    else restoreTo(listOffset.current);
  };

  /* 기기의 뒤로가기는 머리글의 ← 와 같은 일을 한다 -- 목록으로 돌아간다. */
  useCloseOnBack(detail !== null, () => openDetail(null));

  /**
   * 위에 덮어 연 거래 화면의 검색. null 이면 덮지 않았다.
   *
   * 거래 탭으로 건너가지 않고 이 화면 위에 덮는다 (2026-10-15 사용자 요청 -- 팝업처럼). 아래의
   * 상세·목록은 지우지 않고 숨겨 두어 닫으면 다시 받지 않고 보던 자리로 돌아온다.
   */
  const [entriesSearch, setEntriesSearch] = useState<TransactionSearch | null>(null);
  /** 거래 화면을 덮기 전에 보던 자리. */
  const entriesOffset = useRef(0);
  const openEntries = (search: TransactionSearch) => {
    entriesOffset.current = offsetOf();
    setEntriesSearch(search);
    scrollToTop();
  };
  const closeEntries = () => {
    narrowedPerson.current = null;
    setEntriesSearch(null);
    restoreTo(entriesOffset.current);
  };
  useCloseOnBack(entriesSearch !== null, closeEntries);

  /**
   * 구성원의 거래내역을 덮을 때 좁힌 사람. 자산주인 선택은 모든 탭이 함께 쓰므로, 이 탭이 가려지면
   * 되돌리고 다시 보이면 다시 좁힌다 (2026-10-16 -- 탭을 숨겨 두게 된 뒤로, 덮은 채 다른 탭으로 가면
   * 모든 탭이 한 사람만 보였다). 덮개가 닫히면 거래 화면이 사라지며 되돌린다(TransactionsScreen).
   */
  const narrowedPerson = useRef<string | null>(null);
  const restorePersonScope = useEntryFocus((state) => state.restorePersonScope);
  const visible = useScreenVisible();
  useEffect(() => {
    const personId = narrowedPerson.current;
    if (!personId || entriesSearch === null) return;
    if (visible) narrowPersonScope(personId);
    else restorePersonScope();
    // 보임이 바뀔 때만 본다. 덮개를 열고 닫는 일은 위의 함수들이 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /*
   * 가계부를 바꾸면 덮어 둔 거래내역은 앞 가계부의 조건이라 닫는다. 좁히기 전 선택도 앞 가계부의
   * 사람들이라 되돌리지 않고 버린다 -- 되돌리면 새 가계부에 없는 사람 id 가 선택으로 들어간다.
   */
  useEffect(() => {
    if (narrowedPerson.current) useEntryFocus.setState({ personScope: null });
    narrowedPerson.current = null;
    setEntriesSearch(null);
  }, [selectedProjectId]);

  /*
   * 지금 그릴 상세. 목록에서 다시 찾아 온다.
   *
   * 못 찾으면 null 이다 -- 지웠거나, 숨겼거나, 자산주인 선택에서 빠졌다. 자산주인에서
   * 빠진 항목을 그대로 두면 왼쪽 목록에 없는 것의 내역이 화면에 남고, 위의 총자산에도
   * 들어가지 않아 화면 안에서 숫자가 어긋난다 (웹과 같은 규칙이다).
   */
  const visibleIds = new Set(assets.visiblePeople.map((person) => person.id));
  const ownerOfAccount = (accountId: string) =>
    assets.accounts.find((account) => account.id === accountId)?.ownerId ?? null;

  const detailTarget: AssetDetailTarget | null = (() => {
    if (!detail) return null;

    if (detail.kind === 'person') {
      const person = assets.visiblePeople.find((item) => item.id === detail.id);
      return person ? { kind: 'person', person } : null;
    }

    if (detail.kind === 'account') {
      const account = assets.accounts.find((item) => item.id === detail.id);
      if (!account || !visibleIds.has(account.ownerId ?? '')) return null;
      return { kind: 'account', account };
    }

    if (detail.kind === 'group') {
      const group = ASSET_TYPE_GROUPS.find((item) => item.key === detail.id);
      if (!group) return null;
      return {
        kind: 'group',
        group,
        // 맨 위 유형 카드와 같은 값이다 (고른 사람들의 묶음별 소계).
        amount: assetGroupAmount(assets.netWorth ?? undefined, group),
        ownerIds: assets.allPeopleSelected ? undefined : assets.selectedPersonIds,
      };
    }

    const card = assets.cards.find((item) => item.id === detail.id);
    if (!card) return null;
    const ownerId = ownerOfAccount(card.paymentAccountId);
    return ownerId && visibleIds.has(ownerId) ? { kind: 'card', card } : null;
  })();

  /** 카드의 결제 통장으로 고를 수 있는 계좌. 목록에 선 사람들의 것만이다. */
  const visibleAccounts = assets.accounts.filter((account) =>
    visibleIds.has(account.ownerId ?? ''),
  );

  /**
   * 붙박이 단추로 연 폼에 미리 채울 주인과 결제 통장 (웹의 `addDefaults` 와 같은 규칙).
   *
   * 상세를 펼쳐 두었으면 그 항목에서 읽는다 -- 보고 있던 사람·통장 밑에 만들 때가
   * 가장 흔하다. 아니면 주인은 "나"(목록에 없으면 목록의 첫 사람)이고, 결제 통장은
   * 비워 둔다. 통장은 사람마다 여럿이라 아무것이나 골라 두면 모르고 저장하기 쉽다.
   */
  const addDefaults = (): { ownerId: string | null; accountId: string | null } => {
    if (detailTarget?.kind === 'person') {
      return { ownerId: detailTarget.person.id, accountId: null };
    }
    if (detailTarget?.kind === 'account') {
      return { ownerId: detailTarget.account.ownerId ?? null, accountId: detailTarget.account.id };
    }
    if (detailTarget?.kind === 'card') {
      const accountId = detailTarget.card.paymentAccountId;
      return { ownerId: ownerOfAccount(accountId), accountId };
    }
    const fallbackOwner = visibleIds.has(assets.myPersonId ?? '')
      ? assets.myPersonId
      : (assets.visiblePeople[0]?.id ?? null);
    return { ownerId: fallbackOwner, accountId: null };
  };

  const chooseAdd = (kind: AssetAddKind) => {
    setIsAddChooserOpen(false);
    const { ownerId, accountId } = addDefaults();
    if (kind === 'person') setIsPersonAddOpen(true);
    else if (kind === 'account') setAccountAdd({ ownerId });
    else setCardAdd({ accountId });
  };

  /*
   * 자산 추가. 껍데기가 오른쪽 아래에 붙박이로 그린다 (거래 화면의 추가 단추와 같은 자리).
   *
   * 목록 위에 두지 않는다 -- 사람·통장이 늘면 목록이 길어져, 위에 둔 단추는 몇 번만
   * 내려도 화면 밖으로 사라진다. 읽기 전용 구성원에게는 그리지 않는다. 그림은 +가 아니라
   * 지갑이다 (`AssetAddIcon`) -- 거래 추가 단추와 헷갈리지 않게.
   *
   * 누름은 한 번 만들어 둔다. 껍데기는 누름이 바뀔 때마다 단추를 다시 세운다.
   */
  const openAddChooser = useCallback(() => setIsAddChooserOpen(true), []);
  useFloatingActionSlot(
    // 거래내역을 덮어 둔 동안에는 세우지 않는다 -- 덮은 거래 화면이 단추를 비우면(고르는 중)
    // 이 화면의 자산 추가가 그 위로 비쳐 올라왔다 (2026-10-16).
    canEdit && !entriesSearch
      ? { label: t('assets.addTitle'), onPress: openAddChooser, icon: AssetAddIcon }
      : null,
  );

  /*
   * 사라진 항목의 표시는 지운다. 다시 나타나도 저절로 펼쳐지지 않아야 한다.
   *
   * 목록이 오는 중에는 건드리지 않는다. 거래 화면에서 ←로 돌아오면 이 화면이 새로
   * 서면서 펼 항목을 쪽지에서 받는데, 그때 목록은 아직 비어 있다. 그 순간을 "사라졌다"
   * 로 읽으면 돌아온 자리에서 상세가 곧바로 닫힌다.
   */
  useEffect(() => {
    if (!detail || detailTarget || assets.isLoading) return;
    setDetail(null);
  }, [detail, detailTarget, assets.isLoading]);

  /**
   * 끌어서 바꾼 구성원 차례를 저장한다.
   *
   * 목록에는 고른 자산주인만 서 있으므로 놓은 자리도 그 안에서의 번호다. 차례 값을
   * 매기는 쪽은 구성원 전부를 보므로(`movePersonTo`) 전체에서 몇 번째인지로 바꿔 준다
   * -- 그러지 않으면 자산주인을 좁혀 놓고 옮겼을 때 엉뚱한 자리에 앉는다.
   */
  const movePersonWithin = (id: string, toIndex: number) => {
    const visible = assets.visiblePeople.map((person) => person.id);
    const next = visible.filter((personId) => personId !== id);
    next.splice(toIndex, 0, id);

    const full = mergeOrder(
      assets.people.map((person) => person.id),
      next,
    );
    void assets.movePersonTo(id, full.indexOf(id));
  };


  /** 카드의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  const currencyOfCard = (card: Card) =>
    assets.accounts.find((account) => account.id === card.paymentAccountId)?.currency ?? 'KRW';

  /** 결제 통장의 이름. 카드 고치기 창이 "이 카드는 어느 통장에서 빠지는가"를 적는다. */
  const nameOfAccount = (accountId: string) =>
    assets.accounts.find((account) => account.id === accountId)?.name ?? '';

  /*
   * 거래 화면에서 ←로 돌아왔을 때 떠나온 상세를 다시 편다.
   *
   * 분류·태그와 같은 쪽지를 쓴다. 목록이 도착해야 그 항목을 찾을 수 있지만, 여기서는
   * 종류와 id 만 담아 두면 되므로 기다릴 것이 없다 -- 못 찾으면 detailTarget 이 null 이
   * 되어 목록이 그대로 보인다.
   */
  useEffect(() => {
    if (!reopen) return;
    if (reopen.kind === 'category' || reopen.kind === 'tag') return;

    setDetail({ kind: reopen.kind, id: reopen.id });
    clearReopen();
  }, [reopen, clearReopen]);

  /**
   * 자산 묶음의 결제수단: 그 묶음 통장과, 그 통장에 딸린 카드 (웹과 같다).
   * 목록에 선 계좌만이다 -- 자산주인 선택 밖의 계좌는 묶음 소계에도 없다.
   */
  const groupMethodsOf = (groupKey: string) => {
    const accountIds =
      byAssetType.find((row) => row.group.key === groupKey)?.accounts.map(
        (account) => account.id,
      ) ?? [];
    return {
      accountIds,
      cardIds: assets.cards
        .filter((card) => accountIds.includes(card.paymentAccountId))
        .map((card) => card.id),
    };
  };

  /**
   * 이 항목으로 걸린 거래내역을 본다. 거래 화면을 위에 덮는다.
   *
   * 통장·카드는 검색 조건으로 걸리지만(결제수단), 구성원은 자산주인 선택을 그 사람만
   * 으로 좁힌다 -- 상세에 있던 최근 거래와 같은 기준이 그것이다. 좁힌 선택은 거래
   * 화면이 닫힐 때 저절로 되돌아온다 (core 의 entry-focus, TransactionsScreen).
   *
   * 추이 그래프의 칸을 누르면 같은 화면을 그 칸의 기간으로 좁혀 연다(`range`, 2026-10-14
   * 사용자 요청).
   */
  const showEntries = (range?: { from: string; to: string }) => {
    if (!detailTarget) return;
    const period = range ? { startDate: range.from, endDate: range.to } : {};

    if (detailTarget.kind === 'person') {
      narrowPersonScope(detailTarget.person.id);
      narrowedPerson.current = detailTarget.person.id;
      openEntries({ ...EMPTY_SEARCH, ...period });
    } else if (detailTarget.kind === 'account') {
      openEntries({ ...EMPTY_SEARCH, ...period, paymentAccountIds: [detailTarget.account.id] });
    } else if (detailTarget.kind === 'group') {
      // 그 묶음 통장으로 오간 것과, 그 통장에 딸린 카드로 쓰고 갚은 것.
      const { accountIds, cardIds } = groupMethodsOf(detailTarget.group.key);
      openEntries({
        ...EMPTY_SEARCH,
        ...period,
        paymentAccountIds: accountIds,
        paymentCardIds: cardIds,
      });
    } else {
      openEntries({ ...EMPTY_SEARCH, ...period, paymentCardIds: [detailTarget.card.id] });
    }
  };

  /**
   * 전체 추이의 아래 줄을 눌렀을 때. 그 기간의 거래 화면을 덮는다. 자산주인 선택은 거래 화면도
   * 같은 것을 쓰므로 따로 좁히지 않는다 -- 그래프가 세는 사람과 같다.
   */
  const showTotalEntries = (range: { from: string; to: string }) =>
    openEntries({ ...EMPTY_SEARCH, startDate: range.from, endDate: range.to });

  /** 상세의 "고치기". 종류에 맞는 창을 연다. 상세는 그 아래 그대로 남는다. */
  const openEditOfDetail = () => {
    if (!detailTarget) return;
    if (detailTarget.kind === 'person') setPersonEdit(detailTarget.person);
    else if (detailTarget.kind === 'account') setAccountEdit(detailTarget.account);
    else if (detailTarget.kind === 'card') setCardEdit(detailTarget.card);
  };

  return (
    <View className="gap-6">
      {entriesSearch ? (
        <ScreenPush>
          <TransactionsScreen
            initial={{ search: entriesSearch, unit: DEFAULT_ENTRY_PERIOD }}
            onBack={closeEntries}
          />
        </ScreenPush>
      ) : null}
      {/*
        상세를 펼쳐 두면 그것만 보인다.

        총자산과 목록을 위에 남겨 두면 좁은 화면에서 그래프가 한참 아래로 밀리고,
        무엇을 보고 있는지도 흐려진다. 목록은 지우지 않고 숨겨 두어(`ScreenReturn`) 닫으면
        다시 받지 않고 그 자리에 그대로 돌아온다 (2026-10-15 사용자 요청).
      */}
      {detailTarget ? (
        <ScreenReturn covered={entriesSearch !== null}>
        <AssetDetailView
          target={detailTarget}
          netWorthByPerson={assets.netWorthByPerson}
          excludeAccountIds={assets.exclusion.excludeKey}
          cardCurrency={
            detailTarget.kind === 'card' ? currencyOfCard(detailTarget.card) : displayCurrency
          }
          paymentAccountOwnerId={
            detailTarget.kind === 'card'
              ? ownerOfAccount(detailTarget.card.paymentAccountId)
              : undefined
          }
          onClose={() => openDetail(null)}
          onEdit={openEditOfDetail}
          onShowEntries={() => showEntries()}
          onOpenPeriod={showEntries}
          onOpenEntry={openEntry}
          onChanged={assets.reload}
        />
        </ScreenReturn>
      ) : null}
      <ScreenReturn covered={detailTarget !== null || entriesSearch !== null} style={{ gap: 24 }}>
      {/*
        화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을, 유형 카드를 누르면
        무엇을 더한 금액인지 고른다. 홈에 있던 칸을 그대로 옮겨 왔다.

        총자산 한 덩어리를 적던 파란 상자를 대신한다. 계좌를 골라도 이 값은
        그대로고, 유형 넷을 다 켜면 예전의 총자산과 같은 금액이 나온다.
      */}
      <AssetTypeSummary
        parts={assets.netWorth ?? undefined}
        rawParts={assets.rawNetWorth ?? undefined}
        accountsOf={(group) =>
          accountsOfGroup(assets.accounts, group, assets.visiblePeople, assets.allPeopleSelected)
        }
        ownerNameOf={(account) => personNameOf.get(account.ownerId ?? '')}
        exclusion={assets.exclusion}
        hasNoScope={assets.people.length > 0 && assets.selectedPersonIds.length === 0}
        scopeTitle={
          <PersonScopeTitle
            noun={t('home.assetsNoun')}
            people={assets.people}
            myPersonId={assets.myPersonId}
            selectedPersonIds={assets.selectedPersonIds}
            /*
              구성원을 더하고, 열고, 차례를 바꾸는 일은 여기 없다. 추가는 오른쪽 아래
              붙박이 단추, 상세는 상자의 머리글, 차례는 상자를 끌어 정한다. 이 창은
              보는 범위만 고른다.
            */
            onTogglePerson={togglePersonId}
          />
        }
      />

      {/*
        전체 추이. 고른 자산주인만 그린다.

        전원이면 ownerIds 를 빼서 주인 없는 계좌까지 담는다 (웹과 같은 규칙이다).
      */}
      <AssetHistoryChart
        projectId={selectedProjectId}
        ownerIds={assets.allPeopleSelected ? undefined : assets.selectedPersonIds}
        excludeAccountIds={assets.exclusion.excludeKey}
        onOpenPeriod={showTotalEntries}
      />

      {assets.hasError ? (
        <View className="rounded bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
        </View>
      ) : null}

      <View>
      {assets.isLoading && assets.people.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : (
        /*
          **사람마다 한 상자다** (웹과 같다).

          계좌의 자리(sortRank)가 주인 안에서의 자리라 남의 통장 사이로 끌어다 놓을
          자리가 없다. 사람을 지우고 한 줄기로 늘어놓아 보니, 끌어도 어떤 줄 앞에서는
          멎는 목록이 되어 고장으로 보였다. 상자가 그 경계다.

          상자로 나누면 끌어 옮기는 모습도 제대로 보인다. 한 장의 목록에서는 머리글만
          떠올라 제 계좌들을 남겨 둔 채 움직였다. 지금은 사람 하나가 통째로 들린다.

          머리글은 이름과 소계뿐이다. 누르면 그 사람의 상세가 열리고, **조금 길게 눌러
          끌면 구성원 차례가 바뀐다** (계좌·카드와 같은 손짓이다). 계좌가 없는 사람도
          상자는 내준다 -- 그 상자가 없으면 그 사람만 차례를 바꿀 수 없다.
        */
        <View>
          {/*
            사용자별 · 자산유형별 (웹과 같다). 같은 계좌를 다르게 묶을 뿐이라 금액은
            바뀌지 않는다. 고른 것은 기기에 남는다 (`useAssetListView`).
          */}
          <View className="mb-3">
            <SegmentedTabs
              tabs={[
                { id: 'person' as const, label: t('assets.view.person') },
                { id: 'type' as const, label: t('assets.view.type') },
              ]}
              selected={listView}
              onSelect={setListView}
            />
          </View>

          {listView === 'type' ? (
            <AssetTypeList
              assets={assets}
              byAssetType={byAssetType}
              personNameOf={personNameOf}
              currency={displayCurrency}
              onOpenDetail={openDetail}
            />
          ) : (
            <AssetPersonList
              assets={assets}
              currency={displayCurrency}
              onOpenDetail={openDetail}
              onReorderPerson={movePersonWithin}
            />
          )}
        </View>
      )}
      </View>
      </ScreenReturn>

      {/*
        열 때만 만든다. 세 창이 같은 규칙이다 -- 숨긴 채로 붙여 두면 열리지 않는 일이
        있었고(안드로이드), 폼 상태도 창을 닫을 때 함께 사라지는 편이 단순하다.
      */}
      {personEdit ? (
        <EditPersonModal
          target={personEdit}
          onClose={() => setPersonEdit(null)}
          isSubmitting={assets.isSubmitting}
          onSave={(patch) => assets.updatePerson(personEdit.id, patch)}
          onRemove={() => assets.removePerson(personEdit.id)}
          onMove={(step) => assets.movePerson(personEdit.id, step)}
        />
      ) : null}

      {accountEdit ? (
        <EditAccountModal
          target={accountEdit}
          /* 주인은 고치지 못하지만 누구 것인지는 창에 적는다 (웹과 같다). */
          ownerName={
            assets.people.find((person) => person.id === accountEdit.ownerId)?.name ?? ''
          }
          onClose={() => setAccountEdit(null)}
          isSubmitting={assets.isSubmitting}
          onSave={(patch) => assets.updateAccount(accountEdit.id, patch)}
          onRemove={() => assets.removeAccount(accountEdit.id)}
          onMove={(step) => assets.moveAccount(accountEdit.id, accountEdit.ownerId, step)}
        />
      ) : null}

      {cardEdit ? (
        <EditCardModal
          target={cardEdit}
          currency={currencyOfCard(cardEdit)}
          accountName={nameOfAccount(cardEdit.paymentAccountId)}
          onClose={() => setCardEdit(null)}
          isSubmitting={assets.isSubmitting}
          onSave={(patch) => assets.updateCard(cardEdit.id, patch)}
          onRemove={() => assets.removeCard(cardEdit.id)}
          onMove={(step) => assets.moveCard(cardEdit.id, cardEdit.paymentAccountId, step)}
        />
      ) : null}

      {isPersonAddOpen ? (
        <AddPersonModal
          isOpen
          onClose={() => setIsPersonAddOpen(false)}
          onSubmit={assets.addPerson}
          isSubmitting={assets.isSubmitting}
        />
      ) : null}

      <AssetAddChooser
        isOpen={isAddChooserOpen}
        onClose={() => setIsAddChooserOpen(false)}
        onChoose={chooseAdd}
        hasPeople={assets.visiblePeople.length > 0}
        hasAccounts={visibleAccounts.length > 0}
      />

      {accountAdd ? (
        <AddAccountModal
          isOpen
          onClose={() => setAccountAdd(null)}
          onSubmit={assets.addAccount}
          isSubmitting={assets.isSubmitting}
          /* 상세에서 열었으면 그 주인이, 아니면 "나"가 골라져 있다. 폼에서 바꾼다. */
          people={assets.visiblePeople}
          defaultOwnerId={accountAdd.ownerId}
        />
      ) : null}

      {cardAdd ? (
        <AddCardModal
          isOpen
          onClose={() => setCardAdd(null)}
          onSubmit={assets.addCard}
          isSubmitting={assets.isSubmitting}
          accounts={visibleAccounts}
          defaultAccountId={cardAdd.accountId}
        />
      ) : null}

      {/*
        원장 줄에서 연 거래. 상세를 읽고 거기서 고친다.

        베끼기는 두지 않는다 -- 베낀 것은 이 통장의 거래가 아닐 수도 있어 여기서 만들면
        보고 있던 원장과 상관없는 거래가 조용히 생긴다. 지우기도 마찬가지로 두지 않는다
        (거래 화면에서 한다).
      */}
      <EntryDetailModal
        entry={entryDetail}
        onClose={() => setEntryDetail(null)}
        onEdit={
          canEdit
            ? (entry) => {
                setEntryDetail(null);
                // 페이백은 따로 고친다 (거래 화면과 같다).
                if (entry.kind === 'payback') setPaybackTarget({ editing: entry });
                else setEntryEditing(entry);
              }
            : undefined
        }
        onAddPayback={
          canEdit
            ? (original) => {
                setEntryDetail(null);
                setPaybackTarget({ original });
              }
            : undefined
        }
        onOpenPayback={(payback) => setEntryDetail(payback)}
      />

      {/* 페이백도 잔액을 바꾼다. 저장하면 목록과 총자산을 다시 읽는다. */}
      <PaybackEditor
        target={paybackTarget}
        onClose={() => setPaybackTarget(null)}
        onSaved={assets.reload}
      />

      {entryEditing ? (
        <EntryEditor
          isOpen
          editing={entryEditing}
          onClose={() => setEntryEditing(null)}
          /* 금액이 바뀌면 잔액도 대금도 달라진다. 목록과 총자산을 다시 읽는다. */
          onSaved={assets.reload}
        />
      ) : null}
    </View>
  );
}
