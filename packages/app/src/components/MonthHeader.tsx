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
  showTotals = true,
  tightArrows = false,
}: {
  year: number;
  month: number;
  incomeTotal: number;
  expenseTotal: number;
  onMonthChange: (year: number, month: number) => void;
  /** 같은 줄 오른쪽 끝에 붙일 것 */
  right?: ReactNode;
  /**
   * 합계를 이 줄에 함께 적을지.
   *
   * 가계 화면은 끄고 쓴다 -- 첫 문장이 그 금액을 문장으로 말하므로(LedgerKindSummary)
   * 여기서 또 적으면 같은 숫자가 한 화면에 두 번 나온다.
   */
  showTotals?: boolean;
  /**
   * 화살표의 좌우 여백을 레이아웃에서 뺄지 (누를 자리는 그대로 둔다).
   *
   * 가계의 첫 문장이 켜고 쓴다. 이 화살표는 문장 안에 섞여 있어 두 가지가 걸린다.
   *
   *   1. 왼쪽 선. 윗줄 제목은 `아이콘 20 + gap-1.5` 라 글자가 26 에서 시작하는데,
   *      화살표에 여백(p-2)이 붙어 있으면 년월 글자가 34 로 밀려 "전"과 "2"가 어긋난다.
   *   2. 오른쪽 여백. 여백이 그대로면 꺽쇠 양옆이 넓게 벌어져, 뒤에 오는 낱말이
   *      한 문장으로 이어 읽히지 않는다.
   *
   * 음수 여백으로 상쇄하면 차지하는 자리는 아이콘 크기(20)뿐이고 누를 자리는 36 이다.
   */
  tightArrows?: boolean;
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
          {/*
            화살표와 년월 글자의 자리를 **윗줄 제목과 맞춘다** (PersonScopeTitle).
            제목은 `아이콘 20 + gap-1.5` 라 글자가 26px 에서 시작한다. 그래서 여기도
            같은 아이콘 크기와 같은 간격을 쓰고, 년월 버튼의 좌우 여백은 두지 않는다 --
            px 를 두면 그만큼 글자가 밀려, 세로로 봤을 때 "전"과 "2"가 어긋난다.
          */}
          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={() => shift(-1)}
              className={`rounded-lg p-2 active:bg-gray-100 ${tightArrows ? '-mx-2' : ''}`}
            >
              {/* 색은 윗줄 제목의 아이콘과 같다 (PersonScopeTitle 의 ChevronDown). */}
              <ChevronLeft size={20} color="#9ca3af" />
            </Pressable>

            <Pressable
              onPress={() => {
                // 닫았다 열 때 훑어보던 연도가 남아 있으면 안 된다. 지금 선택으로 되돌린다.
                setPickerYear(year);
                setIsPickerOpen((open) => !open);
              }}
              className="rounded-lg py-1 active:bg-gray-100"
            >
              <Text className="text-2xl font-bold text-gray-900">{formatYearMonth(year, month)}</Text>
            </Pressable>

            <Pressable
              onPress={() => shift(1)}
              className={`rounded-lg p-2 active:bg-gray-100 ${tightArrows ? '-mx-2' : ''}`}
            >
              <ChevronRight size={20} color="#9ca3af" />
            </Pressable>
          </View>

          {showTotals ? (
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
          ) : null}
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
