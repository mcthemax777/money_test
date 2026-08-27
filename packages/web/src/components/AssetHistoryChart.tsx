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
  formatTooltipAmount,
  lineAxis,
} from '@/lib/chart';
import { useProjectDisplayCurrency } from '@/store/project';

interface AssetHistoryChartProps {
  /** 생략하면 자본 계정을 뺀 전체 자산 합계 */
  accountId?: string;
  /** 한 구성원이 가진 계좌들의 합계. accountId 와 함께 쓰지 않는다. */
  ownerId?: string;
  /**
   * 여러 구성원이 가진 계좌들의 합계. accountId/ownerId 와 함께 쓰지 않는다.
   *
   * 생략하면 전체, 빈 배열이면 아무도 고르지 않은 것이라 빈 그래프가 된다.
   * 화면의 자산주인 선택과 같은 세 상태 규칙이다.
   */
  ownerIds?: string[];
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

/** 직접 고르는 구간 단위. 드릴다운으로 들어간 일별 보기와는 별개다. */
type Granularity = 'day' | 'month' | 'year';

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: 'day', label: '일' },
  { value: 'month', label: '월' },
  { value: 'year', label: '년' },
];

/** 단위별 창 크기. 서버 기본값과 같은 값을 쓴다. */
const RECENT_DAYS = 30;
const MONTHS = 12;
const YEARS = 5;

export default function AssetHistoryChart({
  accountId,
  ownerId,
  ownerIds,
  projectId,
  endMonth,
}: AssetHistoryChartProps) {
  const displayCurrency = useProjectDisplayCurrency();
  const [granularity, setGranularity] = useState<Granularity>('month');
  /*
   * null이 아니면 그 달의 일별 보기다.
   *
   * 단위 토글과 따로 두는 이유는 돌아갈 자리가 다르기 때문이다. 드릴다운은 "월별
   * 그래프의 이 달"이라는 맥락을 갖고 들어온 것이라 나갈 때 월별로 되돌아가야 한다.
   * 토글로 고른 일별 보기는 그 자체가 목적지라 돌아갈 곳이 없다.
   */
  const [drilledMonth, setDrilledMonth] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /*
   * 의존성으로 쓸 자산주인 키.
   *
   * 배열은 렌더마다 새 참조라 그대로 의존성에 넣으면 값이 같아도 매번 다시 부른다.
   * 서버로 넘길 모양과 같은 쉼표 문자열로 굳힌다. null이면 전체다.
   */
  const ownerKey = ownerIds === undefined ? null : ownerIds.join(',');

  // 계좌나 프로젝트가 바뀌면 일별 보기에 머물러 있을 이유가 없다. 월별로 되돌린다.
  useEffect(() => {
    setDrilledMonth(null);
  }, [accountId, ownerId, ownerKey, projectId]);

  /** 단위를 직접 고르면 드릴다운으로 들어온 맥락은 버린다. */
  const selectGranularity = (value: Granularity) => {
    setDrilledMonth(null);
    setGranularity(value);
  };

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');

      const target = accountId
        ? { accountId }
        : ownerId
          ? { ownerId }
          : ownerKey === null
            ? {}
            : { ownerIds: ownerKey };
      const window = endMonth ? { endMonth } : {};
      const rows = await apiClient.getBalanceHistory(
        drilledMonth
          ? { ...target, granularity: 'day', yearMonth: drilledMonth }
          : granularity === 'day'
            ? { ...target, granularity: 'day', days: RECENT_DAYS }
            : granularity === 'year'
              ? { ...target, granularity: 'year', years: YEARS, ...window }
              : { ...target, granularity: 'month', months: MONTHS, ...window },
        projectId,
      );

      /*
       * 축 이름은 단위마다 다르게 짧게 적는다.
       *
       * 드릴다운한 일별은 한 달 안이라 "N일"이면 충분하지만, 토글로 고른 최근 30일은
       * 달을 넘나들어서 날짜만 적으면 어느 달인지 알 수 없다.
       */
      setPoints(
        (rows ?? []).map((row) => {
          const balance = toNumber(row.balance);
          if (drilledMonth) return { label: `${Number(row.date.slice(8))}일`, balance };
          if (granularity === 'day') {
            return { label: `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}`, balance };
          }
          if (granularity === 'year') return { label: `${row.date}년`, balance };
          return { label: `${Number(row.date.slice(5))}월`, balance, yearMonth: row.date };
        }),
      );
    } catch {
      // 그래프를 못 불러와도 나머지 화면은 살아 있어야 한다.
      setPoints([]);
      setError('자산 추이를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [accountId, ownerId, ownerKey, projectId, endMonth, drilledMonth, granularity]);

  useEffect(() => {
    load();
  }, [load]);

  // 값이 전부 0이면 recharts의 domain이 [0,0]이 되어 선이 축에 붙는다.
  const hasAnyValue = points.some((p) => p.balance !== 0);

  /*
   * Y축을 잔액이 움직인 구간에 맞춘다.
   *
   * 0에서 시작하면 1,000만 원이 1,001만 원이 된 한 달이 직선으로 보인다. 자산 추이는
   * "얼마인가"보다 "늘었는가 줄었는가"를 보는 그래프라 아래를 잘라도 뜻이 뒤집히지 않는다.
   */
  const yAxis = lineAxis(points.map((point) => point.balance), displayCurrency);

  /** 월별 보기에서만 그 달의 일별로 내려간다. 일·연 단위에는 내려갈 곳이 없다. */
  const canDrill = !drilledMonth && granularity === 'month';

  const title = drilledMonth
    ? `${Number(drilledMonth.slice(0, 4))}년 ${Number(drilledMonth.slice(5))}월 일별 잔액`
    : granularity === 'day'
      ? `최근 ${RECENT_DAYS}일 자산 추이`
      : granularity === 'year'
        ? `연도별 자산 추이 (${YEARS}년)`
        : `월별 자산 추이 (${MONTHS}개월)`;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>

        <div className="flex items-center gap-2">
          {drilledMonth && (
            <button
              type="button"
              onClick={() => setDrilledMonth(null)}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              월별로 돌아가기
            </button>
          )}

          {/* 드릴다운 중에도 단위를 고를 수 있다. 고르면 그 단위의 전체 창으로 나간다. */}
          <div className="flex rounded border border-gray-300 overflow-hidden">
            {GRANULARITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectGranularity(option.value)}
                className={`px-3 py-1 text-sm ${
                  !drilledMonth && granularity === option.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {canDrill && (
        <p className="text-xs text-gray-500 mb-2">그래프의 월을 누르면 일별로 보입니다</p>
      )}

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
              if (!canDrill) return;
              const index = Number(state?.activeTooltipIndex);
              if (!Number.isInteger(index) || index < 0) return;
              const clicked = points[index];
              if (clicked?.yearMonth) setDrilledMonth(clicked.yearMonth);
            }}
            style={{ cursor: canDrill ? 'pointer' : 'default' }}
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
              formatter={(value: any) => formatTooltipAmount(value, '잔액', displayCurrency)}
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
