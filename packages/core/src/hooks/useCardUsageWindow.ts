/**
 * 주기별 사용액 막대가 보고 있는 창.
 *
 * 받아 둔 주기를 다 그리지 않는다. 여섯 개씩 잘라 보여 주고 좌우로 끌면 그 창이
 * 주기 위를 미끄러진다 -- 자산 추이 그래프와 같은 규칙이다(useAssetHistory).
 * 스물넉 달을 한 화면에 늘어놓으면 막대가 손가락보다 좁아져 읽을 것이 없다.
 *
 * 자산 추이와 달리 서버를 다시 부르지 않는다. 카드 사용액은 한 번에 받아 둔 뒤
 * (MAX_USAGE_PERIODS) 그 안에서 창만 옮기면 되는 양이라, 끄는 동안 기다릴 것이 없다.
 *
 * 그리는 일만 플랫폼이 맡는다 -- 웹은 recharts, 앱은 react-native-svg 다.
 */
import { useCallback, useEffect, useState } from 'react';

import { cardUsageBars, cardUsageDomain, type CardUsageBar } from '../lib/card-usage-chart';
import { todayKey } from '../lib/datetime';
import type { CardUsagePeriod } from '../lib/types';
import { useProjectTimeZone } from '../store/project';

/** 한 화면에 그리는 주기 수. 이보다 많이 받아 두고 창을 옮겨 본다. */
export const CARD_USAGE_WINDOW = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface CardUsageWindow {
  /** 지금 창에 그리는 막대. 오래된 주기가 왼쪽이다. */
  bars: CardUsageBar[];
  /** 창이 제자리에서 몇 칸 떨어져 있는지. 양수면 지난 주기, 음수면 앞 주기다. */
  offset: number;
  /** 한 창에 그리는 칸 수. 한 칸의 폭을 재는 쪽이 쓴다. */
  span: number;
  /**
   * 끌기. 누를 때의 자리에서 몇 칸 옮길지를 준다.
   *
   * 끄는 동안의 기준은 손을 댄 순간의 offset 이다. 지금 값에 더해 가면 한 번의
   * 끌기 안에서 오차가 쌓인다 (자산 추이 그래프와 같다).
   */
  panFrom: (startOffset: number, steps: number) => void;
  /** 창을 진행 중인 주기로 되돌린다. */
  resetWindow: () => void;
  /** 받아 둔 주기가 창보다 많은가. 끌 수 있는 그래프인지를 부르는 쪽이 가른다. */
  canPan: boolean;
  /** 막대 축의 아래끝·위끝. 창에 보이는 막대에만 맞춘다. */
  domain: [number, number];
}

/**
 * @param periods 서버에서 받아 둔 주기 전부. 오래된 것이 앞이다.
 * @param target 실적 기준액. 없으면 색으로 달성 여부를 말하지 않는다.
 * @param resetKey 이 값이 바뀌면 창을 제자리로 되돌린다. 보통 카드 id 다 --
 *   다른 카드를 펼쳤는데 앞 카드에서 끌어 둔 자리에 창이 남아 있으면 안 된다.
 */
export function useCardUsageWindow(
  periods: CardUsagePeriod[],
  target: number | null,
  resetKey?: string,
  span: number = CARD_USAGE_WINDOW,
): CardUsageWindow {
  const timeZone = useProjectTimeZone();
  const [offset, setOffset] = useState(0);

  const resetWindow = useCallback(() => setOffset(0), []);

  // 보는 카드가 바뀌면 옛 자리에 머물러 있을 이유가 없다.
  useEffect(() => {
    resetWindow();
  }, [resetKey, resetWindow]);

  /*
   * 막대는 렌더마다 다시 만든다.
   *
   * 막대의 말(range 의 "마감/진행")은 사전에서 나오므로 언어가 바뀌면 달라져야 한다.
   * 주기 배열만 보고 기억해 두면 언어를 바꿔도 옛 말이 남는다. 스물넉 개를 다시
   * 만드는 값이라 기억해 두어 아낄 것이 없다.
   */
  const all = cardUsageBars(periods, todayKey(timeZone), target);

  /*
   * 창이 제자리에 있을 때의 오른쪽 끝. 진행 중인 주기까지다.
   *
   * 그 뒤는 할부로 금액만 미리 잡혀 있는 앞 주기라, 왼쪽으로 끌어야 나온다. 처음부터
   * 보여 주면 아직 오지도 않은 달이 오른쪽 끝을 차지해 이번 달 막대가 가운데로 밀린다.
   */
  const future = all.findIndex((bar) => bar.phase === 'future');
  const anchorEnd = future === -1 ? all.length : future;

  /** 창의 오른쪽 끝이 설 수 있는 자리. 배열 밖으로는 나가지 않는다. */
  const minEnd = Math.min(span, all.length);
  const maxEnd = all.length;

  /*
   * 제자리에 있을 때 창의 오른쪽 끝.
   *
   * 진행 중인 주기가 창 하나보다 앞에 있으면(앞 주기가 잔뜩 잡혀 있는 카드) 거기에
   * 창을 대는 것이 아니라 배열의 첫 창을 그린다. offset 은 이 자리에서부터 센다 --
   * 그래야 손을 대지 않았을 때가 늘 0이고, "지금으로"가 괜히 떠 있지 않다.
   */
  const restEnd = clamp(anchorEnd, minEnd, maxEnd);

  const end = clamp(restEnd - offset, minEnd, maxEnd);
  const bars = all.slice(Math.max(0, end - span), end);

  const panFrom = useCallback(
    (startOffset: number, steps: number) => {
      setOffset(clamp(startOffset + steps, restEnd - maxEnd, restEnd - minEnd));
    },
    [restEnd, maxEnd, minEnd],
  );

  return {
    bars,
    // 끝까지 끌어 둔 뒤라면 저장해 둔 값보다 작다. 화면에 선 자리를 그대로 알린다.
    offset: restEnd - end,
    span,
    panFrom,
    resetWindow,
    canPan: all.length > span,
    domain: cardUsageDomain(bars, target),
  };
}
