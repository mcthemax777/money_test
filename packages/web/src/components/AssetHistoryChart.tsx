'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiClient } from '@/lib/api-client';
import { toNumber } from '@/lib/money';
import {
  CHART_ACTIVE_DOT,
  CHART_COLOR,
  CHART_DOT,
  CHART_GRID,
  CHART_MARGIN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  formatAxisAmount,
  formatTooltipAmount,
} from '@/lib/chart';

interface AssetHistoryChartProps {
  /** 생략하면 자본 계정을 뺀 전체 자산 합계 */
  accountId?: string;
  /** 한 구성원이 가진 계좌들의 합계. accountId 와 함께 쓰지 않는다. */
  ownerId?: string;
  projectId?: string | null;
  /** 처음 보여줄 12개월 구간의 마지막 달. 생략하면 이번 달 */
  endMonth?: string;
}

interface Point {
  label: string;
  balance: number;
  /** 월 단위일 때만. 클릭해서 일별로 내려갈 때 쓴다 */
  yearMonth?: string;
}

export default function AssetHistoryChart({
  accountId,
  ownerId,
  projectId,
  endMonth,
}: AssetHistoryChartProps) {
  // null이면 월별 보기, 값이 있으면 그 달의 일별 보기
  const [drilledMonth, setDrilledMonth] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 계좌나 프로젝트가 바뀌면 일별 보기에 머물러 있을 이유가 없다. 월별로 되돌린다.
  useEffect(() => {
    setDrilledMonth(null);
  }, [accountId, ownerId, projectId]);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');

      const target = accountId ? { accountId } : ownerId ? { ownerId } : {};
      const rows = await apiClient.getBalanceHistory(
        drilledMonth
          ? { ...target, granularity: 'day', yearMonth: drilledMonth }
          : { ...target, granularity: 'month', months: 12, ...(endMonth ? { endMonth } : {}) },
        projectId,
      );

      setPoints(
        (rows ?? []).map((row) =>
          drilledMonth
            ? { label: `${Number(row.date.slice(8))}일`, balance: toNumber(row.balance) }
            : {
                label: `${Number(row.date.slice(5))}월`,
                balance: toNumber(row.balance),
                yearMonth: row.date,
              },
        ),
      );
    } catch {
      // 그래프를 못 불러와도 나머지 화면은 살아 있어야 한다.
      setPoints([]);
      setError('자산 추이를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [accountId, ownerId, projectId, endMonth, drilledMonth]);

  useEffect(() => {
    load();
  }, [load]);

  // 값이 전부 0이면 recharts의 domain이 [0,0]이 되어 선이 축에 붙는다.
  const hasAnyValue = points.some((p) => p.balance !== 0);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {drilledMonth
            ? `${Number(drilledMonth.slice(0, 4))}년 ${Number(drilledMonth.slice(5))}월 일별 잔액`
            : '월별 자산 추이 (12개월)'}
        </h3>
        {drilledMonth ? (
          <button
            type="button"
            onClick={() => setDrilledMonth(null)}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            월별로 돌아가기
          </button>
        ) : (
          <span className="text-xs text-gray-500">그래프의 월을 누르면 일별로 보입니다</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-500 text-sm py-12 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-red-600 text-sm py-12 text-center">{error}</p>
      ) : !hasAnyValue ? (
        <p className="text-gray-500 text-sm py-12 text-center">표시할 잔액 기록이 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={points}
            margin={CHART_MARGIN}
            // 점이 아니라 빈 곳을 눌러도 그 달로 내려가도록 차트 전체에서 받는다.
            // recharts 3에서 activeTooltipIndex는 number가 아닐 수 있어 숫자로 확인하고 쓴다.
            onClick={(state: any) => {
              if (drilledMonth) return;
              const index = Number(state?.activeTooltipIndex);
              if (!Number.isInteger(index) || index < 0) return;
              const clicked = points[index];
              if (clicked?.yearMonth) setDrilledMonth(clicked.yearMonth);
            }}
            style={{ cursor: drilledMonth ? 'default' : 'pointer' }}
          >
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="label" tick={CHART_TICK} />
            <YAxis tickFormatter={formatAxisAmount} tick={CHART_TICK} width={CHART_Y_AXIS_WIDTH} />
            <Tooltip
              formatter={(value: any) => formatTooltipAmount(value, '잔액')}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Line
              type="monotone"
              dataKey="balance"
              stroke={CHART_COLOR}
              strokeWidth={2}
              dot={CHART_DOT}
              activeDot={CHART_ACTIVE_DOT}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
