/*
 * 자산 상세의 원장 목록들. 통장·신용카드의 계좌 원장, 체크카드의 결제 줄, 카드 주기 원장(실적·청구).
 *
 * 자산 상세(AssetDetailView)에서 떼어 냈다 (2026-10-26). 세 목록이 같은 줄(LedgerRow)과
 * 같은 더 보기 단추를 쓴다.
 */
import { Pressable, Text, View } from 'react-native';
import type { CardDto } from '@money/types';

import { useAccountLedger } from '@money/core/hooks/useAccountLedger';
import { useCardEntries } from '@money/core/hooks/useCardEntries';
import { useCardPeriodLedger } from '@money/core/hooks/useCardPeriodLedger';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { installmentBadge } from '@money/core/lib/period-ledger';
import type { CardUsageMeasure } from '@money/core/lib/card-usage-chart';
import { formatDate, formatDateMarker } from '@money/core/lib/datetime';
import { categoryTitleOf } from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { LedgerLikeRow } from '@money/core/lib/types';
import {
  useProject,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';

import { useNearBottom } from '../shell/scroll';

/**
 * 한 계좌의 원장 줄. 통장과 신용카드가 함께 쓴다.
 *
 * 카드의 사용과 대금 결제는 그 카드의 **부채 계정**에 쌓이므로 통장과 같은 원장이다.
 * 웹과 같은 규칙이라, 같은 항목을 눌러 웹과 앱이 같은 줄을 본다.
 */
export function AccountLedgerList({
  accountId,
  currency,
  kind,
  reloadToken = 0,
  range,
  onOpenEntry,
}: {
  /** 신용카드는 그 카드의 부채 계정 id 다. */
  accountId: string | null;
  /** 원장에 적힌 통화. 기준통화 환산액이 아니다. */
  currency: string;
  /** 'asset' 은 통장, 'liability' 는 카드의 부채 계정이다. */
  kind: 'asset' | 'liability';
  /** 부르는 자리에서 다시 읽게 하는 값. 대금을 기록하면 카드 쪽이 올린다. */
  reloadToken?: number;
  /** 이 구간의 줄만. 그래프 아래에서 주기를 골랐을 때 온다. */
  range?: { startDate: string; endDate: string } | null;
  onOpenEntry?: (entryId: string) => void;
}) {
  // 남이 적은 거래도 들어와야 한다. 사본이 바뀌면 다시 읽는다 (웹은 0에 머문다).
  const mirrorVersion = useMirrorVersion();
  const ledger = useAccountLedger(accountId, mirrorVersion + reloadToken, range);

  return <LedgerRows ledger={ledger} currency={currency} kind={kind} onOpenEntry={onOpenEntry} />;
}

/**
 * 체크카드의 결제 줄.
 *
 * 쓰는 즉시 결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다. 전표를 그 카드로 걸러
 * 받아 원장과 같은 모양으로 옮긴 뒤(core 의 useCardEntries) 같은 목록에 태운다 --
 * 잔액 한 칸만 비고 나머지는 신용카드와 똑같이 읽힌다.
 */
export function CardEntryList({
  cardId,
  range,
  onOpenEntry,
}: {
  cardId: string;
  /** 이 구간의 줄만. 그래프 아래에서 달을 골랐을 때 온다. */
  range?: { startDate: string; endDate: string } | null;
  onOpenEntry?: (entryId: string) => void;
}) {
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  /*
   * 금액은 표시 통화다 (EntryListItem.amount). 신용카드 줄은 부채 계정의 원장이라 그
   * 계정의 통화로 적혀 있지만, 이쪽은 전표 목록에서 온 값이라 이미 환산되어 있다.
   */
  const displayCurrency = useProjectDisplayCurrency();
  // 남이 그 카드로 결제한 것도 들어와야 한다. 사본이 바뀌면 다시 읽는다.
  const mirrorVersion = useMirrorVersion();
  const ledger = useCardEntries(cardId, selectedProjectId, mirrorVersion, range);

  return (
    <LedgerRows
      ledger={ledger}
      currency={displayCurrency}
      kind="liability"
      onOpenEntry={onOpenEntry}
    />
  );
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
  onOpenEntry,
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
  /** 주면 줄을 눌러 그 거래의 상세를 연다. 없으면 읽기만 하는 목록이다. */
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const { rows, hasMore, isLoading, hasError, loadMore } = ledger;

  /* 바닥까지 내려오면 다음 쪽을 잇는다. 홈의 거래 목록과 같다 (shell/scroll). */
  useNearBottom(() => {
    // 실패했으면 스스로 다시 부르지 않는다. 다시 해 보기는 사람이 누른다.
    if (hasMore && !isLoading && !hasError) loadMore();
  });

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
      {rows.map((row) => (
        <LedgerRow
          key={row.postingId}
          row={row}
          currency={currency}
          isCard={isCard}
          onOpenEntry={onOpenEntry}
          /*
            그 거래 직후의 잔액. 체크카드에는 없다 -- 쓰는 즉시 결제 통장에서 빠져
            카드 쪽에 쌓이는 것이 없으므로 "남은 대금"이라 부를 값이 아예 없다.
          */
          note={
            row.balanceAfter === null
              ? null
              : t(isCard ? 'assets.cardBalanceAfter' : 'assets.balanceAfter', {
                  amount: formatCurrency(
                    isCard ? -toNumber(row.balanceAfter) : toNumber(row.balanceAfter),
                    currency,
                  ),
                })
          }
        />
      ))}

      <MoreButton hasMore={hasMore} isLoading={isLoading} loadMore={loadMore} />
    </>
  );
}

/** 할부 배지의 글자. 어느 배지를 붙일지는 core 가 정한다(웹과 앱이 같다). */
function badgeTextOf(
  t: ReturnType<typeof useTranslation>['t'],
  row: CardDto.PeriodLedgerRow,
): string | null {
  const badge = installmentBadge(row);
  return badge ? t(badge.key, badge.params) : null;
}

/**
 * 카드 주기 원장. 주기마다 0에서 다시 쌓는다.
 *
 * 줄마다 붙는 값이 남은 대금이 아니라 **그 주기에 지금까지 쌓인 값**이다. 9월 8일이
 * 주기의 첫날이면 그날 첫 줄이 0에서 시작한다 -- 카드사가 혜택을 정할 때 세는 방식이
 * 그러하고, 막대도 같은 값을 그린다.
 *
 * 실적과 청구가 할부에서 갈린다. 실적은 결제한 주기에 전액이 한 줄로 들고, 청구는
 * 회차마다 한 줄씩 뒤 주기로 퍼진다 -- 24개월 할부의 이번 달 몫은 청구 쪽에만 있다.
 *
 * 누적은 서버가 붙여 준다. 화면에 올라온 줄만으로 더하면 아직 받지 않은 앞부분이 빠진다.
 */
export function PeriodLedgerList({
  cardId,
  measure,
  fallbackCurrency,
  reloadToken = 0,
  closingKey,
  onOpenEntry,
}: {
  cardId: string;
  /** 실적 원장인가 청구 내역인가. 카드 상세의 탭이 정한다. */
  measure: CardUsageMeasure;
  /** 응답이 오기 전에 쓸 통화. 카드 상세가 이미 알고 있는 값이다. */
  fallbackCurrency: string;
  reloadToken?: number;
  /** 이 주기의 줄만 ('YYYY-MM'). 그래프 아래 줄을 눌러 고른 주기다. */
  closingKey?: string | null;
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const isBilled = measure === 'billed';
  // 남이 그 카드로 결제한 것도 함께 세어야 한다. 사본이 바뀌면 다시 읽는다.
  const mirrorVersion = useMirrorVersion();
  const ledger = useCardPeriodLedger(cardId, measure, mirrorVersion + reloadToken, closingKey);
  const currency = ledger.currency ?? fallbackCurrency;

  /* 바닥까지 내려오면 다음 쪽을 잇는다. 다른 원장과 같다. */
  useNearBottom(() => {
    if (ledger.hasMore && !ledger.isLoading && !ledger.hasError) ledger.loadMore();
  });

  if (ledger.hasError) {
    return <Text className="text-sm text-red-600">{t('feed.loadFailed')}</Text>;
  }

  if (ledger.rows.length === 0) {
    return (
      <Text className="text-sm text-gray-600">
        {ledger.isLoading ? t('settlement.loading') : t('assets.noEntries')}
      </Text>
    );
  }

  return (
    <>
      {ledger.rows.map((row, index) => {
        // 주기가 바뀌는 자리에만 머리글을 세운다. 어디서 0으로 돌아가는지가 그 줄로 드러난다.
        const period =
          row.periodStart === ledger.rows[index - 1]?.periodStart
            ? null
            : ledger.periods[row.periodStart];

        return (
          <View key={row.key}>
            {period ? (
              <View className="mt-2 flex-row items-baseline justify-between gap-2 border-b border-gray-200 pb-1">
                <Text className="text-xs font-medium text-gray-700">
                  {/* 주기 끝값은 달력 날짜 표시자(UTC 자정)다. 시간대로 읽으면 서쪽 시간대에서 하루 앞서 보였다. */}
                  {formatDateMarker(period.periodStart)} ~ {formatDateMarker(period.periodEnd)}
                </Text>
                <Text className="text-xs text-gray-500">
                  {t(isBilled ? 'assets.billedPeriodTotal' : 'assets.performancePeriodTotal', {
                    amount: formatCurrency(toNumber(period.total), currency),
                  })}
                </Text>
              </View>
            ) : null}

            <LedgerRow
              row={row}
              currency={currency}
              isCard
              onOpenEntry={onOpenEntry}
              note={t(isBilled ? 'assets.billedAfter' : 'assets.performanceAfter', {
                amount: formatCurrency(toNumber(row.runningTotal), currency),
              })}
              /*
                청구는 회차마다 한 줄이라 "3/24회차"가 붙고, 실적은 결제한 주기에 전액이
                한 줄로 들어 개월수만 적는다.
              */
              badge={badgeTextOf(t, row)}
            />
          </View>
        );
      })}

      <MoreButton
        hasMore={ledger.hasMore}
        isLoading={ledger.isLoading}
        loadMore={ledger.loadMore}
      />
    </>
  );
}

/**
 * 원장 한 줄. 결제대금 탭과 실적 탭이 함께 쓴다.
 *
 * **카드는 부호를 뒤집어 읽는다.** 부채 계정은 빚이 늘수록 음수라 그대로 그리면 쓴 돈이
 * 마이너스로 보인다. 카드에서 알고 싶은 것은 얼마를 썼고 얼마가 남았는가다.
 */
function LedgerRow({
  row,
  currency,
  isCard,
  note,
  badge = null,
  onOpenEntry,
}: {
  row: {
    entryId: string;
    date: string;
    description: string;
    amount: string;
    categoryName: string | null;
    parentCategoryName: string | null;
  };
  currency: string;
  isCard: boolean;
  /** 금액 아래 작게 붙는 말. 남은 대금이거나 쌓인 실적이다. */
  note: string | null;
  /** 제목 옆의 작은 표. 지금은 할부 회차뿐이다. */
  badge?: string | null;
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  // 원장 금액은 계정 관점이다 (부채가 늘면 음수). 카드에서 읽을 값으로 뒤집는다.
  const amount = isCard ? -toNumber(row.amount) : toNumber(row.amount);
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
    /*
      줄 전체가 누를 자리다. 거래 목록에서 한 줄을 눌러 상세를 여는 것과 같은
      손짓이라, 원장에서만 누를 수 없으면 "여기 것은 못 고치는 줄"로 읽힌다.

      대금 결제 줄도 똑같이 전표라 함께 열린다. 폼으로 고칠 수 없는 갈래는
      상세 팝업이 고치기 단추를 감춘다 -- 여기서 가릴 일이 아니다.
    */
    <Pressable
      onPress={onOpenEntry ? () => onOpenEntry(row.entryId) : undefined}
      disabled={!onOpenEntry}
      className={`flex-row items-start justify-between gap-3 border-b border-gray-100 py-2.5 ${
        onOpenEntry ? 'active:opacity-70' : ''
      }`}
    >
      <View className="flex-1">
        <Text className="text-[15px] text-gray-900">{title}</Text>
        <Text className="mt-0.5 text-xs text-gray-500">
          {formatDate(row.date, timeZone)}
          {badge ? ` · ${badge}` : ''}
        </Text>
      </View>

      <View className="items-end">
        <Text className={`text-[15px] font-bold ${isGood ? 'text-green-600' : 'text-red-600'}`}>
          {isUp ? '+' : '-'}
          {formatCurrency(Math.abs(amount), currency)}
        </Text>
        {note ? <Text className="mt-0.5 text-xs text-gray-500">{note}</Text> : null}
      </View>
    </Pressable>
  );
}

/** 더 보기. 원장 목록 셋이 같은 단추를 쓴다. */
function MoreButton({
  hasMore,
  isLoading,
  loadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  loadMore: () => void;
}) {
  const { t } = useTranslation();
  if (!hasMore) return null;

  return (
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
  );
}
