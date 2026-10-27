'use client';

import { useEffect, useRef, useState } from 'react';

import { useVisibleParade } from '@money/core/hooks/useCats';
import {
  CAT_PARADE_HEIGHT,
  CAT_SPRITE_WIDTH,
  catNameKey,
  catStartX,
  nextCatAction,
  type CatPose,
} from '@money/core/lib/cats';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';

import CatArt from './CatArt';

/** 누르면 이름 말풍선이 떠 있는 시간. */
const BUBBLE_MS = 2200;

/**
 * 화면 아래를 걷는 고양이들. 앱의 `components/cats/CatParade` 와 같은 짝이다.
 *
 * 좁은 화면에서는 아래 탭 바로 위, 넓은 화면에서는 화면 맨 아래(사이드바 옆)다. 광고 배너와 같은 자리이고 배너보다
 * 아래 층이다 -- 광고가 있는 가계부에서는 아예 세우지 않는다(`useVisibleParade`).
 *
 * 줄 자체는 손을 받지 않는다. 본문 위에 겹쳐 있어서, 받으면 그 밑의 마지막 줄을 누를 수 없다. 고양이만 받는다.
 */
export default function CatParade() {
  const projectId = useProject((state) => state.selectedProjectId);
  const parade = useVisibleParade(projectId);
  const stripRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(strip);
    return () => observer.disconnect();
  }, [parade.length > 0]);

  if (parade.length === 0) return null;

  return (
    <div
      ref={stripRef}
      className="pointer-events-none fixed inset-x-0 z-20 md:left-64 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0"
      style={{ height: CAT_PARADE_HEIGHT }}
    >
      {width > 0
        ? parade.map((breedId, index) => (
            <Walker
              key={breedId}
              breedId={breedId}
              startX={catStartX(index, parade.length, width - CAT_SPRITE_WIDTH)}
              range={width - CAT_SPRITE_WIDTH}
            />
          ))
        : null}
    </div>
  );
}

/** 본문이 줄에 가리지 않게 그만큼 비켜 준다 (AdBannerSpacer 와 같은 구실). */
export function CatParadeSpacer() {
  const projectId = useProject((state) => state.selectedProjectId);
  const visible = useVisibleParade(projectId).length > 0;
  return visible ? <div aria-hidden style={{ height: CAT_PARADE_HEIGHT }} /> : null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 고양이 한 마리. 할 일(`nextCatAction`)을 하나 끝내면 다음 일을 고른다.
 *
 * 걸음은 CSS 전이로 옮긴다 -- 자리를 한 번 정해 주면 브라우저가 그 시간 동안 미끄러뜨려, 프레임마다 값을 고치지
 * 않는다. 움직임을 줄이는 설정이면 걷지 않고 서거나 잠들기만 한다.
 */
function Walker({ breedId, startX, range }: { breedId: string; startX: number; range: number }) {
  const { t } = useTranslation();
  const [x, setX] = useState(startX);
  const [pose, setPose] = useState<CatPose>('stand');
  const [facingRight, setFacingRight] = useState(true);
  const [moveMs, setMoveMs] = useState(0);
  const [bubble, setBubble] = useState(false);
  const xRef = useRef(startX);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const step = useRef<() => void>(() => {});
  step.current = () => {
    const width = Math.max(0, rangeRef.current);
    const from = Math.min(xRef.current, width);
    const action = nextCatAction(from, width);
    if (action.kind === 'walk' && !prefersReducedMotion()) {
      setFacingRight(action.toX >= from);
      setPose('walk');
      setMoveMs(action.ms);
      setX(action.toX);
      xRef.current = action.toX;
      timer.current = setTimeout(() => step.current(), action.ms);
      return;
    }
    setPose(action.kind === 'sleep' ? 'sleep' : 'stand');
    setMoveMs(0);
    timer.current = setTimeout(() => step.current(), action.kind === 'walk' ? 3000 : action.ms);
  };

  useEffect(() => {
    // 처음에는 잠깐 서 있다 움직인다. 여럿이 한꺼번에 출발하지 않게 조금씩 어긋난다.
    timer.current = setTimeout(() => step.current(), 600 + Math.random() * 1500);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(bubbleTimer.current);
    };
  }, []);

  /* 창 폭이 줄어 줄 밖에 서게 되면 안으로 들인다. */
  useEffect(() => {
    if (xRef.current > range) {
      xRef.current = Math.max(0, range);
      setMoveMs(0);
      setX(xRef.current);
    }
  }, [range]);

  const onPress = () => {
    clearTimeout(bubbleTimer.current);
    setBubble(true);
    bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS);
    // 잠든 고양이는 깨어 선다.
    if (pose === 'sleep') {
      clearTimeout(timer.current);
      setPose('stand');
      timer.current = setTimeout(() => step.current(), 2500);
    }
  };

  return (
    <div
      className="absolute bottom-0 left-0"
      style={{
        transform: `translateX(${x}px)`,
        transition: moveMs > 0 ? `transform ${moveMs}ms linear` : 'none',
        width: CAT_SPRITE_WIDTH,
      }}
    >
      {bubble ? (
        <span className="unfold absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 shadow">
          {t(catNameKey(breedId))}
        </span>
      ) : null}
      {pose === 'sleep' ? (
        <span className="cat-zzz absolute -top-1 right-1 text-[10px] font-bold text-blue-400">z</span>
      ) : null}
      {/* 줄에 새로 선 고양이는 옅은 데서 나타난다. 걷는 자리 옮김(바깥 상자의 transform)과 겹치지 않게 안쪽에 건다. */}
      <div className="unfold">
        <button
          type="button"
          onClick={onPress}
          className="pointer-events-auto block"
          style={{ transform: facingRight ? undefined : 'scaleX(-1)' }}
          aria-label={t(catNameKey(breedId))}
        >
          <CatArt breedId={breedId} pose={pose} width={CAT_SPRITE_WIDTH} />
        </button>
      </div>
    </div>
  );
}
