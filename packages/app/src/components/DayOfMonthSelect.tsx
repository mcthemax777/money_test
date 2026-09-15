/*
 * "매월 N일"을 고르는 칸. 카드의 마감일과 결제일이 쓴다.
 *
 * 31 은 "말일"이다. 그 달에 없는 날짜는 서버가 말일로 자르므로(clampDayOfMonth)
 * 31 을 고르면 2월에는 28일(윤년 29일)이 된다. 목록의 이름과 그 아래 안내가 core 에
 * 있어(day-of-month) 웹과 앱이 같은 말을 쓴다.
 */
import { dayOfMonthOptions } from '@money/core/lib/day-of-month';

import { Select } from './FormFields';

export default function DayOfMonthSelect({
  value,
  onSelect,
}: {
  value: number;
  onSelect: (day: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      options={dayOfMonthOptions().map((option) => ({
        value: String(option.day),
        label: option.label,
      }))}
      onSelect={(next) => onSelect(Number(next))}
    />
  );
}
