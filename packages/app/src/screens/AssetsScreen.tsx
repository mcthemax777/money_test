import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAssetsData } from '@money/core/hooks/useAssetsData';
import { EMPTY_SEARCH } from '@money/core/hooks/useTransactions';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { accountDueOf } from '@money/core/lib/card-settlement';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card, Person } from '@money/core/lib/types';
import { useCanEdit, useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import { useEntryFocus } from '@money/core/store/entry-focus';
import { useUserFilter } from '@money/core/store/user-filter';

import { useNavigation } from '../shell/navigation';
import { useScrollToTop } from '../shell/scroll';
import AddButton from '../components/AddButton';
import AssetDetailView, { type AssetDetailTarget } from '../components/AssetDetailView';
import AssetHistoryChart from '../components/AssetHistoryChart';
import AssetTypeSummary from '../components/AssetTypeSummary';
import PersonScopeTitle from '../components/PersonScopeTitle';
import { AddAccountModal, AddCardModal, AddPersonModal } from '../components/AssetAddModals';
import DragList from '../components/DragList';
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
   * 상세를 펼치거나 접으면 맨 위로 올린다.
   *
   * 화면에 보이는 것이 통째로 바뀌는 자리다. 내려와 있던 자리에 그대로 두면 새로 그린
   * 칸의 가운데부터 보이고, 접고 나면 목록의 엉뚱한 데에 서 있다.
   */
  const scrollToTop = useScrollToTop();
  const openDetail = (next: { kind: AssetDetailTarget['kind']; id: string } | null) => {
    setDetail(next);
    scrollToTop();
  };

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

  /** 카드의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  const currencyOfCard = (card: Card) =>
    assets.accounts.find((account) => account.id === card.paymentAccountId)?.currency ?? 'KRW';

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

      {/*
        구성원은 목록 맨 위에서 더한다. 만들 자리가 목록보다 먼저 보인다.

        사람 카드끼리는 넓게(gap-8) 벌리지만 이 버튼은 바로 아래 카드에 붙여 둔다.
        같은 간격으로 띄우면 어느 목록에 더하는 버튼인지 멀어져 읽히지 않는다.
      */}
      <View>
      <AddButton label={t('person.add')} onPress={() => setIsPersonAddOpen(true)} />

      {assets.isLoading && assets.people.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : assets.visiblePeople.length === 0 ? (
        <Text className="text-gray-600">{t('assets.noSelection')}</Text>
      ) : (
        /* 길게 누르면 끌어서 자리를 바꾼다. 구성원·계좌·카드가 모두 같은 규칙이다. */
        <DragList
          items={assets.visiblePeople}
          gap={32}
          itemClassName="rounded-lg bg-white p-6 shadow-sm"
          onReorder={(id, toIndex) => void assets.movePersonTo(id, toIndex)}
          renderItem={(person) => {
            const owned = assets.accounts.filter((account) => account.ownerId === person.id);

            return (
              <>
                {/*
                  이름을 누르면 그 사람의 상세가 열린다 (웹에서 오른쪽에 펼치던 칸이다).
                  고치는 창은 그 상세의 머리글에 있다 -- 읽기 전용 구성원에게는 그 단추가
                  없고, 상세 자체는 누구나 읽는다.
                */}
                {/*
                  이름과 소계를 한 줄의 양 끝에 둔다. "소계"라는 말은 적지 않는다 --
                  사람 이름 옆의 금액은 그 사람 몫이라는 뜻 말고 읽힐 것이 없다.
                  계좌·카드 줄도 같은 자리에 금액을 두어 오른쪽 끝이 나란히 선다.
                */}
                <Pressable
                  className="mb-6 flex-row items-center justify-between gap-3"
                  onPress={() => openDetail({ kind: 'person', id: person.id })}
                >
                  <Text numberOfLines={1} className="shrink text-xl font-bold text-gray-900">
                    {person.name}
                  </Text>
                  <Text className="text-xl font-bold text-gray-900">
                    {formatCurrency(
                      assets.netWorthByPerson.get(person.id)?.total ?? 0,
                      displayCurrency,
                    )}
                  </Text>
                </Pressable>

                <AddButton label={t('account.add')} onPress={() => setAccountAddFor(person)} />

                {owned.length === 0 ? (
                  <Text className="text-gray-600">{t('assets.noAccounts')}</Text>
                ) : (
                  <DragList
                    items={owned}
                    gap={16}
                    itemClassName="rounded-lg border border-gray-200 p-4"
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
      )}
      </View>

      {/* 아직 웹에만 있는 것들. 없는 채로 두면 앱에서 할 수 있는 일로 오해한다. */}
      <Text className="text-xs text-gray-500">{t('assets.webOnlyRest')}</Text>
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
          ownerId={accountAddFor.id}
          ownerName={accountAddFor.name}
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
 * 계좌 한 줄과 그 아래 카드들.
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
  const profitAmount = toNumber(profit);
  /* 이 통장으로 빠져나갈 카드 대금과, 그것을 뺀 남은 금액. 셈은 core 가 한다(웹과 같은 값). */
  const { due, remaining } = accountDueOf(account.balance, cards);

  /* 겉 상자는 목록(DragList)이 씌운다. 여기서 또 씌우면 테두리가 두 겹이 된다. */
  return (
    <>
      {/*
        계좌 칸 전체가 누를 자리다 (웹의 계좌 버튼과 같다). 예전에는 이름 줄만 받아서,
        정작 크게 적힌 금액이나 그 아래 줄을 눌러서는 상세가 열리지 않았다.

        칸의 여백(DragList 가 준 p-4)까지 누를 자리로 삼는다. 여백을 음수 여백으로 도로
        덮고 같은 크기의 안 여백을 주면, 보이는 모양은 그대로면서 손이 닿는 자리만 넓어진다.

        카드 묶음은 이 밖에 둔다. 그쪽을 함께 받으면 카드를 누른 것이 계좌 상세로 간다.
      */}
      <Pressable className="-mx-4 -mt-4 px-4 pt-4 active:opacity-70" onPress={onOpen}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="shrink flex-row items-center gap-1.5">
            <Text numberOfLines={1} className="shrink text-sm text-gray-600">
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
          <Text className="text-2xl font-bold text-gray-900">
            {formatCurrency(remaining, account.currency)}
          </Text>
        </View>

        {/*
          무엇을 뺀 값인지는 대금이 있을 때만 풀어 쓴다. 대금이 없으면 남은 금액이
          곧 잔액이라, 같은 수를 한 번 더 적는 줄이 된다.
        */}
        {due !== 0 ? (
          <Text className="mt-1 text-right text-xs text-gray-500">
            {t(due > 0 ? 'assets.balanceWithDue' : 'assets.balanceWithRefund', {
              balance: formatCurrency(account.balance, account.currency),
              due: formatCurrency(Math.abs(due), account.currency),
            })}
          </Text>
        ) : null}

        {/* 손실에 "수익 -"를 붙이면 두 번 읽어야 한다. 부호 대신 이름을 바꾼다. */}
        {profit !== undefined && profitAmount !== 0 ? (
          <Text
            className={`mt-1 text-xs ${profitAmount > 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {t(profitAmount > 0 ? 'assets.profit' : 'assets.loss')}
            {formatCurrency(Math.abs(profitAmount), account.currency)}
          </Text>
        ) : null}

        {account.accountNumber ? (
          <Text className="mt-1 text-xs text-gray-400">{account.accountNumber}</Text>
        ) : null}
      </Pressable>

      <View className="mt-4 border-t border-gray-200 pt-4">
        <AddButton label={t('card.add')} onPress={onAddCard} />
      </View>

      {cards.length > 0 ? (
        <DragList
          items={cards}
          itemClassName="rounded border border-green-100 bg-green-50 px-3 py-2 active:bg-green-100"
          onPressItem={onOpenCard}
          onReorder={onReorderCards}
          renderItem={(card) => (
            <>
              <View className="flex-row items-center justify-between gap-3">
                <Text numberOfLines={1} className="shrink text-sm font-medium text-gray-900">
                  {card.name}
                </Text>
                {/* 카드 금액은 전부 결제 통장의 통화다 (기준통화 환산액이 아니다). */}
                <CardOutstanding card={card} currency={account.currency} />
              </View>
              <Text className="text-xs text-gray-600">
                {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
              </Text>
            </>
          )}
        />
      ) : null}
    </>
  );
}
