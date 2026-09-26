import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntryFilterQuery, EntryListItem, EntrySearchQuery, ReportDto } from '@money/types';

import { installmentEntryViews, toEntrySearchQuery } from '@money/types';

import { homeDataPort } from '../data/home-port';
import { type ReportPeriod } from '../lib/api-client';
import { dateKeyOf, dayRangeQuery, monthQueryRange } from '../lib/datetime';
import type { Account, Card, Category, Person } from '../lib/types';
import { useLedgerBasis } from '../store/ledger-basis';
import { useProject } from '../store/project';
import { useUserFilter } from '../store/user-filter';
import { useDebouncedValue } from './useDebouncedValue';
import { useMirrorVersion } from './useMirrorVersion';
import { usePersonFilterSync } from './usePersonFilterSync';
import { searchRange, type TransactionSearch } from './useTransactions';

/**
 * 가계 화면이 보는 값 전부.
 *
 * 한 구간(달 또는 기간)의 거래와 합계, 그리고 그것을 거르는 조건들이다. 분류별·수단별
 * 탭은 각자 서버에서 받으므로 여기서는 조회를 다시 하게 할 표(dataVersion)만 올린다.
 *
 * 웹과 앱이 같은 화면을 그리므로 조회와 판단을 여기 한 곳에 둔다.
 *
 * 값을 어디서 얻는지는 창구(`homeDataPort`)가 정한다. 웹은 서버에서 곧바로 받고,
 * 앱은 기기 사본에서 읽는다. 이 훅과 화면은 어느 쪽인지 모른 채 같은 코드를 쓴다.
 */
export function useLedgerData({
  projectId,
  year,
  month,
  rangeStart,
  rangeEnd,
  search,
}: {
  projectId: string | null;
  year: number;
  month: number;
  /** 기간 보기. 둘 다 있으면 달 대신 이 구간을 본다 ("YYYY-MM-DD"). */
  rangeStart?: string;
  rangeEnd?: string;
  /**
   * 거래 화면의 검색. 달력 보기가 목록 보기에서 걸어 둔 조건을 그대로 이어받는다.
   *
   * 목록에만 걸린다. 상단 합계(summary)에는 싣지 않는다 -- 달력은 합계를 받은 목록으로
   * 직접 세고(`sumEntries`), 요약 API 가 검색 칸을 받는지는 여기서 기대지 않는다.
   */
  search?: TransactionSearch;
}) {
  const timeZone = useProject((state) => {
    const selected = state.projects.find((project) => project.id === state.selectedProjectId);
    return selected?.timezone || 'Asia/Seoul';
  });
  const { selectedPersonIds } = useUserFilter();
  /*
   * 무엇을 "그 달에 쓴 돈"으로 셀지. 머리글의 더보기에서 고른다 (거래 화면과 같은 둘).
   *
   * 기본은 회차 기준이다. 할부를 산 달에 전액으로 세면 그 달만 혼자 튀고, 실제로 매달
   * 빠져나가는 돈은 어느 달에서도 보이지 않는다.
   */
  const basis = useLedgerBasis((state) => state.basis);
  const myPersonId = useProject((state) => {
    const selected = state.projects.find((project) => project.id === state.selectedProjectId);
    return selected?.myPersonId ?? null;
  });

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [summary, setSummary] = useState<ReportDto.Summary | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  /** 사본이 채워질 때마다 올라간다 (홈 훅과 같은 이유). 웹에서는 0에 머문다. */
  const mirrorVersion = useMirrorVersion();
  /**
   * 거래를 고치고 나면 올라가는 번호.
   *
   * 분류별·수단별 탭은 각자 서버에서 데이터를 받는다. 이 화면의 목록만 다시 불러오면
   * 그 탭들은 고치기 전 값을 계속 보여 준다.
   */
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const loadReference = async () => {
      try {
        setIsLoading(true);
        const port = homeDataPort();
        const [accountsData, peopleData, cardsData, categoriesData] = await Promise.all([
          port.getAccountsV2(projectId),
          port.getPeople(projectId),
          port.getCards(projectId),
          port.getCategories(projectId),
        ]);
        if (cancelled) return;

        setAccounts(accountsData || []);
        // 저장된 자산주인 선택은 usePersonFilterSync 가 이 목록에 맞춘다.
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setCategories(categoriesData || []);
      } catch (error) {
        console.error('가계 기준 데이터 조회 실패:', error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadReference();

    return () => {
      cancelled = true;
    };
  }, [projectId, mirrorVersion]);

  usePersonFilterSync(projectId, people);

  /**
   * 서버로 보내는 필터.
   *
   * 체크 상태를 그대로 넘긴다. 전부 고른 경우만 파라미터를 빼서 서버가 필터 없는
   * 기본 경로를 타게 하고(사람을 새로 추가해도 자동 포함), 하나도 고르지 않았으면
   * 빈 값을 보내 "결과 없음"을 뜻하게 한다. 빼는 것과 빈 값은 서버에서 다르게 읽는다.
   */
  const entryFilter = useMemo<EntryFilterQuery>(() => {
    const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;

    return {
      ...(allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
    };
  }, [people.length, selectedPersonIds]);
  const filter = useDebouncedValue(entryFilter, 250);

  /*
   * 검색을 조회 조건과 기간으로 나눈다. 객체는 렌더마다 새로 만들어지므로 의존성에는
   * 문자열로 굳힌 값을 쓴다.
   *
   * 기간은 서버로 보내지 않고 받은 뒤 날짜로 자른다. 이 훅은 한 달을 통째로 받아
   * 달력을 채우는데, 조회 구간을 좁히면 회차 기준 할부를 옮겨 오는 구간까지 함께 좁아진다.
   * 기간을 잘못 적었으면(searchRange 가 null) 목록 보기와 같이 기간 조건이 없는 것으로 본다.
   */
  const searchQueryKey = search ? JSON.stringify(toEntrySearchQuery(search)) : '{}';
  const searchPeriod = search ? searchRange(search) : null;
  const searchPeriodKey = searchPeriod
    ? `${searchPeriod.startKey ?? ''}~${searchPeriod.endKey ?? ''}`
    : '';

  const isRangeMode = Boolean(rangeStart && rangeEnd);
  /**
   * 지금 보고 있는 구간.
   *
   * 목록 API 는 인스턴트를, 리포트 API 는 달력 날짜를 받는다. 같은 구간을 두 형식으로
   * 만들어 두 곳에 넘긴다. 한쪽만 바꾸면 목록과 상단 합계가 서로 다른 구간을 본다.
   */
  const reportPeriod: ReportPeriod = isRangeMode
    ? { startDate: rangeStart as string, endDate: rangeEnd as string }
    : { yearMonth: `${year}-${String(month).padStart(2, '0')}` };
  const entryRange = isRangeMode
    ? dayRangeQuery(rangeStart as string, rangeEnd as string, timeZone)
    : monthQueryRange(year, month, timeZone);
  // 객체는 렌더마다 새로 만들어지므로 의존성에는 값을 쓴다.
  const rangeKey = `${entryRange.startDate}~${entryRange.endDate}`;

  const reloadPeriod = useCallback(async () => {
    if (!projectId) return;

    try {
      setHasError(false);
      /*
       * 커서를 끝까지 따라간다. 한 페이지만 받으면 목록이 잘리는 것보다, 달력의 일별
       * 합계가 조용히 과소 집계되는 것이 문제다. 상단 요약은 서버가 전량으로 계산하므로
       * 같은 화면 안에서 숫자가 어긋난다.
       */
      const port = homeDataPort();
      /*
       * 회차 기준이면 **지난달에 산 할부도 이 달의 줄이 된다.**
       *
       * 할부는 회차가 서는 달마다 그 달의 원금과 이자만 든다. 지난달에 산 할부의
       * 이번 달 회차는 목록 질의에 걸리지 않으므로(전표 날짜로 자른다) 따로 받아
       * 합친 뒤, 구간에 서는 회차만 남기고 날짜를 그 달로 옮긴다.
       *
       * 발생 기준이면 그 한 벌을 아예 받지 않는다 -- 산 달에 전액을 세는 규칙이라
       * 합칠 것도 옮길 것도 없고, 받아 두면 지난달 거래가 이 달 목록에 그대로 낀다.
       */
      const spread = basis === 'installment';
      const searchQuery = JSON.parse(searchQueryKey) as EntrySearchQuery;
      const [entryRows, pastRows, summaryRow] = await Promise.all([
        port.getAllEntries({ ...entryRange, ...filter, ...searchQuery, basis }, projectId),
        spread
          ? port.getInstallmentRows({ ...entryRange, ...filter, ...searchQuery }, projectId)
          : Promise.resolve([] as EntryListItem[]),
        port.getSummary(reportPeriod, projectId, { ...filter, basis }),
      ]);

      const rows = [...((entryRows ?? []) as EntryListItem[]), ...(pastRows ?? [])];
      const viewed = spread
        ? installmentEntryViews(rows, {
            timeZone,
            from: entryRange.startDate,
            to: entryRange.endDate,
          })
        : rows;
      /*
       * 검색 기간. 회차를 그 달로 옮긴 뒤에 자른다 -- 달력에 서는 날짜가 그것이다.
       * 날짜 키는 0을 채운 문자열이라 사전순 비교가 곧 날짜 비교다. 없는 쪽은 열려 있다.
       */
      const [periodStart, periodEnd] = searchPeriodKey.split('~');
      setEntries(
        searchPeriodKey
          ? viewed.filter((entry) => {
              const key = dateKeyOf(entry.date, timeZone);
              return (!periodStart || key >= periodStart) && (!periodEnd || key <= periodEnd);
            })
          : viewed,
      );
      setSummary(summaryRow ?? null);
    } catch (error) {
      console.error('거래 조회 실패:', error);
      setEntries([]);
      setHasError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rangeKey, filter, basis, timeZone, mirrorVersion, searchQueryKey, searchPeriodKey]);

  useEffect(() => {
    reloadPeriod();
  }, [reloadPeriod]);

  /** 거래를 저장하거나 지운 뒤. 목록·합계와 다른 탭이 함께 다시 읽는다. */
  const reloadAll = useCallback(async () => {
    await reloadPeriod();
    setDataVersion((version) => version + 1);
  }, [reloadPeriod]);

  /**
   * 아래 탭들이 그대로 실어 보내는 조건.
   *
   * 세는 기준을 함께 싣는다 -- 분류별·수단별이 목록·상단 합계와 다른 기준으로 세면
   * 한 화면 안에서 숫자가 갈린다.
   */
  const scope = useMemo(() => ({ ...filter, basis }), [filter, basis]);

  return {
    accounts,
    people,
    cards,
    categories,
    myPersonId,
    selectedPersonIds,

    entries,
    summary,
    filter: scope,
    /**
     * 필터가 걸려 있는지. 목록이 비었을 때 까닭을 알려 주는 데 쓴다.
     *
     * 세는 기준은 거르는 조건이 아니라 세는 방식이라 여기서 빠진다 -- 넣으면 아무것도
     * 고르지 않은 화면에서도 "필터 때문에 비었다"로 읽힌다.
     */
    isFilterNarrowed:
      Object.keys(filter).length > 0 || searchQueryKey !== '{}' || searchPeriodKey !== '',

    reportPeriod,
    entryRange,
    isRangeMode,

    isLoading,
    hasError,
    dataVersion,
    reloadAll,
    /**
     * 이 구간의 거래와 합계만 다시 받는다.
     *
     * 다른 탭까지 건드리지 않는다. 날짜별 보기로 돌아왔을 때처럼 눈앞의 값만 새로
     * 맞추면 되는 자리에 쓴다. 거래를 고친 뒤에는 reloadAll 로 전부 맞춘다.
     */
    reloadEntries: reloadPeriod,
  };
}
