import { useEffect, useRef, useState } from 'react';

import { currentYearMonth } from '../lib/datetime';

/** 이번 달이 바뀌었는지 보는 간격. 문자열 하나를 견줄 뿐이라 자주 봐도 든다는 것이 없다. */
const CHECK_INTERVAL_MS = 60_000;

type YearMonth = { year: number; month: number };

const keyOf = ({ year, month }: YearMonth) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * 화면이 보고 있는 달과 지금 달 (2026-10-16).
 *
 * 보는 달을 마운트할 때 한 번만 정하면, 화면을 살려 두는 탭(앱의 keep-alive, 웹의 열어 둔 탭)은 달이 바뀐
 * 뒤에도 지난달에 머문다 -- 이번 달 표시(thisYearMonth)는 다음 달로 넘어갔는데 화면은 지난달을 그린다.
 * 그래서 지금 달을 1분마다 다시 보고, **사용자가 이번 달을 보고 있었을 때만** 보는 달도 함께 옮긴다. 지난
 * 달을 펴 보던 사람의 화면은 건드리지 않는다.
 *
 * 프로젝트 시간대가 늦게 들어와(가계부 목록을 받기 전의 기본 시간대) 이번 달이 달라질 때도 같은 길로 따라간다.
 */
export function useViewMonth(timeZone: string) {
  const [now, setNow] = useState<YearMonth>(() => currentYearMonth(timeZone));
  const [view, setView] = useState<YearMonth>(now);

  // 시간대가 바뀌면 곧바로, 아니면 1분마다 지금 달을 다시 본다.
  useEffect(() => {
    const check = () =>
      setNow((prev) => {
        const next = currentYearMonth(timeZone);
        return keyOf(next) === keyOf(prev) ? prev : next;
      });
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [timeZone]);

  // 지금 달이 넘어가면, 그 전의 이번 달을 보고 있던 화면만 따라 옮긴다.
  const followedRef = useRef(keyOf(now));
  useEffect(() => {
    const before = followedRef.current;
    followedRef.current = keyOf(now);
    if (before === keyOf(now)) return;
    setView((prev) => (keyOf(prev) === before ? now : prev));
  }, [now]);

  return {
    view,
    setView,
    thisYear: now.year,
    thisMonth: now.month,
  };
}
