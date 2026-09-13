/*
 * 고른 구성원·계좌·카드의 상세. 웹에서 오른쪽 자리에 펼치던 그 칸이다.
 *
 * 앱은 화면이 좁아 나란히 둘 자리가 없다. 목록을 밀어내고 이 칸이 화면을 통째로
 * 쓴다 -- 그래프를 옆에 끼워 넣으면 선이 손가락 두 개 폭이 되어 읽을 것이 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Info, Receipt } from 'lucide-react-native';
import { MAX_USAGE_PERIODS } from '@money/types';

import { useAccountLedger } from '@money/core/hooks/useAccountLedger';
import { useCardEntries } from '@money/core/hooks/useCardEntries';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { formatDate } from '@money/core/lib/datetime';
import { categoryTitleOf } from '@money/core/lib/entries';
import { apiClient } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card, CardUsage, LedgerLikeRow, Person } from '@money/core/lib/types';
import {
  useCanEdit,
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';

import AssetHistoryChart from './AssetHistoryChart';
import CardPerformancePanel from './CardPerformancePanel';
import CardSettlementPanel from './CardSettlementPanel';
import CardUsageChart from './CardUsageChart';
import PageHeader from './PageHeader';
import PendingRatePanel from './PendingRatePanel';

/** 무엇을 펼쳐 두었는가. 세 갈래가 같은 머리글과 같은 그래프 자리를 쓴다. */
export type AssetDetailTarget =
  | { kind: 'person'; person: Person }
  | { kind: 'account'; account: Account }
  | { kind: 'card'; card: Card };

export default function AssetDetailView({
  target,
  netWorthByPerson,
  /** 카드의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  cardCurrency,
  paymentAccountOwnerId,
  onClose,
  onEdit,
  onShowEntries,
  onChanged,
}: {
  target: AssetDetailTarget;
  /** 구성원별 소계. 사람 상세의 큰 숫자가 여기서 온다. */
  netWorthByPerson: Map<string, { total: string }>;
  cardCurrency: string;
  /** 카드의 결제 통장 주인. 대금 전표에 사람을 달아야 해서 필요하다. */
  paymentAccountOwnerId?: string | null;
  /** 목록으로 돌아간다. 머리글의 ← 가 부른다. */
  onClose: () => void;
  /** 기본 정보를 고치는 창을 연다. 읽기 전용 구성원에게는 이 단추를 그리지 않는다. */
  onEdit: () => void;
  /** 이 항목으로 걸린 거래내역을 본다. 거래 화면으로 건너간다. */
  onShowEntries: () => void;
  /** 대금이 오간 뒤. 목록과 총자산을 다시 읽는 자리다. */
  onChanged?: () => void | Promise<void>;
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
            <Pressable
              onPress={onShowEntries}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('assets.viewEntries')}
              className="h-10 w-10 items-center justify-center rounded-lg active:bg-gray-100"
            >
              <Receipt size={20} color="#4b5563" />
            </Pressable>
            {canEdit ? (
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
        <AssetHistoryChart ownerId={target.person.id} projectId={selectedProjectId} />
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
            />
          </View>
        </>
      ) : (
        <CardCharts
          card={target.card}
          currency={cardCurrency}
          paymentAccountOwnerId={paymentAccountOwnerId}
          onChanged={onChanged}
        />
      )}
    </View>
  );
}

/**
 * 카드의 실적과 주기별 사용액.
 *
 * 두 칸이 같은 것을 다른 방식으로 말한다. 위는 지금 진행 중인 한 주기가 기준에
 * 얼마나 닿았는지, 아래는 지난 주기들이 그 기준을 넘겼는지다.
 */
function CardCharts({
  card,
  currency,
  paymentAccountOwnerId,
  onChanged,
}: {
  card: Card;
  /** 카드 금액의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  currency: string;
  paymentAccountOwnerId?: string | null;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // 남이 그 카드로 결제한 것도 사용액에 들어와야 한다.
  const mirrorVersion = useMirrorVersion();
  const [usage, setUsage] = useState<CardUsage | null>(null);
  const [error, setError] = useState('');
  /** 청구액을 확정하면 올린다. 남은 대금 판이 그 값을 보고 다시 읽는다. */
  const [settledVersion, setSettledVersion] = useState(0);
  /** 대금을 기록하거나 확정하면 올린다. 사용·결제 내역이 그 값을 보고 다시 읽는다. */
  const [ledgerVersion, setLedgerVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setError('');
      /*
       * 화면에 그리는 여섯 주기보다 훨씬 넉넉히 받아 둔다.
       *
       * 그래프를 좌우로 끌어 앞뒤 주기를 보는데, 창만큼만 받으면 끌 때마다 서버를
       * 물어야 하고 답이 올 때까지 막대가 멈춰 있다 (useCardUsageWindow 참고).
       */
      setUsage(await apiClient.getCardUsage(card.id, MAX_USAGE_PERIODS));
    } catch {
      setUsage(null);
      setError(t('settlement.loadFailed'));
    }
    // t 는 언어가 바뀔 때 새 함수가 된다. 의존성에 넣으면 언어를 바꿀 때마다 다시 부른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    load();
  }, [load, mirrorVersion]);

  /*
   * 그래프에 그을 실적 기준선. 0 이하는 기준이 없는 것으로 본다.
   *
   * 0을 기준으로 삼으면 한 푼도 쓰지 않은 주기까지 "달성"으로 칠해진다.
   */
  const target = (() => {
    const amount = toNumber(card.performanceAmount ?? 0);
    return amount > 0 ? amount : null;
  })();

  const isCredit = card.cardType === 'credit';

  return (
    <View className="gap-4 rounded-lg bg-white p-4 shadow-sm">
      <CardPerformancePanel cardId={card.id} />

      <View>
        <Text className="mb-2 text-sm font-medium text-gray-700">
          {t(isCredit ? 'settlement.usageByStatement' : 'settlement.usageByMonth')}
        </Text>

        {error ? (
          <Text className="text-sm text-red-600">{error}</Text>
        ) : !usage ? (
          <Text className="text-sm text-gray-600">{t('settlement.loading')}</Text>
        ) : (
          <CardUsageChart
            periods={usage.periods}
            currency={usage.currency}
            target={target}
            cardId={card.id}
          />
        )}
      </View>

      {/*
        남은 대금과 대금 기록은 신용카드만이다. 체크카드는 결제 즉시 통장에서 빠져
        갚을 것이 남지 않는다 (위 사용액은 체크카드도 똑같이 보여 준다).

        사용액 그래프 아래에 둔다. 카드를 열었을 때 먼저 보는 것은 얼마를 썼나이고,
        대금은 그 뒤에 하는 일이다 (웹과 같은 차례다).
      */}
      {isCredit ? (
        <CardSettlementPanel
          card={card}
          paymentAccountOwnerId={paymentAccountOwnerId}
          reloadToken={settledVersion}
          onChanged={async () => {
            // 대금을 기록하면 거래가 하나 생긴다. 아래 내역도 그 줄을 받아야 한다.
            setLedgerVersion((version) => version + 1);
            await onChanged?.();
          }}
        />
      ) : null}

      {/*
        외화 결제의 청구액 확정.

        추정 환율로 들어간 건이 남아 있으면 남은 대금이 명세서와 어긋나므로, 그
        건들을 여기 모아 한 번에 맞춘다. 확정할 것이 없으면 아무것도 그리지 않는다.
      */}
      {isCredit ? (
        <PendingRatePanel
          cardId={card.id}
          onSettled={async () => {
            // 확정하면 네 값이 함께 달라진다 -- 주기별 사용액, 남은 대금, 내역, 총자산.
            setSettledVersion((version) => version + 1);
            setLedgerVersion((version) => version + 1);
            await load();
            await onChanged?.();
          }}
        />
      ) : null}

      {/*
        결제 내역. 통장 상세의 입출금 내역과 같은 자리다 (웹과 같다).

        두 카드가 다른 데서 읽는다. 신용카드는 그 카드의 부채 계정에 사용과 대금이
        쌓이므로 원장을 그대로 읽어 줄마다 남은 대금까지 붙지만, 체크카드는 쓰는 즉시
        결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다 -- 그쪽은 전표를 카드로 걸러
        받는다. 예전에는 그 길이 없어 체크카드에만 이 칸이 통째로 비어 있었다.
      */}
      <View className="gap-2">
        <Text className="text-sm font-medium text-gray-700">{t('assets.cardLedger')}</Text>
        {isCredit ? (
          <AccountLedgerList
            accountId={card.liabilityAccountId}
            currency={currency}
            kind="liability"
            reloadToken={ledgerVersion}
          />
        ) : (
          <CardEntryList cardId={card.id} />
        )}
      </View>
    </View>
  );
}

/**
 * 한 계좌의 원장 줄. 통장과 신용카드가 함께 쓴다.
 *
 * 카드의 사용과 대금 결제는 그 카드의 **부채 계정**에 쌓이므로 통장과 같은 원장이다.
 * 웹과 같은 규칙이라, 같은 항목을 눌러 웹과 앱이 같은 줄을 본다.
 */
function AccountLedgerList({
  accountId,
  currency,
  kind,
  reloadToken = 0,
}: {
  /** 신용카드는 그 카드의 부채 계정 id 다. */
  accountId: string | null;
  /** 원장에 적힌 통화. 기준통화 환산액이 아니다. */
  currency: string;
  /** 'asset' 은 통장, 'liability' 는 카드의 부채 계정이다. */
  kind: 'asset' | 'liability';
  /** 부르는 자리에서 다시 읽게 하는 값. 대금을 기록하면 카드 쪽이 올린다. */
  reloadToken?: number;
}) {
  // 남이 적은 거래도 들어와야 한다. 사본이 바뀌면 다시 읽는다 (웹은 0에 머문다).
  const mirrorVersion = useMirrorVersion();
  const ledger = useAccountLedger(accountId, mirrorVersion + reloadToken);

  return <LedgerRows ledger={ledger} currency={currency} kind={kind} />;
}

/**
 * 체크카드의 결제 줄.
 *
 * 쓰는 즉시 결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다. 전표를 그 카드로 걸러
 * 받아 원장과 같은 모양으로 옮긴 뒤(core 의 useCardEntries) 같은 목록에 태운다 --
 * 잔액 한 칸만 비고 나머지는 신용카드와 똑같이 읽힌다.
 */
function CardEntryList({ cardId }: { cardId: string }) {
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  /*
   * 금액은 표시 통화다 (EntryListItem.amount). 신용카드 줄은 부채 계정의 원장이라 그
   * 계정의 통화로 적혀 있지만, 이쪽은 전표 목록에서 온 값이라 이미 환산되어 있다.
   */
  const displayCurrency = useProjectDisplayCurrency();
  // 남이 그 카드로 결제한 것도 들어와야 한다. 사본이 바뀌면 다시 읽는다.
  const mirrorVersion = useMirrorVersion();
  const ledger = useCardEntries(cardId, selectedProjectId, mirrorVersion);

  return <LedgerRows ledger={ledger} currency={displayCurrency} kind="liability" />;
}

/**
 * 원장 줄을 그린다. 어디서 받아 온 줄인지는 보지 않는다.
 *
 * **카드는 부호를 뒤집어 읽는다.** 부채 계정은 빚이 늘수록 음수라 그대로 그리면 쓴 돈이
 * 마이너스로 보인다. 카드에서 알고 싶은 것은 얼마를 썼고 얼마가 남았는가다.
 */
function LedgerRows({
  ledger,
  currency,
  kind,
}: {
  ledger: {
    rows: LedgerLikeRow[];
    hasMore: boolean;
    isLoading: boolean;
    hasError: boolean;
    loadMore: () => void;
  };
  /** 원장에 적힌 통화. 기준통화 환산액이 아니다. */
  currency: string;
  /** 'asset' 은 통장, 'liability' 는 카드다 (부채 계정이 없는 체크카드까지). */
  kind: 'asset' | 'liability';
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const { rows, hasMore, isLoading, hasError, loadMore } = ledger;

  const isCard = kind === 'liability';

  if (hasError) {
    return <Text className="text-sm text-red-600">{t('feed.loadFailed')}</Text>;
  }

  if (rows.length === 0) {
    return (
      <Text className="text-sm text-gray-600">
        {isLoading ? t('settlement.loading') : t('assets.noEntries')}
      </Text>
    );
  }

  return (
    <>
      {rows.map((row) => {
        // 원장 금액은 계정 관점이다 (부채가 늘면 음수). 카드에서 읽을 값으로 뒤집는다.
        const amount = isCard ? -toNumber(row.amount) : toNumber(row.amount);
        /*
          그 거래 직후의 잔액. 체크카드에는 없다 -- 쓰는 즉시 결제 통장에서 빠져
          카드 쪽에 쌓이는 것이 없으므로 "남은 대금"이라 부를 값이 아예 없다.
        */
        const balance =
          row.balanceAfter === null
            ? null
            : isCard
              ? -toNumber(row.balanceAfter)
              : toNumber(row.balanceAfter);
        const isUp = amount > 0;
        /*
          색. 통장은 들어온 돈이 초록이고, 카드는 반대다 -- 쌓인 대금이 갚아야 할
          돈이라 빨강, 결제가 그것을 더는 일이라 초록이다.
        */
        const isGood = isCard ? !isUp : isUp;
        /*
          제목. 설명이 비어 있으면 분류가 그 줄의 이름 노릇을 한다 ("대분류 > 소분류").

          예전에는 제목 아래에 가맹점을 한 줄 더 적었다. 그런데 가맹점은 설명과 같은
          글자인 일이 많아(카드 내역을 들여올 때 둘 다 상호가 된다) 같은 말이 두 번
          섰다. 분류는 이체 계열에 없으므로 그때는 "(내용 없음)"이 남는다.
        */
        const title = row.description || categoryTitleOf(row) || t('entry.noTitle');

        return (
          <View
            key={row.postingId}
            className="flex-row items-start justify-between gap-3 border-b border-gray-100 py-2.5"
          >
            <View className="flex-1">
              <Text className="text-[15px] text-gray-900">{title}</Text>
              <Text className="mt-0.5 text-xs text-gray-500">{formatDate(row.date, timeZone)}</Text>
            </View>

            <View className="items-end">
              <Text
                className={`text-[15px] font-bold ${isGood ? 'text-green-600' : 'text-red-600'}`}
              >
                {isUp ? '+' : '-'}
                {formatCurrency(Math.abs(amount), currency)}
              </Text>
              {balance !== null ? (
                <Text className="mt-0.5 text-xs text-gray-500">
                  {t(isCard ? 'assets.cardBalanceAfter' : 'assets.balanceAfter', {
                    amount: formatCurrency(balance, currency),
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {hasMore ? (
        <Pressable
          onPress={loadMore}
          disabled={isLoading}
          className={`items-center rounded-lg border border-gray-200 px-3 py-3 active:bg-gray-50 ${
            isLoading ? 'opacity-50' : ''
          }`}
        >
          <Text className="text-sm font-medium text-gray-600">
            {isLoading ? t('feed.loadingMore') : t('assets.more')}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}
