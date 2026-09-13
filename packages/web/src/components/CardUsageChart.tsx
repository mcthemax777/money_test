'use client';

import { useRef } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CardUsagePeriod } from '@money/core/lib/types';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import {
  CHART_BAR_RADIUS,
  CHART_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  formatAxisAmount,
  formatTooltipAmount,
} from '@money/core/lib/chart';
import { CARD_USAGE_TARGET_COLOR } from '@money/core/lib/card-usage-chart';
import { useCardUsageWindow } from '@money/core/hooks/useCardUsageWindow';

/** 막대 위에 금액을 적는 최대 개수. 이보다 많으면 글자끼리 겹친다. */
const LABEL_LIMIT = 8;

/**
 * Y축 눈금과 좌우 여백이 먹는 폭의 어림값(px).
 *
 * 자산 추이 그래프와 같은 규칙이다 -- "몇 px을 끌면 한 칸이 넘어가는가" 하나를
 * 정하는 데만 쓰므로 정확할 필요가 없다.
 */
const PLOT_INSET = 90;

/** 이보다 적게 움직인 것은 끌기가 아니라 누르다가 손이 떨린 것이다(px). */
const DRAG_THRESHOLD = 3;

interface CardUsageChartProps {
  periods: CardUsagePeriod[];
  /** 사용액·기준액의 통화 (= 결제 통장의 통화) */
  currency: string;
  /** 실적 기준액. 없는 카드가 더 많아서 null이면 기준선도 색 구분도 없다. */
  target: number | null;
  /** 어느 카드의 그래프인지. 카드가 바뀌면 끌어 둔 창을 제자리로 되돌린다. */
  cardId?: string;
  height?: number;
}

/**
 * 주기별 사용액 막대.
 *
 * 실적 기준액에 가로 점선을 긋는다. 숫자를 줄줄이 읽고 기준액과 하나씩 견주는 대신,
 * 선 위로 올라온 막대가 곧 실적을 채운 주기다.
 *
 * 한 번에 여섯 주기만 그리고 좌우로 끌어 앞뒤 주기로 옮긴다. 어느 막대가 어떤 색이고
 * 창이 어디에 놓이는지는 core 의 useCardUsageWindow 가 정한다 (앱의 같은 그래프와
 * 같은 규칙이다).
 *
 * 막대 아래에는 같은 값을 글로도 적는다. 축에는 "8월"·"8.9~9.8"처럼 줄여 적고 막대
 * 위의 금액도 만 단위로 줄여 두어, 정확한 구간과 금액은 마우스를 올려야만 읽혔다.
 */
export default function CardUsageChart({
  periods,
  currency,
  target,
  cardId,
  height = 240,
}: CardUsageChartProps) {
  const { t } = useTranslation();
  const usage = useCardUsageWindow(periods, target, cardId);
  const { bars } = usage;

  /*
   * 끌기. 마우스를 따라 창이 주기 위를 미끄러진다.
   *
   * 자산 추이 그래프와 같은 규칙이다 -- 오른쪽으로 끌면 지난 주기가 왼쪽에서 들어오고,
   * 문턱을 넘은 뒤에야 손을 붙잡아 안쪽의 누름을 막지 않는다.
   */
  const plotRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const didDrag = useRef(false);

  /** 한 칸이 화면에서 차지하는 폭(px). 이만큼 끌면 한 주기가 넘어간다. */
  const stepWidth = () => {
    const width = plotRef.current?.clientWidth ?? 0;
    return Math.max((width - PLOT_INSET) / usage.span, 8);
  };

  if (bars.length === 0) return null;

  const [bottom, top] = usage.domain;

  return (
    <div>
      {/* 창이 제자리를 벗어나 있을 때만. 그만큼 다시 끌지 않아도 된다. */}
      {usage.offset !== 0 && (
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={usage.resetWindow}
            className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-300"
          >
            {t('history.backToNow')}
          </button>
        </div>
      )}

      <div
        ref={plotRef}
        // 세로 스크롤은 화면에 넘기고 가로 끌기만 받는다 (자산 추이 그래프와 같다).
        style={{ touchAction: 'pan-y' }}
        className={usage.canPan ? 'select-none' : undefined}
        onPointerDown={(event) => {
          if (!usage.canPan) return;
          didDrag.current = false;
          drag.current = { x: event.clientX, offset: usage.offset };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const dx = event.clientX - start.x;
          // 손 떨림은 끌기가 아니다. 문턱을 넘기 전까지는 그냥 누른 것으로 둔다.
          if (Math.abs(dx) <= DRAG_THRESHOLD) return;
          if (!didDrag.current) {
            didDrag.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          // 오른쪽으로 끌면 지난 주기(+), 왼쪽으로 끌면 앞 주기(-)다.
          usage.panFrom(start.offset, Math.round(dx / stepWidth()));
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
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={bars} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="label" tick={CHART_TICK} />
            <YAxis
              domain={[bottom, top]}
              tickFormatter={(value: number) => formatAxisAmount(value, currency)}
              tick={CHART_TICK}
              width={CHART_Y_AXIS_WIDTH}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }}
              contentStyle={CHART_TOOLTIP_STYLE}
              // 축에는 달 이름만 적으므로, 어느 구간인지는 툴팁 제목에 그대로 적는다.
              labelFormatter={(_label: unknown, payload: any) => payload?.[0]?.payload?.range ?? ''}
              formatter={(value: any) => formatTooltipAmount(value, t('method.usage'), currency)}
            />
            {target !== null && target > 0 && (
              <ReferenceLine
                y={target}
                stroke={CARD_USAGE_TARGET_COLOR}
                strokeDasharray="4 4"
                label={{
                  value: t('settlement.targetLine', {
                    amount: formatAxisAmount(target, currency),
                  }),
                  position: 'insideTopRight',
                  fill: CARD_USAGE_TARGET_COLOR,
                  fontSize: 11,
                }}
              />
            )}
            {/* 끄는 동안 막대가 하나씩 갈리므로 그때마다 다시 자라면 어지럽다. */}
            <Bar dataKey="amount" radius={CHART_BAR_RADIUS} isAnimationActive={false}>
              {bars.map((bar) => (
                <Cell key={bar.key} fill={bar.fill ?? CHART_COLOR} fillOpacity={bar.fillOpacity} />
              ))}
              {bars.length <= LABEL_LIMIT && (
                <LabelList
                  dataKey="amount"
                  position="top"
                  fontSize={11}
                  fill="#6b7280"
                  formatter={(value: unknown) =>
                    formatAxisAmount(toNumber(value as number), currency)
                  }
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/*
        그래프에 선 막대를 그대로 글로 옮긴 줄. 맨 위가 왼쪽 끝 막대다.

        구간은 양끝 날짜까지, 금액은 줄이지 않고 적는다 -- 축과 막대 위의 글자는
        자리가 좁아 "8월"·"12.3만"으로 줄여 둔 것이라, 정확한 값은 마우스를 올리지
        않으면 읽을 수 없었다.
      */}
      <ul className="mt-3 border-t border-gray-100">
        {bars.map((bar) => (
          <li
            key={bar.key}
            className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-1.5"
          >
            <span className="text-xs text-gray-500">{bar.range}</span>
            <span className="text-sm font-medium tabular-nums text-gray-900">
              {formatCurrency(bar.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
