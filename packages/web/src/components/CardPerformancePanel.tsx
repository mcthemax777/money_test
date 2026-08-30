'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CardDto } from '@money/types';
import { apiClient } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { formatDateMarker } from '@money/core/lib/datetime';

interface CardPerformancePanelProps {
  cardId: string;
  /** 거래가 바뀌면 올라오는 값. 사용액을 다시 읽는다. */
  reloadToken?: number;
}

/**
 * 실적 진행 상황.
 *
 * 카드사가 혜택을 주는 기준이라 "얼마 남았나"가 알고 싶은 값이다. 그래서 사용액
 * 자체보다 기준까지의 거리를 크게 적는다.
 *
 * 기준액을 설정하지 않은 카드에는 아무것도 그리지 않는다. 실적 조건이 없는 카드가
 * 더 많아서, 0원짜리 막대를 늘 띄우면 화면만 어지럽다.
 */
export default function CardPerformancePanel({
  cardId,
  reloadToken = 0,
}: CardPerformancePanelProps) {
  const { t } = useTranslation();
  const [performance, setPerformance] = useState<CardDto.PerformanceResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setPerformance(await apiClient.getCardPerformance(cardId));
    } catch {
      setPerformance(null);
      setError(t('performance.loadFailed'));
    }
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  // 기준액이 없으면 이 카드에는 실적 조건이 없다는 뜻이다.
  if (!performance || performance.target === null) return null;

  const usage = toNumber(performance.usage);
  const target = toNumber(performance.target);
  /*
   * 막대 길이. 기준을 넘겨도 100%에서 멈춘다.
   *
   * 사용액이 음수일 수 있어(취소가 더 많은 구간) 아래도 0에서 자른다. 음수 너비는
   * 그려지지 않고 레이아웃만 흔든다.
   */
  const progress = target > 0 ? Math.min(Math.max((usage / target) * 100, 0), 100) : 0;

  return (
    <div
      className={`rounded-lg p-4 space-y-2 ${
        performance.achieved ? 'bg-emerald-50' : 'bg-amber-50'
      }`}
    >
      <div className="flex justify-between items-baseline gap-2">
        <span
          className={`text-sm font-semibold ${
            performance.achieved ? 'text-emerald-700' : 'text-amber-800'
          }`}
        >
          {performance.achieved
            ? t('performance.reached')
            : t('performance.remaining', {
              amount: formatCurrency(performance.remaining, performance.currency),
            })}
        </span>
        <span className="text-sm text-gray-700 tabular-nums">
          {formatCurrency(performance.usage, performance.currency)} /{' '}
          {formatCurrency(performance.target, performance.currency)}
        </span>
      </div>

      <div className="h-2 bg-white rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            performance.achieved ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/*
        어느 구간을 센 값인지 함께 적는다. 신용카드는 마감일 기준이라 달력의 달과
        어긋나서, 구간을 안 적으면 "이번 달 얼마 썼더라"와 숫자가 달라 보인다.
      */}
      <p className="text-xs text-gray-600">
        {t(
              performance.basis === 'statement'
                ? 'performance.basisStatement'
                : 'performance.basisMonth',
            )}{' '}
        {formatDateMarker(performance.periodStart)} ~ {formatDateMarker(performance.periodEnd)}
      </p>
    </div>
  );
}
