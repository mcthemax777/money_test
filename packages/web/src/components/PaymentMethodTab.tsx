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
import { useProjectDisplayCurrency, useProjectTimeZone } from '@/store/project';
import type { Account, Card } from '@/lib/types';
import Modal from './Modal';
import CardSettlementPanel from './CardSettlementPanel';

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
  /** 실적 기준액 (표시 통화). 카드에 조건이 없으면 없다. */
  performanceTarget?: string;
  /** 신용카드 마감일. 31이면 청구 주기가 달력 월과 같다. */
  statementClosingDay?: number;
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
  /** 카드 목록. 정산 팝업이 결제 통장을 찾는 데 쓴다. */
  cards?: Card[];
  /** 통장 목록. 결제 통장의 주인을 찾는 데 쓴다 (대금 전표에 사람을 단다). */
  accounts?: Account[];
  /** 정산으로 대금을 기록한 뒤. 부모가 합계와 목록을 다시 읽는다. */
  onCardChange?: () => void;
}

/**
 * 왼쪽 목록의 탭.
 *
 * 분류별 화면의 지출/수입 탭과 같은 모양이다. 예전에는 세 덩어리를 세로로 쌓아서
 * 카드가 많은 프로젝트에서는 계좌 결제를 보려면 한참 내려야 했다.
 *
 * 신용카드를 먼저 둔다. 정산과 실적이 걸려 있어 가장 자주 들여다보는 수단이다.
 */
const SECTIONS = [
  { kind: 'credit_card' as const, icon: '💳', title: '신용카드', accent: 'red', empty: '신용카드가 없습니다.' },
  { kind: 'debit_card' as const, icon: '🏧', title: '체크카드', accent: 'green', empty: '체크카드가 없습니다.' },
  { kind: 'account' as const, icon: '💰', title: '계좌 결제', accent: 'blue', empty: '통장이 없습니다.' },
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

/**
 * 실적 달성률을 이 화면의 숫자로 그릴 수 있는지.
 *
 * 실적은 한 주기에 쓴 금액으로 센다. 이 화면이 보여 주는 금액이 그 주기와 같을
 * 때만 나란히 둘 수 있다.
 *   - 기간 보기: 달이 아니라 임의 구간이라 주기와 맞출 수 없다
 *   - 신용카드: 마감일이 말일(31)일 때만 청구 주기가 달력 월과 같다
 *   - 체크카드: 청구 주기가 없어 언제나 달력 월로 센다
 *
 * 맞출 수 없을 때 어림값을 그리지 않는다. 15일 마감 카드에 달력 월 사용액으로
 * 달성률을 그리면 두 주기가 절반씩 어긋난 숫자가 그럴듯하게 보인다.
 */
function canShowPerformance(item: PaymentMethodItem, isMonthView: boolean): boolean {
  if (!isMonthView) return false;
  if (item.kind === 'credit_card') return item.statementClosingDay === 31;
  return item.kind === 'debit_card';
}

/**
 * 한 수단의 실적 진행 상황.
 *
 * 기준액이 없는 카드와 통장은 null이다. 셀 수 없는 구간이면 기준액만 담아
 * 돌려준다(`countable: false`). 목록과 상세가 같은 값을 보여 줘야 해서 한 곳에서 만든다.
 */
function performanceOf(item: PaymentMethodItem, isMonthView: boolean) {
  const target = toNumber(item.performanceTarget);
  if (target <= 0) return null;

  if (!canShowPerformance(item, isMonthView)) return { target, countable: false } as const;

  const usage = toNumber(item.amount);
  const ratio = (usage / target) * 100;

  return {
    target,
    countable: true,
    usage,
    achieved: usage >= target,
    remaining: Math.max(target - usage, 0),
    percent: Math.floor(ratio),
    // 기준을 넘겨도 막대는 100%에서 멈춘다. 사용액이 음수인 구간(취소가 더 많은
    // 달)도 있어 아래도 0에서 자른다. 음수 너비는 레이아웃만 흔든다.
    progress: Math.min(Math.max(ratio, 0), 100),
  } as const;
}

export default function PaymentMethodTab({
  period,
  projectId,
  filter,
  onEntryClick,
  reloadToken,
  cards = [],
  accounts = [],
  onCardChange,
}: Props) {
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

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
  /** 왼쪽 목록에서 보고 있는 수단 종류. 신용카드부터 본다. */
  const [kind, setKind] = useState<PaymentMethodItem['kind']>('credit_card');
  const [selected, setSelected] = useState<PaymentMethodItem | null>(null);
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
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

  // 탭을 옮기면 선택을 비운다. 목록에 없는 항목의 상세가 오른쪽에 남으면
  // 무엇을 보고 있는지 알 수 없다.
  useEffect(() => {
    setSelected(null);
  }, [kind]);

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

  const section = SECTIONS.find((item) => item.kind === kind)!;
  const accent = ACCENT[section.accent];
  const visibleItems = methods.filter((item) => item.kind === kind);

  /** 고른 카드의 원본. 정산 팝업이 결제 통장과 마감일을 여기서 읽는다. */
  const selectedCard =
    selected && selected.kind !== 'account'
      ? cards.find((card) => card.id === selected.id)
      : undefined;

  /*
   * 실적 달성률.
   *
   * 왼쪽 목록의 사용액을 그대로 쓴다. 서버에서 따로 받아 오면 그쪽은 "지금 주기"의
   * 값이라, 지난 달을 보고 있을 때 화면의 다른 숫자와 어긋난다.
   */
  const isMonthView = Boolean(period.yearMonth);
  const performance = selected ? performanceOf(selected, isMonthView) : null;

  /**
   * 목록 한 줄에 붙는 실적 줄. 분류별 화면의 예산 진행률과 같은 자리다.
   *
   * 눌러야 보이면 카드가 여럿일 때 어느 카드가 실적에 가까운지 하나씩 눌러 봐야
   * 알 수 있다. 목록에서 한눈에 훑을 수 있어야 한다.
   */
  const performanceLine = (item: PaymentMethodItem) => {
    const progress = performanceOf(item, isMonthView);
    if (!progress) return null;

    // 셀 수 없는 구간에서도 기준액은 알려 준다. 얼마짜리 조건인지는 구간과 무관하다.
    if (!progress.countable) {
      return (
        <p className="mt-1 text-xs text-gray-500">
          실적 {formatCurrency(progress.target, displayCurrency)} · 자산 화면에서 확인
        </p>
      );
    }

    return (
      <div className="mt-1 flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${progress.achieved ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${progress.progress}%` }}
          />
        </div>
        <span
          className={`text-xs shrink-0 ${
            progress.achieved ? 'text-emerald-600' : 'text-gray-500'
          }`}
        >
          실적 {formatCurrency(progress.target, displayCurrency)} · {progress.percent}%
          {progress.achieved
            ? ' · 달성'
            : ` · ${formatCurrency(progress.remaining, displayCurrency)} 남음`}
        </span>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="lg:col-span-1 bg-white rounded-lg shadow p-6">
        <div className="flex gap-4 border-b mb-4">
          {SECTIONS.map((section) => (
            <button
              key={section.kind}
              onClick={() => setKind(section.kind)}
              className={`px-3 py-2 font-medium transition ${
                kind === section.kind
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <span className="mr-1">{section.icon}</span>
              {section.title}
            </button>
          ))}
        </div>

        {/*
          비어 있어도 탭은 남긴다. 항목이 없는 탭을 감추면 카드를 처음 만들 때마다
          탭 줄이 움직여서 어디를 누르던 중이었는지 놓친다.
        */}
        {visibleItems.length === 0 ? (
          <p className="text-gray-600">{section.empty}</p>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected(item)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  selected?.id === item.id ? accent.selected : accent.idle
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
                    {formatCurrency(item.amount, displayCurrency)}
                  </span>
                  {toNumber(item.income) > 0 && (
                    <span className="text-sm font-semibold text-green-600">
                      수입 {formatCurrency(item.income, displayCurrency)}
                    </span>
                  )}
                </div>
                {performanceLine(item)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-1">
        {selected ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{selected.name}</h3>
                <p className="text-sm text-gray-500">{selected.ownerName ?? '미정'}</p>
              </div>
              {/*
                신용카드만 정산할 것이 있다. 체크카드는 결제 즉시 통장에서 빠지고
                통장에는 갚을 대금이라는 개념이 없다.
              */}
              {selected.kind === 'credit_card' && selectedCard && (
                <button
                  onClick={() => setIsSettlementOpen(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 whitespace-nowrap"
                >
                  정산하기
                </button>
              )}
            </div>

            {/*
              실적 진행 상황.

              카드사가 혜택을 주는 기준이라 "얼마 남았나"가 알고 싶은 값이다.
              기준액을 설정하지 않은 카드에는 아무것도 그리지 않는다.
            */}
            {performance && !performance.countable && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                {isMonthView
                  ? '이 카드는 마감일 기준 청구 주기로 실적을 셉니다. 달력 월 사용액과 구간이 달라 여기서는 달성률을 보여 주지 않습니다. 자산 화면에서 카드를 눌러 확인하세요.'
                  : '실적은 달 단위로 셉니다. 기간 보기에서는 달성률을 보여 주지 않습니다. 자산 화면에서 카드를 눌러 확인하세요.'}
              </p>
            )}
            {performance?.countable && (
              <div
                className={`rounded-lg p-4 space-y-2 ${
                  performance.achieved ? 'bg-emerald-50' : 'bg-amber-50'
                }`}
              >
                <div className="flex justify-between items-baseline gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      performance.achieved ? 'text-emerald-700' : 'text-amber-800'
                    }`}
                  >
                    {performance.achieved
                      ? '실적 달성'
                      : `실적까지 ${formatCurrency(performance.remaining, displayCurrency)}`}
                  </span>
                  <span className="text-sm text-gray-700 tabular-nums">
                    {formatCurrency(performance.usage, displayCurrency)} /{' '}
                    {formatCurrency(performance.target, displayCurrency)}
                  </span>
                </div>
                <div className="h-2 bg-white rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      performance.achieved ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${performance.progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600">
                  이 달({period.yearMonth}) 사용액 기준입니다.
                </p>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">월별 사용 금액</h4>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData} margin={CHART_MARGIN}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="month" tick={CHART_TICK} />
                  <YAxis
                    domain={barDomain(monthlyData.map((d) => d.amount))}
                    tickFormatter={(value: number) => formatAxisAmount(value, displayCurrency)}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) => formatTooltipAmount(value, '사용액', displayCurrency)}
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
                    {...lineAxis(dailyData.map((d) => d.cumulative), displayCurrency)}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) => formatTooltipAmount(value, '누적 사용액', displayCurrency)}
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

      {/*
        정산.

        자산 화면의 카드 상세와 같은 컴포넌트를 쓴다. 남은 대금을 보려고 화면을
        옮겼다가 돌아오지 않아도 되게 하려는 것이므로, 내용이 그쪽과 달라지면 안 된다.
      */}
      {isSettlementOpen && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => setIsSettlementOpen(false)}
          title={`${selectedCard.name} 정산`}
        >
          <CardSettlementPanel
            card={selectedCard}
            paymentAccountOwnerId={
              accounts.find((account) => account.id === selectedCard.paymentAccountId)?.ownerId
            }
            reloadToken={reloadToken}
            onChange={onCardChange}
          />
        </Modal>
      )}
    </div>
  );
}
