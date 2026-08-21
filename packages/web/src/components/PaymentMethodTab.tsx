'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { apiClient } from '@/lib/api-client';
import { formatCurrency, toNumber } from '@/lib/money';
import { buildDailyCumulative } from '@/lib/entries';
import { monthQueryRange } from '@/lib/datetime';
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
  formatDayTick,
  formatTooltipAmount,
} from '@/lib/chart';
import type { EntryFilterQuery } from '@money/types';
import { useProjectTimeZone } from '@/store/project';

/** 서버가 계산해 주는 결제수단별 지출 (/reports/payment-methods) */
interface PaymentMethodItem {
  kind: 'account' | 'debit_card' | 'credit_card';
  id: string;
  name: string;
  ownerName: string | null;
  amount: string;
  count: number;
}

interface Props {
  currentMonth?: number;
  currentYear?: number;
  projectId?: string | null;
  /** 가계 화면의 사람/고정 필터. 합계와 목록이 같은 조건을 써야 한다. */
  filter?: EntryFilterQuery;
}

const SECTIONS = [
  { kind: 'account' as const, icon: '💰', title: '계좌 결제', accent: 'blue' },
  { kind: 'debit_card' as const, icon: '🏧', title: '체크카드', accent: 'green' },
  { kind: 'credit_card' as const, icon: '💳', title: '신용카드', accent: 'red' },
];

const ACCENT: Record<string, { selected: string; idle: string; text: string }> = {
  blue: {
    selected: 'bg-blue-100 border-2 border-blue-500',
    idle: 'bg-blue-50 border border-blue-200 hover:bg-blue-100',
    text: 'text-blue-600',
  },
  green: {
    selected: 'bg-green-100 border-2 border-green-500',
    idle: 'bg-green-50 border border-green-200 hover:bg-green-100',
    text: 'text-green-600',
  },
  red: {
    selected: 'bg-red-100 border-2 border-red-500',
    idle: 'bg-red-50 border border-red-200 hover:bg-red-100',
    text: 'text-red-600',
  },
};

/** 값이 전부 0이면 recharts가 축을 못 그린다. 기본 상한을 준다. */
function axisMax(values: number[]) {
  const max = Math.max(0, ...values);
  return max > 0 ? Math.ceil((max * 1.2) / 100) * 100 : 1000;
}

export default function PaymentMethodTab({
  currentMonth: propMonth,
  currentYear: propYear,
  projectId,
  filter,
}: Props) {
  const timeZone = useProjectTimeZone();
  const now = new Date();
  const currentMonth = propMonth ?? now.getMonth() + 1;
  const currentYear = propYear ?? now.getFullYear();
  const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [selected, setSelected] = useState<PaymentMethodItem | null>(null);
  const [monthlyData, setMonthlyData] = useState<Array<{ month: string; amount: number }>>([]);
  const [dailyData, setDailyData] = useState<Array<{ day: number; amount: number; cumulative: number }>>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);

  // 결제수단별 합계는 서버가 계산한다. 거래 전량을 받아 분류하던 코드를 대체했다.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .getPaymentMethods(yearMonth, projectId, filter)
      .then((res) => {
        if (cancelled) return;
        setMethods((res ?? []) as PaymentMethodItem[]);
      })
      .catch((error) => {
        console.error('결제수단별 지출을 불러오지 못했습니다:', error);
        if (!cancelled) setMethods([]);
      });

    // 달이 바뀌면 선택을 비운다. 이전 달 상세가 남아 있으면 잘못된 값을 보게 된다.
    setSelected(null);
    return () => { cancelled = true; };
  }, [yearMonth, projectId, filter]);

  // 선택한 결제수단의 12개월 추이와 이 달 거래
  useEffect(() => {
    if (!selected) {
      setMonthlyData([]);
      setDailyData([]);
      setEntries([]);
      return;
    }

    let cancelled = false;
    const target = selected.kind === 'account' ? 'account' : 'card';
    // 월 경계는 프로젝트 타임존 기준이다. 말일 자정을 endDate로 주면
    // 시각이 붙은 말일 거래가 빠지므로 monthQueryRange를 쓴다.
    const { startDate, endDate } = monthQueryRange(currentYear, currentMonth, timeZone);

    Promise.all([
      apiClient.getTrend(
        target,
        { targetId: selected.id, endMonth: yearMonth, months: 12, ...filter },
        projectId,
      ),
      apiClient.getEntries(
        {
          // 왼쪽 집계와 같은 기준으로 뽑는다 (payment* 파라미터가 그 규칙을 담고 있다).
          ...(selected.kind === 'account'
            ? { paymentAccountId: selected.id }
            : { paymentCardId: selected.id }),
          // kind='expense'로 걸면 수수료가 붙은 이체가 빠진다. 집계에는 들어 있으므로 어긋난다.
          categoryType: 'expense',
          startDate,
          endDate,
          limit: 200,
          ...filter,
        },
        projectId,
      ),
    ])
      .then(([trendRes, entriesRes]) => {
        if (cancelled) return;

        const trend = (trendRes ?? []) as Array<{ yearMonth: string; amount: string }>;
        setMonthlyData(
          trend.map((point) => ({
            month: `${Number(point.yearMonth.split('-')[1])}월`,
            amount: toNumber(point.amount),
          })),
        );

        const rows: EntryListItem[] = entriesRes?.data ?? [];
        setEntries(rows);
        // 이체는 금액이 아니라 수수료만 쌓아야 한다 (buildDailyCumulative가 처리)
        setDailyData(buildDailyCumulative(rows, currentYear, currentMonth, timeZone));
      })
      .catch((error) => {
        console.error('결제수단 상세를 불러오지 못했습니다:', error);
        if (cancelled) return;
        setMonthlyData([]);
        setDailyData([]);
        setEntries([]);
      });

    return () => { cancelled = true; };
  }, [selected, yearMonth, currentYear, currentMonth, projectId, timeZone, filter]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {SECTIONS.map((section) => {
          const items = methods.filter((m) => m.kind === section.kind);
          if (items.length === 0) return null;
          const accent = ACCENT[section.accent];

          return (
            <div key={section.kind} className="bg-white rounded-lg border border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span>{section.icon}</span> {section.title}
              </h4>
              <div className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selected?.id === item.id && selected?.kind === item.kind
                        ? accent.selected
                        : accent.idle
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-gray-700 font-medium">{item.name}</span>
                      <span className="text-xs text-gray-500">{item.ownerName ?? '미정'}</span>
                    </div>
                    <span className={`font-semibold text-sm ${accent.text}`}>
                      {formatCurrency(item.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lg:col-span-1">
        {selected ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{selected.name}</h3>
              <p className="text-sm text-gray-500">{selected.ownerName ?? '미정'}</p>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">월별 사용 금액</h4>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData} margin={CHART_MARGIN}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="month" tick={CHART_TICK} />
                  <YAxis
                    domain={[0, axisMax(monthlyData.map((d) => d.amount))]}
                    tickFormatter={formatAxisAmount}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) => formatTooltipAmount(value, '사용액')}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Bar dataKey="amount" fill={CHART_COLOR} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">일별 누적 사용금액</h4>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dailyData} margin={CHART_MARGIN}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="day" tickFormatter={formatDayTick} tick={CHART_TICK} />
                  <YAxis
                    domain={[0, axisMax(dailyData.map((d) => d.cumulative))]}
                    tickFormatter={formatAxisAmount}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) => formatTooltipAmount(value, '누적 사용액')}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    stroke={CHART_COLOR}
                    strokeWidth={2}
                    dot={CHART_DOT}
                    activeDot={CHART_ACTIVE_DOT}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {entries.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-4">거래 기록</h4>
                <div className="max-h-96 overflow-y-auto">
                  <TransactionListView entries={entries} onEntryClick={() => undefined} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
            <p className="text-gray-500">항목을 선택하여 상세 정보를 확인하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
