import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

import {
  currentYearMonth,
  formatMonthShort,
  formatYearMonth,
  formatYearOnly,
} from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * 달 머리글. 웹의 MonthHeader 와 같다.
 *
 * 화살표는 년월 글자 양옆에 붙고, 글자를 누르면 연·월을 고르는 판이 열린다.
 * 기간 보기(날짜 두 개)는 가계 화면의 것이라 여기 넣지 않았다.
 */
export default function MonthHeader({
  year,
  month,
  incomeTotal,
  expenseTotal,
  onMonthChange,
  right,
}: {
  year: number;
  month: number;
  incomeTotal: number;
  expenseTotal: number;
  onMonthChange: (year: number, month: number) => void;
  /** 같은 줄 오른쪽 끝에 붙일 것 */
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // 선택기 안에서 보고 있는 연도. 실제 선택과 분리해야 12월에서 다음 해를 훑어볼 수 있다.
  const [pickerYear, setPickerYear] = useState(year);

  // Date 생성자가 연도 넘김을 처리하므로 12월/1월을 따로 분기하지 않는다.
  const shift = (delta: number) => {
    const shifted = new Date(year, month - 1 + delta, 1);
    onMonthChange(shifted.getFullYear(), shifted.getMonth() + 1);
  };

  // "이번 달" 판단은 프로젝트 타임존 기준이다.
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-4">
        <View className="flex-row items-center gap-6">
          <View className="flex-row items-center gap-1">
            <Pressable onPress={() => shift(-1)} className="rounded-lg p-2 active:bg-gray-100">
              <ChevronLeft size={20} color="#4b5563" />
            </Pressable>

            <Pressable
              onPress={() => {
                // 닫았다 열 때 훑어보던 연도가 남아 있으면 안 된다. 지금 선택으로 되돌린다.
                setPickerYear(year);
                setIsPickerOpen((open) => !open);
              }}
              className="rounded-lg px-2 py-1 active:bg-gray-100"
            >
              <Text className="text-2xl font-bold text-gray-900">{formatYearMonth(year, month)}</Text>
            </Pressable>

            <Pressable onPress={() => shift(1)} className="rounded-lg p-2 active:bg-gray-100">
              <ChevronRight size={20} color="#4b5563" />
            </Pressable>
          </View>

          <View className="flex-row gap-6">
            {incomeTotal > 0 ? (
              <Text className="text-sm font-semibold text-green-600">
                +{formatCurrency(incomeTotal, displayCurrency)}
              </Text>
            ) : null}
            {expenseTotal > 0 ? (
              <Text className="text-sm font-semibold text-red-600">
                -{formatCurrency(expenseTotal, displayCurrency)}
              </Text>
            ) : null}
          </View>
        </View>

        {right ? <View className="flex-row items-center gap-3">{right}</View> : null}
      </View>

      {isPickerOpen ? (
        <View className="w-64 rounded-lg border border-gray-200 bg-white p-3">
          <View className="mb-3 flex-row items-center justify-between">
            <Pressable
              onPress={() => setPickerYear((value) => value - 1)}
              className="rounded px-2 py-1 active:bg-gray-100"
            >
              <ChevronLeft size={16} color="#4b5563" />
            </Pressable>
            <Text className="font-semibold text-gray-900">{formatYearOnly(pickerYear)}</Text>
            <Pressable
              onPress={() => setPickerYear((value) => value + 1)}
              className="rounded px-2 py-1 active:bg-gray-100"
            >
              <ChevronRight size={16} color="#4b5563" />
            </Pressable>
          </View>

          <View className="flex-row flex-wrap">
            {MONTHS.map((value) => {
              const isSelected = pickerYear === year && value === month;
              const isThisMonth = pickerYear === thisYear && value === thisMonth;

              return (
                <View key={value} className="w-1/4 p-0.5">
                  <Pressable
                    onPress={() => {
                      onMonthChange(pickerYear, value);
                      setIsPickerOpen(false);
                    }}
                    className={`items-center rounded py-2 ${isSelected ? 'bg-blue-600' : ''}`}
                  >
                    <Text
                      className={`text-sm ${
                        isSelected
                          ? 'font-semibold text-white'
                          : isThisMonth
                            ? 'font-semibold text-blue-600'
                            : 'text-gray-700'
                      }`}
                    >
                      {formatMonthShort(value)}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
