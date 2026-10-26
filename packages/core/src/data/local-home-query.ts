/**
 * 홈 창구(`local-home-port`)가 함께 쓰는 질의 도구. 구간·사람·달력 키·환율을 사본이 고를 모양으로 옮긴다.
 */

import {
  type EntryFilterQuery,
  shiftYearMonth,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
  type CurrencyCode,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import { localRateInfo } from './local-lookup';
import type { LocalStore, MirrorEntryScope } from './local-store';

/**
 * 프로젝트 타임존. 달력 경계를 자를 때 쓴다.
 *
 * 사본에 프로젝트 행이 아직 없으면(첫 동기화 전) 서울로 본다. 목록의 달력 키는 이미
 * 동기화할 때 박아 둔 값이라 이 기본값에 기대지 않는다.
 */
export async function timeZoneOf(store: LocalStore, projectId: string): Promise<string> {
  const project = await store.projectRow(projectId);
  return project?.timeZone ?? 'Asia/Seoul';
}

export function requireProject(projectId?: string | null): string {
  if (!projectId) {
    throw new Error('사본을 읽으려면 프로젝트를 골라야 합니다.');
  }
  return projectId;
}

/**
 * 구간을 사본이 고를 달력 키로.
 *
 * **여기서 타임존을 보지 않는다.** 구간 조회의 startDate·endDate 는 인스턴트가 아니라
 * 프로젝트 타임존의 달력 날짜이고(ReportDto.PeriodQuery), 사본의 dateKey 컬럼도 같은
 * 기준으로 박아 둔 값이다. 두 값이 이미 같은 자로 재어져 있어 그대로 견주면 된다.
 * 목록 조회(EntryDto.ListQuery)는 이름이 같아도 인스턴트라 `dateKeyOf` 를 거친다.
 *
 * 달 이름만 온 경우 끝을 `-31` 로 둔다. 키가 0을 채운 문자열이라 그 달의 말일이
 * 며칠이든 정확히 그 달까지만 담긴다.
 */
export function periodKeys(period: ReportPeriod): { fromDateKey: string; toDateKey: string } {
  if (period.yearMonth) {
    return { fromDateKey: `${period.yearMonth}-01`, toDateKey: `${period.yearMonth}-31` };
  }
  return { fromDateKey: String(period.startDate), toDateKey: String(period.endDate) };
}

/** 통화쌍 하나의 환율. 차례는 서버와 함께 쓰는 `resolveRate` 다 (`localRateInfo`). */
export const rateInfoOf = localRateInfo;

/** 계좌 통화 -> 표시 통화 환율. 사본에 있는 것만 모은다. */
export async function ratesFor(
  store: LocalStore,
  projectId: string,
  display: string,
): Promise<Record<string, string>> {
  const accounts = await store.accounts(projectId);
  const result: Record<string, string> = { [display]: '1' };

  for (const currency of new Set(accounts.map((account) => account.currency))) {
    if (result[currency]) continue;

    /*
     * 서버와 같은 순서(직접 정한 값 → 역수 → 고정값, `rateInfoOf`)로 찾는다 (2026-10-16 -- 역수를 빠뜨려 반대
     * 방향만 정해 둔 가계부의 총자산이 서버와 갈렸다).
     *
     * 1 로 눙치면 외화 계좌가 원화와 1:1 로 세어진다. 100달러가 100원이 되어 총자산이
     * 조용히 어긋나는 자리다 -- 기기에서 실제로 그랬다. 셋 다 없을 때만 1 이다.
     */
    result[currency] =
      (await rateInfoOf(store, projectId, currency as CurrencyCode, display as CurrencyCode))?.rate ??
      '1';
  }
  return result;
}

/**
 * 예산 사용액이 보는 조건. 서버 `monthUsageScope` 처럼 사람(자산주)만 본다 -- 거래 화면의 검색어나
 * 기간이 함께 넘어와도 예산 사용액은 그 달 전체여야 한다.
 */
export function ownerFilterOf(
  filter?: EntryFilterQuery & { personId?: string },
): Pick<EntryFilterQuery, 'personIds'> & { personId?: string } {
  return {
    ...(filter?.personId ? { personId: filter.personId } : {}),
    ...(filter?.personIds !== undefined ? { personIds: filter.personIds } : {}),
  };
}

/**
 * 고른 자산 주인. 서버의 `parseEntryFilter` 와 같은 세 상태를 지킨다.
 *
 *   키가 없음  = 전체 (undefined)
 *   값이 있음  = 그 사람들만
 *   빈 문자열  = 아무것도 고르지 않음 -> 결과 없음 (빈 배열)
 */
export function ownerIdsOf(filter?: EntryFilterQuery & { personId?: string }): string[] | undefined {
  if (filter?.personId) return [filter.personId];
  if (filter?.personIds === undefined) return undefined;

  return filter.personIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * 인스턴트를 프로젝트 타임존의 달력 키로. 값이 없으면 열린 끝으로 둔다.
 *
 * 목록 API 는 인스턴트를 받고 사본은 달력 키로 고른다. 여기서 옮기지 않으면 한국의
 * 새벽 거래가 구간 밖으로 밀린다.
 */
export function dateKeyOf(value: string | undefined, timeZone: string, fallbackKey: string): string {
  if (!value) return fallbackKey;
  return zonedDateKey(new Date(value), timeZone);
}

/** 달력 키를 달 단위로 옮긴다. 며칟날은 그대로 두고 달만 센다. */
export function shiftDateKeyMonths(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month) return dateKey;

  const shifted = shiftYearMonth(year, month, delta);
  return `${shifted}-${String(day || 1).padStart(2, '0')}`;
}

/** 편 줄의 날짜를 달력 키로. 사본의 줄은 글자로, 편 줄은 Date 로 온다. */
export function dateKeyOfRow(date: Date | string, timeZone: string): string {
  return zonedDateKey(date instanceof Date ? date : new Date(date), timeZone);
}

/**
 * 회차를 가릴 구간. 시작은 포함, 끝은 열려 있다.
 *
 * 달은 이름으로 만든다. 달력 키로 만들면 말일을 `-31` 로 적는 자리(`periodKeys`)에서
 * 2월이 3월 초사흘까지 늘어나, 없는 날이 다음 달 회차를 끌어온다.
 */
export function periodWindow(
  period: ReportPeriod,
  keys: { fromDateKey: string; toDateKey: string },
  timeZone: string,
): { from: Date; to: Date } {
  if (period.yearMonth) {
    const { start, end } = zonedMonthRange(period.yearMonth, timeZone);
    return { from: start, to: end };
  }
  const [year, month, day] = keys.toDateKey.split('-').map(Number);
  return {
    from: zonedDateStringToUtc(keys.fromDateKey, timeZone),
    // 끝날을 포함하려면 다음 날 0시까지다. 달 넘김은 날짜 계산이 맡는다.
    to: zonedDayStart(year, month, day + 1, timeZone),
  };
}

/**
 * 목록 질의의 좁히기 -- 분류 하나(·정확히), 분류 유형, 카드. 서버 목록과 같은 규칙이다 (`categoryLegFilter`).
 *
 * 목록·쪽 목록·지난 할부 회차가 함께 쓴다. 따로 적던 때에는 지난 할부 회차만 이 조건을 빠뜨렸다 (2026-10-16).
 */
export function listNarrowOf(query: {
  categoryId?: string;
  categoryExact?: boolean | string;
  categoryType?: string;
  cardId?: string;
}): Pick<MirrorEntryScope, 'category' | 'categoryType' | 'cardId'> {
  return {
    ...(query.categoryId
      ? {
          category: {
            id: query.categoryId,
            exact: query.categoryExact === true || query.categoryExact === 'true',
          },
        }
      : {}),
    ...(query.categoryType === 'income' || query.categoryType === 'expense'
      ? { categoryType: query.categoryType }
      : {}),
    ...(query.cardId ? { cardId: query.cardId } : {}),
  };
}
