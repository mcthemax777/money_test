import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { isCalendarMonthKey, shiftPeriodKey, unitOfKey } from '@money/types';

import { periodLabel } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';

import MonthHeader from './MonthHeader';

/**
 * 분석이 보는 기간 하나와 그 앞뒤로 옮기는 단추. 거래 탭의 분석 보기와 분석 탭이 함께 쓴다
 * (웹의 같은 이름 짝과 같다).
 *
 * 달력의 달은 예산 화면과 같은 머리(달 고르기 포함)로, 해·주와 시작일을 옮긴 달은 앞뒤
 * 단추와 이름만으로 옮긴다. 직접 정한 기간은 옮길 앞뒤가 없어 이름만 선다.
 */
export default function PeriodNavigator({
  periodKey,
  onChange,
}: {
  periodKey: string;
  onChange: (key: string) => void;
}) {
  const { t } = useTranslation();
  const unit = unitOfKey(periodKey);

  if (isCalendarMonthKey(periodKey)) {
    const [year, month] = periodKey.split('-').map(Number);
    return (
      <MonthHeader
        year={year}
        month={month}
        incomeTotal={0}
        expenseTotal={0}
        showTotals={false}
        onMonthChange={(nextYear, nextMonth) =>
          onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`)
        }
      />
    );
  }

  /* 앞뒤 단추의 이름. 시작일을 옮긴 달도 달 단위로 옮긴다. */
  const stepLabel = {
    prev: unit === 'week' ? 'week.prev' : unit === 'year' ? 'month.prevYear' : 'month.prev',
    next: unit === 'week' ? 'week.next' : unit === 'year' ? 'month.nextYear' : 'month.next',
  } as const;

  return (
    <View className="flex-row items-center gap-1">
      {unit !== 'range' ? (
        <Pressable
          onPress={() => onChange(shiftPeriodKey(periodKey, -1))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t(stepLabel.prev)}
          className="rounded-lg p-2 active:bg-gray-100"
        >
          <ChevronLeft size={20} color="#9ca3af" />
        </Pressable>
      ) : null}
      <Text className="shrink py-1 text-xl font-bold text-gray-900">{periodLabel(periodKey)}</Text>
      {unit !== 'range' ? (
        <Pressable
          onPress={() => onChange(shiftPeriodKey(periodKey, 1))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t(stepLabel.next)}
          className="rounded-lg p-2 active:bg-gray-100"
        >
          <ChevronRight size={20} color="#9ca3af" />
        </Pressable>
      ) : null}
    </View>
  );
}
