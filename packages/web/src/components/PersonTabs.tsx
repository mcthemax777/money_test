'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { useDragReorder } from '@/hooks/useDragReorder';
import { useTranslation } from '@money/core/lib/i18n';
import type { Person } from '@money/core/lib/types';
import { useCanEdit } from '@money/core/store/project';

/**
 * 자산 목록 위의 사람 탭.
 *
 * 구성원이 둘만 되어도 목록이 한 화면을 넘어, 두 번째 사람의 통장을 보려면 첫 사람의
 * 카드를 통째로 지나쳐 내려가야 했다. 여기서는 늘 한 사람의 카드만 보여 주고, 다른
 * 사람은 탭으로 건너간다.
 *
 * **위의 총자산과 추이 그래프는 건드리지 않는다.** 그쪽은 제목(`PersonScopeTitle`)에서
 * 고른 자산주인 전체의 값이다. 이 탭은 보고 있는 범위를 바꾸는 것이 아니라 긴 목록에서
 * 한 사람에게 바로 가는 길이라, 둘이 같은 일을 하면 어느 것이 범위를 정하는지 흐려진다.
 *
 * 밑줄은 하나를 두고 옮긴다 -- 칸마다 켜고 끄면 순간이동해서 이것들이 한 줄에 나란한
 * 탭인지 서로 다른 단추인지가 흐려진다 (앱의 `SegmentedTabs` 와 같은 규칙).
 *
 * 구성원 추가도 이 줄의 오른쪽 끝에 함께 선다. 목록 위에 점선 버튼을 따로 두면 탭 줄과
 * 버튼이 띠 두 개로 쌓여, 정작 사람 이름이 그만큼 아래로 밀린다.
 *
 * 탭 차례가 곧 구성원 차례다. 조금 길게 누르면 탭을 끌어 옮길 수 있고, 목록의 끌기와
 * 같은 훅을 가로로 돌려 쓴다 (`useDragReorder` 의 axis).
 */
export default function PersonTabs({
  people,
  selectedId,
  onSelect,
  onAddPerson,
  onReorder,
}: {
  people: Person[];
  /** 고른 사람. 구성원이 아직 없을 때만 null 이다. */
  selectedId: string | null;
  onSelect: (personId: string) => void;
  onAddPerson: () => void;
  /** 끌어서 바꾼 차례. 목록의 끌기와 같이 id 를 늘어놓아 보낸다. */
  onReorder: (personIds: string[]) => void;
}) {
  const { t } = useTranslation();
  /* 읽기 전용 구성원에게는 더하기 탭을 그리지 않는다 (`AddButton` 과 같은 규칙). */
  const canEdit = useCanEdit();

  /*
   * 혼자인 가계부에는 고를 것이 없다. 건너갈 데가 없는 탭 하나를 세우면 누를 수 있는
   * 것처럼 보이기만 하므로, 그때는 더하기 탭만 남긴다.
   */
  const tabs = people.length > 1 ? people : [];
  const { items, dragProps, draggingId } = useDragReorder(tabs, onReorder, 'x');

  const listRef = useRef<HTMLDivElement>(null);
  /** 밑줄이 설 자리. 아직 재지 못했으면 null 이고, 그동안은 그리지 않는다. */
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setMark(null);
      return;
    }

    const { offsetLeft: left, offsetWidth: width } = active;
    /*
     * 같은 자리면 있던 값을 그대로 둔다.
     *
     * 잴 때마다 새 객체를 넣으면 그것이 다시 그리기를 부르고, 그 렌더가 또 재는 무한
     * 되풀이가 된다 (아래 useLayoutEffect 가 이름이 바뀔 때마다 돌기 때문이다).
     */
    setMark((prev) =>
      prev && prev.left === left && prev.width === width ? prev : { left, width },
    );
  }, []);

  /* 이름과 차례가 바뀌면 자리도 바뀐다. 목록의 생김새를 열쇠로 삼아 다시 잰다. */
  const signature = items.map((person) => person.name).join('\u0000');
  useLayoutEffect(() => {
    measure();
  }, [measure, selectedId, signature]);

  /* 창을 줄이거나 글꼴이 늦게 도착하면 폭이 달라진다. 그때도 다시 잰다. */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="mb-3 border-b border-gray-200">
      {/*
        사람이 많으면 한 줄에 다 서지 못한다. 글자를 줄이는 대신 옆으로 넘겨 본다 --
        이름을 줄이면 "김…"만 남아 어느 탭인지 알 수 없다. 더하기 탭도 이 줄 안에 있어
        끝까지 밀면 따라 나온다.
      */}
      <div ref={listRef} className="relative flex overflow-x-auto no-scrollbar">
        {items.map((person) => {
          const isActive = person.id === selectedId;

          return (
            <button
              key={person.id}
              type="button"
              {...dragProps(person.id)}
              data-active={isActive}
              aria-pressed={isActive}
              onClick={() => onSelect(person.id)}
              className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
              } ${draggingId === person.id ? 'opacity-50' : ''}`}
            >
              {person.name}
            </button>
          );
        })}

        {canEdit && (
          <>
            {/* 고르는 탭과 더하는 탭 사이의 금. 둘이 같은 무게로 읽히지 않게 한다. */}
            {items.length > 0 && <span aria-hidden className="my-2 w-px shrink-0 bg-gray-200" />}

            <button
              type="button"
              onClick={onAddPerson}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('person.add')}
            </button>
          </>
        )}

        {mark && (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-blue-600 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
          />
        )}
      </div>
    </div>
  );
}
