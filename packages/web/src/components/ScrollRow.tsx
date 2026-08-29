'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useDragScroll } from '@/hooks/useDragScroll';
import { itemStarts } from '@/lib/carousel';
import { useTranslation } from '@/lib/i18n';

/** 지금 위치가 칸의 시작과 딱 맞는지 볼 때 눈감아 주는 거리(px). 소수점 좌표를 감안한다. */
const EPSILON = 1;

interface ScrollRowProps {
  children: React.ReactNode;
  /** 줄 자체의 모양. 칸 사이 간격(gap-*)을 여기서 정한다. */
  className?: string;
}

/**
 * 가로로 늘어놓고 옆으로 넘겨 보는 줄.
 *
 * 홈의 실적 구간 카드와 그래프 세 장이 함께 쓴다. 넘기는 방법을 셋 다 둔다.
 *   - 손가락·트랙패드로 밀기 (브라우저가 한다)
 *   - 마우스로 끌기 (useDragScroll)
 *   - 양옆 버튼 누르기 (여기서 한다)
 *
 * 스크롤 막대는 감춘다. 막대가 있으면 줄마다 회색 띠가 하나씩 더 생겨 그래프
 * 아래가 지저분해지는데, 정작 그것을 잡아 끄는 사람은 드물다. 대신 넘길 것이
 * 남은 쪽에만 버튼을 띄워 "더 있다"는 사실을 보인다. 막대를 감췄을 뿐 넘기는
 * 방법은 그대로다.
 *
 * 버튼은 한 칸씩 옮긴다. 정해진 픽셀만큼 밀면 칸의 너비가 다른 줄(카드 320px,
 * 그래프 480px)에서 칸이 반쯤 걸친 채 멈춘다. 다음 칸이 어디서 시작하는지를
 * 재서 그 자리로 보낸다.
 */
export default function ScrollRow({ children, className = '' }: ScrollRowProps) {
  const { t } = useTranslation();
  const ref = useDragScroll<HTMLDivElement>();
  /** 양옆에 넘길 것이 남았는지. 남은 쪽에만 버튼을 그린다. */
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > EPSILON, end: el.scrollLeft < max - EPSILON });
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /*
     * 줄과 칸의 크기를 함께 지켜본다.
     *
     * 창을 줄이면 줄이 좁아지고, 그래프가 다 그려지면 칸이 커진다. 둘 다 "넘길
     * 것이 남았는가"를 바꾸므로 한쪽만 보면 버튼이 있어야 할 때 없거나 그 반대가 된다.
     */
    const size = new ResizeObserver(measure);

    const watch = () => {
      size.disconnect();
      size.observe(el);
      for (const child of Array.from(el.children)) size.observe(child);
      measure();
    };

    watch();
    el.addEventListener('scroll', measure, { passive: true });

    /*
     * 칸이 늘거나 줄면 지켜볼 대상도 바뀐다.
     *
     * children을 의존성에 넣지 않는 것은, JSX가 그릴 때마다 새 값이라 화면이
     * 한 번 그려질 때마다 지켜보기를 통째로 갈아 끼우게 되기 때문이다. 실제로
     * 칸이 갈렸을 때만 다시 잡는다.
     */
    const childList = new MutationObserver(watch);
    childList.observe(el, { childList: true });

    return () => {
      el.removeEventListener('scroll', measure);
      size.disconnect();
      childList.disconnect();
    };
  }, [measure, ref]);

  /** 한 칸 옮긴다. 방향이 1이면 오른쪽, -1이면 왼쪽이다. */
  const step = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;

    // 끌기가 손을 뗄 때 붙는 자리와 같은 계산을 쓴다 (lib/carousel).
    const starts = itemStarts(el);

    const target =
      direction === 1
        ? starts.find((start) => start > el.scrollLeft + EPSILON)
        : [...starts].reverse().find((start) => start < el.scrollLeft - EPSILON);

    // 갈 칸이 없으면 그 끝까지 붙인다. 마지막 칸이 화면보다 넓을 때 남는 자투리다.
    el.scrollTo({
      left: target ?? (direction === 1 ? el.scrollWidth : 0),
      behavior: 'smooth',
    });
  };

  return (
    <div className="relative">
      {/*
        no-scrollbar는 막대를 감출 뿐이다. 넘기는 것 자체는 그대로 두므로 손가락과
        트랙패드, 끌기가 예전처럼 동작한다 (globals.css 참고).
      */}
      <div ref={ref} className={`flex overflow-x-auto snap-x snap-mandatory no-scrollbar ${className}`}>
        {children}
      </div>

      <StepButton side="start" show={edges.start} label={t('carousel.prev')} onClick={() => step(-1)} />
      <StepButton side="end" show={edges.end} label={t('carousel.next')} onClick={() => step(1)} />
    </div>
  );
}

/**
 * 양옆 버튼.
 *
 * 연하게 얹어 둔다(opacity-70). 칸 위에 겹치는 자리라 진하게 두면 그래프의 선과
 * 카드 이름을 가린다. 마우스를 올리면 또렷해져 누를 것임을 알린다.
 *
 * 넘길 것이 없는 쪽은 그리지 않는다. 눌러도 아무 일이 없는 버튼을 흐리게 남겨 두면
 * 왜 안 되는지를 눌러 봐야 알게 된다.
 */
function StepButton({
  side,
  show,
  label,
  onClick,
}: {
  side: 'start' | 'end';
  show: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!show) return null;

  const Icon = side === 'start' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-200 bg-white/80 p-1.5 text-gray-600 opacity-70 shadow-sm backdrop-blur transition hover:bg-white hover:text-gray-900 hover:opacity-100 ${
        side === 'start' ? 'left-1' : 'right-1'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
