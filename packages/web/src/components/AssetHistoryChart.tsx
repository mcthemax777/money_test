'use client';

import { useRef } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from '@money/core/lib/i18n';
import {
  CHART_ACTIVE_DOT,
  CHART_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  formatTooltipAmount,
} from '@money/core/lib/chart';
import {
  GRANULARITY_OPTIONS,
  historyPointLabel,
  useAssetHistory,
  type AssetHistoryInput,
} from '@money/core/hooks/useAssetHistory';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * Y축 눈금과 좌우 여백이 먹는 폭의 어림값(px).
 *
 * 정확할 필요는 없다. "몇 px을 끌면 한 칸이 넘어가는가" 하나를 정하는 데만 쓴다.
 * Y축 너비는 눈금 글자에 맞춰 자동이라 미리 알 수 없어 어림으로 둔다.
 */
const PLOT_INSET = 90;

/** 이보다 적게 움직인 것은 끌기가 아니라 누르다가 손이 떨린 것이다(px). */
const DRAG_THRESHOLD = 3;

/**
 * 자산 추이. 무엇을 받아 어느 칸을 그릴지는 core 의 useAssetHistory 가 정한다.
 *
 * 여기 남은 것은 그리는 일뿐이다 -- recharts 로 선을 긋고, 손가락(마우스)을 받아
 * 창을 옮기고, 칸을 눌러 한 단 아래로 내려간다. 앱의 같은 그래프가 같은 훅 위에
 * 제 방식으로(react-native-svg) 그려진다.
 */
export default function AssetHistoryChart(props: AssetHistoryInput) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const history = useAssetHistory(props);
  const { points, lastPoint, yAxis, canDrill } = history;

  /*
   * 끌기. 손가락(마우스)을 따라 창이 시간 위를 미끄러진다.
   *
   * 오른쪽으로 끌면 지난 날짜가 왼쪽에서 들어오고 최근 날짜가 오른쪽으로 빠진다 --
   * 종이를 오른쪽으로 미는 것과 같은 방향이다. 한 칸이 화면에서 차지하는 폭만큼
   * 끌 때마다 한 칸이 넘어가므로, 빨리 끌면 그만큼 여러 칸이 한 번에 지나간다.
   */
  const plotRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);
  /**
   * 이번 누름이 끌기였는지.
   *
   * 월별 그래프는 눌러서 일별로 내려가는 자리이기도 하다. 끌고 나서 손을 떼면 클릭도
   * 함께 오므로, 끈 것이면 그 클릭은 흘려보낸다. 누를 때마다 다시 false가 되어
   * 다음 클릭까지 남지 않는다.
   */
  const didDrag = useRef(false);

  /** 한 칸이 화면에서 차지하는 폭(px). 이만큼 끌면 한 칸이 넘어간다. */
  const stepWidth = () => {
    const width = plotRef.current?.clientWidth ?? 0;
    return Math.max((width - PLOT_INSET) / Math.max(history.span - 1, 1), 8);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{t(history.titleKey)}</h3>

        <div className="flex items-center gap-2">
          {/* 지난 날짜든 앞날이든 지금을 벗어나 있을 때. 그만큼 다시 끌지 않아도 된다. */}
          {history.offset !== 0 && (
            <button
              type="button"
              onClick={history.resetWindow}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              {t('history.backToNow')}
            </button>
          )}

          <div className="flex rounded border border-gray-300 overflow-hidden">
            {GRANULARITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => history.selectGranularity(option.value)}
                className={`px-3 py-1 text-sm ${
                  history.granularity === option.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 처음 한 번만 자리를 비운다. 끌면서 다시 받는 동안에는 그리던 선을 그대로 둔다. */}
      {history.isLoading && points.length === 0 ? (
        <p className="text-gray-500 text-sm py-12 text-center">{t('feed.loadingMore')}</p>
      ) : history.error ? (
        <p className="text-red-600 text-sm py-12 text-center">{history.error}</p>
      ) : !history.hasAnyValue && history.offset === 0 ? (
        <p className="text-gray-500 text-sm py-12 text-center">{t('history.empty')}</p>
      ) : (
        <div
          ref={plotRef}
          // 세로 스크롤은 화면에 넘기고 가로 끌기만 받는다. 손가락으로 훑어 내리는 길을 막지 않는다.
          style={{ touchAction: 'pan-y' }}
          className="select-none"
          onPointerDown={(event) => {
            didDrag.current = false;
            drag.current = { x: event.clientX, offset: history.offset };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const dx = event.clientX - start.x;
            // 손 떨림은 끌기가 아니다. 문턱을 넘기 전까지는 그냥 누른 것으로 둔다.
            if (Math.abs(dx) <= DRAG_THRESHOLD) return;
            /*
             * 문턱을 넘은 뒤에야 손을 붙잡는다.
             *
             * 누르자마자 붙잡으면 뒤따르는 클릭까지 이 칸으로 끌려와, 월별 그래프에서
             * 달을 눌러 일별로 내려가는 길이 막힌다.
             */
            if (!didDrag.current) {
              didDrag.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            // 오른쪽으로 끌면 지난 날짜(+), 왼쪽으로 끌면 앞날(-)이다.
            history.panFrom(start.offset, Math.round(dx / stepWidth()));
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={points}
              margin={CHART_MARGIN}
              // 점이 아니라 빈 곳을 눌러도 한 단 아래로 내려가도록 차트 전체에서 받는다.
              // recharts 3에서 activeTooltipIndex는 number가 아닐 수 있어 숫자로 확인하고 쓴다.
              onClick={(state: any) => {
                if (!canDrill || didDrag.current) return;
                const index = Number(state?.activeTooltipIndex);
                if (!Number.isInteger(index) || index < 0) return;
                const clicked = points[index];
                if (!clicked) return;
                history.drillInto(clicked.date);
              }}
              style={{ cursor: canDrill ? 'pointer' : 'grab' }}
            >
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="label" tick={CHART_TICK} />
              <YAxis
                domain={yAxis.domain}
                ticks={yAxis.ticks}
                tickFormatter={yAxis.tickFormatter}
                tick={CHART_TICK}
                width={CHART_Y_AXIS_WIDTH}
              />
              <Tooltip
                formatter={(value: any) =>
                  formatTooltipAmount(value, t('history.balance'), displayCurrency)
                }
                /*
                 * 머리글은 **연도까지** 적는다. 기본값은 X축 이름(label)인데, 그쪽은
                 * 눈금이 겹치지 않게 "9/10"·"9월" 로 줄여 둔 것이라 창을 해가 바뀌는
                 * 자리로 끌면 어느 해의 9월인지 알 수 없다.
                 *
                 * 날짜는 점이 들고 있다. recharts 는 두 번째 인자로 그 칸의 원본
                 * 데이터를 함께 주므로 거기서 꺼낸다 -- 첫 인자(label)로는 되읽을 수
                 * 없다. 아직 아무 칸도 가리키지 않은 순간에는 빈 글자다.
                 */
                labelFormatter={(_label: any, payload: any) => {
                  const date = payload?.[0]?.payload?.date;
                  return date ? historyPointLabel(date) : '';
                }}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Line
                type="monotone"
                dataKey="balance"
                stroke={CHART_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={CHART_ACTIVE_DOT}
                // 끄는 동안 점이 하나씩 갈리므로 그때마다 선이 다시 자라면 어지럽다.
                isAnimationActive={false}
              />
              {/*
                선이 끝나는 점. 점만 찍고 금액은 적지 않는다.

                예전에는 이 점 왼쪽에 잔액을 적었다. 값을 읽는 길이 이미 둘 있는데
                (마우스를 올리면 툴팁, 아래의 잔액 칸) 그래프 안에까지 적으면 같은
                숫자가 한 화면에 셋이 되고, 그 글자는 선을 따라 오르내려 격자선·X축
                이름과 겹치는 자리가 생긴다. 점은 남긴다 -- 선이 어디서 끝나는지는
                그것 말고 말해 주는 것이 없다.
              */}
              {lastPoint && (
                <ReferenceDot
                  x={lastPoint.label}
                  y={lastPoint.balance}
                  r={4}
                  fill={CHART_COLOR}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
