import { Pressable, Text, View } from 'react-native';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';

/** 보고 있는 것. 달 아래 탭이 이 둘을 오간다. */
export type EntryType = 'income' | 'expense';

/**
 * 지출은 빨강, 수입은 초록.
 *
 * 금액 색과 고른 탭의 색을 같은 값에서 뽑는다. 탭 밑줄만 파랑으로 두면 빨간 금액
 * 아래에 파란 줄이 그어져 두 색이 무엇을 뜻하는지 흐려진다.
 */
const TABS: Array<{ type: EntryType; labelKey: MessageKey; text: string; border: string }> = [
  { type: 'expense', labelKey: 'home.tab.expense', text: 'text-red-600', border: 'border-red-600' },
  {
    type: 'income',
    labelKey: 'home.tab.income',
    text: 'text-green-600',
    border: 'border-green-600',
  },
];

/**
 * 지출·수입 탭. 웹 홈 화면의 것과 같다.
 *
 * 합계를 넘기면 글자 옆에 함께 적는다. 고르지 않은 쪽도 색을 그대로 두어, 빨강·초록이
 * 지출·수입을 가리킨다는 것이 흐려지지 않게 한다. 무엇을 골랐는지는 밑줄과 굵기가 말한다.
 */
export default function TypeTabs({
  type,
  onChange,
  expenseTotal,
  incomeTotal,
}: {
  type: EntryType;
  onChange: (type: EntryType) => void;
  expenseTotal?: string;
  incomeTotal?: string;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row border-b border-gray-200">
      {TABS.map((tab) => {
        const total = tab.type === 'income' ? incomeTotal : expenseTotal;
        const isSelected = type === tab.type;

        return (
          <Pressable
            key={tab.type}
            onPress={() => onChange(tab.type)}
            /* 둘이 화면을 반씩 나눈다. 글자 길이대로 두면 누르는 자리가 달마다 움직인다. */
            className={`flex-1 flex-row items-baseline justify-center gap-2 px-4 py-2 ${
              isSelected ? `border-b-2 ${tab.border}` : ''
            }`}
          >
            <Text className={`${tab.text} ${isSelected ? 'font-semibold' : 'font-medium'}`}>
              {t(tab.labelKey)}
            </Text>
            {total ? (
              <Text className={`text-sm font-semibold ${tab.text}`}>{total}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
