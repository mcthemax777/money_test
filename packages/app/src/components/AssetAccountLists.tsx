/*
 * 자산 화면의 두 목록. 사용자별(사람마다 한 상자, 끌어서 차례를 바꾼다)과 자산유형별(네 묶음마다 한 상자).
 *
 * 자산 화면(AssetsScreen)에서 떼어 냈다 (2026-10-26). 같은 계좌를 다르게 묶을 뿐이라 금액은 바뀌지 않는다.
 */
import { Pressable, Text, View } from 'react-native';

import type { useAssetsData } from '@money/core/hooks/useAssetsData';
import { assetGroupAmount, type groupAccountsByAsset } from '@money/core/lib/net-worth';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import type { Account } from '@money/core/lib/types';

import AccountRow from './AccountRow';
import type { AssetDetailTarget } from './AssetDetailView';
import DragList from './DragList';

type AssetsData = ReturnType<typeof useAssetsData>;

/** 목록에서 하나를 눌러 그 상세를 편다. 종류와 id 만 넘긴다. */
type OpenDetail = (next: { kind: AssetDetailTarget['kind']; id: string }) => void;

/**
 * 계좌 한 줄. 두 목록이 같은 값을 넘기므로 한 번만 적는다.
 *
 * 컴포넌트로 감싸지 않고 요소를 돌려준다 -- 목록(DragList)이 받는 줄의 모양이 떼어 내기 전과 같다.
 */
function accountRowOf(
  assets: AssetsData,
  account: Account,
  onOpenDetail: OpenDetail,
  /** 있으면 계좌명 옆에 적는다. 여러 사람이 섞인 자산유형별 목록이 넘긴다. */
  ownerName?: string,
) {
  return (
    <AccountRow
      account={account}
      ownerName={ownerName}
      excluded={assets.exclusion.isExcluded(account.id)}
      profit={assets.accountProfit.get(account.id)}
      cards={assets.cardsOf(account.id)}
      onOpen={() => onOpenDetail({ kind: 'account', id: account.id })}
      onOpenCard={(card) => onOpenDetail({ kind: 'card', id: card.id })}
      onReorderCards={(id, toIndex) => void assets.moveCardTo(id, account.id, toIndex)}
    />
  );
}

/** 자산유형별 목록. 네 묶음마다 상자 하나다. */
export function AssetTypeList({
  assets,
  byAssetType,
  personNameOf,
  currency,
  onOpenDetail,
}: {
  assets: AssetsData;
  /** 사람 차례 → 그 사람 안의 차례로 늘어놓은 뒤 네 묶음으로 나눈 것 (`groupAccountsOfPeople`). */
  byAssetType: ReturnType<typeof groupAccountsByAsset<Account>>;
  personNameOf: Map<string, string>;
  currency: string;
  onOpenDetail: OpenDetail;
}) {
  const { t } = useTranslation();

  return assets.visiblePeople.length === 0 ? (
      <Text className="text-sm text-gray-600">{t('assets.noSelection')}</Text>
    ) : byAssetType.length === 0 ? (
      <Text className="text-sm text-gray-600">{t('assets.noAccounts')}</Text>
    ) : (
      /*
        네 묶음마다 상자 하나. 머리글은 묶음 이름과 소계(맨 위 유형 카드와 같은 값)다.
        계좌 옆에 주인 이름을 적는다 -- 여러 사람이 한 상자에 섞이기 때문이다.

        여기서는 끌어 옮기지 않는다. 계좌의 차례는 주인 안에서의 차례라, 섞인
        목록에서 옮긴 자리는 뜻이 없다. 차례는 사용자별에서 정한다.
      */
      <View className="gap-3">
        {byAssetType.map(({ group, accounts: grouped }) => (
          <View key={group.key} className="overflow-hidden rounded-lg bg-white shadow-sm">
            {/* 머리글을 누르면 그 묶음의 상세(합계와 합계 추이)가 열린다 (사람 머리글과 같다). */}
            <Pressable
              onPress={() => onOpenDetail({ kind: 'group', id: group.key })}
              accessibilityRole="button"
              className="flex-row items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 active:bg-gray-200"
            >
              <Text numberOfLines={1} className="shrink text-sm font-bold text-gray-900">
                {t(group.labelKey)}
              </Text>
              <Text className="text-sm font-bold text-gray-900">
                {formatCurrency(
                  assetGroupAmount(assets.netWorth ?? undefined, group),
                  currency,
                )}
              </Text>
            </Pressable>
            {grouped.map((account) => (
              <View key={account.id} className="border-t border-gray-100 px-4 py-2">
                {accountRowOf(assets, account, onOpenDetail, personNameOf.get(account.ownerId ?? ''))}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
}

/** 사용자별 목록. 사람마다 한 상자이고, 상자를 끌어 구성원 차례를 바꾼다. */
export function AssetPersonList({
  assets,
  currency,
  onOpenDetail,
  onReorderPerson,
}: {
  assets: AssetsData;
  currency: string;
  onOpenDetail: OpenDetail;
  /** 끌어서 바꾼 구성원 차례. 놓은 자리는 목록(고른 자산주인) 안에서의 번호다. */
  onReorderPerson: (id: string, toIndex: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/*
        상자 끌기. 안쪽 목록(계좌·카드)도 같은 것을 쓰지만 서로 밟지 않는다 --
        줄이 제 손짓의 전파를 끊어 **안쪽이 이긴다** (`DragList` 의 onTouchStart).
      */}
      <DragList
        items={assets.visiblePeople}
        gap={12}
        itemClassName="overflow-hidden rounded-lg bg-white shadow-sm"
        onPressItem={(person) => onOpenDetail({ kind: 'person', id: person.id })}
        onReorder={onReorderPerson}
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
                    currency,
                  )}
                </Text>
              </View>

              {owned.length === 0 ? (
                <Text className="px-4 py-3 text-sm text-gray-600">{t('assets.noAccounts')}</Text>
              ) : (
                /*
                  사용자가 끌어 정한 차례 그대로다 (웹과 같다). 묶음으로 나누지 않는다 --
                  그 나눔은 맨 위 유형 카드가 보여 준다 (2026-10-05, 사용자 결정).
                */
                <DragList
                  items={owned}
                  gap={0}
                  itemClassName="border-t border-gray-100 px-4 py-2"
                  onReorder={(id, toIndex) =>
                    void assets.moveAccountTo(id, person.id, toIndex)
                  }
                  renderItem={(account) => accountRowOf(assets, account, onOpenDetail)}
                />
              )}
            </>
          );
        }}
      />

      {assets.visiblePeople.length === 0 ? (
        <Text className="text-sm text-gray-600">{t('assets.noSelection')}</Text>
      ) : null}
    </>
  );
}
