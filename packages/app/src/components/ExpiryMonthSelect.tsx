/*
 * 만료 월 고르기. 웹의 `<input type="month">` 자리를 앱에서 대신한다.
 *
 * 리액트 네이티브에는 월 입력이 없다. 손으로 "2029-13" 같은 값을 적을 수 있으면 저장은
 * 조용히 비워지므로(형식이 어긋나면 `monthInputToIso` 가 null), 연도와 달을 각각 고르게
 * 한다 -- 날짜를 달력에서 고르게 한 것(DatePickerPanel)과 같은 까닭이다.
 *
 * 값은 웹과 같은 "YYYY-MM" 이다. 저장은 그 달의 말일로 바뀐다 (core 의 monthInputToIso).
 */
import { View } from 'react-native';

import { formatMonthShort, formatYearOnly } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';

import { Select } from './FormFields';

/**
 * 고를 수 있는 연도. 올해부터 앞으로 열두 해다.
 *
 * 카드 만료는 앞날이다. 지난해까지 늘어놓으면 목록만 길어진다. 다만 이미 지난 만료월이
 * 적힌 카드를 고칠 때 그 값이 목록에서 사라지면 안 되므로, 들고 있는 값의 연도는 언제나
 * 목록에 함께 넣는다.
 */
function yearOptions(current: number | null): number[] {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 13 }, (_, index) => thisYear + index);
  if (current !== null && !years.includes(current)) years.unshift(current);
  return years;
}

export default function ExpiryMonthSelect({
  value,
  onChange,
}: {
  /** 지금 고른 만료 월 "YYYY-MM". 정하지 않았으면 빈 문자열. */
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const year = match ? Number(match[1]) : null;
  const month = match ? Number(match[2]) : null;

  /* 한쪽만 고른 상태는 값으로 두지 않는다. 둘이 다 차야 "YYYY-MM" 이 된다. */
  const pick = (nextYear: number | null, nextMonth: number | null) => {
    if (nextYear === null || nextMonth === null) {
      onChange('');
      return;
    }
    onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
  };

  const noneOption = { value: '', label: t('common.none') };

  return (
    <View className="flex-row gap-2">
      <View className="flex-1">
        <Select
          value={year === null ? '' : String(year)}
          placeholder={t('card.expiryYear')}
          options={[
            noneOption,
            ...yearOptions(year).map((candidate) => ({
              value: String(candidate),
              label: formatYearOnly(candidate),
            })),
          ]}
          onSelect={(next) => pick(next ? Number(next) : null, month)}
        />
      </View>
      <View className="flex-1">
        <Select
          value={month === null ? '' : String(month)}
          placeholder={t('card.expiryMonth')}
          options={[
            noneOption,
            ...Array.from({ length: 12 }, (_, index) => ({
              value: String(index + 1),
              label: formatMonthShort(index + 1),
            })),
          ]}
          onSelect={(next) => pick(year, next ? Number(next) : null)}
        />
      </View>
    </View>
  );
}
