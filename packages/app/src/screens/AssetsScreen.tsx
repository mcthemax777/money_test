import { Text, View } from 'react-native';

import { useAssetsData } from '@money/core/hooks/useAssetsData';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account } from '@money/core/lib/types';
import { useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import PageHeader from '../components/PageHeader';
import PersonScopeTitle from '../components/PersonScopeTitle';

/**
 * 자산. 웹의 /assets 를 옮긴 것이다.
 *
 * 총자산과 구성원별 계좌·카드 목록을 보여 준다. 추가·수정과 계좌 상세(잔액 추이,
 * 거래 목록)는 아직 웹에만 있다.
 */
export default function AssetsScreen() {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const assets = useAssetsData(selectedProjectId);

  /* 고른 자산주인의 총자산. 전원이면 주인 없는 계좌까지 담긴 서버 값을 그대로 쓴다. */
  const total = toNumber(assets.netWorth?.total);

  return (
    <View className="gap-6">
      <PageHeader
        title={
          <PersonScopeTitle
            noun={t('home.assetsNoun')}
            people={assets.people}
            myPersonId={assets.myPersonId}
            selectedPersonIds={assets.selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      {/* 총자산. 계좌를 골라도 이 값은 그대로다. */}
      <View className="rounded-lg bg-blue-600 p-6">
        <Text className="text-sm text-white opacity-90">{t('assets.total')}</Text>
        <Text className="mt-2 text-4xl font-bold text-white">
          {formatCurrency(total, displayCurrency)}
        </Text>
        {assets.netWorth &&
        (toNumber(assets.netWorth.liability) !== 0 ||
          toNumber(assets.netWorth.investment) !== 0) ? (
          <Text className="mt-2 text-sm text-white opacity-90">
            {t('assets.parts', {
              cash: formatCurrency(assets.netWorth.cash, displayCurrency),
              investment: formatCurrency(assets.netWorth.investment, displayCurrency),
              liability: formatCurrency(assets.netWorth.liability, displayCurrency),
            })}
          </Text>
        ) : null}
      </View>

      {assets.hasError ? (
        <View className="rounded bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
        </View>
      ) : null}

      {assets.isLoading && assets.people.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : assets.visiblePeople.length === 0 ? (
        <Text className="text-gray-600">{t('assets.noSelection')}</Text>
      ) : (
        <View className="gap-8">
          {assets.visiblePeople.map((person) => {
            const owned = assets.accounts.filter((account) => account.ownerId === person.id);

            return (
              <View key={person.id} className="rounded-lg bg-white p-6 shadow-sm">
                <View className="mb-6">
                  <Text className="text-xl font-bold text-gray-900">{person.name}</Text>
                  <Text className="text-sm text-gray-600">
                    {t('assets.personSubtotal', {
                      amount: formatCurrency(
                        assets.netWorthByPerson.get(person.id)?.total ?? 0,
                        displayCurrency,
                      ),
                    })}
                  </Text>
                </View>

                {owned.length === 0 ? (
                  <Text className="text-gray-600">{t('assets.noAccounts')}</Text>
                ) : (
                  <View className="gap-4">
                    {owned.map((account) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        profit={assets.accountProfit.get(account.id)}
                        cards={assets.cardsOf(account.id)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 아직 웹에만 있는 것들. 없는 채로 두면 앱에서 할 수 있는 일로 오해한다. */}
      <Text className="text-xs text-gray-500">{t('assets.webOnlyRest')}</Text>
    </View>
  );
}

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
}: {
  account: Account;
  profit?: string;
  cards: Array<{ id: string; name: string; cardType: string; issuer?: { name?: string } | null }>;
}) {
  const { t } = useTranslation();
  const profitAmount = toNumber(profit);

  return (
    <View className="rounded-lg border border-gray-200 p-4">
      <View className="flex-row items-center gap-1.5">
        <Text className="text-sm text-gray-600">{account.name}</Text>
        <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
          {accountTypeLabel(account.type)}
        </Text>
      </View>

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

      {cards.length > 0 ? (
        <View className="mt-4 gap-2 border-t border-gray-200 pt-4">
          {cards.map((card) => (
            <View key={card.id} className="rounded border border-green-100 bg-green-50 px-3 py-2">
              <Text className="text-sm font-medium text-gray-900">{card.name}</Text>
              {card.issuer?.name ? (
                <Text className="text-xs text-gray-600">{card.issuer.name}</Text>
              ) : null}
              <Text className="text-xs text-gray-600">
                {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
