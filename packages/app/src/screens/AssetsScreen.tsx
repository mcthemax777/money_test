import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAssetsData } from '@money/core/hooks/useAssetsData';
import { homeDataPort } from '@money/core/data/home-port';
import { EMPTY_SEARCH } from '@money/core/hooks/useTransactions';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { accountDueOf } from '@money/core/lib/card-settlement';
import { mergeOrder } from '@money/core/lib/reorder';
import {
  accountBalanceLine,
  accountMetaParts,
  type AssetMetaPart,
  type AssetMetaTone,
} from '@money/core/lib/asset-meta';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card, Person } from '@money/core/lib/types';
import type { EntryListItem } from '@money/types';
import { useCanEdit, useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import { useEntryFocus } from '@money/core/store/entry-focus';
import { useUserFilter } from '@money/core/store/user-filter';

import { useCloseOnBack, useNavigation } from '../shell/navigation';
import { useScrollRestore, useScrollToTop } from '../shell/scroll';
import AddButton from '../components/AddButton';
import AssetDetailView, { type AssetDetailTarget } from '../components/AssetDetailView';
import AssetHistoryChart from '../components/AssetHistoryChart';
import AssetTypeSummary from '../components/AssetTypeSummary';
import EntryDetailModal from '../components/EntryDetailModal';
import EntryEditor from '../components/EntryEditor';
import PersonScopeTitle from '../components/PersonScopeTitle';
import { AddAccountModal, AddCardModal, AddPersonModal } from '../components/AssetAddModals';
import DragList from '../components/DragList';
import { usePressFade } from '../components/usePressFade';
import {
  EditAccountModal,
  EditCardModal,
  EditPersonModal,
} from '../components/AssetEditModals';

/**
 * 자산. 웹의 /assets 를 옮긴 것이다.
 *
 * 총자산과 구성원별 계좌·카드 목록을 보여 주고, 목록 안에서 구성원·계좌·카드를 만든다.
 * 목록에서 하나를 누르면 그 상세(잔액 추이, 카드 실적)가 화면을 통째로 쓴다.
 */
export default function AssetsScreen() {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const canEdit = useCanEdit();
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const assets = useAssetsData(selectedProjectId);
  const nav = useNavigation();
  const focusEntries = useEntryFocus((state) => state.focusEntries);
  const narrowPersonScope = useEntryFocus((state) => state.narrowPersonScope);
  const reopen = useEntryFocus((state) => state.reopen);
  const clearReopen = useEntryFocus((state) => state.clearReopen);

  /*
   * 열려 있는 만들기 창.
   *
   * 계좌는 어느 사람 밑에, 카드는 어느 계좌 밑에 만드는지가 함께 있어야 한다. 눌러서
   * 들어온 자리가 그것을 정하므로 그 대상을 그대로 담는다 -- 폼에서 다시 고를 것이 없다.
   */
  const [isPersonAddOpen, setIsPersonAddOpen] = useState(false);
  /** 고치는 중인 대상. 한 번에 하나만 연다 (만들기 창과 같은 규칙). */
  const [personEdit, setPersonEdit] = useState<Person | null>(null);
  const [accountEdit, setAccountEdit] = useState<Account | null>(null);
  const [cardEdit, setCardEdit] = useState<Card | null>(null);
  const [accountAddFor, setAccountAddFor] = useState<Person | null>(null);
  const [cardAddFor, setCardAddFor] = useState<Account | null>(null);


  /**
   * 원장 줄에서 연 거래. 상세와 고치기는 거래 화면과 같은 짝을 쓴다.
   *
   * 원장 줄이 들고 있는 것은 전표 id 뿐이라 여기서 그 거래를 읽어 온다. 사본에 없으면
   * (아직 내려받지 못한 달) 조용히 아무것도 열지 않는다 -- 열리지 않는 팝업을 세우느니
   * 누르지 않은 것처럼 두는 편이 낫다.
   */
  const [entryDetail, setEntryDetail] = useState<EntryListItem | null>(null);
  const [entryEditing, setEntryEditing] = useState<EntryListItem | null>(null);

  const openEntry = useCallback(
    (entryId: string) => {
      void homeDataPort()
        .getEntry(entryId, selectedProjectId)
        .then((entry) => {
          if (entry) setEntryDetail(entry);
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

    const card = assets.cards.find((item) => item.id === detail.id);
    if (!card) return null;
    const ownerId = ownerOfAccount(card.paymentAccountId);
    return ownerId && visibleIds.has(ownerId) ? { kind: 'card', card } : null;
  })();

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
   * 이 항목으로 걸린 거래내역을 본다. 거래 화면으로 건너간다.
   *
   * 통장·카드는 검색 조건으로 걸리지만(결제수단), 구성원은 자산주인 선택을 그 사람만
   * 으로 좁힌다 -- 상세에 있던 최근 거래와 같은 기준이 그것이다. 좁힌 선택은 거래
   * 화면을 벗어날 때 저절로 되돌아온다 (core 의 entry-focus).
   */
  const showEntries = () => {
    if (!detailTarget) return;

    if (detailTarget.kind === 'person') {
      narrowPersonScope(detailTarget.person.id);
      focusEntries({ kind: 'person', id: detailTarget.person.id }, EMPTY_SEARCH);
    } else if (detailTarget.kind === 'account') {
      focusEntries({ kind: 'account', id: detailTarget.account.id }, {
        ...EMPTY_SEARCH,
        paymentAccountIds: [detailTarget.account.id],
      });
    } else {
      focusEntries({ kind: 'card', id: detailTarget.card.id }, {
        ...EMPTY_SEARCH,
        paymentCardIds: [detailTarget.card.id],
      });
    }

    nav.go('/transactions');
  };

  /** 상세의 "고치기". 종류에 맞는 창을 연다. 상세는 그 아래 그대로 남는다. */
  const openEditOfDetail = () => {
    if (!detailTarget) return;
    if (detailTarget.kind === 'person') setPersonEdit(detailTarget.person);
    else if (detailTarget.kind === 'account') setAccountEdit(detailTarget.account);
    else setCardEdit(detailTarget.card);
  };

  return (
    <View className="gap-6">
      {/*
        상세를 펼쳐 두면 그것만 그린다.

        총자산과 목록을 위에 남겨 두면 좁은 화면에서 그래프가 한참 아래로 밀리고,
        무엇을 보고 있는지도 흐려진다. 닫으면 목록이 그 자리에 그대로 돌아온다.
      */}
      {detailTarget ? (
        <AssetDetailView
          target={detailTarget}
          netWorthByPerson={assets.netWorthByPerson}
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
          onShowEntries={showEntries}
          onOpenEntry={openEntry}
          onChanged={assets.reload}
        />
      ) : (
        <>
      {/*
        화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을, 유형 카드를 누르면
        무엇을 더한 금액인지 고른다. 홈에 있던 칸을 그대로 옮겨 왔다.

        총자산 한 덩어리를 적던 파란 상자를 대신한다. 계좌를 골라도 이 값은
        그대로고, 유형 넷을 다 켜면 예전의 총자산과 같은 금액이 나온다.
      */}
      <AssetTypeSummary
        byType={assets.netWorth?.byType}
        hasNoScope={assets.people.length > 0 && assets.selectedPersonIds.length === 0}
        scopeTitle={
          <PersonScopeTitle
            noun={t('home.assetsNoun')}
            people={assets.people}
            myPersonId={assets.myPersonId}
            selectedPersonIds={assets.selectedPersonIds}
            /*
              구성원을 더하고, 열고, 차례를 바꾸는 일은 여기 없다. 아래 목록이 그
              자리다 -- 추가는 목록 위 버튼, 상세는 상자의 머리글, 차례는 상자를 끌어
              정한다. 이 창은 보는 범위만 고른다.
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
          상자는 내준다 -- 그 상자가 없으면 그 사람만 차례를 바꿀 수 없고, 계좌를 만들
          자리도 없다.
        */
        <View>
          {/* 만들 자리는 목록 바로 위다 (`AddButton` 과 같은 규칙). */}
          <AddButton label={t('person.add')} onPress={() => setIsPersonAddOpen(true)} />

          {/*
            상자 끌기. 안쪽 목록(계좌·카드)도 같은 것을 쓰지만 서로 밟지 않는다 --
            줄이 제 손짓의 전파를 끊어 **안쪽이 이긴다** (`DragList` 의 onTouchStart).
          */}
          <DragList
            items={assets.visiblePeople}
            gap={12}
            itemClassName="overflow-hidden rounded-lg bg-white shadow-sm"
            onPressItem={(person) => openDetail({ kind: 'person', id: person.id })}
            onReorder={movePersonWithin}
            renderItem={(person) => {
              const owned = assets.accounts.filter((account) => account.ownerId === person.id);

              return (
                <>
                  {/*
                    상자의 머리글. 이름과 소계를 한 줄의 양 끝에 둔다. "소계"라는 말은
                    적지 않는다 -- 사람 이름 옆의 금액은 그 사람 몫이라는 뜻 말고 읽힐
                    것이 없다.
                  */}
                  <View className="flex-row items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
                    <Text numberOfLines={1} className="shrink text-sm font-bold text-gray-900">
                      {person.name}
                    </Text>
                    <Text className="text-sm font-bold text-gray-900">
                      {formatCurrency(
                        assets.netWorthByPerson.get(person.id)?.total ?? 0,
                        displayCurrency,
                      )}
                    </Text>
                  </View>

                  <View className="px-4 pt-2">
                    <AddButton
                      dense
                      label={t('account.add')}
                      onPress={() => setAccountAddFor(person)}
                    />
                  </View>

                  {owned.length === 0 ? (
                    <Text className="px-4 pb-3 text-sm text-gray-600">{t('assets.noAccounts')}</Text>
                  ) : (
                    <DragList
                      items={owned}
                      gap={0}
                      itemClassName="border-t border-gray-100 px-4 py-2"
                      onReorder={(id, toIndex) =>
                        void assets.moveAccountTo(id, person.id, toIndex)
                      }
                      renderItem={(account) => (
                        <AccountRow
                          account={account}
                          profit={assets.accountProfit.get(account.id)}
                          cards={assets.cardsOf(account.id)}
                          onAddCard={() => setCardAddFor(account)}
                          onOpen={() => openDetail({ kind: 'account', id: account.id })}
                          onOpenCard={(card) => openDetail({ kind: 'card', id: card.id })}
                          onReorderCards={(id, toIndex) =>
                            void assets.moveCardTo(id, account.id, toIndex)
                          }
                        />
                      )}
                    />
                  )}
                </>
              );
            }}
          />

          {assets.visiblePeople.length === 0 ? (
            <Text className="text-sm text-gray-600">{t('assets.noSelection')}</Text>
          ) : null}
        </View>
      )}
      </View>
        </>
      )}

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

      {accountAddFor ? (
        <AddAccountModal
          isOpen
          onClose={() => setAccountAddFor(null)}
          onSubmit={assets.addAccount}
          isSubmitting={assets.isSubmitting}
          /* 눌러서 들어온 상자가 주인을 정한다. 잘못 골랐으면 폼에서 바꾼다. */
          people={assets.visiblePeople}
          defaultOwnerId={accountAddFor.id}
        />
      ) : null}

      {cardAddFor ? (
        <AddCardModal
          isOpen
          onClose={() => setCardAddFor(null)}
          onSubmit={assets.addCard}
          isSubmitting={assets.isSubmitting}
          account={cardAddFor}
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
                setEntryEditing(entry);
              }
            : undefined
        }
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

/**
 * 목록 안에서 하나 더 만드는 버튼. 웹의 것과 같은 모양이다.
 *
 * 점선으로 둘러 "여기에 하나 더"로 읽히게 한다. 채워진 버튼으로 두면 목록의 항목과
 * 같은 무게가 되어, 있는 것과 만들 자리가 눈에 섞인다.
 */
/**
 * 계좌 이름 밑에 한 줄로 이어 붙는 작은 글씨들 (core 의 `accountMetaParts`).
 *
 * 수익·계좌번호를 줄마다 하나씩 쌓으면 계좌 하나가 네 줄이 된다. 가운뎃점으로
 * 이어 한 줄에 두되, 좁은 화면에서는 접혀 내려가게 둔다 -- 잘라 내면 뒤에 선
 * 계좌번호가 통째로 사라진다.
 *
 * 무게는 조각마다 다르다. 셋을 같은 색으로 두면 한 줄에 모인 순간 어느 것이 큰 금액을
 * 설명하는 수인지 알 수 없다.
 */
const META_TONE_CLASS: Record<AssetMetaTone, string> = {
  profit: 'font-semibold text-green-600',
  loss: 'font-semibold text-red-600',
  muted: 'text-gray-400',
};

function AssetMetaLine({ parts }: { parts: AssetMetaPart[] }) {
  if (parts.length === 0) return null;

  return (
    <View className="shrink flex-row flex-wrap items-center">
      {parts.map((part, index) => (
        <View key={part.key} className="flex-row items-center">
          {/* 가운뎃점은 앞 조각의 색을 따르지 않는다. 이어 주는 표시일 뿐이다. */}
          {index > 0 ? <Text className="px-1.5 text-xs text-gray-300">·</Text> : null}
          <Text className={`text-xs ${META_TONE_CLASS[part.tone]}`}>{part.text}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 카드 줄 오른쪽 끝의 남은 대금. 웹의 자산 목록과 같은 규칙이다.
 *
 * 아직 정산하지 않은 것이 있을 때만 적는다. 0원을 적어 두면 다 갚은 카드가 밀린
 * 카드와 같은 무게로 보인다. 체크카드는 결제 즉시 통장에서 빠져 갚을 것이 남지 않는다.
 *
 * 음수는 카드사가 갚을 돈이다(사용을 취소했거나 대금을 더 가져간 뒤). 부호만 바꿔
 * 적으면 빚으로 읽히므로 이름과 색을 함께 바꾼다 -- 정산 판과 같은 규칙이다.
 */
function CardOutstanding({ card, currency }: { card: Card; currency: string }) {
  // 훅은 이른 반환보다 앞이어야 한다.
  const { t } = useTranslation();

  if (card.cardType !== 'credit') return null;

  const outstanding = toNumber(card.currentUsage);
  if (outstanding === 0) return null;

  const refundPending = outstanding < 0;

  return (
    <Text
      className={`text-sm font-bold ${refundPending ? 'text-emerald-700' : 'text-red-600'}`}
    >
      {refundPending ? (
        <Text className="text-xs font-medium">{t('settlement.refundPending')} </Text>
      ) : null}
      {formatCurrency(Math.abs(outstanding), currency)}
    </Text>
  );
}

/**
 * 계좌 한 줄과 그 줄에 달려 내려오는 카드들.
 *
 * 왼쪽에 계좌명, 오른쪽 끝에 남은 금액을 둔다. 어느 계좌인지 먼저 알아야 하고, 금액은
 * 오른쪽 끝에 모여 있어야 위아래로 훑으며 견줄 수 있다. 유형은 총자산을 현금성·투자·
 * 부채로 나누는 기준이라 계좌명 옆에 붙인다.
 */
function AccountRow({
  account,
  profit,
  cards,
  onAddCard,
  onOpen,
  onOpenCard,
  onReorderCards,
}: {
  account: Account;
  profit?: string;
  cards: Card[];
  /** 카드는 결제 통장 밑에 붙는다. 그 통장이 곧 이 계좌다. */
  onAddCard: () => void;
  /** 이 계좌의 상세(잔액 추이)를 펼친다 */
  onOpen: () => void;
  /** 그 카드의 상세(실적, 주기별 사용액)를 펼친다 */
  onOpenCard: (card: Card) => void;
  onReorderCards: (id: string, toIndex: number) => void;
}) {
  const { t } = useTranslation();
  /* 이 통장으로 빠져나갈 카드 대금과, 그것을 뺀 남은 금액. 셈은 core 가 한다(웹과 같은 값). */
  const { due, remaining } = accountDueOf(account.balance, cards);
  const balanceLine = accountBalanceLine(account, { due, t });
  const metaParts = accountMetaParts(account, { profit, t });
  const fade = usePressFade();

  /* 겉 상자는 목록(DragList)이 씌운다. 여기서 또 씌우면 테두리가 두 겹이 된다. */
  return (
    <>
      {/*
        계좌 칸 전체가 누를 자리다 (웹의 계좌 버튼과 같다). 예전에는 이름 줄만 받아서,
        정작 크게 적힌 금액이나 그 아래 줄을 눌러서는 상세가 열리지 않았다.

        줄의 여백(DragList 가 준 px-4 py-2)까지 누를 자리로 삼는다. 여백을 음수 여백으로 도로
        덮고 같은 크기의 안 여백을 주면, 보이는 모양은 그대로면서 손이 닿는 자리만 넓어진다.

        카드 묶음은 이 밖에 둔다. 그쪽을 함께 받으면 카드를 누른 것이 계좌 상세로 간다.
      */}
      <Pressable
        className="-mx-4 -mt-2 px-4 pt-2"
        onPressIn={fade.onPressIn}
        onPressOut={fade.onPressOut}
        onPress={onOpen}
      >
        {/*
          흐림은 안쪽에 준다. 겉의 Pressable 은 음수 여백으로 줄 밖까지 누를 자리를 넓혀
          두었는데, 그것을 다른 뷰로 감싸면 안드로이드는 감싼 뷰 밖의 손끝을 받지 않는다.
        */}
        <Animated.View style={fade.style}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="shrink flex-row items-center gap-1.5">
            <Text numberOfLines={1} className="shrink text-sm font-medium text-gray-900">
              {account.name}
            </Text>
            <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
              {accountTypeLabel(account.type)}
            </Text>
          </View>
          {/*
            잔액이 아니라 카드 대금을 뺀 남은 금액이다. 통장에 찍힌 돈에는 카드사가
            이미 가져가기로 된 몫이 섞여 있어, 잔액만 보면 쓸 수 있는 돈을 그만큼
            부풀려 읽는다.
          */}
          <Text className="text-base font-bold text-gray-900">
            {formatCurrency(remaining, account.currency)}
          </Text>
        </View>

        {/*
          둘째 줄. 왼쪽에 수익·계좌번호, 오른쪽 끝에 잔액이다. 무엇을 적을지는 core 가
          정한다 (`accountMetaParts`·`accountBalanceLine` -- 웹과 같다).

          윗줄과 같은 짜임이라 이름 밑에 주인이, 큰 금액 밑에 잔액이 선다. 잔액을 따로 한
          줄 더 내리면 계좌 하나가 세 줄이 되고, 왼쪽에 끼워 넣으면 어느 수를 설명하는
          줄인지 사라진다.
        */}
        {metaParts.length > 0 || balanceLine ? (
          <View className="mt-0.5 flex-row items-center justify-between gap-3">
            {/*
              왼쪽이 비어도 자리는 남긴다. 적을 것이 잔액뿐일 때 감싸는 칸까지 사라지면
              잔액이 왼쪽으로 붙어, 윗줄의 큰 금액과 어긋난다.
            */}
            <View className="flex-1">
              <AssetMetaLine parts={metaParts} />
            </View>
            {balanceLine ? (
              <Text className="text-xs font-medium text-gray-700">{balanceLine}</Text>
            ) : null}
          </View>
        ) : null}
        </Animated.View>
      </Pressable>

      {/*
        카드는 결제 통장에 **달려 내려온다.** 그 통장이 곧 이 계좌다.

        왼쪽의 세로줄 하나와 들여쓰기가 딸린 것임을 말한다. 예전에는 가름줄을 긋고 초록
        상자를 쌓았는데, 상자는 그 자체로 한 항목의 무게라 통장과 카드가 같은 층에 선
        것처럼 보였다. 세로줄은 자리를 거의 쓰지 않으면서 층을 만든다 (웹과 같다).
      */}
      <View className="ml-1 mt-1 border-l border-gray-200 pl-3">
        <AddButton dense label={t('card.add')} onPress={onAddCard} />

        {cards.length > 0 ? (
          <DragList
            items={cards}
            gap={0}
            /* 줄은 좁지만 손이 닿는 자리는 따로다. 글자 위아래로 조금 더 준다. */
            itemClassName="py-1"
            onPressItem={onOpenCard}
            onReorder={onReorderCards}
            /*
              한 줄에 다 넣는다. 갈래(신용·체크)를 아랫줄로 내리면 카드 하나가 두 줄이
              되어, 통장마다 카드가 둘씩만 있어도 목록이 화면을 훌쩍 넘는다. 갈래는 이름
              옆의 작은 배지다 -- 계좌 유형 배지와 같은 자리, 같은 모양이다 (웹과 같다).
            */
            renderItem={(card) => (
              <View className="flex-row items-center justify-between gap-2">
                <View className="shrink flex-row items-center gap-1.5">
                  <Text numberOfLines={1} className="shrink text-sm text-gray-700">
                    💳 {card.name}
                  </Text>
                  <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
                    {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
                  </Text>
                </View>
                {/* 카드 금액은 전부 결제 통장의 통화다 (기준통화 환산액이 아니다). */}
                <CardOutstanding card={card} currency={account.currency} />
              </View>
            )}
          />
        ) : null}
      </View>
    </>
  );
}
