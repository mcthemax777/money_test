/*
 * 날짜 고르는 달력. 웹의 `<input type="date">` 자리를 앱에서 대신한다.
 *
 * 리액트 네이티브에는 달력 입력이 없어 앱은 날짜를 글자로 받아 왔다. 손으로 적으면
 * `2026-02-31` 처럼 실재하지 않는 날이나 자릿수가 어긋난 값이 나오고, 그런 값은 오류
 * 없이 조회에 실려 결과만 조용히 어긋난다. 달력에서 고르면 그런 값이 생기지 않는다.
 *
 * 네이티브 달력 모듈을 넣지 않았다. 필요한 것은 날짜 하나를 고르는 일이고, 이미
 * 거래 달력(TransactionCalendar)에서 쓰는 것과 같은 칸 계산으로 그릴 수 있다.
 * 모듈을 더하면 안드로이드 빌드를 다시 만들어야 한다.
 *
 * 붙박이 여섯 줄(42칸)을 그린다. 달을 옮길 때 줄 수가 달라지면 판 높이가 흔들려
 * 아래 버튼이 손가락 밑에서 움직인다.
 */
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

import { formatYearMonth, isDateKey, todayKey, weekdayNames } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectTimeZone } from '@money/core/store/project';

/** 로컬 Date 의 "YYYY-MM-DD". 달력 칸은 시각이 아니라 날짜라 로컬 필드를 그대로 쓴다. */
function dateKeyOfCell(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function DatePickerPanel({
  value,
  fallbackDate,
  onSelect,
}: {
  /** 지금 고른 날 "YYYY-MM-DD". 없으면 빈 문자열. */
  value: string;
  /**
   * 고른 날이 없을 때 어느 달부터 보여 줄지. 기간의 다른 쪽 날짜가 여기에 들어간다
   * -- 시작일을 9월로 고른 사람의 종료일은 이번 달보다 9월에 있을 확률이 높다.
   */
  fallbackDate?: string;
  onSelect: (dateKey: string) => void;
}) {
  const { t } = useTranslation();
  // "오늘"은 프로젝트 타임존 기준이다 (거래가 며칠에 들리는지와 같은 기준).
  const timeZone = useProjectTimeZone();
  const today = todayKey(timeZone);

  /*
   * 처음 보여 줄 달. 고른 날 → 다른 쪽 날짜 → 이번 달 차례로 잡는다.
   *
   * 여는 순간 한 번만 정한다. 판을 다시 열거나 다른 칸으로 옮길 때 새로 잡는 일은
   * 부모가 `key` 로 다시 그려 맡는다. 여기서 값을 따라가게 하면, 달을 훑어보는
   * 중에 커서가 고른 날의 달로 되돌아간다.
   */
  const [cursor, setCursor] = useState(() => {
    // 온전한 날짜 중 첫 번째. 둘 다 비어 있으면 오늘이 든 달에서 시작한다.
    const base =
      [value, fallbackDate ?? ''].find((candidate) => isDateKey(candidate)) ?? today;
    return { year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) };
  });

  // Date 생성자가 연도 넘김을 처리하므로 12월/1월을 따로 분기하지 않는다.
  const shift = (delta: number) => {
    const shifted = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: shifted.getFullYear(), month: shifted.getMonth() + 1 });
  };

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month - 1, 1);
    // 그 주의 일요일부터 센다. 1 - 요일 로 지난달까지 자연히 넘어간다.
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  return (
    <View className="rounded-lg border border-gray-200 bg-white p-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Pressable
          onPress={() => shift(-1)}
          hitSlop={8}
          className="rounded-lg p-2 active:bg-gray-100"
        >
          <ChevronLeft size={18} color="#4b5563" />
        </Pressable>
        <Text className="text-base font-semibold text-gray-900">
          {formatYearMonth(cursor.year, cursor.month)}
        </Text>
        <Pressable
          onPress={() => shift(1)}
          hitSlop={8}
          className="rounded-lg p-2 active:bg-gray-100"
        >
          <ChevronRight size={18} color="#4b5563" />
        </Pressable>
      </View>

      <View className="flex-row">
        {weekdayNames().map((day) => (
          <View key={day} className="w-[14.28%] py-1">
            <Text className="text-center text-xs text-gray-500">{day}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {days.map((date) => {
          const key = dateKeyOfCell(date);
          const isThisMonth = date.getMonth() === cursor.month - 1;
          const isSelected = key === value;

          return (
            <View key={key} className="w-[14.28%] p-0.5">
              {/*
                이웃 달의 날도 고를 수 있게 둔다. 9월 말에서 10월 1일로 넘어가는 사람이
                화살표를 먼저 눌러야 한다면, 눈에 보이는 칸을 못 누르는 것이 된다.
              */}
              <Pressable
                onPress={() => onSelect(key)}
                className={`items-center rounded py-2 ${
                  isSelected ? 'bg-blue-600' : 'active:bg-gray-100'
                }`}
              >
                <Text
                  className={`text-sm ${
                    isSelected
                      ? 'font-semibold text-white'
                      : key === today
                        ? 'font-semibold text-blue-600'
                        : isThisMonth
                          ? 'text-gray-900'
                          : 'text-gray-400'
                  }`}
                >
                  {date.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* 가장 잦은 값은 한 번에. 문구는 거래 입력 화면의 것을 함께 쓴다. */}
      <Pressable
        onPress={() => onSelect(today)}
        className="mt-2 self-center rounded-lg border border-gray-300 px-3 py-1.5 active:bg-gray-50"
      >
        <Text className="text-xs font-medium text-gray-700">{t('entryForm.today')}</Text>
      </Pressable>
    </View>
  );
}
