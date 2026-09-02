import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntryFilterQuery, EntryListItem, ReportDto } from '@money/types';

import { homeDataPort } from '../data/home-port';
import { type ReportPeriod } from '../lib/api-client';
import { dayRangeQuery, monthQueryRange } from '../lib/datetime';
import { countedShare } from '../lib/entries';
import type { Account, Card, Category, Person } from '../lib/types';
import { useProject } from '../store/project';
import { useUserFilter } from '../store/user-filter';
import { useDebouncedValue } from './useDebouncedValue';
import { useMirrorVersion } from './useMirrorVersion';
import { usePersonFilterSync } from './usePersonFilterSync';

/** 일반/과소비. 둘 다 고르면 필터를 걸지 않는다. */
export type ExtraType = 'normal' | 'extra';

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
}: {
  projectId: string | null;
  year: number;
  month: number;
  /** 기간 보기. 둘 다 있으면 달 대신 이 구간을 본다 ("YYYY-MM-DD"). */
  rangeStart?: string;
  rangeEnd?: string;
}) {
  const timeZone = useProject((state) => {
    const selected = state.projects.find((project) => project.id === state.selectedProjectId);
    return selected?.timezone || 'Asia/Seoul';
  });
  const { selectedPersonIds } = useUserFilter();
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
  const [selectedExtraTypes, setSelectedExtraTypes] = useState<ExtraType[]>(['normal', 'extra']);

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
    const allExtraSelected = selectedExtraTypes.length === 2;

    return {
      ...(allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
      ...(allExtraSelected ? {} : { extraTypes: selectedExtraTypes.join(',') }),
    };
  }, [people.length, selectedExtraTypes, selectedPersonIds]);
  const filter = useDebouncedValue(entryFilter, 250);

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
      const [entryRows, summaryRow] = await Promise.all([
        port.getAllEntries({ ...entryRange, ...filter }, projectId),
        port.getSummary(reportPeriod, projectId, filter),
      ]);

      setEntries((entryRows ?? []) as EntryListItem[]);
      setSummary(summaryRow ?? null);
    } catch (error) {
      console.error('거래 조회 실패:', error);
      setEntries([]);
      setHasError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rangeKey, filter, mirrorVersion]);

  useEffect(() => {
    reloadPeriod();
  }, [reloadPeriod]);

  /** 거래를 저장하거나 지운 뒤. 목록·합계와 다른 탭이 함께 다시 읽는다. */
  const reloadAll = useCallback(async () => {
    await reloadPeriod();
    setDataVersion((version) => version + 1);
  }, [reloadPeriod]);

  const toggleExtraType = useCallback((value: ExtraType) => {
    setSelectedExtraTypes((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }, []);

  return {
    accounts,
    people,
    cards,
    categories,
    myPersonId,
    selectedPersonIds,

    entries,
    summary,
    /**
     * 일반/과소비 중 어느 몫을 셀지.
     *
     * 한 거래가 둘로 나뉘므로(3,000원 중 2,000원이 과소비) 한쪽만 볼 때는 날짜별
     * 소계도 그 몫만 세야 위 합계와 맞는다. 서버가 리포트에서 쓰는 규칙과 같다.
     */
    share: countedShare(filter),
    filter,
    selectedExtraTypes,
    toggleExtraType,
    /** 필터가 걸려 있는지. 목록이 비었을 때 까닭을 알려 주는 데 쓴다. */
    isFilterNarrowed: Object.keys(filter).length > 0,

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
