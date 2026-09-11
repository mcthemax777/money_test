/*
 * 실적 진행 상황. 웹의 같은 칸을 앱에 옮긴 것이다.
 *
 * 카드사가 혜택을 주는 기준이라 "얼마 남았나"가 알고 싶은 값이다. 그래서 사용액
 * 자체보다 기준까지의 거리를 크게 적는다.
 *
 * 기준액을 설정하지 않은 카드에는 아무것도 그리지 않는다. 실적 조건이 없는 카드가
 * 더 많아서, 0원짜리 막대를 늘 띄우면 화면만 어지럽다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { apiClient } from '@money/core/lib/api-client';
import { formatDateMarker } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { CardDto } from '@money/types';

export default function CardPerformancePanel({
  cardId,
  /** 거래가 바뀌면 올라오는 값. 사용액을 다시 읽는다. */
  reloadToken = 0,
}: {
  cardId: string;
  reloadToken?: number;
}) {
  const { t } = useTranslation();
  // 남이 그 카드로 결제한 것도 실적에 들어와야 한다. reloadToken 은 이 화면의 편집만 센다.
  const mirrorVersion = useMirrorVersion();
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
    // t 는 언어가 바뀔 때 새 함수가 된다. 의존성에 넣으면 언어를 바꿀 때마다 다시 부른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load, reloadToken, mirrorVersion]);

  if (error) {
    return <Text className="text-sm text-red-600">{error}</Text>;
  }
  // 기준액이 없으면 이 카드에는 실적 조건이 없다는 뜻이다.
  if (!performance || performance.target === null) return null;

  const usage = toNumber(performance.usage);
  const target = toNumber(performance.target);
  /*
   * 막대 길이. 기준을 넘겨도 100%에서 멈춘다.
   *
   * 사용액이 음수일 수 있어(취소가 더 많은 구간) 아래도 0에서 자른다. 음수 너비는
   * 그려지지 않고 자리만 흔든다.
   */
  const progress = target > 0 ? Math.min(Math.max((usage / target) * 100, 0), 100) : 0;
  const reached = performance.achieved;

  return (
    <View className={`gap-2 rounded-lg p-4 ${reached ? 'bg-emerald-50' : 'bg-amber-50'}`}>
      <View className="flex-row items-baseline justify-between gap-2">
        <Text
          className={`shrink text-sm font-semibold ${
            reached ? 'text-emerald-700' : 'text-amber-800'
          }`}
        >
          {reached
            ? t('performance.reached')
            : t('performance.remaining', {
                amount: formatCurrency(performance.remaining, performance.currency),
              })}
        </Text>
        <Text className="text-sm text-gray-700">
          {formatCurrency(performance.usage, performance.currency)} /{' '}
          {formatCurrency(performance.target, performance.currency)}
        </Text>
      </View>

      <View className="h-2 overflow-hidden rounded-full bg-white">
        <View
          className={`h-full rounded-full ${reached ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${progress}%` }}
        />
      </View>

      {/*
        어느 구간을 센 값인지 함께 적는다. 신용카드는 마감일 기준이라 달력의 달과
        어긋나서, 구간을 안 적으면 "이번 달 얼마 썼더라"와 숫자가 달라 보인다.
      */}
      <Text className="text-xs text-gray-600">
        {t(
          performance.basis === 'statement'
            ? 'performance.basisStatement'
            : 'performance.basisMonth',
        )}{' '}
        {formatDateMarker(performance.periodStart)} ~ {formatDateMarker(performance.periodEnd)}
      </Text>
    </View>
  );
}
