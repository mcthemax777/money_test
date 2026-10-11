/*
 * 정기예금·적금의 만기일. 웹의 MaturityDateField 와 같은 칸이다.
 *
 * 통장 추가·수정이 함께 쓴다. 만기가 있는 유형(`hasMaturity`)일 때만 부르는 쪽이 그린다.
 * 손으로 적으면 `2027-02-31` 같은 날이 나오므로 달력에서 고른다(DatePickerPanel). 고른 값은
 * "YYYY-MM-DD" 이고, 비우면 빈 문자열이다.
 */
import { useState } from 'react';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';

import { formatYearMonthDay } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';

import DatePickerPanel from './DatePickerPanel';

/** 달력을 펴고 접을 때 아래 칸이 툭 밀리지 않게 잇는다 (다른 펼침과 같은 180ms). */
function animateNext() {
  LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
}

export default function MaturityDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => {
    animateNext();
    setIsOpen((previous) => !previous);
  };

  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{t('account.maturityDate')}</Text>
      <Pressable
        onPress={toggle}
        className={`flex-row items-center gap-2 rounded-lg border bg-white px-3 py-2 ${
          isOpen ? 'border-blue-600' : 'border-gray-300'
        }`}
      >
        <CalendarDays size={16} color={isOpen ? '#2563eb' : '#6b7280'} />
        <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value ? formatYearMonthDay(value) : t('account.maturityDatePick')}
        </Text>
      </Pressable>
      {isOpen ? (
        <View className="mt-2 gap-2">
          <DatePickerPanel
            value={value}
            onSelect={(dateKey) => {
              animateNext();
              onChange(dateKey);
              setIsOpen(false);
            }}
          />
          {value ? (
            <Pressable
              onPress={() => {
                animateNext();
                onChange('');
                setIsOpen(false);
              }}
              className="self-start rounded-lg border border-gray-300 px-3 py-2"
            >
              <Text className="text-sm text-gray-700">{t('account.maturityDateClear')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
