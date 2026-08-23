'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { apiClient, type ReportPeriod } from '@/lib/api-client';
import { formatCurrency, toNumber } from '@/lib/money';
import { buildDailyCumulative, monthDateKeys } from '@/lib/entries';
import { dayRangeQuery } from '@/lib/datetime';
import {
  CHART_ACTIVE_DOT,
  CHART_COLOR,
  CHART_DOT,
  CHART_GRID,
  CHART_MARGIN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  barDomain,
  formatAxisAmount,
  formatTooltipAmount,
  lineAxis,
} from '@/lib/chart';
import type { EntryFilterQuery } from '@money/types';
import { useProjectTimeZone } from '@/store/project';

/** 서버가 계산해 주는 결제수단별 지출과 통장 수입 (/reports/payment-methods) */
interface PaymentMethodItem {
  kind: 'account' | 'debit_card' | 'credit_card';
  id: string;
  name: string;
  ownerName: string | null;
  /** 이 수단으로 나간 지출 */
  amount: string;
  count: number;
  /** 이 통장으로 들어온 수입. 카드는 언제나 "0"이다. */
  income: string;
}

interface Props {
  /**
   * 볼 구간. 한 달(`{ yearMonth }`)이거나 임의 기간(`{ startDate, endDate }`)이다.
   *
   * 합계·거래·일별 누적이 전부 이 구간을 쓴다. 오른쪽 "월별 사용 금액"만 구간의
   * 마지막 달을 끝으로 하는 12개월 추이라, 구간 밖의 달도 함께 보여 준다.
   */
  period: ReportPeriod;
  projectId?: string | null;
  /** 가계 화면의 사람/고정 필터. 합계와 목록이 같은 조건을 써야 한다. */
  filter?: EntryFilterQuery;
  /** 거래를 누르면 호출한다. 날짜별 보기와 같은 상세 팝업을 열기 위한 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 데이터를 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
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

export default function PaymentMethodTab({
  period,
  projectId,
  filter,
  onEntryClick,
  reloadToken,
}: Props) {
  const timeZone = useProjectTimeZone();

  /*
   * 구간을 세 형태로 쓴다.
   *   dayKeys  : 일별 누적 그래프의 x축 (달력 날짜)
   *   range    : 거래 목록 조회 (인스턴트)
   *   endMonth : 12개월 추이의 마지막 달
   * 하나만 어긋나도 같은 화면 안에서 숫자가 서로 다른 구간을 가리킨다.
   */
  const dayKeys = period.yearMonth
    ? monthDateKeys(Number(period.yearMonth.slice(0, 4)), Number(period.yearMonth.slice(5, 7)))
    : { startKey: period.startDate!, endKey: period.endDate! };
  const range = dayRangeQuery(dayKeys.startKey, dayKeys.endKey, timeZone);
  const endMonth = dayKeys.endKey.slice(0, 7);
  /** 구간이 바뀌었는지 판단할 값. 객체는 렌더마다 새로 만들어진다. */
  const periodKey = `${dayKeys.startKey}~${dayKeys.endKey}`;

  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [selected, setSelected] = useState<PaymentMethodItem | null>(null);
  const [monthlyData, setMonthlyData] = useState<Array<{ month: string; amount: number }>>([]);
  const [dailyData, setDailyData] = useState<Array<{ label: string; amount: number; cumulative: number }>>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);

  // 결제수단별 합계는 서버가 계산한다. 거래 전량을 받아 분류하던 코드를 대체했다.
  useEffect(() => {
    let cancelled = false;

    apiClient
      .getPaymentMethods(period, projectId, filter)
      .then((res) => {
        if (cancelled) return;
        setMethods((res ?? []) as PaymentMethodItem[]);
      })
      .catch((error) => {
        console.error('결제수단별 지출을 불러오지 못했습니다:', error);
        if (!cancelled) setMethods([]);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, projectId, filter, reloadToken]);

  // 구간이나 필터가 바뀌면 선택을 비운다. 이전 구간의 상세가 남아 있으면 잘못된 값을 보게 된다.
  // reloadToken은 여기에 넣지 않는다. 거래를 고칠 때마다 고른 결제수단이 풀리면 불편하다.
  useEffect(() => {
    setSelected(null);
  }, [periodKey, projectId, filter]);

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
    // 구간 경계는 프로젝트 타임존 기준이다. 끝날 자정을 endDate로 주면
    // 시각이 붙은 그날 거래가 빠지므로 위에서 만든 range를 쓴다.
    const { startDate, endDate } = range;

    /*
     * 통장으로 들어온 수입.
     *
     * paymentAccountId는 "이 통장에서 돈이 나간 전표"라 음수 다리만 본다. 수입은
     * 들어오는 쪽이라 그 조건에 걸리지 않으므로 따로 받아 합친다. 원장 관점의
     * accountId + 수입 카테고리로 거르면 이 통장에 들어온 수입만 남는다.
     */
    const incomeQuery =
      selected.kind === 'account'
        ? apiClient.getAllEntries(
            {
              accountId: selected.id,
              categoryType: 'income' as const,
              startDate,
              endDate,
              ...filter,
            },
            projectId,
          )
        : Promise.resolve([] as EntryListItem[]);

    Promise.all([
      apiClient.getTrend(
        target,
        { targetId: selected.id, endMonth, months: 12, ...filter },
        projectId,
      ),
      // 커서를 끝까지 따라간다. 한 페이지만 받으면 아래 일별 누적이
      // 12개월 그래프(서버 집계, 전량)와 어긋난다.
      apiClient.getAllEntries(
        {
          // 왼쪽 집계와 같은 기준으로 뽑는다 (payment* 파라미터가 그 규칙을 담고 있다).
          ...(selected.kind === 'account'
            ? { paymentAccountId: selected.id }
            : { paymentCardId: selected.id }),
          // kind='expense'로 걸면 수수료가 붙은 이체가 빠진다. 집계에는 들어 있으므로 어긋난다.
          categoryType: 'expense',
          startDate,
          endDate,
          ...filter,
        },
        projectId,
      ),
      incomeQuery,
    ])
      .then(([trendRes, entriesRes, incomeRes]) => {
        if (cancelled) return;

        const trend = (trendRes ?? []) as Array<{ yearMonth: string; amount: string }>;
        setMonthlyData(
          trend.map((point) => ({
            month: `${Number(point.yearMonth.split('-')[1])}월`,
            amount: toNumber(point.amount),
          })),
        );

        const rows: EntryListItem[] = (entriesRes ?? []) as EntryListItem[];
        const incomeRows: EntryListItem[] = (incomeRes ?? []) as EntryListItem[];
        // 두 조회를 합치면 시간순이 깨진다. 목록은 최근 것이 위로 온다.
        setEntries(
          [...rows, ...incomeRows].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          ),
        );
        /*
          그래프는 지출만 쌓는다. 제목이 "사용 금액"이고 12개월 추이도 서버가 지출로
          집계하므로, 수입을 섞으면 두 그래프가 서로 다른 것을 그린다.
          buildDailyCumulative는 expenseAmountOf를 쓰므로 수입 건은 저절로 0이다.
        */
        setDailyData(buildDailyCumulative(rows, dayKeys.startKey, dayKeys.endKey, timeZone));
      })
      .catch((error) => {
        console.error('결제수단 상세를 불러오지 못했습니다:', error);
        if (cancelled) return;
        setMonthlyData([]);
        setDailyData([]);
        setEntries([]);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, periodKey, projectId, timeZone, filter, reloadToken]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {SECTIONS.map((section) => {
          const items = methods.filter((m) => m.kind === section.kind);
          if (items.length === 0) return null;
          const accent = ACCENT[section.accent];

          return (
            <div key={section.kind} className="bg-white rounded-lg shadow p-6">
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
                    {/*
                      통장은 돈이 나가는 곳이면서 들어오는 곳이다. 지출만 보여 주면
                      월급이 들어온 통장이 0원으로 보인다. 수입이 있을 때만 두 값에
                      이름을 붙인다. 카드에는 수입이 들어오지 않아 늘 지출 하나뿐이다.
                    */}
                    <div className="flex items-baseline gap-2">
                      <span className={`font-semibold text-sm ${accent.text}`}>
                        {toNumber(item.income) > 0 ? '지출 ' : ''}
                        {formatCurrency(item.amount)}
                      </span>
                      {toNumber(item.income) > 0 && (
                        <span className="text-sm font-semibold text-green-600">
                          수입 {formatCurrency(item.income)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lg:col-span-1">
        {selected ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-8">
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
                    domain={barDomain(monthlyData.map((d) => d.amount))}
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
                  <XAxis dataKey="label" tick={CHART_TICK} />
                  {/* 꺾은선은 값이 움직인 구간만 그린다 (lineAxis 주석 참고) */}
                  <YAxis
                    {...lineAxis(dailyData.map((d) => d.cumulative))}
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
                  <TransactionListView
                    entries={entries}
                    onEntryClick={onEntryClick ?? (() => undefined)}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-500">항목을 선택하여 상세 정보를 확인하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
