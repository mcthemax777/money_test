import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BudgetDto, CardDto, EntryFilterQuery, ReportDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { dateMarkerKey, formatMonthShort } from '../lib/datetime';
import { sumNetWorth } from '../lib/net-worth';
import type { Account, Card, Category, Person } from '../lib/types';
import { useProject } from '../store/project';
import { useUserFilter } from '../store/user-filter';
import { useDebouncedValue } from './useDebouncedValue';
import { usePersonFilterSync } from './usePersonFilterSync';

/**
 * 실적 구간 카드 한 장.
 *
 * 결제수단 집계와 카드 실적 조회를 합친 모양이다. 웹의 카드 줄과 앱의 카드 줄이
 * 같은 값을 그리므로 여기 둔다.
 */
export interface SpendingMethod {
  id: string;
  kind: 'credit_card' | 'debit_card';
  /** 카드에 고른 앞면 색(CardColor). 고르지 않았으면 종류의 기본색으로 그린다. */
  color?: string | null;
  name: string;
  ownerName: string | null;
  /** 사용액·기준액의 통화. 카드 결제 통장의 통화다. */
  currency: string;
  /** 지금 세고 있는 구간 표시 ("8/16 ~ 9/15") */
  periodLabel: string;
  usage: string;
  /** 직전 구간 표시와 사용액. 1일에 지난 구간을 확인하러 가지 않게 함께 적는다. */
  previousPeriodLabel: string;
  previousUsage: string;
  /** 실적 기준액. 조건이 없는 카드는 null */
  target: string | null;
}

/** 카드 줄에 세우는 순서. 신용카드가 먼저다. */
const METHOD_ORDER: Record<SpendingMethod['kind'], number> = {
  credit_card: 0,
  debit_card: 1,
};

/** `@db.Date` 값의 "8/16". 카드 앞면은 좁아서 연도까지 적을 자리가 없다. */
function shortMarker(marker: string): string {
  const key = dateMarkerKey(marker);
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

/**
 * 카드가 세고 있는 구간 표시. 신용카드만 달력의 달과 어긋난다.
 *
 * 날짜만 적는다. 카드 앞면에서 위는 이번 구간, 아래는 직전 구간 자리로 이미 갈려 있어
 * "마감 기준"·"직전" 같은 말을 붙이면 좁은 자리를 두 번 쓰는 셈이다.
 */
function periodLabelOf(performance: CardDto.PerformanceResponse, previous: boolean): string {
  const start = previous ? performance.previousPeriodStart : performance.periodStart;
  const end = previous ? performance.previousPeriodEnd : performance.periodEnd;

  if (performance.basis === 'month') {
    return formatMonthShort(Number(dateMarkerKey(end).slice(5, 7)));
  }

  return `${shortMarker(start)} ~ ${shortMarker(end)}`;
}

/** 팝업 안에서 새로 만든 것들. 화면이 들고 있는 목록에 반영한다. */
export interface ReferencePatch {
  accounts?: Account[];
  cards?: Card[];
  categories?: Category[];
  people?: Person[];
}

/**
 * 홈 화면이 보는 값 전부 (그래프 제외).
 *
 * 웹과 앱이 같은 화면을 그리므로 조회와 판단을 여기 한 곳에 둔다. 그래프는 웹에만
 * 있어 부르는 쪽에 남겨 두었다.
 *
 * 오류는 문구가 아니라 `hasError` 로 알린다. 사전을 읽는 일은 화면의 몫이다.
 */
export function useHomeData({
  projectId,
  year,
  month,
  thisYearMonth,
}: {
  projectId: string | null;
  year: number;
  month: number;
  /** 실적 구간 카드가 셀 달. 보고 있는 달이 아니라 지금 달이다. */
  thisYearMonth: string;
}) {
  const { selectedPersonIds } = useUserFilter();
  const myPersonId = useProject((state) => {
    const selected = state.projects.find((project) => project.id === state.selectedProjectId);
    return selected?.myPersonId ?? null;
  });

  const [people, setPeople] = useState<Person[]>([]);
  /** 구성원 목록을 받아 봤는지. 아직이면 필터를 만들 수 없어 조회를 미룬다. */
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  const [budgets, setBudgets] = useState<BudgetDto.MonthlyBudget[]>([]);
  const [summary, setSummary] = useState<ReportDto.Summary | null>(null);
  const [methods, setMethods] = useState<SpendingMethod[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  /** 거래를 고친 뒤 목록과 합계를 다시 받게 하는 표. */
  const [entryVersion, setEntryVersion] = useState(0);
  /** 대금을 기록한 뒤 카드 사용 현황을 다시 읽게 하는 표. */
  const [cardVersion, setCardVersion] = useState(0);

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const loadReference = async () => {
      try {
        const [peopleData, cardsData, accountsData, categoryData] = await Promise.all([
          apiClient.getPeople(projectId),
          apiClient.getCards(projectId),
          apiClient.getAccountsV2(projectId),
          apiClient.getCategories(projectId),
        ]);
        if (cancelled) return;

        // 저장된 자산주인 선택은 usePersonFilterSync 가 이 목록에 맞춘다.
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setAccounts(accountsData || []);
        setCategories(categoryData || []);
        setPeopleLoaded(true);
      } catch (error) {
        console.error('구성원·카드 조회 실패:', error);
        if (cancelled) return;
        setHasError(true);
        setIsLoading(false);
      }
    };

    loadReference();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  usePersonFilterSync(projectId, people);

  const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;

  /**
   * 서버로 보내는 필터.
   *
   * 전부 고른 경우만 파라미터를 빼서 서버가 필터 없는 경로를 타게 하고(주인이 없는
   * 계좌까지 담긴다), 하나도 고르지 않았으면 빈 값을 보내 "결과 없음"을 뜻하게 한다.
   */
  const entryFilter = useMemo<EntryFilterQuery>(
    () => (allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
    [allPeopleSelected, selectedPersonIds],
  );
  const filter = useDebouncedValue(entryFilter, 250);

  useEffect(() => {
    if (!projectId || !peopleLoaded) return;
    /*
     * 구성원이 없는 프로젝트.
     *
     * 저장된 선택은 아직 다른 프로젝트 것일 수 있고(usePersonFilterSync 가 맞출 대상이
     * 없어 그대로 둔다), 그 선택으로 조회하면 남의 프로젝트 id 로 거른 결과가 나온다.
     */
    if (people.length === 0) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadPeriod = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        const [netWorthData, budgetRows, summaryRow, currentMethods] = await Promise.all([
          apiClient.getNetWorth(projectId),
          apiClient.getBudgetForMonth(year, month, projectId, filter),
          apiClient.getSummary({ yearMonth }, projectId, filter),
          apiClient.getPaymentMethods({ yearMonth: thisYearMonth }, projectId, filter),
        ]);
        if (cancelled) return;

        setNetWorth(netWorthData ?? null);
        setBudgets(budgetRows ?? []);
        setSummary(summaryRow ?? null);

        const items: ReportDto.PaymentMethodItem[] = currentMethods ?? [];

        /*
         * 카드는 실적 구간을 카드마다 따로 계산한다(신용카드는 마감일 기준 주기).
         * 위의 결제수단 집계는 달력 월이라 그 값을 쓰면 마감일이 15일인 카드의
         * 실적이 실제 카드사 기준과 달라진다.
         */
        const cardItems = items.filter(
          (item): item is ReportDto.PaymentMethodItem & { kind: SpendingMethod['kind'] } =>
            item.kind !== 'account',
        );
        const performances = await Promise.all(
          cardItems.map((item) =>
            apiClient.getCardPerformance(item.id).catch((error: unknown) => {
              console.error('카드 실적 조회 실패:', error);
              return null;
            }),
          ),
        );
        if (cancelled) return;

        const cardMethods: SpendingMethod[] = cardItems.flatMap((item, index) => {
          const performance = performances[index];
          if (!performance) return [];
          return [
            {
              id: item.id,
              kind: item.kind,
              color: item.color,
              name: item.name,
              ownerName: item.ownerName ?? null,
              currency: performance.currency,
              periodLabel: periodLabelOf(performance, false),
              usage: performance.usage,
              previousPeriodLabel: periodLabelOf(performance, true),
              previousUsage: performance.previousUsage,
              target: performance.target ?? null,
            },
          ];
        });

        setMethods(
          cardMethods.sort(
            (a, b) =>
              METHOD_ORDER[a.kind] - METHOD_ORDER[b.kind] || Number(b.usage) - Number(a.usage),
          ),
        );
      } catch (error) {
        console.error('홈 데이터 조회 실패:', error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadPeriod();

    return () => {
      cancelled = true;
    };
  }, [projectId, peopleLoaded, people.length, filter, year, month, yearMonth, thisYearMonth, entryVersion]);

  /**
   * 고른 자산주인의 총자산.
   *
   * 전원을 고른 때만 서버의 전체 값을 그대로 쓴다. 주인이 없는 계좌는 사람별 소계에
   * 들어가지 않아, 전체를 보면서 소계를 더하면 그만큼 빠진다.
   */
  const scopedNetWorth = useMemo(() => {
    if (allPeopleSelected) return netWorth;

    const byPerson = new Map((netWorth?.byPerson ?? []).map((row) => [row.personId, row]));
    return sumNetWorth(selectedPersonIds.map((id) => byPerson.get(id)));
  }, [allPeopleSelected, netWorth, selectedPersonIds]);

  const applyReferencePatch = useCallback((patch: ReferencePatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  return {
    people,
    peopleLoaded,
    cards,
    accounts,
    categories,
    myPersonId,
    selectedPersonIds,

    netWorth: scopedNetWorth,
    budgets,
    summary,
    methods,

    /** 서버로 보낼 필터. 조회가 겹치지 않게 잠잠해진 뒤의 값이다. */
    filter,
    allPeopleSelected,
    /** 구성원은 있는데 아무도 고르지 않았다. 빈 화면과 뜻이 다르다. */
    hasNoScope: people.length > 0 && selectedPersonIds.length === 0,

    isLoading,
    hasError,

    entryVersion,
    cardVersion,
    /** 거래를 고치거나 지운 뒤. 목록과 합계를 함께 다시 읽는다. */
    reloadEntries: useCallback(() => setEntryVersion((version) => version + 1), []),
    /** 카드 대금을 기록한 뒤. */
    reloadCards: useCallback(() => setCardVersion((version) => version + 1), []),
    applyReferencePatch,
  };
}
