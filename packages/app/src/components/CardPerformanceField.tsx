/*
 * 카드 실적 기준액 입력. 웹의 같은 이름 컴포넌트를 앱에 옮긴 것이다.
 *
 * 카드 추가 폼과 수정 폼이 같은 값을 받는다. 안내 문구가 길고 카드 종류에 따라
 * 갈려서, 따로 적어 두면 한 곳만 고쳤을 때 화면마다 다른 설명이 남는다.
 *
 * 한도(creditLimit)와 달리 신용카드 전용이 아니다. 체크카드에도 실적 조건이 붙는
 * 카드가 있고, 그때는 달력 월로 센다.
 */
import { Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';

/** 마감일이 N일이면 구간은 (N+1)일부터 다음 달 N일까지다. */
function statementHint(
  t: ReturnType<typeof useTranslation>['t'],
  closingDay?: number,
): string {
  if (!closingDay) return t('performance.statementHintNoDay');

  const nextDay = closingDay === 31 ? 1 : closingDay + 1;
  return t('performance.statementHint', { closing: closingDay, next: nextDay });
}

export default function CardPerformanceField({
  cardType,
  value,
  onChange,
  statementClosingDay,
  inputClassName,
}: {
  /** 세는 구간이 종류마다 달라서 안내 문구가 갈린다. */
  cardType: 'debit' | 'credit';
  value: string;
  onChange: (value: string) => void;
  /** 신용카드 마감일. 안내에 실제 구간을 적어 준다. 없으면 일반적인 설명만 한다. */
  statementClosingDay?: number;
  /** 입력 칸의 모양. 부르는 창이 제 폼의 다른 칸과 같은 것을 준다. */
  inputClassName: string;
}) {
  const { t } = useTranslation();

  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{t('performance.target')}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="300000"
        placeholderTextColor="#9ca3af"
        className={inputClassName}
      />
      <Text className="mt-1 text-xs leading-5 text-gray-500">
        {cardType === 'credit'
          ? statementHint(t, statementClosingDay)
          : t('performance.monthHint')}{' '}
        {t('performance.emptyHint')}
      </Text>
    </View>
  );
}
