/**
 * 홈 창구의 거래 목록 쪽. 구간 목록, 쪽 목록, 거래 하나, 지난 할부 회차다.
 */

import {
  installmentRowDate,
  installmentMatchesFeatures,
  parseEntrySearch,
  lineMatcherOf,
  toListItem,
  zonedMonthRange,
  INSTALLMENT_LOOKBACK_MONTHS,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { HomeContext } from './local-home-context';
import {
  dateKeyOf,
  listNarrowOf,
  ownerIdsOf,
  requireProject,
  shiftDateKeyMonths,
  timeZoneOf,
} from './local-home-query';

export function entryReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getAllEntries'
  | 'getInstallmentRows'
  | 'getEntry'
  | 'getEntries'
> {
  const { store, note, converter } = ctx;

  return {
    /**
     * 그 구간의 거래 목록.
     *
     * 목록 API 는 인스턴트(startDate·endDate)를 받지만 사본은 달력 키로 고른다.
     * 두 값이 같은 구간을 가리키도록 인스턴트를 프로젝트 타임존의 달력 키로 옮긴다.
     */
    async getAllEntries(query, projectId) {
      const id = requireProject(projectId);
      note('entries');

      const timeZone = await timeZoneOf(store, id);
      const show = await converter(id);

      const search = parseEntrySearch(query);
      const entries = await store.viewEntries(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        // 한 달만 볼 때는 박아 둔 컬럼을 쓴다. 달 길이도 시차도 다시 따질 것이 없다.
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search,
        // 분석 기준이면 연결된 페이백을 원거래의 날짜로 고른다 (서버 목록의 `dateBasis`).
        dateBasis: query.dateBasis === 'analysis' ? 'analysis' : 'own',
        // 원거래 상세의 "받은 페이백" (서버 목록의 `paybackOf`).
        paybackOf: query.paybackOf,
        ...listNarrowOf(query),
      });

      // 서버와 같은 판정기로 걸린 줄만 남긴다. 규칙이 두 벌이면 목록이 갈린다.
      const matchLine = lineMatcherOf(search);
      return entries.map((entry) =>
        toListItem(
          entry,
          show.view,
          matchLine,
        ),
      );
    },

    /**
     * 이 구간에 회차가 서는 지난 할부. 회차 기준으로 볼 때만 부른다.
     *
     * 서버의 `/entries/installment-rows` 와 같은 답을 내야 한다 -- 오프라인에서 목록이
     * 달라지면 같은 달을 두 기기에서 다르게 보게 된다.
     */
    async getInstallmentRows(query, projectId) {
      const id = requireProject(projectId);
      note('entries');

      const timeZone = await timeZoneOf(store, id);

      /*
       * 구간은 목록 질의와 **같은 방식으로** 읽는다. 달 이름이든 인스턴트 두 개든 된다.
       *
       * 거래 화면은 달을 볼 때 이름 하나만 보낸다(`listRangeOf`). 인스턴트만 받으면 이
       * 조회가 늘 빈 목록을 내주어, 산 달의 1회차만 서고 나머지 회차는 합계에만 잡힌다.
       */
      const window = query.yearMonth
        ? zonedMonthRange(query.yearMonth, timeZone)
        : query.startDate && query.endDate
          ? { start: new Date(query.startDate), end: new Date(query.endDate) }
          : null;
      if (!window) return [];

      const { start: from, end: to } = window;
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

      const show = await converter(id);

      /*
       * 구간이 시작하기 **전날까지** 산 할부를 본다. 구간 안의 할부는 이미 목록에 있어
       * 다시 실으면 같은 거래가 두 줄로 선다.
       */
      const toKey = dateKeyOf(new Date(from.getTime() - 1).toISOString(), timeZone, '9999-12-31');
      const fromKey = shiftDateKeyMonths(
        dateKeyOf(from.toISOString(), timeZone, '0000-01-01'),
        -INSTALLMENT_LOOKBACK_MONTHS,
      );

      // 할부만 본다. 사용자가 고른 모양이 있어도 이 조회에서는 할부가 대상이다.
      const search = parseEntrySearch({ ...query, features: 'installment' });
      /*
       * 목록과 같은 좁히기(분류·유형·카드)를 건다 (2026-10-16). 빠뜨려 회차 기준의 분류 상세가 오프라인에서
       * 모든 분류의 지난 할부 회차를 일별 누적과 비교선에 더했다. 서버는 같은 질의를 그대로 목록에 넘긴다.
       */
      const entries = await store.viewEntries(id, {
        fromDateKey: fromKey,
        toDateKey: toKey,
        ownerIds: ownerIdsOf(query),
        search,
        ...listNarrowOf(query),
      });

      const matchLine = lineMatcherOf(search);
      const items = entries.map((entry) =>
        toListItem(
          entry,
          show.view,
          matchLine,
        ),
      );

      const features = parseEntrySearch(query).features;

      // 회차가 이 구간에 서는 것만 남긴다. 다 갚은 할부는 여기서 빠진다.
      return items.filter((entry) => {
        // 위 조회가 덮어쓴 형태를 여기서 다시 본다 (`installmentMatchesFeatures`).
        if (!installmentMatchesFeatures(entry, features)) return false;
        const months = entry.installmentMonths ?? 1;
        if (months < 2) return false;
        for (let index = 1; index < months; index += 1) {
          const at = installmentRowDate(entry.date, index, timeZone);
          const time = (at instanceof Date ? at : new Date(at)).getTime();
          if (time >= from.getTime() && time < to.getTime()) return true;
        }
        return false;
      });
    },

    /**
     * 거래 하나. 사본에 없으면 null 이다 (아직 내려받지 못한 달의 거래).
     *
     * 목록과 같은 함수로 편다(`toListItem`). 상세 팝업이 받는 한 줄은 어디서 왔든
     * 같은 모양이어야, 원장에서 연 상세와 목록에서 연 상세가 다르게 보이지 않는다.
     */
    async getEntry(id, projectId) {
      note('entry');

      const entry = await store.viewEntryById(id);
      if (!entry) return null;

      // 환산율은 가계부마다 다르다. 전표에는 그 값이 없어 부르는 쪽이 준 것을 쓴다.
      const show = await converter(requireProject(projectId));
      return toListItem(entry, show.view);
    },

    /**
     * 한 쪽씩 받는 목록.
     *
     * 커서는 서버와 같은 모양이다("ISO날짜|id" 를 base64url 로). 형식을 맞춰 두면
     * 사본에서 읽던 목록을 온라인 창구로 이어 받아도 자리가 어긋나지 않는다.
     */
    async getEntries(query, projectId) {
      const id = requireProject(projectId);
      note('entriesPage');

      const timeZone = await timeZoneOf(store, id);
      const show = await converter(id);
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

      const search = parseEntrySearch(query);
      const page = await store.viewEntriesPage(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search,
        ...listNarrowOf(query),
        dateBasis: query.dateBasis === 'analysis' ? 'analysis' : 'own',
        paybackOf: query.paybackOf,
        limit,
        cursor: decodeCursor(query.cursor),
      });

      const matchLine = lineMatcherOf(search);
      const rows = page.entries.map((entry) =>
        toListItem(
          entry,
          show.view,
          matchLine,
        ),
      );

      const last = page.entries[page.entries.length - 1];
      return {
        data: rows,
        nextCursor: page.hasMore && last ? encodeCursor(String(last.date), last.id) : null,
      };
    },
  };
}

/**
 * 커서. 서버와 같은 모양이다 ("ISO날짜|id" 를 base64url 로).
 *
 * base64 는 전역 `btoa`/`atob` 를 쓴다. 이 런타임에 있다는 것은 이미 확인된 사실이다
 * (api-client 가 JWT 만료를 읽을 때 `atob` 를 쓰고 있고 앱에서 그 경로가 돈다).
 */
function encodeCursor(date: string, id: string): string {
  return toBase64Url(`${new Date(date).toISOString()}|${id}`);
}

function decodeCursor(cursor?: string): { date: string; id: string } | null {
  if (!cursor) return null;

  try {
    const text = fromBase64Url(cursor);
    const [dateText, id] = text.split('|');
    if (!id || Number.isNaN(new Date(dateText).getTime())) return null;
    return { date: new Date(dateText).toISOString(), id };
  } catch {
    return null;
  }
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
