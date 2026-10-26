/**
 * 카드의 주기 원장(실적·청구)을 주기 단위로 거슬러 오르며 한 쪽씩 모으는 뼈대
 * (card-ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 데이터베이스를 직접 읽지 않는다. 주기마다 줄을 읽는 일과 더 오래된 줄이 있는지 묻는 일은
 * 부르는 쪽이 함수로 넘긴다. 여기서는 커서·누적·자르기만 정한다.
 */
import { Prisma } from '@prisma/client';
import {
  CardDto,
  MAX_USAGE_PERIODS,
  closingMonthKey,
  shiftClosingMonth,
  zonedDayStart,
  zonedParts,
} from '@money/types';

const ZERO = new Prisma.Decimal(0);

/** 마감 연월 하나. 체크카드는 달력 월이 그 자리에 든다. */
export interface ClosingMonth {
  year: number;
  month: number;
}

/** 실적 원장의 다음 자리. "이 주기의 이 줄 다음부터"를 가리킨다. */
export interface LedgerCursor {
  closing: ClosingMonth;
  /** 비어 있으면 그 주기의 첫 줄부터다 (거래가 없는 달을 건너뛴 자리). */
  key: string;
  /** 그 줄의 날짜 (ISO). 그 줄이 그 사이 사라졌을 때 이어 볼 자리를 정한다. 옛 커서에는 없다. */
  date?: string;
}

/** 한 쪽의 크기. 없거나 읽을 수 없으면 20, 1~100 으로 자른다. */
export function parseLedgerLimit(value: unknown): number {
  return Math.min(Math.max(Number(value) || 20, 1), 100);
}

/** 'YYYY-MM' 을 마감 연월로. 모양이 아니면 null (전체를 본다). */
export function parseClosingKey(value?: string): ClosingMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** 'YYYY-MM|줄키' 를 되돌린다. 모양이 아니면 처음부터 본다. */
export function parseLedgerCursor(raw?: string): LedgerCursor | null {
  if (!raw) return null;

  const [month, ...rest] = raw.split('|');
  const matched = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!matched) return null;

  // 끝 칸이 날짜면 새 모양('YYYY-MM|줄키|날짜')이다. 줄 키에는 '|' 가 들지 않는다.
  const last = rest[rest.length - 1] ?? '';
  const hasDate = rest.length >= 2 && !Number.isNaN(Date.parse(last)) && /^\d{4}-\d{2}-\d{2}T/.test(last);
  return {
    closing: { year: Number(matched[1]), month: Number(matched[2]) },
    key: (hasDate ? rest.slice(0, -1) : rest).join('|'),
    ...(hasDate ? { date: last } : {}),
  };
}

/**
 * 주기의 마감일 다음 날이 시작하는 인스턴트. 거래를 읽는 질의의 끝(포함하지 않음)이다.
 *
 * `periodForClosingMonth` 의 `periodEnd` 는 마감일의 **UTC 자정 표시자**라 그대로 `lte` 로
 * 쓰면 마감일 거래가 대부분 빠진다 -- 서울이면 마감일 오전 9시 이후 것이 전부 빠졌다.
 * 프로젝트 타임존에서 마감일 다음 날 0시를 구해 그 앞까지 읽는다.
 */
export function afterClosingDay(periodEnd: Date, timeZone: string): Date {
  return zonedDayStart(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth() + 1,
    periodEnd.getUTCDate() + 1,
    timeZone,
  );
}

/** 오늘을 달력 날짜로 찍은 표시자. 주기가 닫혔는지 보는 데 쓴다. */
function todayUtcMarker(timeZone: string): number {
  const today = zonedParts(new Date(), timeZone);
  return Date.UTC(today.year, today.month - 1, today.day);
}

/**
 * 커서 다음 줄들. 줄은 최신이 앞이다 (`fillPeriod`).
 *
 * 커서가 가리킨 줄이 그 사이 지워졌으면(2026-10-16) 그 줄의 날짜보다 오래된 줄부터 잇는다. 예전에는 찾지 못하면
 * 처음부터 다시 돌려줘 이미 본 줄이 또 실렸다. 날짜가 없는 옛 커서는 지금처럼 처음부터다.
 */
function rowsAfterCursor<R extends { key: string; date: string }>(rows: R[], cursor: LedgerCursor): R[] {
  const at = rows.findIndex((row) => row.key === cursor.key);
  if (at >= 0) return rows.slice(at + 1);
  if (cursor.date) return rows.filter((row) => row.date < cursor.date!);
  return rows;
}

/**
 * 한 주기의 줄에 쌓인 값을 붙인다. **가장 오래된 줄부터** 더한다.
 *
 * 돌려줄 때는 최신이 앞이다. 목록은 언제나 최근 것부터 읽는데, 누적은 주기 시작에서만
 * 뜻이 있어 더하는 방향과 보여 주는 방향이 반대다. 합계는 그 주기 전부의 값이라,
 * 뒷부분만 보여 줄 때에도 머리글의 숫자는 달라지지 않는다.
 */
function fillPeriod(rows: CardDto.PeriodLedgerRow[]): {
  rows: CardDto.PeriodLedgerRow[];
  total: string;
} {
  let running = ZERO;
  const filled = rows.map((row) => {
    // 줄의 금액은 카드 관점이라 사용이 음수다. 쌓이는 값은 그 반대 부호다.
    running = running.add(new Prisma.Decimal(row.amount).neg());
    return { ...row, runningTotal: running.toString() };
  });

  return { rows: filled.reverse(), total: running.toString() };
}

/**
 * 주기를 거슬러 오르며 줄을 `limit` 만큼 모은다. 신용·체크가 이 한 길을 쓴다.
 *
 * **주기는 통째로 만든다.** 누적은 주기 시작부터 세야 뜻이 있어, 뒷부분만 보여 줄
 * 때에도 앞부터 더한 값을 붙여야 한다. 자르는 것은 보여 줄 줄뿐이다.
 *
 * 한 번에 스물네 주기까지 훑는다. 그 안에서 채우지 못하면 더 오래된 줄이 있는지
 * 한 번 물어, 없으면 커서를 끊어 목록이 끝나게 한다 -- 끊지 않으면 빈 쪽을 부르는
 * 일이 되풀이된다.
 */
export async function walkPeriods(input: {
  limit: number;
  cursor: LedgerCursor | null;
  /**
   * 이 주기 하나만 본다. 더 오래된 주기로 내려가지 않는다.
   *
   * 그래프에서 막대를 눌러 한 주기로 좁힌 자리다. 그 주기 안에서 줄이 한 쪽을 넘으면
   * 이어 받을 수 있지만, 다 보고 나면 끝이다 -- 고르지 않은 주기를 이어 붙이면 화면이
   * 좁혀 놓은 것과 달라진다.
   */
  only?: ClosingMonth | null;
  from: ClosingMonth;
  timeZone: string;
  periodOf: (closing: ClosingMonth) => { start: Date; end: Date };
  rowsOf: (
    closing: ClosingMonth,
    period: { start: Date; end: Date },
  ) => Promise<CardDto.PeriodLedgerRow[]>;
  olderExists: (start: Date) => Promise<{ id: string } | null>;
}): Promise<{
  periods: CardDto.PeriodLedgerPeriod[];
  rows: CardDto.PeriodLedgerRow[];
  nextCursor: string | null;
}> {
  const todayMarker = todayUtcMarker(input.timeZone);
  const periods: CardDto.PeriodLedgerPeriod[] = [];
  const rows: CardDto.PeriodLedgerRow[] = [];

  let closing = input.from;
  let scanned = input.from;
  let leftover = false;

  for (let step = 0; step < MAX_USAGE_PERIODS && rows.length < input.limit; step += 1) {
    scanned = closing;
    const period = input.periodOf(closing);
    const built = fillPeriod(await input.rowsOf(closing, period));

    const key = closingMonthKey(closing);
    // 커서가 가리키는 주기에서는 그 줄 다음부터다. 더 오래된 주기는 통째로 잇는다.
    const rest =
      input.cursor && input.cursor.key && key === closingMonthKey(input.cursor.closing)
        ? rowsAfterCursor(built.rows, input.cursor)
        : built.rows;

    if (rest.length > 0) {
      const room = input.limit - rows.length;
      rows.push(...rest.slice(0, room));
      leftover = rest.length > room;
      periods.push({
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        closed: period.end.getTime() < todayMarker,
        total: built.total,
      });
    }

    if (rows.length >= input.limit) break;
    // 한 주기만 보는 조회는 여기서 끝난다.
    if (input.only) break;
    closing = shiftClosingMonth(closing, -1);
  }

  /*
   * 다음 자리.
   *
   * 본 주기에 줄이 남았으면 마지막 줄이 그 자리다. 다 봤으면 더 오래된 줄이 있는지
   * 물어, 있으면 훑던 다음 주기부터 이어 가고 없으면 끊는다.
   */
  const last = rows[rows.length - 1];
  if (leftover && last) {
    return { periods, rows, nextCursor: `${closingMonthKey(scanned)}|${last.key}|${last.date}` };
  }

  // 한 주기만 보기로 했으면 더 오래된 줄을 묻지 않는다.
  if (input.only) return { periods, rows, nextCursor: null };

  const older = await input.olderExists(input.periodOf(scanned).start);
  return {
    periods,
    rows,
    nextCursor: older ? `${closingMonthKey(shiftClosingMonth(scanned, -1))}|` : null,
  };
}
