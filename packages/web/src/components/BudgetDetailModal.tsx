'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from 'recharts';
import Modal from './Modal';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { useCategoryDetail, type CategorySlice } from '@money/core/hooks/useCategoryDetail';
import type { BarPoint, MethodSlice, PatternMode } from '@money/core/lib/usage-pattern';
import { type ReportPeriod } from '@money/core/lib/api-client';
import { formatCurrency } from '@money/core/lib/money';
import {
  CHART_BAR_RADIUS,
  CHART_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_PIE_COLORS,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  signedBarColor,
  barDomain,
  barTicks,
  formatAxisAmount,
  formatTooltipAmount,
  barValueLabel,
} from '@money/core/lib/chart';
import { useTranslation } from '@money/core/lib/i18n';
import DailyCumulativeChart from './DailyCumulativeChart';
import type { EntryScopeQuery } from '@money/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';
import type { Category } from '@money/core/lib/types';

interface BudgetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryId: string;
  categoryName: string;
  categories?: Category[];
  isInline?: boolean;
  /**
   * 볼 구간. 한 달(`{ yearMonth }`)이거나 임의 기간(`{ startDate, endDate }`)이다.
   *
   * 원형차트·일별 누적·거래 목록이 전부 이 구간을 쓴다. 오른쪽 12개월 추이만
   * 구간의 마지막 달을 끝으로 하는 시계열이라 구간 밖의 달도 함께 보여 준다.
   */
  period: ReportPeriod;
  /**
   * categoryId를 그 분류로만 본다 (소분류 제외).
   *
   * 목록의 "미분류"를 눌렀을 때 켠다. 소분류 없이 대분류에 바로 기록한 건만
   * 그리므로 원형차트는 그리지 않는다. 더 쪼갤 것이 없다.
   */
  exactCategory?: boolean;
  /** 선택된 프로젝트. 넘기지 않으면 서버가 기본 프로젝트로 조회한다. */
  projectId?: string | null;
  /** 가계 화면의 사람 필터. 상단 합계와 같은 조건을 써야 한다. */
  filter?: EntryScopeQuery;
  /** 거래를 누르면 호출한다. 날짜별 보기와 같은 상세 팝업을 열기 위한 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 데이터를 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
  /** 12개월 추이를 자를 구간. 거래 분석이 검색 기간을 걸었을 때 준다 (useCategoryDetail). */
  trendClip?: { from?: string; to?: string };
  /** 추이 막대의 마지막 기간. 주·해면 그 단위로 선다 (useCategoryDetail). */
  trendPeriod?: string;
  /**
   * 분류 원형의 목록 줄을 누르면 부른다. 값은 검색의 분류 칸에 담을 것이다 (`CategorySlice.pickId`).
   * 분석 탭이 그 분류를 조건으로 더한다. 주지 않으면 목록 줄은 원형 조각과 같이 파고든다.
   */
  onPickCategory?: (pickId: string) => void;
  /** 수단 원형의 목록 줄을 누르면 부른다. 분석 탭이 그 수단을 조건으로 더한다. */
  onPickMethod?: (method: MethodSlice) => void;
}

/** 요일·시간대 막대의 평균/누적 전환. 제목 줄 오른쪽에 선다 (앱의 같은 단추와 같은 모양). */
export function PatternModeToggle({
  mode,
  onChange,
}: {
  mode: PatternMode;
  onChange: (mode: PatternMode) => void;
}) {
  const { t } = useTranslation();
  const options: Array<{ id: PatternMode; label: string }> = [
    { id: 'average', label: t('detail.patternAverage') },
    { id: 'total', label: t('detail.patternTotal') },
  ];
  return (
    <div className="relative flex shrink-0 rounded-md bg-gray-200 p-0.5 text-xs">
      {/* 흰 알약이 고른 쪽으로 미끄러진다. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: mode === 'total' ? 'translateX(100%)' : 'translateX(0)' }}
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={mode === option.id}
          className={`relative flex-1 px-3 py-1 font-medium ${
            mode === option.id ? 'text-blue-600' : 'text-gray-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 구성비 원형. 분류 조각과 수단 조각이 함께 쓴다 (앱의 CategoryPieChart 와 같은 자리).
 *
 * onDrill 을 주면 id 가 있는 조각을 눌러 한 단 내려간다. id 가 없는 조각("미분류")이나
 * 수단 조각은 내려갈 곳이 없다.
 */
export function SlicePieChart<T extends CategorySlice>({
  slices,
  currency,
  onDrill,
  onPick,
}: {
  slices: T[];
  currency: string;
  onDrill?: (categoryId: string) => void;
  /**
   * 목록 줄을 누를 때. 주면 줄은 이 일을 하고(분석의 조건 더하기), 조각은 여전히 파고든다.
   * 주지 않으면 줄도 조각처럼 파고든다. 그 줄이 할 일이 없으면 누를 수 없다.
   */
  onPick?: (slice: T) => void;
}) {
  const total = slices.reduce((acc, slice) => acc + slice.value, 0);
  /*
   * 이름표는 둘레가 아니라 아래 목록에 둔다 (앱의 CategoryPieChart 와 같은 모양, 2026-10-08).
   * 둘레 글자는 조각이 많으면 서로 겹치고, 목록 줄이어야 눌러 조건을 더할 자리가 생긴다.
   */
  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
            nameKey="name"
            onClick={(entry: any) => {
              if (onDrill && entry.id) onDrill(entry.id);
            }}
          >
            {slices.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_PIE_COLORS[index % CHART_PIE_COLORS.length]}
                style={{ cursor: onDrill && entry.id ? 'pointer' : 'default' }}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: any) => formatCurrency(value, currency)}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="mt-2">
        {slices.map((slice, index) => {
          const action = onPick
            ? () => onPick(slice)
            : onDrill && slice.id
              ? () => onDrill(slice.id!)
              : undefined;
          const ratio = total > 0 ? (slice.value / total) * 100 : 0;
          return (
            <li key={`${slice.id ?? slice.name}-${index}`}>
              <button
                type="button"
                onClick={action}
                disabled={!action}
                className="flex w-full items-baseline gap-2 border-b border-gray-100 px-1 py-1.5 text-left enabled:hover:bg-gray-50"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 self-center rounded-sm"
                  style={{ backgroundColor: CHART_PIE_COLORS[index % CHART_PIE_COLORS.length] }}
                />
                <span className="truncate text-sm text-gray-800">{slice.name}</span>
                <span className="text-xs text-gray-500">{ratio.toFixed(1)}%</span>
                <span className="ml-auto text-sm font-medium text-gray-900">
                  {formatCurrency(slice.value, currency)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 막대 위의 금액. 막대가 좁으면 세워 적는다 -- 시간대 스물넷을 눕혀 적으면 서로 겹친다.
 * 0 원 막대에는 적지 않는다.
 */
function BarValueLabel({
  x,
  y,
  width,
  height,
  value,
  currency,
  vertical,
}: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  currency: string;
  vertical: boolean;
}) {
  const amount = Number(value ?? 0);
  const text = barValueLabel(amount, currency);
  if (!text) return null;
  const left = Number(x ?? 0);
  const top = Number(y ?? 0);
  const barHeight = Number(height ?? 0);
  const center = left + Number(width ?? 0) / 2;
  /*
   * 막대의 위 끝(음수 막대면 0 선) 바로 위에 적는다. recharts 는 음수 막대의 높이를 음수로 줄 수
   * 있어 둘 중 작은 쪽을 잡는다. 음수를 아래 끝 밑에 적으면 작은 음수가 X축 이름과 겹친다 --
   * 부호가 이미 음수임을 말한다.
   */
  const anchorY = Math.min(top, top + barHeight) - 4;
  return vertical ? (
    <text
      x={center}
      y={anchorY}
      transform={`rotate(-90 ${center} ${anchorY})`}
      textAnchor="start"
      dominantBaseline="central"
      fontSize={10}
      fill="#4b5563"
    >
      {text}
    </text>
  ) : (
    <text x={center} y={anchorY} textAnchor="middle" fontSize={11} fill="#4b5563">
      {text}
    </text>
  );
}

/** 막대가 이보다 많으면 금액을 세워 적는다. 웹 패널은 넓어 열둘까지는 눕혀도 겹치지 않는다. */
const VERTICAL_LABEL_FROM = 13;

/** 금액 막대. 12개월 추이와 요일별·시간대별 평균이 함께 쓴다. */
export function AmountBarChart({
  data,
  currency,
  tooltipName,
  interval,
  signed = false,
}: {
  data: BarPoint[];
  currency: string;
  tooltipName: string;
  /** X축 이름을 몇 칸 걸러 적을지. 0 이면 다 적는다. 비우면 recharts 가 겹치지 않게 고른다. */
  interval?: number;
  /** 부호로 색을 가른다 -- 0 이상은 초록, 음수는 빨강 (순수입). 비우면 모두 기본 파랑. */
  signed?: boolean;
}) {
  const domain = barDomain(data.map((d) => d.amount));
  const vertical = data.length >= VERTICAL_LABEL_FROM;
  return (
    <ResponsiveContainer width="100%" height={300}>
      {/* 세운 금액은 가장 높은 막대 위로 삐져나온다. 그만큼 위를 띄운다. */}
      <BarChart data={data} margin={{ ...CHART_MARGIN, top: vertical ? 40 : 20 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" tick={CHART_TICK} interval={interval} />
        <YAxis
          domain={domain}
          /* 눈금은 앱 막대와 같은 간격으로 직접 준다. recharts 가 고르면 0 아래로 연 축에서 간격이 고르지 않다. */
          ticks={barTicks(domain[0], domain[1])}
          tickFormatter={(value: number) => formatAxisAmount(value, currency)}
          tick={CHART_TICK}
          width={CHART_Y_AXIS_WIDTH}
        />
        <Tooltip
          formatter={(value: any) => formatTooltipAmount(value, tooltipName, currency)}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Bar dataKey="amount" fill={CHART_COLOR} radius={CHART_BAR_RADIUS}>
          {signed
            ? data.map((point, index) => <Cell key={`bar-${index}`} fill={signedBarColor(point.amount)} />)
            : null}
          <LabelList
            dataKey="amount"
            content={(props: any) => (
              <BarValueLabel {...props} currency={currency} vertical={vertical} />
            )}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * 분류 하나(또는 그 유형 전체)의 상세.
 *
 * 무엇을 받아 무엇을 그릴지는 core 의 useCategoryDetail 이 정한다. 앱의 분류 상세
 * 화면이 같은 훅을 쓰므로, 같은 분류를 누르면 두 화면이 같은 값을 말한다. 여기
 * 있는 것은 recharts 로 그리는 일뿐이다.
 */
export function BudgetDetailModal({
  isOpen,
  onClose,
  categoryId,
  categoryName,
  categories = [],
  isInline = false,
  period,
  exactCategory = false,
  projectId,
  filter,
  onEntryClick,
  reloadToken,
  trendClip,
  trendPeriod,
  onPickCategory,
  onPickMethod,
}: BudgetDetailModalProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  /**
   * 요일·시간대 막대를 평균으로 볼지 누적(합계)으로 볼지. 그래프마다 따로 고른다
   * (2026-10-08 사용자 요청 -- 한쪽을 바꾸면 다른 쪽까지 바뀌어 헷갈렸다).
   */
  const [weekdayMode, setWeekdayMode] = useState<PatternMode>('average');
  const [hourMode, setHourMode] = useState<PatternMode>('average');
  const isTotalWeekday = weekdayMode === 'total';
  const isTotalHour = hourMode === 'total';

  const detail = useCategoryDetail({
    categoryId,
    categories,
    period,
    exactCategory,
    projectId,
    filter,
    reloadToken,
    // 닫혀 있는 팝업은 받지 않는다. 인라인으로 쓸 때는 늘 보이는 자리다.
    enabled: isOpen,
    trendClip,
    trendPeriod,
  });

  /** 거래내역에서 세는 세 그래프가 비었을 때의 안내. 일별 누적과 같은 말을 쓴다. */
  const emptyPattern = t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod);

  const content = (
    <div className="space-y-8 p-4">
      {detail.isLoading ? (
        <div className="text-center text-gray-500">{t('detail.loading')}</div>
      ) : (
        <>
          {/* 원형차트: 조각이 있는 것만 온다. 태그는 지출과 수입이 하나씩이다. */}
          {detail.pies.map((pie) => (
            <div key={pie.key}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{t(pie.title)}</h3>
                {pie.drilledId && (
                  <button
                    onClick={pie.resetDrill}
                    className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    {t('detail.back')}
                  </button>
                )}
              </div>
              <SlicePieChart
                slices={pie.slices}
                currency={displayCurrency}
                /* 한 단 더 내려간 뒤나 소분류를 펼친 원형은 쪼갤 것이 없다. 그때는 누를 수 없는 그림이다. */
                onDrill={pie.drilledId || pie.isFlat ? undefined : pie.drill}
                onPick={
                  onPickCategory
                    ? (slice) => {
                        const pickId = slice.pickId ?? slice.id;
                        if (pickId) onPickCategory(pickId);
                      }
                    : undefined
                }
              />
            </div>
          ))}

          {/*
            수단별. 분류별 구성비 바로 아래에 둔다 -- 두 원형이 "어디에 썼나"와 "무엇으로
            냈나"를 나란히 말한다. 아래 거래내역에서 센다.
          */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.method)}</h3>
            {detail.hasPatternAmount ? (
              /* 수단은 분류가 아니라 더 내려갈 곳이 없다. 누를 수 없는 그림이다. */
              <SlicePieChart
                slices={detail.pattern.methods}
                currency={displayCurrency}
                onPick={onPickMethod}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {emptyPattern}
              </p>
            )}
          </div>

          {/* 일별 누적. 구성비 둘 다음에 이 구간의 흐름을 본다. */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.daily)}</h3>
            {detail.hasDailyAmount ? (
              <DailyCumulativeChart
                current={detail.daily}
                comparisons={detail.comparisons}
                currentName={detail.currentMonthName}
                currentPeriodKey={detail.currentPeriodKey}
                throughDay={detail.throughDay}
                tooltipName={t(detail.labels.cumulative)}
                height={300}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod)}
              </p>
            )}
          </div>

          {/* 12개월 바차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.monthly)}</h3>
            {detail.hasMonthlyAmount ? (
              <AmountBarChart
                data={detail.monthly}
                currency={displayCurrency}
                tooltipName={t(detail.labels.amount)}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noYear)}
              </p>
            )}
          </div>

          {/* 요일·시간대. 둘 다 아래 거래내역에서 센다. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">
                {t(isTotalWeekday ? detail.labels.weekdayTotal : detail.labels.weekday)}
              </h3>
              <PatternModeToggle mode={weekdayMode} onChange={setWeekdayMode} />
            </div>
            <p className="mb-4 text-xs text-gray-500">
              {t(isTotalWeekday ? 'detail.weekdayTotalNote' : 'detail.weekdayNote')}
            </p>
            {detail.hasPatternAmount ? (
              <AmountBarChart
                data={isTotalWeekday ? detail.pattern.weekdayTotal : detail.pattern.weekday}
                currency={displayCurrency}
                tooltipName={t(isTotalWeekday ? 'detail.patternTotal' : 'detail.dailyAverage')}
                interval={0}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {emptyPattern}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">
                {t(isTotalHour ? detail.labels.hourTotal : detail.labels.hour)}
              </h3>
              <PatternModeToggle mode={hourMode} onChange={setHourMode} />
            </div>
            <p className="mb-4 text-xs text-gray-500">
              {t(isTotalHour ? 'detail.hourTotalNote' : 'detail.hourNote')}
              {detail.pattern.untimedCount > 0 &&
                ` ${t('detail.hourUntimed', { count: detail.pattern.untimedCount })}`}
            </p>
            {detail.pattern.hasTimedAmount ? (
              <AmountBarChart
                data={isTotalHour ? detail.pattern.hourTotal : detail.pattern.hour}
                currency={displayCurrency}
                tooltipName={t(isTotalHour ? 'detail.patternTotal' : 'detail.dailyAverage')}
                /* 스물넷을 다 적으면 좁은 패널에서 겹친다. 0·3·6…시만 적는다. */
                interval={2}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {detail.hasPatternAmount ? t('detail.noHourUsage') : emptyPattern}
              </p>
            )}
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('detail.entries')}</h3>
            {detail.entries.length === 0 ? (
              <p className="text-gray-500 text-sm">{t(detail.isOffline ? 'online.viewOnlyOnline' : 'detail.noEntries')}</p>
            ) : (
              <TransactionListView
                entries={detail.entries}
                onEntryClick={onEntryClick ?? (() => undefined)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );

  if (isInline) {
    return content;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('category.detailTitle', { name: categoryName })}
      wide
    >
      {content}
    </Modal>
  );
}
