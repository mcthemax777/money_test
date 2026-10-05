'use client';

import type { CardDto } from '@money/types';
import type { LedgerLikeRow } from '@money/core/lib/types';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { categoryTitleOf } from '@money/core/lib/entries';
import { installmentBadge } from '@money/core/lib/period-ledger';
import type { CardUsageMeasure } from '@money/core/lib/card-usage-chart';
import { useCardPeriodLedger } from '@money/core/hooks/useCardPeriodLedger';
import { useProjectTimeZone } from '@money/core/store/project';
import PullFooter from '@/components/PullFooter';
import { useBottomPull } from '@/hooks/useBottomPull';

/*
 * 자산 상세의 원장 목록들. 통장 상세와 카드 상세(자산 화면, 예산 화면의 카드 팝업)가 함께 쓴다.
 */

/**
 * 원장 줄 목록. 통장 상세와 카드 상세가 함께 쓴다.
 *
 * 줄마다 그 거래 직후의 잔액이 붙는다. 카드에서는 그 잔액이 "남은 대금"이라, 쓴 줄을
 * 만나면 늘고 결제한 줄을 만나면 줄어드는 것이 그대로 보인다.
 */
export function LedgerList({
  rows,
  currency,
  kind,
  hasMore,
  isLoading,
  onMore,
  onOpenEntry,
}: {
  rows: LedgerLikeRow[];
  /** 그 계좌의 통화. 기준통화 환산액이 아니라 원장에 적힌 그대로다. */
  currency: string;
  /** 'asset' 은 통장, 'liability' 는 카드다 (부채 계정이 없는 체크카드까지). */
  kind: 'asset' | 'liability';
  hasMore: boolean;
  isLoading: boolean;
  onMore: () => void;
  /**
   * 주면 줄을 눌러 그 거래의 상세를 연다. 없으면 읽기만 하는 목록이다.
   *
   * 여는 일은 화면이 맡는다 -- 상세 팝업은 이 목록이 아니라 자산 화면이 들고 있다.
   */
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const isCard = kind === 'liability';
  /* 바닥에서 한 번 더 당기면 다음 쪽이 온다. 홈의 거래 목록과 같은 손짓이다. */
  const pull = useBottomPull({ hasMore, isLoading, count: rows.length, loadMore: onMore });

  if (rows.length === 0) {
    return <p className="text-sm text-gray-600">{t('assets.noEntries')}</p>;
  }

  return (
    <div>
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

      <PullFooter pull={pull} isLoading={isLoading} hasMore={hasMore} isEmpty={false} />
    </div>
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
 * 그러하고, 바로 위의 막대도 같은 값을 그린다.
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
  const timeZone = useProjectTimeZone();
  const isBilled = measure === 'billed';
  const ledger = useCardPeriodLedger(cardId, measure, reloadToken, closingKey);
  const currency = ledger.currency ?? fallbackCurrency;
  /* 바닥에서 한 번 더 당기면 다음 쪽이 온다. 다른 원장과 같은 손짓이다. */
  const pull = useBottomPull({
    hasMore: ledger.hasMore,
    isLoading: ledger.isLoading,
    count: ledger.rows.length,
    loadMore: ledger.loadMore,
  });

  if (ledger.hasError) {
    return <p className="text-sm text-red-600">{t('feed.loadFailed')}</p>;
  }

  if (ledger.rows.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        {ledger.isLoading ? t('settlement.loading') : t('assets.noEntries')}
      </p>
    );
  }

  return (
    <div>
      {ledger.rows.map((row, index) => {
        // 주기가 바뀌는 자리에만 머리글을 세운다. 어디서 0으로 돌아가는지가 그 줄로 드러난다.
        const period =
          row.periodStart === ledger.rows[index - 1]?.periodStart
            ? null
            : ledger.periods[row.periodStart];

        return (
          <div key={row.key}>
            {period && (
              <div className="mt-2 flex items-baseline justify-between gap-2 border-b border-gray-200 pb-1">
                <p className="text-xs font-medium text-gray-700">
                  {formatDate(period.periodStart, timeZone)} ~{' '}
                  {formatDate(period.periodEnd, timeZone)}
                </p>
                <p className="text-xs text-gray-500 whitespace-nowrap">
                  {t(isBilled ? 'assets.billedPeriodTotal' : 'assets.performancePeriodTotal', {
                    amount: formatCurrency(toNumber(period.total), currency),
                  })}
                </p>
              </div>
            )}

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
          </div>
        );
      })}

      <PullFooter
        pull={pull}
        isLoading={ledger.isLoading}
        hasMore={ledger.hasMore}
        isEmpty={false}
      />
    </div>
  );
}

/**
 * 원장 한 줄. 결제대금 탭과 실적 탭이 함께 쓴다.
 *
 * **카드는 부호를 뒤집어 읽는다.** 사용과 결제는 카드의 부채 계정에 쌓이는데 그 계정은
 * 빚이 늘수록 음수다. 그대로 그리면 쓴 돈이 마이너스로, 갚은 돈이 플러스로 보인다.
 * 카드에서 알고 싶은 것은 "얼마를 썼고 얼마가 남았는가"이므로 사용을 +로 세운다.
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
  /** 날짜 옆의 작은 표. 지금은 할부 회차뿐이다. */
  badge?: string | null;
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  // 원장 posting의 amount는 이미 부호를 갖는다 (자산 증가 +, 감소 -).
  // 부호를 그대로 두고 앞에 '-'를 또 붙이면 '--₩10,000'이 된다. 절댓값으로 찍는다.
  const amount = isCard ? -toNumber(row.amount) : toNumber(row.amount);
  const isUp = amount > 0;
  /*
    색. 통장은 들어온 돈이 초록이고, 카드는 반대다 -- 쌓인 대금이 갚아야 할
    돈이라 빨강, 결제가 그것을 더는 일이다.
  */
  const color = (isCard ? !isUp : isUp) ? 'text-green-600' : 'text-red-600';
  /*
    제목. 설명이 비어 있으면 분류가 그 줄의 이름 노릇을 한다 ("대분류 > 소분류").

    예전에는 제목 아래에 가맹점을 한 줄 더 적었다. 그런데 가맹점은 설명과 같은
    글자인 일이 많아(카드 내역을 들여올 때 둘 다 상호가 된다) 같은 말이 두 번
    섰다. 분류는 이체 계열에 없으므로 그때는 "(내용 없음)"이 남는다.
  */
  const title = row.description || categoryTitleOf(row) || t('entry.noTitle');

  /*
    줄 전체가 누를 자리다. 거래 목록에서 한 줄을 눌러 상세를 여는 것과 같은
    손짓이라, 원장에서만 누를 수 없으면 "여기 것은 못 고치는 줄"로 읽힌다.

    대금 결제 줄도 똑같이 전표라 함께 열린다. 폼으로 고칠 수 없는 갈래는 상세
    팝업이 고치기 단추를 감춘다 -- 여기서 가릴 일이 아니다.
  */
  const Row = onOpenEntry ? 'button' : 'div';

  return (
    <Row
      {...(onOpenEntry ? { type: 'button' as const, onClick: () => onOpenEntry(row.entryId) } : {})}
      className={`flex w-full items-start justify-between gap-3 border-b border-gray-100 py-2.5 text-left ${
        onOpenEntry ? 'transition hover:bg-gray-50' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-gray-900">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {formatDate(row.date, timeZone)}
          {badge ? ` · ${badge}` : ''}
        </p>
      </div>
      <div className="text-right whitespace-nowrap">
        {/*
          원장의 금액과 잔액은 그 계좌의 통화다 (기준통화 환산액이 아니다).
          통화를 넘기지 않으면 달러 통장의 $100이 ₩100으로 보인다.
        */}
        <p className={`text-[15px] font-bold ${color}`}>
          {isUp ? '+' : '-'}
          {formatCurrency(Math.abs(amount), currency)}
        </p>
        {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
      </div>
    </Row>
  );
}
