'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LEDGER_MIN_ENTRY_DATE_KEY,
  ledgerMaxEntryDateKey,
  zonedFormValueToUtc,
  type CardTransferDirection,
} from '@money/types';
import { apiClient } from '@/lib/api-client';
import type { CardUsage } from '@/lib/types';
import { formatCurrency, toAmountString, toNumber } from '@/lib/money';
import { formatDateMarker, todayKey } from '@/lib/datetime';
import { useProjectTimeZone } from '@/store/project';
import Modal from './Modal';
import PendingRatePanel from './PendingRatePanel';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const PAYMENT_FORM_ID = 'card-payment-form';

/** 카드사와 통장 사이 자금이 오가는 방향 */
const TRANSFER_DIRECTIONS = [
  { id: 'payment' as CardTransferDirection, label: '대금 결제' },
  { id: 'refund' as CardTransferDirection, label: '환불 입금' },
];

interface CardSettlementPanelProps {
  card: {
    id: string;
    cardType: 'debit' | 'credit';
    /** 대금이 오가는 통장. 카드에 붙어 있어 사용자가 고르지 않는다. */
    paymentAccountId: string;
  };
  /**
   * 결제 통장의 주인. 대금 전표에 사람을 달아야 해서 필요하다.
   *
   * 없으면 대금을 기록할 수 없다. 통장은 있는데 주인이 없는 상태라 화면에서
   * 고칠 곳도 여기가 아니므로, 버튼을 감추고 이유를 적는다.
   */
  paymentAccountOwnerId?: string | null;
  /** 거래가 바뀌면 올린다. 사용 현황을 다시 읽는다. */
  reloadToken?: number;
  /** 대금을 기록하거나 환율을 확정한 뒤. 부모가 카드 목록·총자산을 다시 읽는다. */
  onChange?: () => void | Promise<void>;
}

/**
 * 신용카드 정산.
 *
 * 남은 대금, 마감일 기준 주기별 사용액, 대금 기록, 외화 청구액 확정이 한 덩어리다.
 * 자산 화면의 카드 상세와 가계 화면의 수단별 탭이 같은 것을 보여 줘야 해서 컴포넌트로
 * 뽑았다. 예전에는 자산 화면 안에만 있어서 가계 화면에서 카드를 보다가 대금을
 * 기록하려면 화면을 옮겨야 했다.
 *
 * 청구서를 저장하지 않는다. 남은 대금과 주기별 사용액을 서버가 카드의 현재 마감일로
 * 그때그때 계산하므로, 마감일을 바꾸면 과거 주기까지 곧바로 다시 그려진다.
 */
export default function CardSettlementPanel({
  card,
  paymentAccountOwnerId,
  reloadToken = 0,
  onChange,
}: CardSettlementPanelProps) {
  const timeZone = useProjectTimeZone();

  const [usage, setUsage] = useState<CardUsage | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    direction: 'payment' as CardTransferDirection,
    amount: '',
    /**
     * 대금이 통장에서 빠진 날.
     *
     * 예전에는 서버가 저장 시각을 박았다. 결제일에 맞춰 뒤늦게 입력하거나 미리
     * 기록해 두는 경우 통장 잔액의 날짜가 실제와 어긋났다. 그래서 사용자가 고른다.
     */
    date: '',
  });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);

  const isCredit = card.cardType === 'credit';

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await apiClient.getCardUsage(card.id));
    } catch (err) {
      console.error('카드 사용 현황 조회 실패:', err);
      setUsage(null);
    }
  }, [card.id]);

  useEffect(() => {
    if (!isCredit) {
      setUsage(null);
      return;
    }
    loadUsage();
  }, [isCredit, loadUsage, reloadToken]);

  // 남은 대금이 음수면 카드사가 갚을 돈이 남은 상태다.
  const outstanding = Number(usage?.outstanding ?? 0);
  const refundPending = outstanding < 0;
  /** 입력 금액이 남은 쪽 잔액을 넘는 정도. 막지는 않고 알리기만 한다. */
  const overTransfer = (() => {
    const amount = toNumber(paymentForm.amount);
    if (!amount) return 0;
    const room = paymentForm.direction === 'refund' ? -outstanding : outstanding;
    return amount > room ? amount - Math.max(room, 0) : 0;
  })();

  /** 이체 팝업 닫기. 취소·닫기·성공 세 경로가 같은 초기화를 쓴다. */
  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setPaymentForm({ direction: 'payment', amount: '', date: '' });
  };

  /** 대금이 오가거나 환율이 확정된 뒤. 이 패널과 부모가 함께 다시 읽는다. */
  const refresh = async () => {
    await loadUsage();
    await onChange?.();
  };

  /**
   * 카드사와 통장 사이 자금 이동 기록.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수(환불 예정)로 남아야 한다.
   */
  const handleCardTransfer = async () => {
    if (!usage || !paymentAccountOwnerId) return;

    try {
      setIsPaymentSubmitting(true);
      await apiClient.createCardTransfer(card.id, {
        accountId: card.paymentAccountId,
        personId: paymentAccountOwnerId,
        amount: toAmountString(paymentForm.amount),
        direction: paymentForm.direction,
        // 입력한 날짜는 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
        date: zonedFormValueToUtc(
          paymentForm.date || todayKey(timeZone),
          undefined,
          timeZone,
        ).toISOString(),
      });

      closePaymentModal();
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '기록에 실패했습니다.');
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  if (!isCredit) {
    return (
      <p className="text-gray-600">
        체크카드는 결제 즉시 통장에서 빠집니다. 청구 주기와 남은 대금이 없습니다.
      </p>
    );
  }

  if (!usage) {
    return <p className="text-gray-600">사용 현황을 불러오는 중입니다...</p>;
  }

  return (
    <>
      <div className="space-y-3">
        <div
          className={`rounded-lg p-4 space-y-3 ${refundPending ? 'bg-emerald-50' : 'bg-red-50'}`}
        >
          <div className="flex justify-between items-baseline">
            <span
              className={`text-sm font-semibold ${
                refundPending ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {refundPending ? '환불 예정' : '남은 대금'}
            </span>
            <span
              className={`text-lg font-bold ${
                refundPending ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {formatCurrency(Math.abs(outstanding), usage.currency)}
            </span>
          </div>
          {refundPending && (
            <p className="text-xs text-emerald-700">
              카드사가 갚을 돈입니다. 맞지 않으면 대금 기록을 확인하세요.
            </p>
          )}
          {paymentAccountOwnerId ? (
            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              대금 기록하기
            </button>
          ) : (
            <p className="text-xs text-gray-600">
              결제 통장의 주인이 없어 대금을 기록할 수 없습니다. 자산 화면에서 통장 주인을
              지정하세요.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">마감일 기준 사용액</h3>
          <div className="space-y-1">
            {usage.periods.map((period) => (
              <div
                key={period.periodEnd}
                className="flex justify-between items-center px-3 py-2 bg-gray-50 rounded-lg"
              >
                <div className="text-sm text-gray-700">
                  {formatDateMarker(period.periodStart)} ~ {formatDateMarker(period.periodEnd)}
                  <span className="ml-2 text-xs text-gray-500">
                    {period.closed ? '마감' : '진행'}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {formatCurrency(period.usage, usage.currency)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            할부는 회차분만 들어갑니다. 남은 대금은 결제까지 반영한 값이라 합계와 다릅니다.
          </p>
        </div>

        {/*
          외화 결제의 청구액 확정.
          추정 환율로 들어간 건이 남아 있으면 남은 대금이 명세서와 어긋나므로,
          그 건들을 여기 모아 한 번에 맞춘다.
        */}
        <PendingRatePanel cardId={card.id} onSettled={refresh} />
      </div>

      {/* 카드사 자금 이동 모달 */}
      {isPaymentModalOpen && (
        <Modal
          isOpen={true}
          onClose={closePaymentModal}
          title="카드 대금 기록"
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closePaymentModal}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                취소
              </button>
              <button
                type="submit"
                form={PAYMENT_FORM_ID}
                disabled={isPaymentSubmitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isPaymentSubmitting ? '처리 중...' : '기록하기'}
              </button>
            </div>
          }
        >
          <form
            id={PAYMENT_FORM_ID}
            onSubmit={(e) => {
              e.preventDefault();
              handleCardTransfer();
            }}
            className="space-y-4"
          >
            <div className="bg-gray-50 p-3 rounded-lg flex justify-between">
              <span className="text-sm text-gray-600">
                {refundPending ? '환불 예정' : '남은 대금'}
              </span>
              <span className="font-semibold">
                {formatCurrency(Math.abs(outstanding), usage.currency)}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">방향</label>
              <div className="flex gap-2">
                {TRANSFER_DIRECTIONS.map((option) => (
                  <label key={option.id} className="flex-1 flex items-center">
                    <input
                      type="radio"
                      value={option.id}
                      checked={paymentForm.direction === option.id}
                      onChange={() => setPaymentForm({ ...paymentForm, direction: option.id })}
                      className="mr-2"
                    />
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {paymentForm.direction === 'refund'
                  ? '카드사가 통장에 넣어 준 돈입니다.'
                  : '통장에서 카드사로 나간 돈입니다.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
              <input
                type="date"
                required
                value={paymentForm.date || todayKey(timeZone)}
                min={LEDGER_MIN_ENTRY_DATE_KEY}
                // 연도 오타(2026 -> 2926)를 서버 400 전에 브라우저가 막는다
                max={ledgerMaxEntryDateKey()}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">통장에서 돈이 실제로 오간 날입니다.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">금액</label>
              <input
                type="number"
                required
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {/*
                상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
                입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수로 남아야 한다.
              */}
              {overTransfer > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {refundPending ? '환불 예정액' : '남은 대금'}보다{' '}
                  {formatCurrency(overTransfer, usage.currency)} 많습니다. 차액은{' '}
                  {paymentForm.direction === 'refund' ? '대금' : '환불 예정'}으로 남습니다.
                </p>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
