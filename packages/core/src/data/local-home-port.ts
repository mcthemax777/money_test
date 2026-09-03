/**
 * 홈 화면의 값을 기기 사본에서 만든다.
 *
 * 합계와 순자산, 예산 사용액은 `@money/types` 의 집계 함수가 낸다. 서버도 같은
 * 함수를 쓰므로 같은 사본에서 같은 값이 나온다.
 *
 * 홈 화면이 쓰는 값은 모두 사본에서 난다. 결제수단별 집계와 카드 실적, 투자 계좌의
 * 시가까지 들어왔다.
 *
 * 그래도 서버 창구를 아주 놓지는 않는다. 사본이 낼 수 없는 경우가 남아 있고(설정이
 * 빠진 신용카드), 그때는 서버가 그 사정을 오류로 말해 주는 쪽이 맞다. 값을 지어내지
 * 않는 것이 이 파일의 규칙이다. 0원은 "쓰지 않았다"는 뜻이지 "아직 모른다"가 아니다.
 */

import {
  type BudgetDto,
  type CardDto,
  type EntryFilterQuery,
  type EntrySearchQuery,
  Dec,
  type PaymentMethodAccount,
  type ReportDto,
  categoryBreakdown,
  categoryUsage,
  creditUsagePeriods,
  currencyDecimals,
  debitUsagePeriods,
  entryMonths,
  isBudgetApplicable,
  netWorth,
  parseEntrySearch,
  paymentMethods,
  performanceOf,
  summarize,
  toListItem,
  totalUsage,
  zonedDateKey,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import type { HomeDataPort } from './home-port';
import type { LocalStore } from './local-store';

/** 서버 창구. 사본이 낼 수 없는 값을 물어볼 곳이다. */
export interface LocalHomePortOptions {
  fallback: HomeDataPort;
  /** 사본에서 낸 값임을 알리고 싶을 때. 화면이 "오프라인" 표시를 켜는 자리다. */
  onLocalRead?: (name: string) => void;
}

export function createLocalHomePort(
  store: LocalStore,
  { fallback, onLocalRead }: LocalHomePortOptions,
): HomeDataPort {
  const note = (name: string) => onLocalRead?.(name);

  /** 표시 통화로 옮기는 곱셈. 합계에만 한 번 곱한다. */
  const converter = async (projectId: string) => {
    const project = await store.projectRow(projectId);
    const ledger = project?.ledgerCurrency ?? 'KRW';
    const display = project?.displayCurrency ?? ledger;

    if (ledger === display) {
      return { display, ledger, toString: (value: Dec) => value.toString(), rate: Dec.of(1) };
    }

    const rate = Dec.of((await store.latestRate(projectId, ledger, display)) ?? '1');
    const decimals = currencyDecimals(display);
    return {
      display,
      ledger,
      rate,
      toString: (value: Dec) => value.times(rate).round(decimals).toString(),
    };
  };

  /**
   * 그 구간의 카테고리 다리.
   *
   * 양끝은 달력 키 문자열로 자른다. 키가 "YYYY-MM-DD" 로 0을 채운 값이라
   * `<= '2026-08-31'` 이 그 달의 마지막 날까지를 정확히 담는다(달의 길이를 몰라도 된다).
   * 그 키는 이미 프로젝트 타임존으로 계산해 넣은 값이므로 여기서 타임존을 다시 볼 일이 없다.
   */
  const monthPostings = (
    projectId: string,
    period: ReportPeriod,
    filter?: EntryFilterQuery & EntrySearchQuery & { personId?: string },
  ) =>
    store.categoryPostings(projectId, {
      ...periodKeys(period),
      ownerIds: ownerIdsOf(filter),
      // 거래 화면의 검색. 고르지 않았으면 조건이 서지 않는다.
      search: parseEntrySearch(filter ?? {}),
    });

  return {
    async getPeople(projectId) {
      note('people');
      return store.personRows(requireProject(projectId));
    },

    async getCards(projectId) {
      note('cards');
      return store.cardRows(requireProject(projectId));
    },

    async getAccountsV2(projectId) {
      note('accounts');
      return store.accountRows(requireProject(projectId));
    },

    async getCategories(projectId) {
      note('categories');
      return store.categoryRows(requireProject(projectId));
    },

    async getTags(projectId) {
      note('tags');
      return store.tagRows(requireProject(projectId));
    },

    async getNetWorth(projectId) {
      const id = requireProject(projectId);
      note('netWorth');

      const show = await converter(id);
      const result = netWorth(await store.netWorthRows(id), {
        ledgerCurrency: show.ledger,
        displayCurrency: show.display,
        // 계좌 통화별 환율. 사본에 담긴 것만 쓴다. 없으면 1로 본다.
        toDisplay: await ratesFor(store, id, show.display),
        ledgerToDisplay: show.rate,
      });

      const byType: ReportDto.NetWorthByType = {};
      for (const [type, amount] of result.byType) {
        if (amount.isZero()) continue;
        byType[type] = amount.toString();
      }

      return {
        total: result.total.toString(),
        cash: result.cash.toString(),
        investment: result.investment.toString(),
        liability: result.liability.toString(),
        unrealizedGain: result.unrealizedGain.toString(),
        byType,
        byPerson: result.byPerson.map((bucket) => ({
          personId: bucket.personId,
          personName: bucket.personName,
          total: bucket.total.toString(),
          cash: bucket.cash.toString(),
          investment: bucket.investment.toString(),
          liability: bucket.liability.toString(),
          byType: Object.fromEntries(
            [...bucket.byType].filter(([, v]) => !v.isZero()).map(([k, v]) => [k, v.toString()]),
          ) as ReportDto.NetWorthByType,
        })),
      };
    },

    async getSummary(period, projectId, filter) {
      const id = requireProject(projectId);
      note('summary');

      const rows = await monthPostings(id, period, filter);
      const totals = summarize(rows, extraOf(filter));
      const show = await converter(id);

      const keys = periodKeys(period);
      return {
        startDate: keys.fromDateKey,
        endDate: keys.toDateKey,
        // 한 달을 본 경우에만 채운다. 서버의 periodLabel 과 같은 규칙이다.
        ...(period.yearMonth ? { yearMonth: period.yearMonth } : {}),
        income: show.toString(totals.income),
        expense: show.toString(totals.expense),
        extraExpense: show.toString(totals.extraExpense),
        normalExpense: show.toString(totals.normalExpense),
        extraIncome: show.toString(totals.extraIncome),
        normalIncome: show.toString(totals.normalIncome),
        net: show.toString(totals.net),
      };
    },

    async getBudgetForMonth(year, month, projectId, filter) {
      const id = requireProject(projectId);
      note('budgets');

      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const [rows, categories, budgets, show] = await Promise.all([
        monthPostings(id, { yearMonth }, filter),
        store.categories(id),
        store.budgets(id, year, month),
        converter(id),
      ]);

      const usage = categoryUsage(rows, categories, extraOf(filter));
      const applicable = budgets.filter((budget) => isBudgetApplicable(budget, yearMonth));
      const byCategory = new Map(applicable.filter((b) => b.categoryId).map((b) => [b.categoryId!, b]));
      const byType = new Map(applicable.filter((b) => !b.categoryId && b.type).map((b) => [b.type!, b]));
      const names = await store.categoryRows(id);
      const nameOf = new Map(names.map((row) => [row.id, row]));
      const hasChildren = new Set(names.map((row) => row.parentId).filter(Boolean) as string[]);

      const rowOf = (
        budget: (typeof applicable)[number] | undefined,
        categoryId: string | undefined,
        categoryType: 'income' | 'expense',
        usedAmount: Dec,
      ): BudgetDto.MonthlyBudget => {
        const category = categoryId ? nameOf.get(categoryId) : undefined;
        const amount = budget?.overrideAmount ?? budget?.monthlyAmount ?? '0';

        return {
          budgetId: budget?.id ?? `placeholder-${categoryId ?? `total-${categoryType}`}`,
          categoryId,
          categoryName: category?.name ?? (categoryType === 'expense' ? '전체 지출' : '전체 수입'),
          categoryType,
          parentCategoryId: category?.parentId ?? undefined,
          monthlyAmount: show.toString(Dec.of(amount)),
          ruleAmount: show.toString(Dec.of(budget?.monthlyAmount ?? '0')),
          usedAmount: show.toString(usedAmount),
          isOverridden: Boolean(budget?.overrideAmount),
          overrideId: budget?.overrideId ?? undefined,
          effectiveFrom: budget?.effectiveFrom ?? undefined,
          effectiveTo: budget?.effectiveTo ?? undefined,
          hasChildren: categoryId ? hasChildren.has(categoryId) : hasChildren.size > 0,
        };
      };

      const result: BudgetDto.MonthlyBudget[] = [];
      for (const type of ['expense', 'income'] as const) {
        result.push(rowOf(byType.get(type), undefined, type, totalUsage(usage, categories, type)));
      }
      for (const category of names) {
        if (!category.isActive) continue;
        result.push(
          rowOf(
            byCategory.get(category.id),
            category.id,
            category.type as 'income' | 'expense',
            usage.get(category.id)?.amount ?? Dec.of(0),
          ),
        );
      }
      return result;
    },

    /**
     * 결제수단별 집계.
     *
     * 세는 규칙은 서버와 같은 함수를 쓴다. 여기서 하는 일은 사본에서 재료를 고르는
     * 것과 실적 기준액을 표시 통화로 옮기는 것뿐이다.
     */
    /**
     * 분류별 구성비. 거래 화면의 분류별 목록이 쓴다.
     *
     * 롤업(소분류를 대분류로 합치기)과 비율까지 공용 함수가 낸다. 사본이 손수 더하면
     * 같은 달의 구성비가 웹과 앱에서 갈린다.
     */
    async getCategoryBreakdown(period, type, projectId, options) {
      const id = requireProject(projectId);
      note('categoryBreakdown');

      const rows = await monthPostings(id, period, options);
      const show = await converter(id);

      return categoryBreakdown(rows, {
        type,
        // 쿼리스트링을 거치지 않는 자리라 값이 그대로 온다. 기본은 롤업이다.
        rollup: options?.rollup !== false,
        extra: extraOf(options),
      }).map((bucket) => ({
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        parentCategoryId: bucket.parentCategoryId,
        parentCategoryName: bucket.parentCategoryName,
        amount: show.toString(bucket.amount),
        count: bucket.count,
        ratio: bucket.ratio,
      }));
    },

    /**
     * 거래가 있는 달. 기간을 주면 그 구간에 걸친 달만이다.
     *
     * 달을 자르는 일은 `entryMonths` 가 프로젝트 타임존으로 한다. 사본에 이미
     * `yearMonth` 컬럼이 박혀 있지만 그것을 쓰지 않는 이유가 있다 -- 서버와 같은 함수를
     * 거쳐야 경계 규칙이 한 벌로 남는다. 그 컬럼은 질의로 **고르는** 데 쓰는 것이고,
     * 여기서 하는 일은 고른 것을 **묶는** 것이다.
     */
    async getEntryMonths(projectId, filter) {
      const id = requireProject(projectId);
      note('entryMonths');

      const timeZone = await timeZoneOf(store, id);
      /*
       * 고른 기간. 없으면 전체다 -- 달력 키가 0을 채운 문자열이라 양끝을 이렇게
       * 잡으면 전부 든다.
       *
       * 날짜는 여기서도 달력 날짜다(EntryMonthsQuery). 걸친 달의 합계가 구간만큼만
       * 세어지는 것이 요점이다. 달을 통째로 세면 년월 줄의 금액과 그 안을 펴서 나온
       * 거래의 합이 어긋난다.
       */
      const scope = {
        fromDateKey: filter?.startDate && filter?.endDate ? filter.startDate : '0000-01-01',
        toDateKey: filter?.startDate && filter?.endDate ? filter.endDate : '9999-12-31',
        ownerIds: ownerIdsOf(filter),
        search: parseEntrySearch(filter ?? {}),
      };
      const [rows, dates, show] = await Promise.all([
        store.categoryPostings(id, scope),
        // 이체·카드정산은 카테고리 다리가 없어 다리만 보면 달이 만들어지지 않는다.
        store.entryDates(id, scope),
        converter(id),
      ]);

      return entryMonths(rows, { timeZone, extra: extraOf(filter), entryDates: dates }).map((month) => ({
        yearMonth: month.yearMonth,
        income: show.toString(month.income),
        expense: show.toString(month.expense),
      }));
    },

    async getPaymentMethods(period, projectId, filter) {
      const id = requireProject(projectId);
      note('paymentMethods');

      const [entries, accounts, cards, show] = await Promise.all([
        store.viewEntries(id, {
          ...periodKeys(period),
          ownerIds: ownerIdsOf(filter),
          // 거래 화면의 검색. 이것을 빠뜨리면 고르지 않은 카드가 금액을 갖고 목록에 남는다.
          search: parseEntrySearch(filter ?? {}),
        }),
        store.accounts(id),
        store.cardsForPaymentMethods(id),
        converter(id),
      ]);

      /*
       * 실적 기준액을 표시 통화로 옮긴다.
       *
       * 카드에 저장된 값은 결제 통장의 통화다. 통장 통화는 카드마다 다를 수 있어
       * 통화별로 환율을 한 번씩 고른다. 사본에 그 환율이 없으면 기준액을 내지 않는다.
       * 1로 눙치면 달러 카드의 기준액이 원화 사용액과 나란히 놓여 달성률이 뒤집힌다.
       */
      const rates = new Map<string, string | null>();
      for (const currency of new Set(cards.map((card) => card.paymentCurrency))) {
        rates.set(
          currency,
          currency === show.display ? '1' : await store.latestRate(id, currency, show.display),
        );
      }

      const items = entries.map((entry) =>
        toListItem(entry, { convert: (value) => value.times(show.rate), rate: show.rate }),
      );

      return paymentMethods(
        items,
        accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type as PaymentMethodAccount['type'],
          isActive: account.isActive,
          ownerId: account.ownerId,
          ownerName: account.ownerName,
        })),
        cards.map((card) => {
          const rate = rates.get(card.paymentCurrency) ?? null;
          return {
            id: card.id,
            name: card.name,
            cardType: card.cardType,
            isActive: card.isActive,
            color: card.color,
            statementClosingDay: card.statementClosingDay,
            performanceTarget:
              card.performanceAmount === null || rate === null
                ? null
                : Dec.of(card.performanceAmount)
                    .times(rate)
                    .round(currencyDecimals(show.display))
                    .toString(),
            ownerId: card.ownerId,
            ownerName: card.ownerName,
          };
        }),
        {
          personIds: ownerIdsOf(filter) ?? null,
          extraOnly: extraOf(filter),
          matchNothing: ownerIdsOf(filter)?.length === 0,
        },
      );
    },

    /**
     * 카드 실적 진행 상황.
     *
     * 주기를 자르고 할부를 나누는 규칙은 서버와 같은 함수(card-usage)가 갖는다.
     * 사본이 낼 수 없는 카드(설정이 빠진 신용카드)는 서버에 물어본다.
     */
    async getCardPerformance(cardId): Promise<CardDto.PerformanceResponse> {
      const card = await store.cardForPerformance(cardId);

      /*
       * 사본에 없거나 신용카드인데 마감일 설정이 비어 있으면 계산할 수 없다.
       * 서버가 그 경우 오류를 주는 쪽이 맞으므로 그대로 넘긴다.
       */
      const isCredit = card?.cardType === 'credit';
      const usable =
        card &&
        (!isCredit ||
          (card.statementClosingDay !== null &&
            card.paymentDueDay !== null &&
            card.liabilityAccountId !== null));
      if (!card || !usable) return fallback.getCardPerformance(cardId);

      note('cardPerformance');
      const timeZone = await timeZoneOf(store, card.projectId);

      if (isCredit) {
        const { periods } = creditUsagePeriods({
          postings: await store.creditCardPostings(card.liabilityAccountId!),
          statementClosingDay: card.statementClosingDay!,
          paymentDueDay: card.paymentDueDay!,
          timeZone,
          // 앞이 지난 주기, 뒤가 진행 중인 주기다.
          span: 2,
        });
        const [previous, current] = periods;

        return performanceOf({
          cardId: card.id,
          currency: card.liabilityCurrency ?? card.paymentCurrency,
          basis: 'statement',
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          usage: current.usage,
          previousPeriodStart: previous.periodStart,
          previousPeriodEnd: previous.periodEnd,
          previousUsage: previous.usage,
          target: card.performanceAmount,
        });
      }

      const [previous, current] = debitUsagePeriods({
        postings: await store.debitCardPostings(card.id),
        timeZone,
        span: 2,
      });

      return performanceOf({
        cardId: card.id,
        currency: card.paymentCurrency,
        basis: 'month',
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
        usage: current.usage,
        previousPeriodStart: previous.periodStart,
        previousPeriodEnd: previous.periodEnd,
        previousUsage: previous.usage,
        target: card.performanceAmount,
      });
    },

    /**
     * 그 구간의 거래 목록.
     *
     * 목록 API 는 인스턴트(startDate·endDate)를 받지만 사본은 달력 키로 고른다.
     * 두 값이 같은 구간을 가리키도록 인스턴트를 프로젝트 타임존의 달력 키로 옮긴다.
     */
    async getAllEntries(query, projectId) {
      const id = requireProject(projectId);
      note('entries');

      const project = await store.projectRow(id);
      const timeZone = project?.timeZone ?? 'Asia/Seoul';
      const show = await converter(id);

      const entries = await store.viewEntries(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        // 한 달만 볼 때는 박아 둔 컬럼을 쓴다. 달 길이도 시차도 다시 따질 것이 없다.
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search: parseEntrySearch(query),
      });

      const extra = extraOf(query);
      const rows = entries.map((entry) =>
        toListItem(entry, { convert: (value) => value.times(show.rate), rate: show.rate }),
      );

      /*
       * 일반/과소비 필터.
       *
       * 서버는 "그 몫이 있는 다리를 가진 전표"를 고른다. 한 줄이 둘로 나뉜 거래는
       * 양쪽 목록에 모두 들어야 목록과 합계가 어긋나지 않는다.
       */
      if (extra === undefined) return rows;
      return rows.filter((row) => hasSelectedShare(row, extra));
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

      const project = await store.projectRow(id);
      const timeZone = project?.timeZone ?? 'Asia/Seoul';
      const show = await converter(id);
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const extra = extraOf(query);

      const page = await store.viewEntriesPage(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search: parseEntrySearch(query),
        limit,
        cursor: decodeCursor(query.cursor),
      });

      const rows = page.entries
        .map((entry) =>
          toListItem(entry, { convert: (value) => value.times(show.rate), rate: show.rate }),
        )
        .filter((row) => extra === undefined || hasSelectedShare(row, extra));

      const last = page.entries[page.entries.length - 1];
      return {
        data: rows,
        nextCursor: page.hasMore && last ? encodeCursor(String(last.date), last.id) : null,
      };
    },
  };
}

/**
 * 프로젝트 타임존. 달력 경계를 자를 때 쓴다.
 *
 * 사본에 프로젝트 행이 아직 없으면(첫 동기화 전) 서울로 본다. 목록의 달력 키는 이미
 * 동기화할 때 박아 둔 값이라 이 기본값에 기대지 않는다.
 */
async function timeZoneOf(store: LocalStore, projectId: string): Promise<string> {
  const project = await store.projectRow(projectId);
  return project?.timeZone ?? 'Asia/Seoul';
}

function requireProject(projectId?: string | null): string {
  if (!projectId) {
    throw new Error('사본을 읽으려면 프로젝트를 골라야 합니다.');
  }
  return projectId;
}

/** 창구가 받는 구간은 한 달이거나 임의 구간이다. 홈은 한 달만 본다. */
function monthOf(period: ReportPeriod): string {
  if (period.yearMonth) return period.yearMonth;
  return String(period.startDate).slice(0, 7);
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
function periodKeys(period: ReportPeriod): { fromDateKey: string; toDateKey: string } {
  if (period.yearMonth) {
    return { fromDateKey: `${period.yearMonth}-01`, toDateKey: `${period.yearMonth}-31` };
  }
  return { fromDateKey: String(period.startDate), toDateKey: String(period.endDate) };
}

/** 일반/과소비 선택. 서버의 parseEntryFilter 와 같은 규칙이다. */
function extraOf(filter?: EntryFilterQuery): boolean | undefined {
  if (filter?.extraTypes === undefined) return undefined;

  const types = filter.extraTypes.split(',').map((value) => value.trim()).filter(Boolean);
  const wantsNormal = types.includes('normal');
  const wantsExtra = types.includes('extra');
  if (wantsNormal === wantsExtra) return undefined;
  return wantsExtra;
}

/** 계좌 통화 -> 표시 통화 환율. 사본에 있는 것만 모은다. */
async function ratesFor(
  store: LocalStore,
  projectId: string,
  display: string,
): Promise<Record<string, string>> {
  const accounts = await store.accounts(projectId);
  const result: Record<string, string> = { [display]: '1' };

  for (const currency of new Set(accounts.map((account) => account.currency))) {
    if (result[currency]) continue;
    result[currency] = (await store.latestRate(projectId, currency, display)) ?? '1';
  }
  return result;
}

/**
 * 고른 자산 주인. 서버의 `parseEntryFilter` 와 같은 세 상태를 지킨다.
 *
 *   키가 없음  = 전체 (undefined)
 *   값이 있음  = 그 사람들만
 *   빈 문자열  = 아무것도 고르지 않음 -> 결과 없음 (빈 배열)
 */
function ownerIdsOf(filter?: EntryFilterQuery & { personId?: string }): string[] | undefined {
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
function dateKeyOf(value: string | undefined, timeZone: string, fallbackKey: string): string {
  if (!value) return fallbackKey;
  return zonedDateKey(new Date(value), timeZone);
}

/**
 * 고른 몫이 남아 있는 줄인가.
 *
 * 한 줄이 일반과 과소비로 나뉘므로(3,000원 중 2,000원이 과소비) 양쪽 목록에 모두
 * 들어야 목록과 합계가 어긋나지 않는다. 서버의 extraPostingCondition 과 같은 규칙이다.
 */
function hasSelectedShare(row: { amount?: string; extraAmount?: string }, extra: boolean): boolean {
  const extraAmount = Dec.of(row.extraAmount ?? '0');
  const total = Dec.of(row.amount ?? '0');
  return extra ? extraAmount.isPositive() : total.minus(extraAmount).isPositive();
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
