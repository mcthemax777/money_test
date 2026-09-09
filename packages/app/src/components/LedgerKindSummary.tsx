import { useMemo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  LEDGER_KIND_GROUPS,
  ledgerHeadline,
  ledgerKindAmount,
  type LedgerTone,
} from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import { useLedgerKindFilter } from '@money/core/store/ledger-kind-filter';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 첫 문장 금액의 색. 들어온 돈은 초록, 나간 돈은 빨강이다 (달력·목록·갈래 상자와 같은 규칙).
 *
 * 0 원은 어느 쪽도 아니라 기본 글자색으로 둔다. 방향은 `ledgerHeadline` 이 정한다 --
 * 지출만 켜면 금액이 양수인데도 나간 돈이라 빨강이어야 한다.
 */
const TONE_CLASS: Record<LedgerTone, string> = {
  positive: 'text-green-600',
  negative: 'text-red-600',
  neutral: 'text-gray-900',
};

/**
 * 가계의 첫 문장과 갈래별 소계. 웹의 `LedgerKindSummary` 를 옮긴 것이다.
 *
 * "○○님의 / [2026년 9월] 순수입은 / 123만 원입니다"로 읽힌다. 자산 화면의
 * `AssetTypeSummary` 와 같은 짜임새다 -- 화면 이름을 적는 대신 지금 궁금한 값을 문장으로
 * 먼저 말하고, 그 아래 상자를 눌러 무엇을 더한 금액인지 고른다.
 *
 * 다른 것은 낱말이 바뀐다는 점이다. 자산은 넷을 어떻게 골라도 "자산"이지만, 가계는
 * 지출을 빼면 남는 것이 수입이고 수입을 빼면 지출이다. 그래서 상자를 누르면 금액과 함께
 * 문장의 낱말도 갈아 끼운다 (lib/entries 의 `ledgerHeadline`).
 */
export default function LedgerKindSummary({
  scopeTitle,
  dateControl,
  incomeTotal,
  expenseTotal,
}: {
  /**
   * 첫 줄. 자산주인을 겸하는 이 화면의 제목이다 ("김철수님의").
   *
   * 자산 화면과 달리 낱말이 붙지 않는다. 켜 둔 갈래에 따라 바뀌므로 다음 줄로 내려갔다
   * (PersonScopeTitle 의 noun 을 비워 넘긴다).
   */
  scopeTitle: ReactNode;
  /** 둘째 줄 왼쪽. 어느 달을 보고 있는지 고르는 자리다. */
  dateControl: ReactNode;
  incomeTotal: number;
  expenseTotal: number;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { selectedKeys, toggleKey } = useLedgerKindFilter();

  const { nounKey, amount, tone } = useMemo(
    () => ledgerHeadline(selectedKeys, { incomeTotal, expenseTotal }),
    [selectedKeys, incomeTotal, expenseTotal],
  );

  return (
    <View className="gap-4">
      <View>
        {/* 첫 줄. 누구의 가계인지. */}
        {scopeTitle}

        {/*
          둘째 줄. 날짜와 낱말이 한 문장으로 이어 읽힌다.

          왼쪽 선은 윗줄 제목과 맞고, 낱말은 오른쪽 꺽쇠에 바로 붙는다. 날짜 쪽이
          `tightArrows` 로 화살표 여백을 자리에서 빼므로(MonthHeader) 여기서 당기거나
          띄울 것이 없다.
        */}
        <View className="flex-row flex-wrap items-center">
          {dateControl}
          <Text className="text-2xl font-bold text-gray-900">
            {/* 꺽쇠와 낱말 사이는 한 칸이다. 문장 안의 낱말 사이와 같은 간격이라 여백
                대신 공백을 쓴다 -- 줄이 바뀌면 함께 접힌다. */}
            {' '}
            {t(nounKey)}
            {/* 조사는 언어마다 있고 없다. 영어 사전은 이 자리를 비워 둔다. */}
            {t('ledgerSummary.particle')}
          </Text>
        </View>

        <Text className={`mt-1 text-4xl font-bold ${TONE_CLASS[tone]}`}>
          {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
          {formatAmountWithUnit(amount, displayCurrency)}
          <Text className="text-xl font-medium text-gray-500"> {t('ledgerSummary.suffix')}</Text>
        </Text>
      </View>

      {/* 갈래 둘. 눌러서 위 금액에서 빼고 더한다. 자산의 유형 상자와 같은 모양이다. */}
      <View className="flex-row">
        {LEDGER_KIND_GROUPS.map((group) => {
          const groupAmount = ledgerKindAmount(group.key, { incomeTotal, expenseTotal });
          const isSelected = selectedKeys.includes(group.key);

          return (
            <View key={group.key} className="w-1/2 p-1">
              <Pressable
                onPress={() => toggleKey(group.key)}
                /* 고른 표시는 자산 화면과 같은 파란 바탕이다. */
                className={`rounded-lg border p-3 ${
                  isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <View className="flex-row items-center gap-1.5">
                  {/* 켜 둔 것을 색으로도 알린다. */}
                  <View
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSelected ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                  />
                  <Text numberOfLines={1} className="text-xs text-gray-600">
                    {t(group.labelKey)}
                  </Text>
                </View>
                {/*
                  지출도 양수로 적는다. 부호를 뒤집으면 "지출 -30만 원"이 되어 돈이 들어온
                  것처럼 읽힌다. 대신 색으로 가른다 (달력·목록과 같은 규칙).
                */}
                <Text
                  className={`mt-1 text-base font-semibold ${
                    group.key === 'expense' ? 'text-red-600' : 'text-green-600'
                  }`}
                >
                  {formatCurrency(groupAmount, displayCurrency)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
