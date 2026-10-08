'use client';

/*
 * 한 줄에 나란히 선 탭 (앱의 SegmentedTabs 와 같은 짝).
 *
 * 흰 알약을 눌린 칸에 그리는 대신 **하나를 두고 옮긴다.** 칸마다 바탕을 켜고 끄면 탭이
 * 순간이동해, 탭들이 한 줄에 나란한 것인지 서로 다른 화면인지가 흐려진다. 거래·분석·분류
 * 화면의 탭과 같은 모양이다.
 */

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
}

export default function SegmentedTabs<T extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  selected: T;
  onSelect: (id: T) => void;
}) {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selected),
  );

  return (
    <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          // 칸 하나의 폭. 양옆 여백(p-1)과 칸 사이(gap-2)를 뺀 나머지를 칸 수로 나눈다.
          width: `calc((100% - ${tabs.length} * 0.5rem) / ${tabs.length})`,
          // 여기서의 100% 는 알약 자신의 폭, 곧 칸 하나다.
          transform: `translateX(calc(${activeIndex} * (100% + 0.5rem)))`,
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          aria-pressed={tab.id === selected}
          /* 바탕은 위의 알약이 맡는다. 글자가 그 위에 오도록 자리를 잡아 준다. */
          className={`relative flex flex-1 items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${
            tab.id === selected ? 'text-blue-600' : 'text-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
