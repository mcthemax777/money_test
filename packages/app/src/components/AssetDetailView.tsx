/*
 * 고른 구성원·계좌·카드의 상세. 웹에서 오른쪽 자리에 펼치던 그 칸이다.
 *
 * 앱은 화면이 좁아 나란히 둘 자리가 없다. 목록을 밀어내고 이 칸이 화면을 통째로
 * 쓴다 -- 그래프를 옆에 끼워 넣으면 선이 손가락 두 개 폭이 되어 읽을 것이 없다.
 */
import { Pressable, Text, View } from 'react-native';
import { Info } from 'lucide-react-native';

import { accountTypeLabel } from '@money/core/lib/account-type';
import type { ASSET_TYPE_GROUPS } from '@money/core/lib/net-worth';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import type { Account, Card, Person } from '@money/core/lib/types';
import {
  useCanEdit,
  useProject,
  useProjectDisplayCurrency,
} from '@money/core/store/project';

import { AccountLedgerList } from './AssetLedgerLists';
import AssetHistoryChart from './AssetHistoryChart';
import CardCharts from './CardCharts';
import NavIcon from './NavIcon';
import PageHeader from './PageHeader';

/** 무엇을 펼쳐 두었는가. 네 갈래가 같은 머리글과 같은 그래프 자리를 쓴다. */
export type AssetDetailTarget =
  | { kind: 'person'; person: Person }
  | { kind: 'account'; account: Account }
  | { kind: 'card'; card: Card }
  /**
   * 자산유형별 목록에서 누른 묶음. 고른 사람들의 그 묶음 계좌를 하나로 본다 (웹과 같다).
   * 소계와 사람 범위는 화면이 정해 넘긴다 -- 맨 위 유형 카드와 같은 값이어야 한다.
   */
  | {
      kind: 'group';
      group: (typeof ASSET_TYPE_GROUPS)[number];
      amount: number;
      /** 생략하면 전원이다 (주인 없는 계좌까지). 화면의 자산주인 선택과 같은 규칙이다. */
      ownerIds?: string[];
    };

export default function AssetDetailView({
  target,
  netWorthByPerson,
  excludeAccountIds,
  /** 카드의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  cardCurrency,
  paymentAccountOwnerId,
  onClose,
  onEdit,
  onShowEntries,
  onOpenEntry,
  onChanged,
  onOpenPeriod,
}: {
  target: AssetDetailTarget;
  /** 구성원별 소계. 사람 상세의 큰 숫자가 여기서 온다. */
  netWorthByPerson: Map<string, { total: string }>;
  /**
   * 합계 제외로 뺀 계정 (`useAccountExclusion` 의 excludeKey). 사람·묶음 추이가 소계와
   * 같은 계좌를 세도록 넘긴다. 계좌 상세는 그 계좌를 보려고 고른 것이라 쓰지 않는다.
   */
  excludeAccountIds?: string[];
  cardCurrency: string;
  /** 카드의 결제 통장 주인. 대금 전표에 사람을 달아야 해서 필요하다. */
  paymentAccountOwnerId?: string | null;
  /** 목록으로 돌아간다. 머리글의 ← 가 부른다. */
  onClose: () => void;
  /**
   * 기본 정보를 고치는 창을 연다. 읽기 전용 구성원에게는 이 단추를 그리지 않는다.
   * 주지 않으면 단추가 없다 -- 예산 화면에서 연 카드 상세가 그렇다(웹 팝업과 같다).
   */
  onEdit?: () => void;
  /** 이 항목으로 걸린 거래내역을 본다. 거래 화면으로 건너간다. 주지 않으면 단추가 없다. */
  onShowEntries?: () => void;
  /**
   * 원장 한 줄을 눌렀을 때. 그 거래의 상세를 연다.
   *
   * 여는 일은 화면이 맡는다 -- 상세 팝업과 입력 팝업은 이 판이 아니라 자산 화면이
   * 들고 있고(거래 화면과 같은 짝이다), 이 판은 어느 전표인지만 알려 준다.
   */
  onOpenEntry?: (entryId: string) => void;
  /** 대금이 오간 뒤. 목록과 총자산을 다시 읽는 자리다. */
  onChanged?: () => void | Promise<void>;
  /**
   * 사람·묶음 추이의 칸을 눌렀을 때. 거래내역 보기와 같은 화면을 그 기간으로 연다.
   * 계좌는 아래에 원장이 따로 있어 쓰지 않는다.
   */
  onOpenPeriod?: (range: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const canEdit = useCanEdit();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);

  /** 머리글에 적을 이름. 세 갈래가 서로 다른 자리에 들고 있다. */
  const title =
    target.kind === 'person'
      ? target.person.name
      : target.kind === 'account'
        ? target.account.name
        : target.kind === 'group'
          ? t(target.group.labelKey)
          : target.card.name;

  return (
    /*
      칸마다 흰 상자를 따로 쓴다 (앱의 다른 화면과 같은 규칙이다). 전체를 한 상자로
      묶으면 그 안에 그래프의 상자가 또 들어가 테두리가 두 겹이 된다.
    */
    <View className="gap-4">
      {/*
        머리글. 보관함·거래 상세와 같은 모양이다 -- 왼쪽 위의 ← 로 목록에 돌아간다.

        예전에는 이름 옆 오른쪽 끝의 × 가 그 일을 했다. 클릭해서 들어가는 자리마다
        나가는 단추가 다른 자리에 있으면 돌아가는 길을 그때마다 찾아야 한다.
      */}
      <PageHeader
        title={title}
        onBack={onClose}
        action={
          /*
            아이콘만 놓는다 (웹의 상세 머리글과 같은 규칙이다). 네모 둘이 이름 옆에 서면
            그쪽이 무게를 가져가, 정작 보러 온 금액과 추이보다 단추가 먼저 읽힌다.
          */
          <View className="flex-row items-center gap-1">
            {onShowEntries ? (
              <Pressable
                onPress={onShowEntries}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('assets.viewEntries')}
                className="h-10 w-10 items-center justify-center rounded-lg active:bg-gray-100"
              >
                <NavIcon name="transactions" size={20} color="#4b5563" />
              </Pressable>
            ) : null}
            {/* 묶음에는 고칠 기본 정보가 없다. */}
            {onEdit && canEdit && target.kind !== 'group' ? (
              <Pressable
                onPress={onEdit}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('assets.detail')}
                className="h-10 w-10 items-center justify-center rounded-lg active:bg-gray-100"
              >
                <Info size={20} color="#4b5563" />
              </Pressable>
            ) : null}
          </View>
        }
      />

      {/*
        이름은 위 머리글이 갖고, 여기에는 금액과 그것을 읽는 데 필요한 것만 남는다.

        흰 상자로 감싸지 않는다. 보관함과 같은 모양이어야 하고, 아래 그래프가 이미
        제 상자를 갖고 있어 여기까지 상자를 두면 머리글 밑에 네모가 줄줄이 선다.

        **카드에는 큰 금액을 적지 않는다.** 여기 있던 값은 이번 주기의 사용액이었는데,
        바로 아래 실적 판과 사용액 그래프가 같은 값을 구간까지 밝혀 다시 말한다.
        머리글에 한 번 더 두면 같은 숫자가 한 화면에 셋이 되고, 그중 이것만 무엇을 센
        값인지 적혀 있지 않아 "남은 대금"으로 읽혔다.
      */}
      {target.kind === 'person' ? (
        <Text className="text-xl font-bold text-blue-600">
          {formatCurrency(netWorthByPerson.get(target.person.id)?.total ?? 0, displayCurrency)}
        </Text>
      ) : target.kind === 'group' ? (
        <Text className="text-xl font-bold text-blue-600">
          {formatCurrency(target.amount, displayCurrency)}
        </Text>
      ) : target.kind === 'account' ? (
        <View>
          <Text className="text-xl font-bold text-blue-600">
            {formatCurrency(target.account.balance, target.account.currency)}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            {target.account.institution?.name ? (
              <Text className="text-sm text-gray-600">{target.account.institution.name}</Text>
            ) : null}
            <Text className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
              {accountTypeLabel(target.account.type)}
            </Text>
          </View>
        </View>
      ) : target.card.issuer?.name ? (
        <Text className="text-sm text-gray-600">{target.card.issuer.name}</Text>
      ) : null}

      {target.kind === 'person' ? (
        <AssetHistoryChart
          ownerId={target.person.id}
          excludeAccountIds={excludeAccountIds}
          projectId={selectedProjectId}
          onOpenPeriod={onOpenPeriod}
        />
      ) : target.kind === 'group' ? (
        /* 고른 사람들의 이 묶음 계좌 합계 추이. 카드 대금은 결제 통장의 묶음을 따른다. */
        <AssetHistoryChart
          ownerIds={target.ownerIds}
          group={target.group.key}
          excludeAccountIds={excludeAccountIds}
          projectId={selectedProjectId}
          onOpenPeriod={onOpenPeriod}
        />
      ) : target.kind === 'account' ? (
        <>
          <AssetHistoryChart accountId={target.account.id} projectId={selectedProjectId} />

          {/*
            거래 내역. 카드 상세의 사용·결제 내역과 같은 줄이다 (웹과 같다).

            자산 탭에서 통장을 눌러도 들고 난 돈이 보이지 않았다 -- 카드에는 있던
            칸이 통장에만 없어, 잔액이 왜 그 값인지 알 길이 없었다.
          */}
          <View className="gap-2 rounded-lg bg-white p-4 shadow-sm">
            <Text className="text-sm font-medium text-gray-700">{t('assets.accountLedger')}</Text>
            <AccountLedgerList
              accountId={target.account.id}
              currency={target.account.currency}
              kind="asset"
              onOpenEntry={onOpenEntry}
            />
          </View>
        </>
      ) : (
        <CardCharts
          card={target.card}
          currency={cardCurrency}
          paymentAccountOwnerId={paymentAccountOwnerId}
          onOpenEntry={onOpenEntry}
          onChanged={onChanged}
        />
      )}
    </View>
  );
}
