'use client';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';

/** 보고 있는 것. 탭이 이 둘을 오간다. */
export type EntryType = 'income' | 'expense';

/**
 * 지출은 빨강, 수입은 초록.
 *
 * 금액 색과 고른 탭의 색을 같은 값에서 뽑는다. 탭 밑줄만 파랑으로 두면 빨간
 * 금액 아래에 파란 줄이 그어져 두 색이 무엇을 뜻하는지 흐려진다. 가계 화면
 * 머리글의 수입 초록·지출 빨강과도 같은 색이다.
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
 * 지출·수입 탭. 예산 상자·예산 설정·거래 분석이 쓴다 (앱의 TypeTabs 와 같다).
 */
export default function TypeTabs({
  type,
  onChange,
  tone = 'type',
}: {
  type: EntryType;
  onChange: (type: EntryType) => void;
  /**
   * 탭의 색.
   *
   *   type       지출 빨강·수입 초록. 고르지 않은 쪽도 제 색이다.
   *   selection  고른 탭만 파랑, 나머지는 회색. 예산 상자와 예산 설정이 쓴다 (2026-10-05 사용자 요청) --
   *              탭 아래 줄들이 이미 금액을 말하므로 탭은 "무엇을 골랐나"만 알리면 된다.
   */
  tone?: 'type' | 'selection';
}) {
  const { t } = useTranslation();

  return (
    <div className="flex border-b border-gray-200">
      {TABS.map((tab) => {
        const isSelected = type === tab.type;
        const text = tone === 'selection' ? (isSelected ? 'text-blue-600' : 'text-gray-500') : tab.text;
        const border = tone === 'selection' ? 'border-blue-600' : tab.border;
        return (
          <button
            key={tab.type}
            type="button"
            onClick={() => onChange(tab.type)}
            aria-pressed={isSelected}
            /*
              둘이 화면을 반씩 나눈다. 글자 길이대로 두면 누르는 자리가 움직인다.
              무엇을 골랐는지는 밑줄과 굵기가 말한다 (selection 이면 색도).
            */
            className={`flex flex-1 items-baseline justify-center gap-2 px-4 py-2 transition ${text} ${
              isSelected ? `border-b-2 ${border} font-semibold` : 'font-medium hover:bg-gray-50'
            }`}
          >
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
