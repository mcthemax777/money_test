/*
 * 카드 상세의 결제대금·실적 두 탭. 사용액 그래프, 남은 대금, 환율 확정, 결제 내역이 여기 선다.
 *
 * 자산 상세(AssetDetailView)에서 떼어 냈다 (2026-10-26).
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MAX_USAGE_PERIODS } from '@money/types';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { formatDateMarker } from '@money/core/lib/datetime';
import { homeDataPort } from '@money/core/data/home-port';
import { useTranslation } from '@money/core/lib/i18n';
import { toNumber } from '@money/core/lib/money';
import type { Card, CardUsage } from '@money/core/lib/types';

import { AccountLedgerList, CardEntryList, PeriodLedgerList } from './AssetLedgerLists';
import CardPerformancePanel from './CardPerformancePanel';
import CardSettlementPanel from './CardSettlementPanel';
import CardUsageChart from './CardUsageChart';
import PendingRatePanel from './PendingRatePanel';
import SegmentedTabs from './SegmentedTabs';

/**
 * 카드의 실적과 주기별 사용액.
 *
 * 두 칸이 같은 것을 다른 방식으로 말한다. 위는 지금 진행 중인 한 주기가 기준에
 * 얼마나 닿았는지, 아래는 지난 주기들이 그 기준을 넘겼는지다.
 */
export default function CardCharts({
  card,
  currency,
  paymentAccountOwnerId,
  onOpenEntry,
  onChanged,
}: {
  card: Card;
  /** 카드 금액의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  currency: string;
  paymentAccountOwnerId?: string | null;
  /** 결제 내역 한 줄을 눌렀을 때. 대금 결제 줄도 똑같이 전표라 함께 열린다. */
  onOpenEntry?: (entryId: string) => void;
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
      setUsage(await homeDataPort().getCardUsage(card.id, MAX_USAGE_PERIODS));
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

  /*
   * 카드 상세를 두 탭으로 가른다. 실적과 결제대금은 다른 질문이다.
   *
   *   결제대금  얼마를 갚아야 하나. 실적에서 뺀 결제까지 전부 센다.
   *   실적      혜택을 받을 만큼 썼나. 뺀 결제는 그래프에도 내역에도 없다.
   *
   * 한 화면에 나란히 두었더니 같은 축의 막대 둘이 서로 다른 숫자를 말해, 어느 쪽을
   * 보고 있는지가 흐려졌다. 기본은 결제대금이다 -- 카드를 열어 먼저 묻는 것이 그쪽이다.
   */
  const [tab, setTab] = useState<'billed' | 'performance'>('billed');

  /**
   * 그래프 아래에서 고른 주기. null 이면 전체를 본다.
   *
   * 탭을 옮기면 푼다 -- 청구 주기와 실적 주기는 같은 달이어도 세는 것이 다르다.
   */
  const [pickedPeriod, setPickedPeriod] = useState<{
    closingKey: string;
    periodStart: string;
    periodEnd: string;
  } | null>(null);

  useEffect(() => {
    setPickedPeriod(null);
  }, [card.id, tab]);

  return (
    /*
      상자를 둘로 나눈다. 위는 이 카드를 얼마나 썼고 얼마를 갚아야 하는가이고,
      아래는 그 금액을 이룬 거래 하나하나다 -- 통장 상세도 추이 상자와 입출금 내역
      상자가 따로 서 있다. 한 상자에 다 넣으면 실적·그래프·대금·내역이 한 덩어리로
      읽혀, 어디까지가 요약이고 어디부터가 목록인지 경계가 없다.
    */
    <>
      <View className="gap-4 rounded-lg bg-white p-4 shadow-sm">
        <SegmentedTabs
          tabs={[
            { id: 'billed', label: t('settlement.tabBilled') },
            { id: 'performance', label: t('settlement.tabPerformance') },
          ]}
          selected={tab}
          onSelect={setTab}
        />

        {tab === 'performance' ? <CardPerformancePanel cardId={card.id} /> : null}

        {/*
          남은 대금과 대금 기록은 신용카드만이다. 체크카드는 결제 즉시 통장에서 빠져
          갚을 것이 남지 않는다 (위 사용액은 체크카드도 똑같이 보여 준다).

          사용액 그래프 아래에 둔다. 카드를 열었을 때 먼저 보는 것은 얼마를 썼나이고,
          대금은 그 뒤에 하는 일이다 (웹과 같은 차례다).
        */}
        {isCredit && tab === 'billed' ? (
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
        {isCredit && tab === 'billed' ? (
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
          주기별 사용액. **대금 결제와 환율 확정 아래**다.

          카드를 열어 먼저 하는 일은 "얼마를 갚아야 하나"와 그 대금을 적는 것이다.
          그래프는 그 숫자가 어떻게 쌓였는지를 되짚어 보는 자리라, 손이 가는 단추가
          그래프 아래에 묻혀 있으면 카드를 열 때마다 손가락이 한 번 더 든다.
        */}
        <View>
          <Text className="mb-2 text-sm font-medium text-gray-700">
            {t(
              tab === 'performance'
                ? isCredit
                  ? 'settlement.performanceByStatement'
                  : 'settlement.performanceByMonth'
                : isCredit
                  ? 'settlement.billedByStatement'
                  : 'settlement.billedByMonth',
            )}
          </Text>

          {error ? (
            <Text className="text-sm text-red-600">{error}</Text>
          ) : !usage ? (
            <Text className="text-sm text-gray-600">{t('settlement.loading')}</Text>
          ) : (
            /*
              기준선은 실적에만 긋는다. 실적 기준은 청구액에 대고 재는 값이 아니다.
              탭을 바꾸면 그래프도 새로 서야 해서 key 로 갈아 끼운다(끌어 둔 창까지).
            */
            <CardUsageChart
              key={tab}
              periods={usage.periods}
              currency={usage.currency}
              target={tab === 'performance' ? target : null}
              cardId={card.id}
              measure={tab === 'performance' ? 'performance' : 'billed'}
              selectedKey={pickedPeriod?.closingKey ?? null}
              onSelectPeriod={setPickedPeriod}
            />
          )}
        </View>
      </View>

      {/*
        결제 내역. 통장 상세의 입출금 내역과 같은 상자다.

        두 카드가 다른 데서 읽는다. 신용카드는 그 카드의 부채 계정에 사용과 대금이
        쌓이므로 원장을 그대로 읽어 줄마다 남은 대금까지 붙지만, 체크카드는 쓰는 즉시
        결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다 -- 그쪽은 전표를 카드로 걸러
        받는다. 예전에는 그 길이 없어 체크카드에만 이 칸이 통째로 비어 있었다.
      */}
      <View className="gap-2 rounded-lg bg-white p-4 shadow-sm">
        {/*
          어느 구간을 보고 있는지 이름 옆에 적는다.

          그래프에서 주기를 누르면 아래 목록이 그 주기만 남는데, 목록만 보아서는 그것이
          전부인지 걸러진 것인지 알 수 없다 -- 거래가 적은 주기를 고르면 "내역이 없습니다"
          가 뜨고, 그 까닭이 화면 어디에도 없었다.
        */}
        <View className="flex-row items-baseline gap-2">
          <Text className="text-sm font-medium text-gray-700">
            {t(
              tab === 'billed' && pickedPeriod && isCredit
                ? 'assets.billedLedger'
                : 'assets.cardLedger',
            )}
          </Text>
          <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
            {pickedPeriod
              ? `${formatDateMarker(pickedPeriod.periodStart)} ~ ${formatDateMarker(pickedPeriod.periodEnd)}`
              : t('assets.ledgerAllPeriod')}
          </Text>
        </View>
        {/*
          세 갈래다. 묻는 것이 다르면 줄도 달라야 한다.

          실적 탭은 주기마다 0에서 다시 쌓는 실적 원장을 그린다. 결제대금 탭은 기본이
          계좌 원장(줄마다 남은 대금)이고, **주기를 고르면 그 주기의 청구 내역**으로
          바뀐다 -- 청구는 할부 회차가 뒤 주기로 넘어가므로 원장을 날짜로 자르면 막대는
          큰데 목록은 비는 일이 생긴다. 24개월 할부로 산 차가 매달 청구될 때가 그렇다.
        */}
        {tab === 'performance' || (pickedPeriod && isCredit) ? (
          <PeriodLedgerList
            cardId={card.id}
            measure={tab}
            fallbackCurrency={currency}
            reloadToken={ledgerVersion}
            closingKey={pickedPeriod?.closingKey ?? null}
            onOpenEntry={onOpenEntry}
          />
        ) : isCredit ? (
          <AccountLedgerList
            accountId={card.liabilityAccountId}
            currency={currency}
            kind="liability"
            reloadToken={ledgerVersion}
            /* 주기를 고르면 이 목록 대신 청구 내역을 그린다. 여기는 늘 전체다. */
            range={null}
            onOpenEntry={onOpenEntry}
          />
        ) : (
          <CardEntryList
            cardId={card.id}
            range={
              pickedPeriod
                ? { startDate: pickedPeriod.periodStart, endDate: pickedPeriod.periodEnd }
                : null
            }
            onOpenEntry={onOpenEntry}
          />
        )}
      </View>
    </>
  );
}
