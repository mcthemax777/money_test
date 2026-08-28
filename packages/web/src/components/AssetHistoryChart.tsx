'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { apiClient } from '@/lib/api-client';
import { formatCurrency, toNumber } from '@/lib/money';
import {
  CHART_ACTIVE_DOT,
  CHART_COLOR,
  CHART_DOT,
  CHART_GRID,
  CHART_MARGIN_EVEN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH_AUTO,
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
  /** 어느 화면의 모양으로 그릴지. 기본은 자산 화면의 큰 패널이다. */
  variant?: Variant;
  /** 처음 고를 구간 단위. 사용자가 토글로 바꾸면 그 값을 따른다. */
  initialGranularity?: Granularity;
  /**
   * 월별 그래프에서 그 달의 일별로 내려갈 수 있는지. 기본은 내려갈 수 있다.
   *
   * 홈처럼 훑어보기만 하는 화면은 끈다. 누를 수 있게 두면 홈에서 내려간 뒤
   * 돌아올 자리가 없다.
   */
  drillable?: boolean;
}

interface Point {
  label: string;
  balance: number;
  /** 월 단위일 때만. 클릭해서 일별로 내려갈 때 쓴다 */
  yearMonth?: string;
}

/** 직접 고르는 구간 단위. 드릴다운으로 들어간 일별 보기와는 별개다. */
type Granularity = 'day' | 'month' | 'year';

/**
 * 화면에 따른 겉모양.
 *
 * `panel`은 자산 화면의 큰 그래프다. `compact`는 홈에서 다른 카드들과 나란히 서는
 * 모양이라, 홈의 누적 지출 그래프와 같은 테두리·여백·높이를 쓰고 점을 찍지 않는다.
 */
type Variant = 'panel' | 'compact';

const VARIANT_STYLE: Record<
  Variant,
  {
    container: string;
    title: string;
    height: number;
    dot: typeof CHART_DOT | false;
    /** 끝점 옆에 금액을 적을지. 홈은 그래프가 작아 숫자가 선을 가린다. */
    showLastValue: boolean;
  }
> = {
  panel: {
    container: 'bg-white rounded-lg shadow p-6',
    title: 'text-lg font-semibold text-gray-900',
    height: 300,
    dot: CHART_DOT,
    showLastValue: true,
  },
  compact: {
    container: 'rounded-lg border border-gray-200 bg-white p-4',
    title: 'font-semibold text-gray-900',
    height: 224,
    dot: false,
    showLastValue: false,
  },
};

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
  variant = 'panel',
  initialGranularity = 'month',
  drillable = true,
}: AssetHistoryChartProps) {
  const style = VARIANT_STYLE[variant];
  const displayCurrency = useProjectDisplayCurrency();
  const [granularity, setGranularity] = useState<Granularity>(initialGranularity);
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

  /**
   * 선이 끝나는 점. 여기에만 점을 찍고 금액을 적는다.
   *
   * 선만 있으면 지금 얼마인지 알려고 Y축 눈금을 되짚어야 한다. 마지막 값은 이
   * 그래프에서 가장 자주 찾는 숫자라 그 자리에 그대로 적는다.
   */
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;

  /** 월별 보기에서만 그 달의 일별로 내려간다. 일·연 단위에는 내려갈 곳이 없다. */
  const canDrill = drillable && !drilledMonth && granularity === 'month';

  const title = drilledMonth
    ? `${Number(drilledMonth.slice(0, 4))}년 ${Number(drilledMonth.slice(5))}월 일별 잔액`
    : granularity === 'day'
      ? `최근 ${RECENT_DAYS}일 자산 추이`
      : granularity === 'year'
        ? `연도별 자산 추이 (${YEARS}년)`
        : `월별 자산 추이 (${MONTHS}개월)`;

  return (
    <div className={style.container}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className={style.title}>{title}</h3>

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
        <ResponsiveContainer width="100%" height={style.height}>
          <LineChart
            data={points}
            margin={CHART_MARGIN_EVEN}
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
              width={CHART_Y_AXIS_WIDTH_AUTO}
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
              dot={style.dot}
              activeDot={CHART_ACTIVE_DOT}
            />
            {/*
              금액은 점 왼쪽에 적는다. 마지막 점은 오른쪽 끝에 붙어 있어 위나
              오른쪽에 적으면 글자가 그래프 밖으로 잘린다.
            */}
            {lastPoint && (
              <ReferenceDot
                x={lastPoint.label}
                y={lastPoint.balance}
                r={4}
                fill={CHART_COLOR}
                stroke="#fff"
                strokeWidth={2}
                label={
                  style.showLastValue
                    ? {
                        value: formatCurrency(lastPoint.balance, displayCurrency),
                        position: 'left',
                        offset: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        fill: '#374151',
                      }
                    : undefined
                }
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
