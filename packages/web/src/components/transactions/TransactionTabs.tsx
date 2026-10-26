'use client';

/*
 * 거래 화면의 보기 방식 탭 (날짜 · 분류 · 수단).
 */
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import type { TransactionTab } from '@money/core/hooks/useTransactions';

const TABS: Array<{ id: TransactionTab; labelKey: MessageKey }> = [
  { id: 'date', labelKey: 'tx.tab.date' },
  { id: 'category', labelKey: 'tx.tab.category' },
  { id: 'method', labelKey: 'tx.tab.method' },
];

/**
 * 보기 방식.
 *
 * 흰 알약을 눌린 칸에 그리지 않고 **하나를 두고 옮긴다.** 칸마다 바탕을 켜고
 * 끄면 탭이 순간이동해, 세 탭이 한 줄에 나란한 것인지 서로 다른 화면인지가
 * 흐려진다. 미끄러져 가면 "옆으로 옮겼다"가 그대로 보인다.
 *
 * 폭과 걸음은 calc 로 센다 -- 글자 길이가 언어마다 달라(날짜/Date/日付) 미리
 * 적어 둘 수 없고, 재서 옮기려면 그리고 난 뒤를 기다려야 한다.
 * `p-1`(0.25rem) 과 `gap-2`(0.5rem) 가 아래 숫자의 출처다.
 */
export default function TransactionTabs({
  tab,
  tabOpen,
  onChange,
}: {
  tab: TransactionTab;
  /** 고른 탭을 다시 누르면 전부 접는가(true) 한 단 더 펴는가(false). */
  tabOpen: boolean;
  onChange: (tab: TransactionTab) => void;
}) {
  const { t } = useTranslation();
  const activeTabIndex = Math.max(
    0,
    TABS.findIndex((item) => item.id === tab),
  );

  return (
    <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: 'calc((100% - 1.5rem) / 3)',
          // 여기서의 100% 는 알약 자신의 폭, 곧 칸 하나다.
          transform: `translateX(calc(${activeTabIndex} * (100% + 0.5rem)))`,
        }}
      />
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          /* 바탕은 위의 알약이 맡는다. 글자가 그 위에 오도록 자리를 잡아 준다. */
          className={`relative flex flex-1 items-center justify-center gap-1 rounded-md px-4 py-2 font-medium ${
            tab === item.id ? 'text-blue-600' : 'text-gray-600'
          }`}
        >
          {t(item.labelKey)}
          {/*
            고른 탭에만 꺾쇠를 둔다. 다음 누름이 무엇을 할지 미리 말한다 -- 거래가
            하나라도 보이면 위(전부 접는다), 아니면 아래(한 단 더 편다)다.
            이것이 없으면 이미 고른 탭을 다시 누를 까닭을 아무도 모른다.
          */}
          {tab === item.id ? (
            tabOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )
          ) : null}
        </button>
      ))}
    </div>
  );
}
