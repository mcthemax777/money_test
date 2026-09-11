/**
 * 자산 추이 그래프의 속.
 *
 * 무엇을 받아 오고, 창을 어디에 놓고, 어느 칸을 그릴지를 정한다. 그리는 일(선·축·
 * 손가락 받기)은 플랫폼이 맡는다 -- 웹은 recharts, 앱은 react-native-svg 다.
 *
 * 예전에는 이 전부가 웹의 AssetHistoryChart 안에 있었다. 앱에 같은 그래프를 올리려면
 * 창을 세는 법과 다시 받는 규칙을 그대로 한 벌 더 적어야 했고, 그러면 한쪽만 고친
 * 날부터 두 화면이 다른 날짜를 그린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../lib/api-client';
import { lineAxis, type LineAxis } from '../lib/chart';
import {
  currentYearMonth,
  daysBetweenKeys,
  formatMonthShort,
  lastDayOfMonth,
  monthsBetween,
  shiftDateKey,
  shiftYearMonth,
  todayKey,
} from '../lib/datetime';
import { activeLocale, translate, type MessageKey } from '../lib/i18n';
import { toNumber } from '../lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '../store/project';

/** 직접 고르는 구간 단위. 드릴다운으로 들어간 일별 보기와는 별개다. */
export type Granularity = 'day' | 'month' | 'year';

export interface AssetHistoryPoint {
  label: string;
  balance: number;
  /**
   * 서버가 준 그대로의 날짜. 연이면 "YYYY", 월이면 "YYYY-MM", 일이면 "YYYY-MM-DD".
   *
   * 축에 적는 이름(label)은 언어에 따라 "8월"·"Aug" 로 달라져 되읽을 수 없다. 눌러서
   * 한 단 아래로 내려갈 때 어느 구간인지는 이 값으로 말한다.
   */
  date: string;
}

/**
 * 그래프 제목. 단위 이름만 적는다.
 *
 * 창의 크기(며칠·몇 달)는 적지 않는다. 끌어서 자리를 옮기는 그래프라 "최근 31일"은
 * 뒤로 끌고 나면 사실이 아니게 되고, 며칠치인가는 X축 눈금이 이미 말한다.
 */
export const HISTORY_TITLE_KEY: Record<Granularity, MessageKey> = {
  day: 'history.dayTitle',
  month: 'history.monthlyTitle',
  year: 'history.yearlyTitle',
};

export const GRANULARITY_OPTIONS: Array<{ value: Granularity; labelKey: MessageKey }> = [
  { value: 'day', labelKey: 'history.day' as const },
  { value: 'month', labelKey: 'history.month' as const },
  { value: 'year', labelKey: 'history.year' as const },
];

/**
 * 단위별 창 크기.
 *
 * 일별은 서른하루다. 달을 눌러 일별로 갈 때 어느 달이든 1일부터 말일까지가 한 창에
 * 다 들어와야 해서, 가장 긴 달에 맞춘다 -- 서른 날로 두면 서른하루인 달만 첫날이
 * 밀려나, 달마다 보이는 범위가 달라진다.
 */
const RECENT_DAYS = 31;
const MONTHS = 12;
const YEARS = 5;

/** 한 화면에 그리는 구간 수. 끌어도 이 개수는 그대로고 창이 놓인 자리만 옮긴다. */
export const WINDOW_SIZE: Record<Granularity, number> = {
  day: RECENT_DAYS,
  month: MONTHS,
  year: YEARS,
};

/**
 * 받아 두는 배수. 창 하나 크기를 앞뒤로 더 받아 세 배를 들고 있는다.
 *
 * 한 칸 옮길 때마다 서버에 물으면 한 번 끄는 동안 수십 번을 묻게 되고, 답이 올 때까지
 * 선이 멈춰 있어 손을 따라오지 않는다. 넉넉히 받아 두고 그 안에서는 잘라 쓰다가,
 * 받아 둔 끝에 닿을 때만 다시 묻는다. 그때도 창을 한가운데 놓고 받으므로 양쪽으로
 * 창 하나만큼 더 끌 여유가 남는다.
 *
 * 서버의 상한(일 366, 월 60, 연 30)을 넘지 않는 배수다.
 */
const FETCH_MULTIPLE = 3;

/**
 * 갈 수 있는 끝. 뒤로도 앞으로도 단위마다 대략 10년이다.
 *
 * 앞날도 그린다. 앞으로 나갈 거래를 미리 적어 둘 수 있고(반복 등록, 날짜를 앞당겨
 * 적은 거래), 그러면 그 날의 잔액도 이미 정해져 있다 -- 오늘에서 선을 끊으면 적어 둔
 * 것이 그래프에 영영 나오지 않는다.
 *
 * 그 너머는 양쪽 다 평평한 선뿐이라 돌아오는 길만 멀어진다.
 */
const PAN_LIMIT: Record<Granularity, number> = { day: 3650, month: 120, year: 10 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface AssetHistoryInput {
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

export interface AssetHistory {
  granularity: Granularity;
  /** 단위를 직접 고른다. 그 단위의 가장 최근 창으로 나간다. */
  selectGranularity: (value: Granularity) => void;
  /** 창이 지금에서 몇 칸 떨어져 있는지. 0이면 오늘로 끝나는 창이다. */
  offset: number;
  /** 창을 지금으로 되돌린다. */
  resetWindow: () => void;
  /**
   * 끌기. 누를 때의 자리에서 몇 칸 옮길지를 준다.
   *
   * 끄는 동안의 기준은 손을 댄 순간의 offset 이다. 지금 값에 더해 가면 한 번의 끌기
   * 안에서 오차가 쌓인다.
   */
  panFrom: (startOffset: number, steps: number) => void;
  /** 한 창에 그리는 칸 수. 한 칸의 폭을 재는 쪽이 쓴다. */
  span: number;
  points: AssetHistoryPoint[];
  isLoading: boolean;
  error: string;
  /** 값이 전부 0인가. 축이 [0,0]으로 납작해지는 경우를 부르는 쪽이 가른다. */
  hasAnyValue: boolean;
  yAxis: LineAxis;
  /** 선이 끝나는 점. 여기에만 점을 찍고 금액을 적는다. */
  lastPoint: AssetHistoryPoint | null;
  /** 연별은 월별로, 월별은 일별로 내려간다. 일별 아래에는 내려갈 곳이 없다. */
  canDrill: boolean;
  /** 그 칸을 눌러 한 단 아래로 내려간다. 일별에서는 아무 일도 하지 않는다. */
  drillInto: (date: string) => void;
  titleKey: MessageKey;
}

export function useAssetHistory({
  accountId,
  ownerId,
  ownerIds,
  projectId,
  endMonth,
}: AssetHistoryInput): AssetHistory {
  const displayCurrency = useProjectDisplayCurrency();
  const timeZone = useProjectTimeZone();
  const [granularity, setGranularity] = useState<Granularity>('month');
  /**
   * 창이 지금에서 몇 칸 떨어져 있는지. 0이면 오늘(이번 달, 올해)로 끝나는 창이다.
   *
   * 그래프를 오른쪽으로 끌면 커지고(지난 날짜), 왼쪽으로 끌면 작아진다. **음수면
   * 앞날이다** -- 적어 둔 앞으로의 거래까지 보러 갈 수 있다.
   */
  const [offset, setOffset] = useState(0);
  /**
   * 받아 둔 구간과 그 **마지막 칸이 놓인 자리**(endOffset).
   *
   * 둘을 한 덩어리로 두는 것은 자리를 모르면 배열의 어디를 잘라야 할지 알 수 없기
   * 때문이다. 따로 두면 다시 받는 동안 새 자리로 옛 배열을 자르게 되어, 한순간
   * 엉뚱한 날짜가 그려진다.
   */
  const [series, setSeries] = useState<{ endOffset: number; points: AssetHistoryPoint[] }>({
    endOffset: 0,
    points: [],
  });
  /**
   * 받아 둔 구간이 감싸는 한가운데. 창이 여기서 창 하나보다 멀어지면 다시 받는다.
   *
   * 창을 한가운데 두고 받으므로 받아 둔 구간은 앞뒤로 창 하나씩을 더 덮는다. 그래서
   * 처음 그린 자리(0)에서 지난 날짜로도, 앞날로도 곧바로 끌 수 있다 -- 어느 쪽으로
   * 끌든 첫 칸부터 서버를 기다리면 손이 멈춘 것처럼 보인다.
   */
  const [anchor, setAnchor] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /*
   * 의존성으로 쓸 자산주인 키.
   *
   * 배열은 렌더마다 새 참조라 그대로 의존성에 넣으면 값이 같아도 매번 다시 부른다.
   * 서버로 넘길 모양과 같은 쉼표 문자열로 굳힌다. null이면 전체다.
   */
  const ownerKey = ownerIds === undefined ? null : ownerIds.join(',');

  /**
   * 창의 자리를 세는 기준 달 "YYYY-MM". 부르는 쪽이 정해 주면 그 달, 아니면 이번 달이다.
   *
   * 월·연 단위의 offset 은 이 달에서 몇 칸 뒤인지를 뜻한다. 서버로 보낼 endMonth 도,
   * 연도를 눌러 월별로 내려갈 때의 자리도 같은 기준에서 세야 서로 어긋나지 않는다.
   */
  const baseMonth = (() => {
    if (endMonth) return endMonth;
    const { year, month } = currentYearMonth(timeZone);
    return `${year}-${String(month).padStart(2, '0')}`;
  })();

  const span = WINDOW_SIZE[granularity];
  /** 한 번에 받아 두는 구간 수. 창의 세 배다. */
  const fetchSpan = span * FETCH_MULTIPLE;
  /** 받아 둔 구간의 끝에서 창 하나만큼 뒤까지가 여유다. */
  const pad = span;

  /** 창을 지금으로 되돌린다. 보는 대상이나 단위가 바뀌면 옛 자리는 뜻이 없다. */
  const resetWindow = useCallback(() => {
    setOffset(0);
    setAnchor(0);
  }, []);

  // 보는 대상이 바뀌면 옛 자리에 머물러 있을 이유가 없다. 창을 지금으로 되돌린다.
  useEffect(() => {
    resetWindow();
  }, [accountId, ownerId, ownerKey, projectId, resetWindow]);

  /** 단위를 직접 고르면 그 단위의 가장 최근 창으로 나간다. */
  const selectGranularity = useCallback(
    (value: Granularity) => {
      resetWindow();
      setGranularity(value);
    },
    [resetWindow],
  );

  /**
   * 월별에서 한 달을 눌렀을 때. 일별 그래프를 그 달에 갖다 댄다.
   *
   * 일별 창을 따로 띄우지 않는다. 단위를 일로 바꾸고 창의 끝을 그 달의 말일에 맞출
   * 뿐이라, 거기서 그대로 좌우로 끌어 앞뒤 날짜로 이어 갈 수 있다. 따로 띄우면 그
   * 창은 한 달에 못 박혀 있어 끌 수도, 이웃한 달로 넘어갈 수도 없었다.
   *
   * 창이 서른하루라 어느 달이든 1일부터 말일까지가 다 들어온다. 서른 날 이하인 달은
   * 앞선 달의 끝자락이 왼쪽에 몇 날 따라 붙는다 -- 창 크기는 늘 같아야 한다.
   *
   * 이번 달과 앞날의 달도 말일까지 그린다. 아직 오지 않은 날은 잔액이 그대로 이어지고,
   * 적어 둔 거래가 있으면 그날 선이 움직인다. 오늘에서 끊으면 적어 둔 것이 보이지 않는다.
   */
  const showMonthAsDays = useCallback(
    (yearMonth: string) => {
      const monthEnd = `${yearMonth}-${String(lastDayOfMonth(yearMonth)).padStart(2, '0')}`;
      // 앞날의 달이면 음수다. 창이 오늘보다 뒤에 선다.
      const next = daysBetweenKeys(monthEnd, todayKey(timeZone));

      setGranularity('day');
      setOffset(next);
      // 받아 둔 구간도 그 자리를 한가운데 삼는다. 달 단위로 세어 둔 옛 자리는 일 단위에서
      // 뜻이 다르므로 그대로 두면 엉뚱한 데를 받아 온다.
      setAnchor(next);
    },
    [timeZone],
  );

  /**
   * 연별에서 한 해를 눌렀을 때. 월별 그래프를 그 해에 갖다 댄다.
   *
   * 달을 눌러 일별로 가는 것과 같은 규칙이다. 창의 끝을 그 해의 12월에 맞추고, 창
   * 크기는 열두 달 그대로라 1월부터 12월까지가 한 창에 다 들어온다. 올해와 앞날의
   * 해도 12월까지 그린다 -- 아직 오지 않은 달에도 적어 둔 거래가 있을 수 있다.
   */
  const showYearAsMonths = useCallback(
    (year: string) => {
      // 앞날의 해면 음수다. 창이 이번 달보다 뒤에 선다.
      const next = monthsBetween(`${year}-12`, baseMonth);

      setGranularity('month');
      setOffset(next);
      // 받아 둔 구간도 그 자리를 한가운데 삼는다. 연 단위로 세어 둔 옛 자리는 월 단위에서
      // 뜻이 다르므로 그대로 두면 엉뚱한 데를 받아 온다.
      setAnchor(next);
    },
    [baseMonth],
  );

  /*
   * 창이 받아 둔 구간을 벗어나면 지금 자리를 한가운데 삼아 다시 받는다.
   *
   * 양쪽에 같은 여유를 남긴다. 끌던 방향으로 더 갈 여유와 되돌아올 여유가 같아야
   * 어느 쪽으로 끌어도 걸리는 느낌이 같다.
   */
  useEffect(() => {
    if (Math.abs(offset - anchor) <= pad) return;
    setAnchor(offset);
  }, [offset, anchor, pad]);

  /**
   * 끌기 중에 떠난 요청의 번호.
   *
   * 빨리 끌면 요청이 겹친다. 늦게 떠난 답이 먼저 온 답에 덮이면 창이 엉뚱한 데로
   * 튀므로, 마지막에 떠난 것의 답만 받는다.
   */
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    /*
     * 축 이름과 오류 문구에 쓸 사전.
     *
     * 훅(useTranslation)을 쓰지 않는다. 그 t 는 언어가 바뀔 때 새 함수가 되어, 이
     * 조회의 의존성에 넣으면 언어를 바꾸는 순간 서버를 다시 부른다. 부르지 않으면
     * 오래된 사전이 닫혀 들어간다. 읽는 시점에 스토어를 보면 둘 다 피한다.
     */
    const t = (key: MessageKey, params?: Record<string, string | number>) =>
      translate(activeLocale(), key, params);
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

      /*
       * 창이 놓인 자리를 서버가 읽는 말로 바꾼다.
       *
       * 서버는 창의 **끝**을 받는다. 받아 두는 구간은 한가운데(anchor)에서 앞날 쪽으로
       * 창 하나만큼 더 나가 있으므로, 끝은 `anchor - pad` 자리다. 음수면 오늘보다 뒤다.
       *
       * 일 단위는 끝나는 날(endDate), 월·연 단위는 끝나는 달(endMonth)이다. 연 단위는
       * 그 값의 연도만 쓰이므로 열두 달씩 물린다.
       */
      const endOffset = anchor - pad;
      const window =
        granularity === 'year'
          ? { endMonth: shiftYearMonth(baseMonth, -endOffset * 12) }
          : { endMonth: shiftYearMonth(baseMonth, -endOffset) };

      const rows = await apiClient.getBalanceHistory(
        granularity === 'day'
          ? {
              ...target,
              granularity: 'day',
              days: fetchSpan,
              endDate: shiftDateKey(todayKey(timeZone), -endOffset),
            }
          : granularity === 'year'
            ? { ...target, granularity: 'year', years: fetchSpan, ...window }
            : { ...target, granularity: 'month', months: fetchSpan, ...window },
        projectId,
      );

      // 뒤늦게 온 답은 버린다. 지금 그리고 있는 것이 더 새 것이다.
      if (id !== requestId.current) return;

      /*
       * 축 이름은 단위마다 다르게 짧게 적는다.
       *
       * 일별은 달을 넘나드는 창이라 날짜만 적으면 어느 달인지 알 수 없다. 달까지 적는다.
       */
      const points = (rows ?? []).map((row): AssetHistoryPoint => {
        const balance = toNumber(row.balance);
        const label =
          granularity === 'day'
            ? `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}`
            : granularity === 'year'
              ? t('history.yearLabel', { year: row.date })
              : formatMonthShort(Number(row.date.slice(5)));
        return { label, balance, date: row.date };
      });
      setSeries({ endOffset, points });
    } catch {
      // 그래프를 못 불러와도 나머지 화면은 살아 있어야 한다.
      if (id !== requestId.current) return;
      setSeries({ endOffset: anchor - pad, points: [] });
      setError(t('history.loadFailed'));
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [
    accountId,
    ownerId,
    ownerKey,
    projectId,
    baseMonth,
    granularity,
    anchor,
    pad,
    fetchSpan,
    timeZone,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * 받아 둔 구간에서 지금 보이는 창을 잘라 낸다.
   *
   * 배열의 마지막 칸이 `series.endOffset` 자리다. 창이 그보다 얼마나 뒤에 있는지만큼
   * 끝에서 당겨 온 다음, 거기서 창 하나를 떼어 낸다. 다시 받는 중이라 창이 배열 밖으로
   * 나가 있으면 가장자리에서 멈춘다 -- 새 답이 오면 제자리로 이어진다.
   */
  const points = (() => {
    const length = series.points.length;
    // 창이 배열 밖으로 나가도 빈 배열이 되지는 않게 한다. 그리던 것이 사라지면
    // 끌고 있던 자리가 화면에서 없어져 손이 갈 곳을 잃는다.
    const end = clamp(length - (offset - series.endOffset), Math.min(span, length), length);
    return series.points.slice(Math.max(0, end - span), end);
  })();

  const panFrom = useCallback(
    (startOffset: number, steps: number) => {
      const limit = PAN_LIMIT[granularity];
      setOffset(clamp(startOffset + steps, -limit, limit));
    },
    [granularity],
  );

  const canDrill = granularity !== 'day';

  const drillInto = useCallback(
    (date: string) => {
      if (granularity === 'year') showYearAsMonths(date);
      else if (granularity === 'month') showMonthAsDays(date);
    },
    [granularity, showMonthAsDays, showYearAsMonths],
  );

  return {
    granularity,
    selectGranularity,
    offset,
    resetWindow,
    panFrom,
    span,
    points,
    isLoading,
    error,
    // 값이 전부 0이면 축의 위아래가 같아져 선이 축에 붙는다.
    hasAnyValue: points.some((point) => point.balance !== 0),
    /*
     * Y축을 잔액이 움직인 구간에 맞춘다.
     *
     * 0에서 시작하면 1,000만 원이 1,001만 원이 된 한 달이 직선으로 보인다. 자산 추이는
     * "얼마인가"보다 "늘었는가 줄었는가"를 보는 그래프라 아래를 잘라도 뜻이 뒤집히지 않는다.
     */
    yAxis: lineAxis(
      points.map((point) => point.balance),
      displayCurrency,
    ),
    lastPoint: points.length > 0 ? points[points.length - 1] : null,
    canDrill,
    drillInto,
    titleKey: HISTORY_TITLE_KEY[granularity],
  };
}
