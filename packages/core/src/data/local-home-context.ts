/**
 * 홈 창구의 갈래들이 함께 쥐는 것. 사본·서버 창구·읽음 알림과, 표시 통화 환산기·구간 다리 읽기다.
 */

import {
  type EntryFilterQuery,
  type EntrySearchQuery,
  Dec,
  currencyDecimals,
  expandInstallmentRows,
  parseEntryBasis,
  parseEntrySearch,
  type CurrencyCode,
  INSTALLMENT_LOOKBACK_MONTHS,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import type { HomeDataPort } from './home-port';
import type { LocalStore } from './local-store';
import {
  dateKeyOfRow,
  ownerIdsOf,
  periodKeys,
  rateInfoOf,
  shiftDateKeyMonths,
  timeZoneOf,
} from './local-home-query';

/** 서버 창구. 사본이 낼 수 없는 값을 물어볼 곳이다. */
export interface LocalHomePortOptions {
  fallback: HomeDataPort;
  /** 사본에서 낸 값임을 알리고 싶을 때. 화면이 "오프라인" 표시를 켜는 자리다. */
  onLocalRead?: (name: string) => void;
}

/** 갈래들이 함께 쓰는 것을 한 번 만든다. `createLocalHomePort` 가 부른다. */
export function createHomeContext(store: LocalStore, { fallback, onLocalRead }: LocalHomePortOptions) {
  const note = (name: string) => onLocalRead?.(name);

  /** 표시 통화로 옮기는 곱셈. 합계에만 한 번 곱한다. */
  const converter = async (projectId: string) => {
    const project = await store.projectRow(projectId);
    const ledger = project?.ledgerCurrency ?? 'KRW';
    const display = project?.displayCurrency ?? ledger;

    if (ledger === display) {
      const one = Dec.of(1);
      return {
        display,
        ledger,
        toString: (value: Dec) => value.toString(),
        rate: one,
        view: { convert: (value: Dec) => value, rate: one },
      };
    }

    /*
     * 서버의 getDisplayConverter 와 같은 환율이다 (rateInfoOf: 직접 정한 값 → 역수 → 고정값).
     * 예전에는 저장된 값이 없으면 1 을 써, 표시 통화를 바꾼 가계부의 오프라인 금액이 서버와 갈렸다.
     */
    const rate = Dec.of(
      (await rateInfoOf(store, projectId, ledger as CurrencyCode, display as CurrencyCode))?.rate ??
        '1',
    );
    const decimals = currencyDecimals(display);
    return {
      display,
      ledger,
      rate,
      toString: (value: Dec) => value.times(rate).round(decimals).toString(),
      /*
       * 목록 한 줄을 펴는 환산기(`toListItem`). 서버처럼 표시 통화 자릿수로 반올림한다 (2026-10-16) -- 곱하기만
       * 하던 다섯 자리가 소수 끝자리를 남겨 수단별 합계가 서버와 1원씩 갈렸다.
       */
      view: { convert: (value: Dec) => value.times(rate).round(decimals), rate },
    };
  };

  /**
   * 그 구간의 카테고리 다리.
   *
   * 양끝은 달력 키 문자열로 자른다. 키가 "YYYY-MM-DD" 로 0을 채운 값이라
   * `<= '2026-08-31'` 이 그 달의 마지막 날까지를 정확히 담는다(달의 길이를 몰라도 된다).
   * 그 키는 이미 프로젝트 타임존으로 계산해 넣은 값이므로 여기서 타임존을 다시 볼 일이 없다.
   */
  const monthPostings = async (
    projectId: string,
    period: ReportPeriod,
    filter?: EntryFilterQuery & EntrySearchQuery & { personId?: string },
  ) => {
    const keys = periodKeys(period);
    const scope = {
      ownerIds: ownerIdsOf(filter),
      // 거래 화면의 검색. 고르지 않았으면 조건이 서지 않는다.
      search: parseEntrySearch(filter ?? {}),
    };
    if (parseEntryBasis(filter?.basis) !== 'installment') {
      return store.categoryPostings(projectId, { ...keys, ...scope });
    }

    /*
     * 회차 기준. 앞에서 산 할부의 회차가 이 구간에 서므로 **앞으로 넓혀 읽고 편 뒤에
     * 구간 밖을 버린다.** 서버의 리포트와 같은 차례다 -- 규칙이 두 벌이면 같은 달의
     * 숫자가 웹과 기기에서 갈린다.
     */
    const timeZone = await timeZoneOf(store, projectId);
    const rows = await store.categoryPostings(projectId, {
      ...keys,
      ...scope,
      fromDateKey: shiftDateKeyMonths(keys.fromDateKey, -INSTALLMENT_LOOKBACK_MONTHS),
      withInstallment: true,
    });
    return expandInstallmentRows(rows, timeZone).filter((row) => {
      const key = dateKeyOfRow(row.date, timeZone);
      return key >= keys.fromDateKey && key <= keys.toDateKey;
    });
  };

  return { store, fallback, note, converter, monthPostings };
}

/** 갈래마다 받는 것. */
export type HomeContext = ReturnType<typeof createHomeContext>;
