'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@money/core/lib/i18n';
import { formatAmountWithUnit, formatCurrency } from '@money/core/lib/money';
import { LEDGER_KIND_GROUPS, ledgerHeadline, ledgerKindAmount } from '@money/core/lib/entries';
import { useLedgerKindFilter } from '@money/core/store/ledger-kind-filter';
import { useProjectDisplayCurrency } from '@money/core/store/project';

interface LedgerKindSummaryProps {
  /**
   * 첫 줄. 자산주인을 겸하는 이 화면의 제목이다 ("김철수님의").
   *
   * 자산 화면과 달리 낱말이 붙지 않는다. 켜 둔 갈래에 따라 순수입·수입·지출로 바뀌므로
   * 다음 줄로 내려갔다 (PersonScopeTitle 의 noun 을 비워 넘긴다).
   */
  scopeTitle: ReactNode;
  /** 둘째 줄 왼쪽. 어느 달(또는 구간)을 보고 있는지 고르는 자리다. */
  dateControl: ReactNode;
  /**
   * 첫 줄 오른쪽 끝. 보기 방식을 바꾸는 것들이 여기 온다 ("기간" 전환).
   *
   * 문장 안에 두지 않는 이유가 있다. 날짜는 "언제의 순수입인가"라 문장의 일부지만,
   * 달로 볼지 구간으로 볼지는 화면을 다루는 방법이다. 문장 사이에 끼우면 읽는 흐름이
   * 끊기고, 제목 줄은 오른쪽이 비어 있어 그 자리가 제자리다.
   */
  action?: ReactNode;
  incomeTotal: number;
  expenseTotal: number;
}

/**
 * 가계의 첫 문장과 갈래별 소계.
 *
 * "○○님의 / [2026년 9월] 순수입은 / 123만 원입니다"로 읽힌다. 자산 화면의
 * `AssetTypeSummary` 와 같은 짜임새다 -- 화면 이름을 적는 대신 지금 궁금한 값을 문장으로
 * 먼저 말하고, 그 아래 상자를 눌러 무엇을 더한 금액인지 고른다.
 *
 * 다른 것은 낱말이 바뀐다는 점이다. 자산은 넷을 어떻게 골라도 "자산"이지만, 가계는
 * 지출을 빼면 남는 것이 수입이고 수입을 빼면 지출이다. 그래서 상자를 누르면 금액과 함께
 * 문장의 낱말도 갈아 끼운다 (lib/entries 의 `ledgerHeadline`).
 *
 * 날짜를 고르는 자리를 문장 안에 둔 이유는 그 값이 문장의 일부이기 때문이다. "언제의
 * 순수입인가"를 답하지 않으면 금액만으로는 무엇을 본 것인지 알 수 없다.
 */
export default function LedgerKindSummary({
  scopeTitle,
  dateControl,
  action,
  incomeTotal,
  expenseTotal,
}: LedgerKindSummaryProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { selectedKeys, toggleKey } = useLedgerKindFilter();

  const { nounKey, amount } = useMemo(
    () => ledgerHeadline(selectedKeys, { incomeTotal, expenseTotal }),
    [selectedKeys, incomeTotal, expenseTotal],
  );

  return (
    <div className="space-y-4">
      <div>
        {/* 첫 줄. 누구의 가계인지. 오른쪽 끝은 보기 방식을 바꾸는 자리다. */}
        <div className="flex items-start justify-between gap-3">
          {scopeTitle}
          {action}
        </div>

        {/*
          둘째 줄. 날짜와 낱말이 한 문장으로 이어 읽힌다.

          왼쪽 선은 윗줄 제목과 맞고, 낱말은 오른쪽 꺽쇠에 바로 붙는다. 날짜 쪽이
          `tightArrows` 로 화살표 여백을 자리에서 빼므로(MonthHeader) 여기서 당기거나
          띄울 것이 없다.
        */}
        {/*
          꺽쇠와 낱말 사이는 한 칸이다 (24px 글자의 공백 폭 = 6px = gap-x-1.5).

          앱은 낱말 앞에 공백 문자를 넣지만 여기서는 여백으로 준다 -- HTML 은 인라인
          요소 첫머리의 공백을 지워서, 같은 코드를 두면 웹에서만 낱말이 꺽쇠에 붙는다.
        */}
        <div className="flex flex-wrap items-center gap-x-1.5">
          {dateControl}
          <span className="text-2xl font-bold text-gray-900">
            {t(nounKey)}
            {/* 조사는 언어마다 있고 없다. 영어 사전은 이 자리를 비워 둔다. */}
            {t('ledgerSummary.particle')}
          </span>
        </div>

        <p className="mt-1 text-4xl font-bold tabular-nums text-gray-900">
          {/* 문장으로 읽히는 자리라 기호 대신 이름을 뒤에 붙인다. */}
          <span className={amount < 0 ? 'text-red-600' : undefined}>
            {formatAmountWithUnit(amount, displayCurrency)}
          </span>
          <span className="ml-2 text-xl font-medium text-gray-500">
            {t('ledgerSummary.suffix')}
          </span>
        </p>
      </div>

      {/*
        갈래 둘. 눌러서 위 금액에서 빼고 더한다. 자산의 유형 상자와 같은 모양이다.

        둘뿐이라 좁은 화면에서도 한 줄에 들어간다. 상자 폭은 절반씩 두어 자산 화면과
        같은 리듬을 지킨다.
      */}
      <div className="grid grid-cols-2 gap-2">
        {LEDGER_KIND_GROUPS.map((group) => {
          const groupAmount = ledgerKindAmount(group.key, { incomeTotal, expenseTotal });
          const isSelected = selectedKeys.includes(group.key);

          return (
            <button
              key={group.key}
              type="button"
              onClick={() => toggleKey(group.key)}
              aria-pressed={isSelected}
              /* 고른 표시는 자산 화면과 같은 파란 바탕이다. */
              className={`rounded-lg border p-3 text-left transition ${
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="flex items-center gap-1.5 text-xs text-gray-600">
                {/* 켜 둔 것을 색으로도 알린다. 글자 색만으로는 흑백에서 갈리지 않는다. */}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSelected ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                  aria-hidden
                />
                <span className="truncate">{t(group.labelKey)}</span>
              </p>
              {/*
                지출도 양수로 적는다. 부호를 뒤집으면 "지출 -30만 원"이 되어 돈이 들어온
                것처럼 읽힌다. 대신 색으로 가른다 (달력·목록과 같은 규칙).
              */}
              <p
                className={`mt-1 text-base font-semibold tabular-nums ${
                  group.key === 'expense' ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {formatCurrency(groupAmount, displayCurrency)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
