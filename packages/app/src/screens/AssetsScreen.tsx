import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAssetsData } from '@money/core/hooks/useAssetsData';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card, Person } from '@money/core/lib/types';
import { useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import AddButton from '../components/AddButton';
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
 * 수정과 계좌 상세(잔액 추이, 거래 목록)는 아직 웹에만 있다.
 */
export default function AssetsScreen() {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const assets = useAssetsData(selectedProjectId);

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

  return (
    <View className="gap-6">
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
                {/* 이름을 누르면 고친다. 자산 화면에서 가장 잦은 손질이 이름과 자리다. */}
                <Pressable className="mb-6" onPress={() => setPersonEdit(person)}>
                  <Text className="text-xl font-bold text-gray-900">{person.name}</Text>
                  <Text className="text-sm text-gray-600">
                    {t('assets.personSubtotal', {
                      amount: formatCurrency(
                        assets.netWorthByPerson.get(person.id)?.total ?? 0,
                        displayCurrency,
                      ),
                    })}
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
                        onEdit={() => setAccountEdit(account)}
                        onEditCard={setCardEdit}
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
          onMove={(step) => assets.movePerson(personEdit.id, step)}
        />
      ) : null}

      {accountEdit ? (
        <EditAccountModal
          target={accountEdit}
          onClose={() => setAccountEdit(null)}
          isSubmitting={assets.isSubmitting}
          onSave={(patch) => assets.updateAccount(accountEdit.id, patch)}
          onMove={(step) => assets.moveAccount(accountEdit.id, accountEdit.ownerId, step)}
        />
      ) : null}

      {cardEdit ? (
        <EditCardModal
          target={cardEdit}
          onClose={() => setCardEdit(null)}
          isSubmitting={assets.isSubmitting}
          onSave={(patch) => assets.updateCard(cardEdit.id, patch)}
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
 * 계좌 한 줄과 그 아래 카드들.
 *
 * 위에는 계좌명, 아래에는 개설 기관을 둔다. 어느 계좌인지 먼저 알아야 하고, 은행은
 * 계좌를 여러 개 가진 사람에게만 필요한 부속 정보다. 유형은 총자산을 현금성·투자·
 * 부채로 나누는 기준이라 계좌명 옆에 붙인다.
 */
function AccountRow({
  account,
  profit,
  cards,
  onAddCard,
  onEdit,
  onEditCard,
  onReorderCards,
}: {
  account: Account;
  profit?: string;
  cards: Card[];
  /** 카드는 결제 통장 밑에 붙는다. 그 통장이 곧 이 계좌다. */
  onAddCard: () => void;
  onEdit: () => void;
  onEditCard: (card: Card) => void;
  onReorderCards: (id: string, toIndex: number) => void;
}) {
  const { t } = useTranslation();
  const profitAmount = toNumber(profit);

  /* 겉 상자는 목록(DragList)이 씌운다. 여기서 또 씌우면 테두리가 두 겹이 된다. */
  return (
    <>
      {/* 이름 줄을 누르면 고친다. 잔액을 누르는 것과 헷갈리지 않게 이름 줄만 받는다. */}
      <Pressable className="flex-row items-center gap-1.5" onPress={onEdit}>
        <Text className="text-sm text-gray-600">{account.name}</Text>
        <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
          {accountTypeLabel(account.type)}
        </Text>
      </Pressable>

      <Text className="mt-2 text-2xl font-bold text-gray-900">
        {formatCurrency(account.balance, account.currency)}
      </Text>

      {/* 손실에 "수익 -"를 붙이면 두 번 읽어야 한다. 부호 대신 이름을 바꾼다. */}
      {profit !== undefined && profitAmount !== 0 ? (
        <Text
          className={`mt-1 text-xs ${profitAmount > 0 ? 'text-green-600' : 'text-red-600'}`}
        >
          {t(profitAmount > 0 ? 'assets.profit' : 'assets.loss')}
          {formatCurrency(Math.abs(profitAmount), account.currency)}
        </Text>
      ) : null}

      {/* 현금과 부동산은 개설 기관이 없다 */}
      {account.institution?.name ? (
        <Text className="mt-2 text-xs text-gray-500">{account.institution.name}</Text>
      ) : null}
      {account.accountNumber ? (
        <Text className="mt-1 text-xs text-gray-400">{account.accountNumber}</Text>
      ) : null}

      <View className="mt-4 border-t border-gray-200 pt-4">
        <AddButton label={t('card.add')} onPress={onAddCard} />
      </View>

      {cards.length > 0 ? (
        <DragList
          items={cards}
          itemClassName="rounded border border-green-100 bg-green-50 px-3 py-2 active:bg-green-100"
          onPressItem={onEditCard}
          onReorder={onReorderCards}
          renderItem={(card) => (
            <>
              <Text className="text-sm font-medium text-gray-900">{card.name}</Text>
              {card.issuer?.name ? (
                <Text className="text-xs text-gray-600">{card.issuer.name}</Text>
              ) : null}
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
