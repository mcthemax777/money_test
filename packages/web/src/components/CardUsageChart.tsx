'use client';

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
import { todayKey } from '@money/core/lib/datetime';
import { toNumber } from '@money/core/lib/money';
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
import {
  CARD_USAGE_TARGET_COLOR,
  cardUsageBars,
  cardUsageDomain,
} from '@money/core/lib/card-usage-chart';
import { useProjectTimeZone } from '@money/core/store/project';

/** 막대 위에 금액을 적는 최대 개수. 이보다 많으면 글자끼리 겹친다. */
const LABEL_LIMIT = 8;

interface CardUsageChartProps {
  periods: CardUsagePeriod[];
  /** 사용액·기준액의 통화 (= 결제 통장의 통화) */
  currency: string;
  /** 실적 기준액. 없는 카드가 더 많아서 null이면 기준선도 색 구분도 없다. */
  target: number | null;
  height?: number;
}

/**
 * 주기별 사용액 막대.
 *
 * 실적 기준액에 가로 점선을 긋는다. 숫자를 줄줄이 읽고 기준액과 하나씩 견주는 대신,
 * 선 위로 올라온 막대가 곧 실적을 채운 주기다.
 *
 * 어느 막대가 어떤 색이고 축에 무엇이라 적는지는 core 의 cardUsageBars 가 정한다
 * (앱의 같은 그래프와 같은 규칙이다).
 */
export default function CardUsageChart({
  periods,
  currency,
  target,
  height = 240,
}: CardUsageChartProps) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  const bars = cardUsageBars(periods, todayKey(timeZone), target);
  if (bars.length === 0) return null;

  const [bottom, top] = cardUsageDomain(bars, target);
  const hasFuture = bars.some((bar) => bar.phase === 'future');

  return (
    <div>
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
          <Bar dataKey="amount" radius={CHART_BAR_RADIUS}>
            {bars.map((bar) => (
              <Cell key={bar.key} fill={bar.fill ?? CHART_COLOR} fillOpacity={bar.fillOpacity} />
            ))}
            {bars.length <= LABEL_LIMIT && (
              <LabelList
                dataKey="amount"
                position="top"
                fontSize={11}
                fill="#6b7280"
                formatter={(value: unknown) => formatAxisAmount(toNumber(value as number), currency)}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 색이 무엇을 뜻하는지 적는다. 색만으로 구분하게 두지 않는다. */}
      {target !== null && <p className="mt-1 text-xs text-gray-500">{t('settlement.chartHint')}</p>}
      {hasFuture && <p className="mt-1 text-xs text-gray-500">{t('settlement.chartFutureHint')}</p>}
    </div>
  );
}
