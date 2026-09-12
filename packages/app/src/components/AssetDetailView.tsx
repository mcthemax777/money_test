/*
 * 고른 구성원·계좌·카드의 상세. 웹에서 오른쪽 자리에 펼치던 그 칸이다.
 *
 * 앱은 화면이 좁아 나란히 둘 자리가 없다. 목록을 밀어내고 이 칸이 화면을 통째로
 * 쓴다 -- 그래프를 옆에 끼워 넣으면 선이 손가락 두 개 폭이 되어 읽을 것이 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Info, Receipt } from 'lucide-react-native';

import { useAccountLedger } from '@money/core/hooks/useAccountLedger';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { formatDate } from '@money/core/lib/datetime';
import { apiClient } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { Account, Card, CardUsage, Person } from '@money/core/lib/types';
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
      */}
      <View>
        {target.kind === 'person' ? (
          <Text className="text-xl font-bold text-blue-600">
            {formatCurrency(netWorthByPerson.get(target.person.id)?.total ?? 0, displayCurrency)}
          </Text>
        ) : target.kind === 'account' ? (
          <>
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
          </>
        ) : (
          <>
            <Text className="text-xl font-bold text-blue-600">
              {formatCurrency(target.card.currentUsage, cardCurrency)}
            </Text>
            {target.card.issuer?.name ? (
              <Text className="mt-1 text-sm text-gray-600">{target.card.issuer.name}</Text>
            ) : null}
          </>
        )}
      </View>

      {target.kind === 'person' ? (
        <AssetHistoryChart ownerId={target.person.id} projectId={selectedProjectId} />
      ) : target.kind === 'account' ? (
        <>
          <AssetHistoryChart accountId={target.account.id} projectId={selectedProjectId} />
          {/*
            추이는 기준통화 장부가다. 위 잔액(계좌 통화)과 단위가 다르므로 밝혀 둔다.
            거래마다 그때의 환율로 쌓인 값이라 최신 환율로 다시 환산한 값과도 다르다.
          */}
          {target.account.currency !== displayCurrency ? (
            <Text className="text-xs text-gray-500">
              {t('assets.trendNote', {
                display: displayCurrency,
                account: target.account.currency,
              })}
            </Text>
          ) : null}
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
      setUsage(await apiClient.getCardUsage(card.id));
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
          <>
            <CardUsageChart
              periods={usage.periods}
              currency={usage.currency}
              target={target}
            />
            <Text className="mt-2 text-xs text-gray-500">
              {t(isCredit ? 'settlement.creditHint' : 'settlement.debitHint')}
            </Text>
          </>
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
        사용·결제 내역. 통장 상세의 거래 내역과 같은 줄이다 (웹과 같다).

        신용카드만 그린다. 체크카드는 쓰는 즉시 통장에서 빠져 쌓이는 대금이 없고,
        그 내역은 결제 통장 쪽에 그대로 있다.
      */}
      {isCredit ? (
        <CardLedger
          card={card}
          currency={currency}
          reloadToken={mirrorVersion + ledgerVersion}
        />
      ) : null}
    </View>
  );
}

/**
 * 카드의 사용·결제 내역.
 *
 * 줄마다 그 거래 직후의 **남은 대금**이 붙는다. 쓴 줄을 만나면 늘고 결제한 줄을 만나면
 * 줄어드는 것이 그대로 보인다 -- 지금 얼마가 남았는지만 보고는 그 금액이 어디서 왔는지
 * 알 수 없다.
 *
 * 부호를 뒤집어 읽는다. 사용과 결제는 카드의 부채 계정에 쌓이는데 그 계정은 빚이 늘수록
 * 음수라, 그대로 그리면 쓴 돈이 마이너스로 보인다.
 */
function CardLedger({
  card,
  currency,
  reloadToken,
}: {
  card: Card;
  /** 원장에 적힌 통화. 기준통화 환산액이 아니다. */
  currency: string;
  reloadToken: number;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const { rows, hasMore, isLoading, hasError, loadMore } = useAccountLedger(
    card.liabilityAccountId,
    reloadToken,
  );

  return (
    <View className="gap-2">
      <View>
        <Text className="text-sm font-medium text-gray-700">{t('assets.cardLedger')}</Text>
        <Text className="mt-1 text-xs text-gray-500">{t('assets.cardLedgerHint')}</Text>
      </View>

      {hasError ? (
        <Text className="text-sm text-red-600">{t('feed.loadFailed')}</Text>
      ) : rows.length === 0 ? (
        <Text className="text-sm text-gray-600">
          {isLoading ? t('settlement.loading') : t('assets.noEntries')}
        </Text>
      ) : (
        <>
          {rows.map((row) => {
            // 원장 금액은 계정 관점이다 (부채가 늘면 음수). 카드에서 읽을 값으로 뒤집는다.
            const amount = -toNumber(row.amount);
            const remaining = -toNumber(row.balanceAfter);
            const isUsed = amount > 0;

            return (
              <View
                key={row.postingId}
                className="flex-row items-start justify-between gap-3 border-b border-gray-100 py-2.5"
              >
                <View className="flex-1">
                  <Text className="text-[15px] text-gray-900">
                    {row.description || t('entry.noTitle')}
                  </Text>
                  {row.merchant ? (
                    <Text className="mt-0.5 text-xs text-gray-600">{row.merchant}</Text>
                  ) : null}
                  <Text className="mt-0.5 text-xs text-gray-500">
                    {formatDate(row.date, timeZone)}
                  </Text>
                </View>

                <View className="items-end">
                  {/*
                    쌓인 대금이 빨강, 결제가 초록이다. 통장과 색이 반대인 것은 뜻이
                    반대이기 때문이다 -- 카드에서 늘어나는 돈은 갚아야 할 돈이다.
                  */}
                  <Text
                    className={`text-[15px] font-bold ${isUsed ? 'text-red-600' : 'text-green-600'}`}
                  >
                    {isUsed ? '+' : '-'}
                    {formatCurrency(Math.abs(amount), currency)}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500">
                    {t('assets.cardBalanceAfter', {
                      amount: formatCurrency(remaining, currency),
                    })}
                  </Text>
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
      )}
    </View>
  );
}
