'use client';

import { useEffect, useState } from 'react';

import type { Account, Card } from '@money/core/lib/types';
import { formatDateMarker } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useAccountLedger } from '@money/core/hooks/useAccountLedger';
import { useCardEntries } from '@money/core/hooks/useCardEntries';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import CardPerformancePanel from '@/components/CardPerformancePanel';
import CardSettlementPanel from '@/components/CardSettlementPanel';
import { LedgerList, PeriodLedgerList } from '@/components/AssetLedgerList';

/**
 * 카드 상세의 본문. 결제대금·실적 탭, 대금 정산, 결제 내역.
 *
 * 자산 화면에서 카드를 누른 상세와 예산 화면에서 카드를 누른 팝업이 같은 것을 그린다.
 * 머리글(이름·단추)은 그리는 쪽이 저마다 정한다 -- 자산 화면은 목록 옆 칸이고 예산 화면은 팝업이다.
 */
export default function CardDetailBody({
  card,
  accounts,
  reloadToken,
  onChange,
  onOpenEntry,
}: {
  card: Card;
  /** 결제 통장의 통화와 주인을 찾는 데 쓴다. */
  accounts: Account[];
  /** 거래를 고치면 올라가는 번호. 원장·실적이 다시 읽는다. */
  reloadToken: number;
  /** 대금을 기록하는 등 카드 쪽 숫자가 바뀐 뒤. */
  onChange: () => void | Promise<void>;
  /** 원장 줄을 눌렀을 때. 거래 상세를 여는 일은 그리는 쪽이 맡는다. */
  onOpenEntry: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const displayCurrency = useProjectDisplayCurrency();
  const mirrorVersion = useMirrorVersion();

  /*
   * 카드 상세를 두 탭으로 가른다. 실적과 결제대금은 다른 질문이다.
   *
   *   결제대금  얼마를 갚아야 하나. 실적에서 뺀 결제까지 전부 센다.
   *   실적      혜택을 받을 만큼 썼나. 뺀 결제는 그래프에도 내역에도 없다.
   *
   * 한 화면에 나란히 두면 같은 축의 막대 둘이 서로 다른 숫자를 말해, 어느 쪽을 보고
   * 있는지가 흐려진다. 기본은 결제대금이다 -- 카드를 열어 먼저 묻는 것이 그쪽이다.
   */
  const [cardTab, setCardTab] = useState<'billed' | 'performance'>('billed');

  /**
   * 그래프 아래에서 고른 주기. null 이면 전체를 본다.
   *
   * 결제내역과 실적 원장을 그 주기로 좁히는 데 쓴다. 카드나 탭을 옮기면 푼다 -- 다른
   * 카드의 주기를 그대로 들고 있으면 빈 목록이 서고, 탭마다 주기의 뜻이 다르다
   * (청구 주기와 실적 주기는 같은 달이어도 세는 것이 다르다).
   */
  const [pickedPeriod, setPickedPeriod] = useState<{
    closingKey: string;
    periodStart: string;
    periodEnd: string;
  } | null>(null);

  useEffect(() => {
    setPickedPeriod(null);
  }, [card.id, cardTab]);

  /*
   * 신용카드의 결제 내역.
   *
   * 카드의 부채 계정 원장이다. 통장 상세가 보는 것과 같은 줄이라 받아 오는 자리도
   * 같다(core 의 useAccountLedger). 체크카드는 그 계정이 없어 비어 있다.
   */
  const cardLedger = useAccountLedger(
    card.liabilityAccountId ?? null,
    reloadToken + mirrorVersion,
    /*
     * 구간으로 좁히지 않는다. 주기를 고르면 이 목록 대신 청구 내역을 그리기 때문이다 --
     * 원장을 날짜로 자르면 그 주기에 청구되는 할부 회차가 빠진다.
     */
    null,
  );

  /*
   * 체크카드의 결제 내역.
   *
   * 쓰는 즉시 결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다. 통장 원장에서는 다른
   * 수단으로 쓴 것과 뒤섞여 있으므로, 전표를 그 카드로 걸러 받아 같은 모양의 줄로
   * 옮긴다 (core 의 useCardEntries).
   */
  const debitLedger = useCardEntries(
    card.liabilityAccountId ? null : card.id,
    selectedProjectId,
    reloadToken + mirrorVersion,
    cardTab === 'billed' && pickedPeriod
      ? { startDate: pickedPeriod.periodStart, endDate: pickedPeriod.periodEnd }
      : null,
  );

  /**
   * 고른 카드의 결제 내역. 두 갈래 중 그 카드가 쓰는 쪽이다.
   *
   * 어디서 읽었든 줄의 모양이 같아(LedgerLikeRow) 화면은 하나만 그린다.
   */
  const cardPayments = card.liabilityAccountId ? cardLedger : debitLedger;

  /**
   * 고른 주기의 청구 내역을 그릴 수 있는가.
   *
   * 신용카드만이다. 체크카드는 쓰는 즉시 통장에서 빠져 청구라는 것이 없고, 주기를
   * 골라도 그 달 전표가 그대로 답이라 목록을 바꿀 까닭이 없다.
   */
  const billedLedgerReady = Boolean(card.liabilityAccountId);

  /**
   * 카드 금액의 통화. 사용액·한도·남은 대금은 전부 결제 통장의 통화다.
   * 기준통화 환산액이 아니라서 원으로 찍으면 달러 카드가 1/1380로 보인다.
   */
  const cardCurrency =
    accounts.find((a) => a.id === card.paymentAccountId)?.currency ?? 'KRW';

  return (
    <>
    <div
      role="tablist"
      aria-label={t('assets.cardLedger')}
      className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1"
    >
      {(
        [
          { id: 'billed', labelKey: 'settlement.tabBilled' },
          { id: 'performance', labelKey: 'settlement.tabPerformance' },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={cardTab === tab.id}
          onClick={() => setCardTab(tab.id)}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            cardTab === tab.id
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>

    {/* 실적 진행률은 실적 탭의 것이다. 세는 구간은 카드 종류가 정한다. */}
    {cardTab === 'performance' && (
      <CardPerformancePanel cardId={card.id} reloadToken={reloadToken} />
    )}

    <div className="pt-4 border-t">
      <CardSettlementPanel
        card={card}
        paymentAccountOwnerId={
          accounts.find((a) => a.id === card.paymentAccountId)?.ownerId
        }
        reloadToken={reloadToken}
        onChange={onChange}
        measure={cardTab}
        selectedPeriodKey={pickedPeriod?.closingKey ?? null}
        onOpenEntry={onOpenEntry}
        onSelectPeriod={setPickedPeriod}
      />
    </div>

    {/*
      결제 내역. 통장 상세의 입출금 내역과 같은 자리다.

      두 카드가 다른 데서 읽는다. 신용카드는 그 카드의 부채 계정에 사용과
      대금이 쌓이므로 원장을 그대로 읽어 줄마다 남은 대금까지 붙지만,
      체크카드는 쓰는 즉시 결제 통장에서 빠져 카드 쪽에 쌓이는 계정이 없다 --
      그쪽은 전표를 카드로 걸러 받는다. 예전에는 그 길이 없어 체크카드에만
      이 칸이 통째로 없었다.
    */}
    <div className="pt-4 border-t space-y-3">
      {/*
        어느 구간을 보고 있는지 이름 옆에 적는다.

        그래프에서 주기를 누르면 아래 목록이 그 주기만 남는데, 목록만 보아서는
        그것이 전부인지 걸러진 것인지 알 수 없다 -- 거래가 적은 주기를 고르면
        "내역이 없습니다"가 뜨고, 그 까닭이 화면 어디에도 없었다.
      */}
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-gray-700">
          {t(
            cardTab === 'billed' && pickedPeriod && billedLedgerReady
              ? 'assets.billedLedger'
              : 'assets.cardLedger',
          )}
        </h3>
        <span className="text-xs text-gray-500">
          {pickedPeriod
            ? `${formatDateMarker(pickedPeriod.periodStart)} ~ ${formatDateMarker(
                pickedPeriod.periodEnd,
              )}`
            : t('assets.ledgerAllPeriod')}
        </span>
      </div>
      {/*
        세 갈래다. 묻는 것이 다르면 줄도 달라야 한다.

        실적 탭은 주기마다 0에서 다시 쌓는 실적 원장을 그린다. 결제대금 탭은
        기본이 계좌 원장(줄마다 남은 대금)이고, **주기를 고르면 그 주기의 청구
        내역**으로 바뀐다 -- 청구는 할부 회차가 뒤 주기로 넘어가므로 원장을
        날짜로 자르면 막대는 큰데 목록은 비는 일이 생긴다. 24개월 할부로 산
        차가 매달 청구될 때가 그렇다.
      */}
      {cardTab === 'performance' || (pickedPeriod && billedLedgerReady) ? (
        <>
          <PeriodLedgerList
            cardId={card.id}
            measure={cardTab}
            fallbackCurrency={
              card.liabilityAccountId
                ? cardCurrency
                : displayCurrency
            }
            reloadToken={reloadToken}
            closingKey={pickedPeriod?.closingKey ?? null}
            onOpenEntry={onOpenEntry}
          />
        </>
      ) : (
        <LedgerList
          rows={cardPayments.rows}
          /*
            통화가 갈린다. 신용카드 줄은 부채 계정의 원장이라 그 계정의 통화로
            적혀 있지만, 체크카드 줄은 전표 목록에서 온 것이라 표시 통화로
            환산된 금액이다 (EntryListItem.amount).
          */
          currency={
            card.liabilityAccountId
              ? cardCurrency
              : displayCurrency
          }
          kind="liability"
          hasMore={cardPayments.hasMore}
          isLoading={cardPayments.isLoading}
          onMore={cardPayments.loadMore}
          onOpenEntry={onOpenEntry}
        />
      )}
    </div>
    </>
  );
}
