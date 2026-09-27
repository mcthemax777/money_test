/**
 * 공휴일. 반복 등록이 휴일을 건너뛰거나 앞/뒤 평일로 옮길 때 읽는다.
 *
 * **목록은 DB(`PublicHoliday`)에 있고, 관리 도구의 "공휴일 갱신"이 채운다** (`sync`). 한국은
 * 해마다 새 연도의 월력요항이 발표되므로 그때 버튼을 누른다.
 *
 *   - 한국: 관보(월력요항) 기준 공개 데이터(hyunbinseo/holidays-kr 의 연도별 JSON). 아직
 *     발표되지 않은 연도는 date-holidays 로 어림한다(source "library") -- 설·추석은 당일만
 *     있어 앞뒤 하루를 더하고, 대체공휴일·임시공휴일은 발표 뒤 갱신에서 바로잡힌다.
 *   - 그 밖의 나라: date-holidays. 그 라이브러리를 올리고 배포한 뒤 갱신하면 반영된다.
 *   - 임시공휴일처럼 급히 정해진 날은 관리 도구에서 직접 더한다(source "manual"). 갱신은
 *     manual 줄을 지우지 않는다.
 *
 * 서버가 처음 떴는데 표가 비어 있으면 스스로 한 번 채운다. 셈하는 쪽은 나라별 목록을
 * 5분 동안 들고 있는다 -- 회차를 셈할 때마다 읽지 않게. 관리 도구가 고치면 이 서버의
 * 것은 곧바로 비우고, 다른 서버는 5분 안에 따라온다.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Holidays from 'date-holidays';
import { HOLIDAY_COUNTRIES, type HolidayCountry } from '@money/types';

import { PrismaService } from '@/config/prisma.service';

/** 관보 기준 데이터가 있는 첫 해. 그 앞은 쓰지 않는다. */
const GAZETTE_FROM_YEAR = 2018;
const GAZETTE_URL = (year: number) =>
  `https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/${year}.json`;

/** 갱신할 구간. 지난해부터 몇 해 뒤까지. 반복은 31일만 따라잡으므로 지난해면 넉넉하다. */
const YEARS_BACK = 1;
const YEARS_AHEAD = 5;

/** 나라별 목록을 들고 있는 시간. */
const CACHE_MS = 5 * 60 * 1000;

/** 공개 데이터를 받을 때 기다리는 한도. */
const FETCH_TIMEOUT_MS = 10 * 1000;

/** 나라 → date-holidays 의 (나라, 지역). 런던은 잉글랜드의 공휴일을 따른다. */
const LIBRARY_SOURCE: Record<HolidayCountry, [string, string?]> = {
  KR: ['KR'],
  JP: ['JP'],
  CN: ['CN'],
  SG: ['SG'],
  GB: ['GB', 'ENG'],
  US: ['US'],
};

export type HolidaySource = 'gazette' | 'library' | 'manual';

export interface HolidayRow {
  country: HolidayCountry;
  date: string;
  name: string;
  source: HolidaySource;
}

/** 갱신 결과. 관리 도구가 연도마다 어디서 몇 건을 받았는지 보인다. */
export interface HolidaySyncResult {
  country: HolidayCountry;
  years: Array<{ year: number; source: 'gazette' | 'library'; count: number }>;
  /** 받지 못한 까닭. 공개 데이터에 닿지 못했을 때 적는다(그 연도는 어림으로 채운다). */
  warnings: string[];
}

@Injectable()
export class HolidaysService implements OnModuleInit {
  private readonly logger = new Logger(HolidaysService.name);
  private readonly cache = new Map<HolidayCountry, { at: number; dates: Set<string> }>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 기다리지 않는다. 공개 데이터가 느려도 서버가 뜨는 것은 막지 않는다.
    void this.seedIfEmpty();
  }

  private async seedIfEmpty(): Promise<void> {
    try {
      if ((await this.prisma.publicHoliday.count()) > 0) return;
      this.logger.log('공휴일 표가 비어 있어 한 번 채웁니다.');
      await this.syncAll();
    } catch (error) {
      this.logger.warn(`공휴일을 채우지 못했습니다: ${String(error)}`);
    }
  }

  /** 그 나라의 공휴일 ("YYYY-MM-DD"). 5분 동안 들고 있는다. */
  async publicHolidays(country: HolidayCountry): Promise<Set<string>> {
    const cached = this.cache.get(country);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.dates;

    const rows = await this.prisma.publicHoliday.findMany({
      where: { country },
      select: { date: true },
    });
    const dates = new Set(rows.map((row) => row.date));
    this.cache.set(country, { at: Date.now(), dates });
    return dates;
  }

  /** 그 나라·연도의 공휴일. 관리 도구가 목록으로 보인다. */
  async list(country: HolidayCountry, year: number): Promise<HolidayRow[]> {
    const rows = await this.prisma.publicHoliday.findMany({
      where: { country, date: { startsWith: `${year}-` } },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => ({
      country: row.country as HolidayCountry,
      date: row.date,
      name: row.name,
      source: row.source as HolidaySource,
    }));
  }

  /** 직접 더한다(임시공휴일 등). 이미 있으면 이름을 바꾸고 manual 로 적는다. */
  async add(country: HolidayCountry, date: string, name: string): Promise<void> {
    await this.prisma.publicHoliday.upsert({
      where: { country_date: { country, date } },
      create: { country, date, name, source: 'manual' },
      update: { name, source: 'manual' },
    });
    this.cache.delete(country);
  }

  /**
   * 지운다. 없으면 아무 일도 없다.
   *
   * 관보·라이브러리에서 온 날을 지우면 다음 갱신에서 다시 들어온다.
   */
  async remove(country: HolidayCountry, date: string): Promise<void> {
    await this.prisma.publicHoliday.deleteMany({ where: { country, date } });
    this.cache.delete(country);
  }

  /** 모든 나라를 갱신한다. */
  async syncAll(): Promise<HolidaySyncResult[]> {
    const results: HolidaySyncResult[] = [];
    for (const country of HOLIDAY_COUNTRIES) results.push(await this.sync(country));
    return results;
  }

  /**
   * 한 나라를 갱신한다. 연도마다 manual 이 아닌 줄을 새 목록으로 갈아 끼운다.
   *
   * 한국은 관보 데이터가 있는 연도는 그것으로, 없는 연도는 어림으로 채운다. 단 **이미
   * 관보로 채운 연도를 어림으로 덮지 않는다** -- 공개 데이터에 잠깐 닿지 못한 것 때문에
   * 맞는 목록이 어림으로 바뀌면 안 된다.
   */
  async sync(country: HolidayCountry): Promise<HolidaySyncResult> {
    const thisYear = new Date().getUTCFullYear();
    const from = country === 'KR' ? GAZETTE_FROM_YEAR : thisYear - YEARS_BACK;
    const result: HolidaySyncResult = { country, years: [], warnings: [] };

    for (let year = from; year <= thisYear + YEARS_AHEAD; year += 1) {
      let rows: Array<{ date: string; name: string }> | null = null;
      let source: 'gazette' | 'library' = 'library';

      if (country === 'KR') {
        try {
          rows = await fetchGazette(year);
          if (rows) source = 'gazette';
        } catch (error) {
          result.warnings.push(`${year}년 관보 데이터를 받지 못했습니다: ${String(error)}`);
        }
        if (!rows) {
          const hasGazette = await this.prisma.publicHoliday.count({
            where: { country, date: { startsWith: `${year}-` }, source: 'gazette' },
          });
          if (hasGazette > 0) continue;
          // 관보 데이터가 있기 전의 해는 어림하지 않는다(쓸 일이 없다).
          if (year < thisYear - YEARS_BACK) continue;
        }
      }
      rows ??= libraryHolidays(country, year);

      await this.replaceYear(country, year, rows, source);
      result.years.push({ year, source, count: rows.length });
    }

    this.cache.delete(country);
    return result;
  }

  /** 그 연도의 manual 이 아닌 줄을 갈아 끼운다. manual 과 겹치는 날은 manual 을 남긴다. */
  private async replaceYear(
    country: HolidayCountry,
    year: number,
    rows: Array<{ date: string; name: string }>,
    source: 'gazette' | 'library',
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.publicHoliday.deleteMany({
        where: { country, date: { startsWith: `${year}-` }, source: { not: 'manual' } },
      }),
      this.prisma.publicHoliday.createMany({
        data: rows.map((row) => ({ country, date: row.date, name: row.name, source })),
        skipDuplicates: true,
      }),
    ]);
  }
}

/**
 * 관보 기준 한 해. 아직 발표되지 않은 해(404)는 null 이다.
 *
 * 한 날에 이름이 여럿일 수 있다(설날과 대체공휴일이 겹친 날 등). "·" 로 잇는다.
 */
async function fetchGazette(year: number): Promise<Array<{ date: string; name: string }> | null> {
  const response = await fetch(GAZETTE_URL(year), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = (await response.json()) as Record<string, string[]>;
  return Object.entries(body)
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(`${year}-`))
    .map(([date, names]) => ({ date, name: (names ?? []).join('·') }));
}

/** date-holidays 에서 그 해의 공휴일. 한국은 설·추석 앞뒤 하루를 더한다. */
function libraryHolidays(country: HolidayCountry, year: number): Array<{ date: string; name: string }> {
  const [code, state] = LIBRARY_SOURCE[country];
  const calendar = state ? new Holidays(code, state) : new Holidays(code);
  const found = new Map<string, string>();

  for (const holiday of calendar.getHolidays(year) || []) {
    if (holiday.type !== 'public') continue;
    const date = holiday.date.slice(0, 10);
    found.set(date, found.has(date) ? `${found.get(date)}·${holiday.name}` : holiday.name);

    if (country === 'KR' && !holiday.substitute && /설날|추석/.test(holiday.name)) {
      for (const [offset, suffix] of [[-1, ' 전날'], [1, ' 다음 날']] as const) {
        const near = addDays(date, offset);
        if (!found.has(near)) found.set(near, `${holiday.name}${suffix}`);
      }
    }
  }

  return [...found]
    .filter(([date]) => date.startsWith(`${year}-`))
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
