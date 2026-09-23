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
  billedShares,
  creditPerformanceShares,
  creditUsagePeriods,
  currencyDecimals,
  debitPerformanceShares,
  debitUsagePeriods,
  entryMonths,
  expandInstallmentRows,
  installmentEntryViews,
  installmentRowDate,
  isEntryPeriodUnit,
  DEFAULT_ENTRY_PERIOD,
  isBudgetApplicable,
  netWorth,
  closingMonthKey,
  closingMonthOf,
  parseEntryBasis,
  parseEntrySearch,
  paymentMethods,
  shiftYearMonth,
  performanceOf,
  periodForClosingMonth,
  usageSpan,
  summarize,
  lineMatcherOf,
  toListItem,
  totalUsage,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
  zonedParts,
  zonedYearMonth,
  fallbackRate,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import type { HomeDataPort } from './home-port';
import type {
  LocalStore,
  StoredCardLedgerPosting,
  StoredPerformanceCard,
} from './local-store';

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
      // 사본에 있는 것이 곧 고를 수 있는 것이다. 감춰진 분류는 없고, 지운 분류는 행이
      // 사라진다 (서버의 `/categories` 와 같은 규칙이다).
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
      const totals = summarize(rows);
      const show = await converter(id);

      const keys = periodKeys(period);
      return {
        startDate: keys.fromDateKey,
        endDate: keys.toDateKey,
        // 한 달을 본 경우에만 채운다. 서버의 periodLabel 과 같은 규칙이다.
        ...(period.yearMonth ? { yearMonth: period.yearMonth } : {}),
        income: show.toString(totals.income),
        expense: show.toString(totals.expense),
        net: show.toString(totals.net),
      };
    },

    async getBudgetForMonth(year, month, projectId, filter) {
      const id = requireProject(projectId);
      note('budgets');

      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const [rows, categories, budgets, show] = await Promise.all([
        /*
         * **회차 기준으로 센다.** 서버와 같은 규칙이다 -- 예산은 "이 달에 이만큼까지
         * 쓴다"는 약속이라, 24개월 할부를 산 달에 전액으로 세면 그 달 하나가 통째로
         * 터지고 남은 달에는 실제로 나가는 돈이 진행률에 잡히지 않는다.
         */
        monthPostings(id, { yearMonth }, { ...filter, basis: 'installment' }),
        store.categories(id),
        store.budgets(id, year, month),
        converter(id),
      ]);

      const usage = categoryUsage(rows, categories);
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
        // 한쪽만 적은 기간은 열린 구간이다. 없는 쪽을 달력 키의 양끝으로 채운다.
        fromDateKey: filter?.startDate || '0000-01-01',
        toDateKey: filter?.endDate || '9999-12-31',
        ownerIds: ownerIdsOf(filter),
        search: parseEntrySearch(filter ?? {}),
      };
      const spread = parseEntryBasis(filter?.basis) === 'installment';
      const [read, dates, show] = await Promise.all([
        store.categoryPostings(id, {
          ...scope,
          // 회차 기준이면 앞에서 산 할부까지 읽는다. 그 회차가 이 구간에 선다.
          ...(spread
            ? {
                fromDateKey: shiftDateKeyMonths(scope.fromDateKey, -INSTALLMENT_LOOKBACK_MONTHS),
                withInstallment: true,
              }
            : {}),
        }),
        // 이체·카드정산은 카테고리 다리가 없어 다리만 보면 달이 만들어지지 않는다.
        store.entryDates(id, scope),
        converter(id),
      ]);

      const rows = spread
        ? expandInstallmentRows(read, timeZone).filter((row) => {
            const key = dateKeyOfRow(row.date, timeZone);
            return key >= scope.fromDateKey && key <= scope.toDateKey;
          })
        : read;
      /*
       * 회차가 선 달도 줄이 되어야 한다. 지난달에 산 할부의 이번 달 회차에는 전표가
       * 없어, 편 줄의 날짜를 함께 넘기지 않으면 그 달이 목록에서 빠진다.
       */
      const monthDates = spread
        ? [...dates, ...rows.map((row) => dateKeyOfRow(row.date, timeZone))]
        : dates;

      // 묶는 단위는 화면이 정한다. 없으면 달이다 (서버의 `getEntryMonths` 와 같다).
      const unit = isEntryPeriodUnit(filter?.unit) ? filter.unit : DEFAULT_ENTRY_PERIOD;

      return entryMonths(rows, { timeZone, entryDates: monthDates, unit }).map((month) => ({
        yearMonth: month.yearMonth,
        income: show.toString(month.income),
        expense: show.toString(month.expense),
      }));
    },

    async getPaymentMethods(period, projectId, filter) {
      const id = requireProject(projectId);
      note('paymentMethods');

      const keys = periodKeys(period);
      const spread = parseEntryBasis(filter?.basis) === 'installment';
      const timeZone = await timeZoneOf(store, id);
      const [entries, accounts, cards, show] = await Promise.all([
        store.viewEntries(id, {
          ...keys,
          /*
           * 회차 기준이면 앞에서 산 할부도 이 구간의 거래가 된다. 목록·분류 탭과 같은
           * 규칙이라, 한 화면 안에서 카드 합계와 분류 합계가 어긋나지 않는다.
           */
          ...(spread
            ? { fromDateKey: shiftDateKeyMonths(keys.fromDateKey, -INSTALLMENT_LOOKBACK_MONTHS) }
            : {}),
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

      /*
       * 걸린 줄만 세도록 판정기를 함께 넘긴다. 서버의 `getPaymentMethods` 와 한 규칙이다.
       *
       * 목록이 걸린 줄만 보여 주는데 수단 줄이 거래 전체를 더하면, 화면에 5,000원 한
       * 줄이 서 있고 그 카드 옆에는 10,000원이 적힌다.
       */
      const matchLine = lineMatcherOf(parseEntrySearch(filter ?? {}));
      const items = entries.map((entry) =>
        toListItem(
          entry,
          { convert: (value) => value.times(show.rate), rate: show.rate },
          matchLine,
        ),
      );
      // 회차 기준이면 금액을 그 회차 몫으로 바꾸고, 회차가 없는 할부는 뺀다.
      const counted = spread
        ? installmentEntryViews(items, { timeZone, ...periodWindow(period, keys, timeZone) })
        : items;

      return paymentMethods(
        counted,
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
     * 주기별 사용액과 남은 대금.
     *
     * 실적 막대와 같은 재료로 낸다(`getCardPerformance`). 남은 대금은 부채 계정의 다리
     * 합을 뒤집은 값이라 서버가 준 잔액 칸을 읽지 않는다 -- 아직 보내지 못한 결제도
     * 그대로 셈에 든다.
     */
    async getCardUsage(cardId, months) {
      const card = await store.cardForPerformance(cardId);
      const isCredit = card?.cardType === 'credit';
      const usable =
        card &&
        (!isCredit ||
          (card.statementClosingDay !== null &&
            card.paymentDueDay !== null &&
            card.liabilityAccountId !== null));
      if (!card || !usable) return fallback.getCardUsage(cardId, months);

      note('cardUsage');
      const timeZone = await timeZoneOf(store, card.projectId);
      const span = usageSpan(months);

      if (isCredit) {
        const { periods } = creditUsagePeriods({
          postings: await store.creditCardPostings(card.liabilityAccountId!),
          statementClosingDay: card.statementClosingDay!,
          paymentDueDay: card.paymentDueDay!,
          timeZone,
          span,
        });

        return {
          cardId: card.id,
          currency: card.liabilityCurrency ?? card.paymentCurrency,
          // 부채는 음수로 쌓인다. 남은 대금은 부호를 뒤집은 값이다.
          outstanding: Dec.of(card.liabilityBalance ?? '0').negated().toString(),
          periods,
        };
      }

      return {
        cardId: card.id,
        currency: card.paymentCurrency,
        // 체크카드는 결제 즉시 통장에서 빠진다. 갚을 대금이 남지 않는다.
        outstanding: '0',
        periods: debitUsagePeriods({
          postings: await store.debitCardPostings(card.id),
          timeZone,
          span,
        }),
      };
    },

    /**
     * 계좌 원장 한 쪽.
     *
     * 줄마다 붙는 잔액은 **가장 오래된 다리부터 더한 값**이다. 서버도 같은 규칙이고
     * (`cumulativeBalanceThrough`), 계좌 잔액 자체가 그 합이라 마지막 줄의 잔액과
     * 화면 위의 잔액이 정의상 맞는다.
     *
     * 금액은 다리 전부를 읽어 더하고, 화면에 적을 것은 보여 줄 줄에만 붙인다.
     */
    async getAccountPostings(accountId, params) {
      note('accountPostings');

      const limit = Math.min(Math.max(Number(params?.limit) || 50, 1), 200);
      const amounts = await store.accountPostingAmounts(accountId);

      // 오래된 것부터 더해 줄마다의 잔액을 만든다. 목록은 그 반대로 읽는다.
      let running = Dec.of(0);
      const withBalance = amounts.map((row) => {
        running = running.plus(row.amount);
        return { ...row, balanceAfter: running.toString() };
      });
      withBalance.reverse();

      /*
       * 구간을 고른 조회는 **잔액을 다 쌓은 뒤에** 자른다.
       *
       * 줄에 붙는 잔액은 구간과 상관없이 맨 앞부터 센 값이다. 구간만큼만 더하면 그
       * 줄의 잔액이 통장의 실제 잔액과 달라진다 (서버도 같은 규칙이다).
       */
      const fromTime = params?.startDate ? new Date(params.startDate).getTime() : null;
      const toTime = params?.endDate ? new Date(params.endDate).getTime() : null;
      const inRange =
        fromTime === null && toTime === null
          ? withBalance
          : withBalance.filter((row) => {
              const at = new Date(row.date).getTime();
              if (fromTime !== null && at < fromTime) return false;
              if (toTime !== null && at > toTime) return false;
              return true;
            });

      /*
       * 커서는 앞 쪽의 마지막 다리 id 다(서버와 같다). 그 줄이 사라졌으면 이어 붙일
       * 자리를 알 수 없으므로 빈 쪽을 준다 -- 처음부터 다시 주면 같은 줄이 두 번 선다.
       */
      const from = params?.cursor
        ? inRange.findIndex((row) => row.postingId === params.cursor) + 1
        : 0;
      if (params?.cursor && from === 0) return { data: [], nextCursor: null };

      const page = inRange.slice(from, from + limit);
      const detail = await store.ledgerRows(page.map((row) => row.postingId));

      const data = page.flatMap((row) => {
        const found = detail.get(row.postingId);
        return found ? [{ ...found, balanceAfter: row.balanceAfter }] : [];
      });

      return {
        data,
        nextCursor: from + limit < inRange.length ? page[page.length - 1].postingId : null,
      };
    },

    /**
     * 실적 원장 한 쪽.
     *
     * 주기를 나누고 차감을 되살리는 규칙은 서버와 같은 함수가 갖는다
     * (`creditPerformanceShares`). 사본은 그 카드의 다리를 한 번에 읽어 주기마다 줄을
     * 만든 뒤, 보여 줄 만큼만 잘라 준다 -- 누적은 주기 시작부터 센 값 그대로다.
     */
    async getCardPerformanceLedger(cardId, params) {
      const card = await store.cardForPerformance(cardId);
      const isCredit = card?.cardType === 'credit';
      if (!card || !ledgerReady(card)) return fallback.getCardPerformanceLedger(cardId, params);

      note('cardPerformanceLedger');
      const timeZone = await timeZoneOf(store, card.projectId);

      const postings = await store.cardLedgerPostings(
        isCredit ? { liabilityAccountId: card.liabilityAccountId } : { cardId: card.id },
      );

      /** 마감 연월 -> 그 주기의 줄. 오래된 것이 앞이다(누적을 그 차례로 더한다). */
      const byPeriod = new Map<string, CardDto.PeriodLedgerRow[]>();
      for (const posting of postings) {
        const shares = isCredit
          ? creditPerformanceShares(posting, card.statementClosingDay!, timeZone)
          : debitPerformanceShares(posting, timeZone);

        for (const share of shares) {
          push(byPeriod, share.closingKey, {
            ...ledgerRowOf(posting, card.id, share.amount),
            installmentMonths: share.months,
          });
        }
      }

      return periodLedgerPage({
        byPeriod,
        params,
        timeZone,
        card,
        isCredit,
        target: card.performanceAmount,
      });
    },

    /**
     * 청구 내역 한 쪽. 이 주기의 청구서에 무엇이 얼마씩 들었는가.
     *
     * 실적 원장과 같은 길을 쓰되 나누는 함수만 다르다(`billedShares`). **할부가 회차마다
     * 한 줄이다** -- 24개월 할부로 산 차는 원장에 산 달 한 줄뿐이라, 그 뒤 주기에서는
     * 대금이 왜 이만큼 나가는지 목록에서 알 수 없었다.
     *
     * 신용카드만이다. 체크카드는 쓰는 즉시 통장에서 빠져 청구라는 것이 없다.
     */
    async getCardBilledLedger(cardId, params) {
      const card = await store.cardForPerformance(cardId);
      if (!card || card.cardType !== 'credit' || !ledgerReady(card)) {
        return fallback.getCardBilledLedger(cardId, params);
      }

      note('cardBilledLedger');
      const timeZone = await timeZoneOf(store, card.projectId);

      const postings = await store.cardLedgerPostings({
        liabilityAccountId: card.liabilityAccountId,
      });

      const byPeriod = new Map<string, CardDto.PeriodLedgerRow[]>();
      for (const posting of postings) {
        /*
         * 실적에서 뺀 거래도 그대로 싣는다. 청구는 실적과 상관없이 되므로, 여기서
         * 거르면 줄의 합이 막대(`UsagePeriod.billed`)와 어긋난다.
         */
        for (const share of billedShares(posting, card.statementClosingDay!, timeZone)) {
          push(byPeriod, share.closingKey, {
            ...ledgerRowOf(posting, card.id, share.amount),
            // 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
            key: share.months > 1 ? `${posting.postingId}:${share.index}` : posting.postingId,
            installmentIndex: share.index,
            installmentMonths: share.months,
          });
        }
      }

      return periodLedgerPage({
        byPeriod,
        params,
        timeZone,
        card,
        isCredit: true,
        // 실적 기준액은 청구와 상관없는 값이다. 막대에 기준선을 긋지 않는다.
        target: null,
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

      const search = parseEntrySearch(query);
      const entries = await store.viewEntries(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        // 한 달만 볼 때는 박아 둔 컬럼을 쓴다. 달 길이도 시차도 다시 따질 것이 없다.
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search,
      });

      // 서버와 같은 판정기로 걸린 줄만 남긴다. 규칙이 두 벌이면 목록이 갈린다.
      const matchLine = lineMatcherOf(search);
      return entries.map((entry) =>
        toListItem(
          entry,
          { convert: (value) => value.times(show.rate), rate: show.rate },
          matchLine,
        ),
      );
    },

    /** 이 분류와 그 소분류에 달린 거래 다리의 수. 사본의 원장을 그대로 센다. */
    /**
     * 이 구간에 회차가 서는 지난 할부. 회차 기준으로 볼 때만 부른다.
     *
     * 서버의 `/entries/installment-rows` 와 같은 답을 내야 한다 -- 오프라인에서 목록이
     * 달라지면 같은 달을 두 기기에서 다르게 보게 된다.
     */
    async getInstallmentRows(query, projectId) {
      const id = requireProject(projectId);
      note('entries');

      const project = await store.projectRow(id);
      const timeZone = project?.timeZone ?? 'Asia/Seoul';

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
      const entries = await store.viewEntries(id, {
        fromDateKey: fromKey,
        toDateKey: toKey,
        ownerIds: ownerIdsOf(query),
        search,
      });

      const matchLine = lineMatcherOf(search);
      const items = entries.map((entry) =>
        toListItem(
          entry,
          { convert: (value) => value.times(show.rate), rate: show.rate },
          matchLine,
        ),
      );

      // 회차가 이 구간에 서는 것만 남긴다. 다 갚은 할부는 여기서 빠진다.
      return items.filter((entry) => {
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

    async getCategoryUsage(id) {
      note('categoryUsage');
      return { counts: await store.categoryPostingCounts(id) };
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
      return toListItem(entry, { convert: (value) => value.times(show.rate), rate: show.rate });
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

      const search = parseEntrySearch(query);
      const page = await store.viewEntriesPage(id, {
        fromDateKey: dateKeyOf(query.startDate, timeZone, '0000-01-01'),
        toDateKey: dateKeyOf(query.endDate, timeZone, '9999-12-31'),
        yearMonth: query.yearMonth,
        ownerIds: ownerIdsOf(query),
        search,
        // 카드 상세의 결제 내역이 이 조건으로 그 카드의 거래만 받는다.
        cardId: query.cardId,
        limit,
        cursor: decodeCursor(query.cursor),
      });

      const matchLine = lineMatcherOf(search);
      const rows = page.entries.map((entry) =>
        toListItem(
          entry,
          { convert: (value) => value.times(show.rate), rate: show.rate },
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
 * 프로젝트 타임존. 달력 경계를 자를 때 쓴다.
 *
 * 사본에 프로젝트 행이 아직 없으면(첫 동기화 전) 서울로 본다. 목록의 달력 키는 이미
 * 동기화할 때 박아 둔 값이라 이 기본값에 기대지 않는다.
 */
async function timeZoneOf(store: LocalStore, projectId: string): Promise<string> {
  const project = await store.projectRow(projectId);
  return project?.timeZone ?? 'Asia/Seoul';
}

/**
 * 이 카드를 사본만으로 그릴 수 있는가.
 *
 * 신용카드는 마감일·결제일·부채 계정이 다 있어야 주기를 자를 수 있다. 하나라도 비면
 * 서버가 오류를 주는 쪽이 맞으므로 그대로 넘긴다.
 */
function ledgerReady(card: StoredPerformanceCard): boolean {
  if (card.cardType !== 'credit') return true;
  return (
    card.statementClosingDay !== null &&
    card.paymentDueDay !== null &&
    card.liabilityAccountId !== null
  );
}

/** 마감 연월 칸에 줄 하나를 더한다. */
function push(byPeriod: Map<string, CardDto.PeriodLedgerRow[]>, key: string, row: CardDto.PeriodLedgerRow) {
  const rows = byPeriod.get(key) ?? [];
  rows.push(row);
  byPeriod.set(key, rows);
}

/** 주기 원장 한 줄의 바탕. 누적과 주기 시작은 쪽을 만들 때 붙인다. */
function ledgerRowOf(
  posting: StoredCardLedgerPosting,
  cardId: string,
  amount: string,
): CardDto.PeriodLedgerRow {
  return {
    key: posting.postingId,
    entryId: posting.entryId,
    date: posting.date,
    description: posting.description,
    merchant: posting.merchant,
    // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
    amount: Dec.of(amount).negated().toString(),
    runningTotal: '0',
    periodStart: '',
    cardId,
    cardName: null,
    categoryName: posting.categoryName,
    parentCategoryName: posting.parentCategoryName,
    installmentMonths: 1,
  };
}

/**
 * 주기마다 만든 줄을 한 쪽으로 자른다. 실적 원장과 청구 내역이 이 한 길을 쓴다.
 *
 * 누적은 주기 시작부터 세야 뜻이 있어, 주기는 통째로 만들어 두고 자르는 것은 보여 줄
 * 줄뿐이다 -- 뒷부분만 받아도 줄에 붙은 누적은 처음부터 센 값이다 (서버와 같은 규칙).
 */
function periodLedgerPage(input: {
  byPeriod: Map<string, CardDto.PeriodLedgerRow[]>;
  params?: CardDto.PeriodLedgerQuery;
  timeZone: string;
  card: StoredPerformanceCard;
  isCredit: boolean;
  target: string | null;
}): CardDto.PeriodLedgerResponse {
  const { byPeriod, params, timeZone, card, isCredit } = input;
  const limit = Math.min(Math.max(Number(params?.limit) || 20, 1), 100);

  const head = {
    cardId: card.id,
    currency: isCredit ? card.liabilityCurrency ?? card.paymentCurrency : card.paymentCurrency,
    basis: (isCredit ? 'statement' : 'month') as 'statement' | 'month',
    target: input.target,
  };

  const today = zonedParts(new Date(), timeZone);
  const todayMarker = Date.UTC(today.year, today.month - 1, today.day);

  const periods: CardDto.PeriodLedgerPeriod[] = [];
  const rows: CardDto.PeriodLedgerRow[] = [];
  /** 주기 시작 -> 마감 연월. 커서에 그 키를 실어 서버와 같은 모양을 쓴다. */
  const closingOf = new Map<string, string>();

  /*
   * 쭉 훑을 때는 진행 중인 주기까지다. 키가 "YYYY-MM" 이라 글자 차례가 곧 시간 차례다.
   *
   * 할부 청구는 뒤 주기로 넘어가고 날짜를 잘못 적은 거래도 있어, 아직 오지 않은 주기에
   * 줄이 놓일 수 있다. 고르지 않은 채로 훑는 목록에는 세우지 않는다 -- 서버도 진행 중인
   * 주기에서 시작해 거슬러 오른다.
   */
  const currentKey = isCredit
    ? closingMonthKey(closingMonthOf(new Date(), card.statementClosingDay!, timeZone))
    : zonedYearMonth(new Date(), timeZone);

  /*
   * 주기 하나만 보는 조회. 그래프에서 막대를 눌렀을 때 온다.
   *
   * 날짜 구간이 아니라 주기 이름으로 가린다. 주기 경계는 마감일이 정하고 할부 회차는
   * 산 날이 아니라 청구되는 주기에 들어, 날짜로 자르면 둘 다 어긋난다.
   */
  const only = params?.closingKey;

  for (const key of [...byPeriod.keys()]
    /*
     * 고른 주기가 있으면 그것만이다. 아직 오지 않은 주기여도 보여 준다 -- 24개월 할부의
     * 다음 달 몫을 그래프에서 눌러 열어 보는 자리이고, 서버도 같은 줄을 준다.
     */
    .filter((key) => (only ? key === only : key <= currentKey))
    .sort()
    .reverse()) {
    const [year, month] = key.split('-').map(Number);
    const span = isCredit
      ? periodForClosingMonth(year, month, card.statementClosingDay!, card.paymentDueDay!)
      : {
          // 달력 월 표시자. 청구 주기 쪽과 같은 형태다 (그 달 1일 ~ 말일).
          periodStart: new Date(Date.UTC(year, month - 1, 1)),
          periodEnd: new Date(Date.UTC(year, month, 0)),
        };
    const periodStart = span.periodStart.toISOString();
    closingOf.set(periodStart, key);

    // 누적은 가장 오래된 줄부터 더하고, 보여 주는 차례는 그 반대다.
    let running = Dec.of(0);
    const filled = (byPeriod.get(key) ?? []).map((row) => {
      running = running.plus(Dec.of(row.amount).negated());
      return { ...row, periodStart, runningTotal: running.toString() };
    });
    filled.reverse();

    periods.push({
      periodStart,
      periodEnd: span.periodEnd.toISOString(),
      closed: span.periodEnd.getTime() < todayMarker,
      total: running.toString(),
    });
    rows.push(...filled);
  }

  /*
   * 커서는 "주기|줄키" 다(서버와 같다). 그 줄 다음부터 limit 만큼 준다.
   * 사라진 줄을 가리키면 빈 쪽을 준다 -- 처음부터 주면 같은 줄이 두 번 선다.
   */
  const cursorKey = params?.cursor?.split('|').slice(1).join('|');
  const from = cursorKey ? rows.findIndex((row) => row.key === cursorKey) + 1 : 0;
  if (params?.cursor && from === 0) {
    return { ...head, periods: [], rows: [], nextCursor: null };
  }

  const page = rows.slice(from, from + limit);
  const shown = new Set(page.map((row) => row.periodStart));
  const last = page[page.length - 1];

  return {
    ...head,
    periods: periods.filter((period) => shown.has(period.periodStart)),
    rows: page,
    nextCursor:
      from + limit < rows.length && last
        ? `${closingOf.get(last.periodStart) ?? ''}|${last.key}`
        : null,
  };
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

    /*
     * 사본의 환율 행이 먼저다. 없으면 고정값 표를 쓴다 (서버와 같은 표, @money/types).
     *
     * 1 로 눙치면 외화 계좌가 원화와 1:1 로 세어진다. 100달러가 100원이 되어 총자산이
     * 조용히 어긋나는 자리다 -- 기기에서 실제로 그랬다.
     */
    result[currency] =
      (await store.latestRate(projectId, currency, display)) ??
      fallbackRate(currency, display) ??
      '1';
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

/**
 * 회차 기준에서 할부를 앞으로 몇 달까지 거슬러 볼지. 서버와 같은 값이다.
 *
 * 쓰이는 개월수는 길어야 서른여섯이라 넉넉하고, 조건을 지우면 사본을 통째로 읽게 된다.
 */
const INSTALLMENT_LOOKBACK_MONTHS = 60;

/** 달력 키를 달 단위로 옮긴다. 며칟날은 그대로 두고 달만 센다. */
function shiftDateKeyMonths(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month) return dateKey;

  const shifted = shiftYearMonth(year, month, delta);
  return `${shifted}-${String(day || 1).padStart(2, '0')}`;
}

/** 편 줄의 날짜를 달력 키로. 사본의 줄은 글자로, 편 줄은 Date 로 온다. */
function dateKeyOfRow(date: Date | string, timeZone: string): string {
  return zonedDateKey(date instanceof Date ? date : new Date(date), timeZone);
}

/**
 * 회차를 가릴 구간. 시작은 포함, 끝은 열려 있다.
 *
 * 달은 이름으로 만든다. 달력 키로 만들면 말일을 `-31` 로 적는 자리(`periodKeys`)에서
 * 2월이 3월 초사흘까지 늘어나, 없는 날이 다음 달 회차를 끌어온다.
 */
function periodWindow(
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
