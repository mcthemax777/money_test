import { Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';

import type { SpendingMethod } from '@money/core/hooks/useHomeData';
import { cardPaletteOf } from '@money/core/lib/card-color';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';

/*
 * nativewind 는 자기가 아는 컴포넌트에만 className 을 스타일로 바꿔 준다. 남의
 * 컴포넌트에는 그냥 넘겨져 무시되므로(카드 안쪽 여백이 통째로 사라진다) 여기서
 * 한 번 알려 준다.
 */
cssInterop(LinearGradient, { className: 'style' });

/** 종류 이름. 카드 앞면 왼쪽 위에 적는다. */
const KIND_KEY: Record<SpendingMethod['kind'], MessageKey> = {
  credit_card: 'method.credit_card',
  debit_card: 'method.debit_card',
};

/**
 * 실적 구간 카드 줄. 웹의 SpendingMethodCarousel 과 같다.
 *
 * 옆으로 넘겨 본다. 카드 한 장의 크기와 비율은 실제 카드(ISO/IEC 7810 ID-1)를 따른다.
 */
export default function SpendingMethodCarousel({
  methods,
  onSelect,
}: {
  methods: SpendingMethod[];
  onSelect?: (method: SpendingMethod) => void;
}) {
  const { t } = useTranslation();

  if (methods.length === 0) {
    return <Text className="text-sm text-gray-600">{t('method.empty')}</Text>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-4 pb-2"
    >
      {methods.map((method) => (
        <MethodCard
          key={`${method.kind}-${method.id}`}
          method={method}
          onSelect={onSelect && (() => onSelect(method))}
        />
      ))}
    </ScrollView>
  );
}

function MethodCard({ method, onSelect }: { method: SpendingMethod; onSelect?: () => void }) {
  const { t } = useTranslation();
  /* 앞면 색과 그 위에서 읽히는 글씨 색은 lib/card-color 가 짝으로 들고 있다. */
  const palette = cardPaletteOf(method.color, method.kind === 'credit_card' ? 'credit' : 'debit');
  const usage = toNumber(method.usage);
  const target = method.target === null ? null : toNumber(method.target);
  /*
   * 실적 막대. 기준을 넘겨도 100%에서 멈춘다. 사용액이 음수일 수 있어(취소가 더 많은
   * 구간) 아래도 0에서 자른다.
   */
  const progress =
    target && target > 0 ? Math.min(Math.max((usage / target) * 100, 0), 100) : null;
  /* 실적을 채우려면 남은 금액. 이미 넘겼으면 음수로 그대로 적는다. */
  const remaining = progress === null || target === null ? null : target - usage;
  const tone = remaining !== null && remaining > 0 ? palette.positive : palette.negative;

  return (
    <Pressable
      onPress={onSelect}
      disabled={!onSelect}
      /*
       * 실제 카드(ISO/IEC 7810 ID-1, 85.6 × 53.98mm) 비율을 그대로 쓴다.
       * 높이를 직접 적지 않고 너비에서 비율로 잡는다. 웹과 같은 값이라 두 화면의
       * 카드 모양이 어긋나지 않는다.
       */
      className="aspect-[85.6/53.98] w-80 overflow-hidden rounded-2xl"
    >
      {/*
        앞면 그라데이션. 웹은 tailwind 클래스로 그리지만 앱에는 CSS 그라데이션이 없어
        같은 색 정지점(core 의 faceColors)으로 직접 그린다. 방향도 웹의 to-br 과 같이
        왼쪽 위에서 오른쪽 아래로 흐른다.
      */}
      <LinearGradient
        colors={palette.faceColors as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-1 justify-between p-4"
      >
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 shrink">
            <Text numberOfLines={1} className={`text-xs opacity-80 ${palette.ink}`}>
              {t(KIND_KEY[method.kind])}
              {method.ownerName ? ` · ${method.ownerName}` : ''}
            </Text>
            <Text numberOfLines={1} className={`font-semibold ${palette.ink}`}>
              {method.name}
            </Text>
          </View>
          {/* 카드 앞면의 IC칩 자리. 카드처럼 보이게 하는 최소한의 표시다. */}
          <View className="mt-1 h-6 w-8 shrink-0 rounded bg-amber-300/80" />
        </View>

        <View>
          <Text numberOfLines={1} className={`text-xs opacity-80 ${palette.ink}`}>
            {method.periodLabel}
          </Text>
          <View className="flex-row items-baseline gap-1.5">
            <Text className={`text-2xl font-bold ${palette.ink}`}>
              {formatCurrency(method.usage, method.currency)}
            </Text>
            {/* 기준액은 사용액 바로 뒤에 붙인다. "얼마 중 얼마"로 한눈에 읽힌다. */}
            {target !== null ? (
              <Text className={`text-xs opacity-80 ${palette.ink}`}>
                / {formatCurrency(method.target, method.currency)}
              </Text>
            ) : null}
          </View>

          {progress !== null ? (
            <View className="mt-2">
              <View className={`h-1.5 overflow-hidden rounded-full ${palette.track}`}>
                <View
                  className={`h-full rounded-full ${tone.bar}`}
                  style={{ width: `${progress}%` }}
                />
              </View>
              {/* 막대 끝쪽에 붙여 "여기까지 얼마 남았다"로 읽히게 한다. */}
              <Text className={`mt-1 text-right text-xs font-semibold ${tone.text}`}>
                {t('method.remaining', {
                  amount: formatCurrency(remaining, method.currency),
                })}
              </Text>
            </View>
          ) : null}
        </View>

        <View className={`border-t pt-1.5 ${palette.divider}`}>
          <View className="flex-row items-baseline justify-between gap-2">
            <Text numberOfLines={1} className={`text-xs opacity-90 ${palette.ink}`}>
              {method.previousPeriodLabel}
            </Text>
            <Text className={`text-xs opacity-90 ${palette.ink}`}>
              {formatCurrency(method.previousUsage, method.currency)}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
