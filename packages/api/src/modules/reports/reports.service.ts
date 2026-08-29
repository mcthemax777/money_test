import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ENTRY_INCLUDE, classifyEntry, toListItem } from '../entries/entry-view';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  parseEntryFilter,
  splitList,
} from '@/common/entry-filter';
import { HIDDEN_ACCOUNT_TYPES } from '../accounts/accounts.service';
import { assertDateKey, assertYearMonth } from '@/common/year-month';
import {
  DisplayConverter,
  ExchangeRatesService,
} from '../exchange-rates/exchange-rates.service';
import {
  ReportDto,
  currencyDecimals,
  zonedCurrentYearMonth,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
  zonedMonthStart,
  zonedParts,
} from '@money/types';

const ZERO = new Prisma.Decimal(0);

/** 순자산에서 제외할 계정. 자본 계정은 자산이 아니다. */
const EQUITY_TYPES: AccountType[] = [AccountType.opening_balance];
/** 시가로 평가하는 계정. 장부 잔액 대신 최신 AssetValuation을 쓴다. */
const VALUED_TYPES: AccountType[] = [AccountType.investment, AccountType.real_estate];
/** 부채 계정. 잔액이 음수로 저장된다. */
const LIABILITY_TYPES: AccountType[] = [AccountType.credit_card, AccountType.loan];
/**
 * 수익을 따로 계산해 보여 주는 계정.
 *
 * 원금은 이체로 넣고 불어난 몫은 수입으로 붙는 계좌들이다(투자는 배당·매매 차익,
 * 저축은 이자). 잔액만 보면 원금인지 수익인지 구별되지 않는다.
 */
const PROFIT_TYPES: AccountType[] = [AccountType.investment, AccountType.savings];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /**
   * 표시 환산기. 저장 통화로 집계한 값을 표시 통화로 옮긴다.
   *
   * **합계에만** 곱한다. 행마다 곱하면 반올림이 행 수만큼 쌓인다.
   * 두 통화가 같으면 곱셈을 건너뛰므로 대부분의 프로젝트에서는 비용이 0이다.
   */
  private async displayConverter(projectId: string) {
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(projectId);
    return this.exchangeRates.getDisplayConverter(projectId, ledger, display);
  }

  /**
   * 월 수입/지출 합계.
   *
   * 결제수단과 무관하게 "지출 카테고리 posting의 합"으로 정의된다.
   * dashboard는 credit_usage를 더하고 statistics는 빼던 불일치가 정의상 사라진다.
   */
  async getSummary(userId: string, query: ReportDto.PeriodQuery): Promise<ReportDto.Summary> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = this.resolvePeriod(query, timeZone);
    const scope = this.entryScope(projectId, range, query);
    // 일반/과소비 필터. 목록과 같은 조건을 걸어야 화면의 합계와 맞는다.
    const extraOnly = parseEntryFilter(query).extra;
    const extraWhere = extraCondition(extraOnly);

    /*
     * 과소비·추가 수입은 다리마다 "그중 얼마"로 적혀 있다(extraAmount).
     * 그래서 다리를 종류별로 나눌 필요 없이 두 합계를 한 번에 얻는다.
     * 합계는 전부 기준통화 환산액이다. amount는 그 다리의 통화라 섞으면 못 더한다.
     */
    const [expenseAgg, incomeAgg] = await Promise.all([
      this.prisma.posting.aggregate({
        _sum: { baseAmount: true, extraAmount: true },
        where: {
          category: { type: CategoryType.expense },
          entry: scope,
          ...extraWhere,
        },
      }),
      this.prisma.posting.aggregate({
        _sum: { baseAmount: true, extraAmount: true },
        where: {
          category: { type: CategoryType.income },
          entry: scope,
          ...extraWhere,
        },
      }),
    ]);

    const expense = expenseAgg._sum.baseAmount ?? ZERO;
    const extraExpense = expenseAgg._sum.extraAmount ?? ZERO;
    // 수입 posting은 음수로 기록되므로 표시용으로 뒤집는다 (extraAmount는 이미 양수다)
    const income = (incomeAgg._sum.baseAmount ?? ZERO).neg();
    const extraIncome = incomeAgg._sum.extraAmount ?? ZERO;

    const show = await this.displayConverter(projectId);
    return {
      ...this.periodLabel(query, range, timeZone),
      income: show.toString(income),
      expense: show.toString(expense),
      extraExpense: show.toString(extraExpense),
      normalExpense: show.toString(expense.sub(extraExpense)),
      extraIncome: show.toString(extraIncome),
      normalIncome: show.toString(income.sub(extraIncome)),
      net: show.toString(income.sub(expense)),
    };
  }

  /**
   * 날짜별 지출·수입 (일반/과소비).
   *
   * 합계는 getSummary 와 같은 규칙이다("그 유형 카테고리 posting의 합"). 날짜는 프로젝트
   * 타임존의 달력 날짜라, 한국의 새벽 거래가 하루 앞으로 밀리지 않는다.
   *
   * 누적은 화면이 만든다. 이번 달은 오늘까지만, 지난달은 말일까지 그어야 두 선을
   * 나란히 읽을 수 있는데 그 지점이 화면마다 다르다.
   */
  async getDailyExpense(
    userId: string,
    query: ReportDto.DailyExpenseQuery,
  ): Promise<ReportDto.DailyExpensePoint[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = this.resolvePeriod(query, timeZone);
    // 쿼리스트링은 문자열로 도착한다. 아는 값이 아니면 지출이다.
    const isIncome = query.type === 'income';
    const postings = await this.prisma.posting.findMany({
      where: {
        category: { type: isIncome ? CategoryType.income : CategoryType.expense },
        entry: this.entryScope(projectId, range, query),
        ...extraCondition(parseEntryFilter(query).extra),
      },
      // 합계는 기준통화 환산액(baseAmount)이다. amount는 그 다리의 통화라 섞으면 못 더한다.
      select: { baseAmount: true, extraAmount: true, entry: { select: { date: true } } },
    });

    /*
     * 한 다리가 일반과 과소비로 나뉜다. 10만 원 중 3만 원이 과소비면 그날의
     * 과소비 3만, 일반 7만이다. 다리를 한쪽에만 넣으면 합이 그날 지출과 어긋난다.
     */
    const byDate = new Map<string, { normal: Prisma.Decimal; extra: Prisma.Decimal }>();
    for (const posting of postings) {
      const key = zonedDateKey(posting.entry.date, timeZone);
      const bucket = byDate.get(key) ?? { normal: ZERO, extra: ZERO };
      // 수입 posting은 음수로 기록되므로 표시용으로 뒤집는다 (extraAmount는 이미 양수다).
      const amount = isIncome ? posting.baseAmount.neg() : posting.baseAmount;
      bucket.extra = bucket.extra.add(posting.extraAmount);
      bucket.normal = bucket.normal.add(amount.sub(posting.extraAmount));
      byDate.set(key, bucket);
    }

    const show = await this.displayConverter(projectId);
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        normal: show.toString(bucket.normal),
        extra: show.toString(bucket.extra),
      }));
  }

  /** 카테고리별 구성비. 기본은 소분류를 대분류로 롤업한다. */
  async getCategoryBreakdown(
    userId: string,
    query: ReportDto.CategoryBreakdownQuery,
  ): Promise<ReportDto.CategoryBreakdownItem[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = this.resolvePeriod(query, timeZone);
    // 쿼리스트링 값은 문자열로 도착한다. 이 DTO는 클래스가 아니라 인터페이스라서
    // ValidationPipe의 암묵 변환이 걸리지 않고 ?rollup=false 가 'false' 문자열로 들어온다.
    // 불리언 비교만 하면 항상 롤업이 켜져서 소분류 구성비를 볼 수 없다.
    const rollup = query.rollup !== false && (query.rollup as unknown) !== 'false';

    const rows = await this.prisma.posting.groupBy({
      by: ['categoryId'],
      _sum: { baseAmount: true },
      _count: true,
      where: {
        category: { type: query.type as CategoryType },
        entry: this.entryScope(projectId, range, query),
        ...extraCondition(parseEntryFilter(query).extra),
      },
    });
    if (rows.length === 0) return [];

    const categories = await this.prisma.category.findMany({
      where: { id: { in: rows.map((r) => r.categoryId!).filter(Boolean) } },
      include: { parent: { select: { id: true, name: true } } },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    // 롤업하면 소분류 금액을 대분류에 합친다. posting은 가장 구체적인 카테고리만 가리키므로
    // 대분류 금액은 이렇게 만들어야 한다.
    const buckets = new Map<string, { amount: Prisma.Decimal; count: number }>();
    for (const row of rows) {
      const category = row.categoryId ? byId.get(row.categoryId) : null;
      if (!category) continue;

      const key = rollup ? category.parent?.id ?? category.id : category.id;
      const bucket = buckets.get(key) ?? { amount: ZERO, count: 0 };
      bucket.amount = bucket.amount.add((row._sum.baseAmount ?? ZERO).abs());
      bucket.count += row._count;
      buckets.set(key, bucket);
    }

    // 롤업 대상인 대분류 이름을 얻기 위해 부모까지 조회한다
    const missing = [...buckets.keys()].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const parents = await this.prisma.category.findMany({
        where: { id: { in: missing } },
        include: { parent: { select: { id: true, name: true } } },
      });
      for (const parent of parents) byId.set(parent.id, parent);
    }

    const total = [...buckets.values()].reduce((acc, b) => acc.add(b.amount), ZERO);
    const show = await this.displayConverter(projectId);

    return [...buckets.entries()]
      .map(([categoryId, bucket]) => {
        const category = byId.get(categoryId)!;
        return {
          categoryId,
          categoryName: category.name,
          parentCategoryId: category.parent?.id ?? null,
          parentCategoryName: category.parent?.name ?? null,
          amount: show.toString(bucket.amount),
          count: bucket.count,
          // 구성비는 비율이라 표시 통화와 무관하다.
          ratio: total.isZero() ? 0 : bucket.amount.div(total).mul(100).toNumber(),
        };
      })
      .sort((a, b) => Number(b.amount) - Number(a.amount));
  }

  /**
   * 순자산.
   *
   * 현금성 계좌는 balance를 그대로, 투자성 계좌는 최신 시가를 쓴다.
   * 자본 계정(opening_balance)은 자산이 아니므로 제외한다. 포함하면 항상 0에 가까워진다.
   */
  async getNetWorth(userId: string, projectId?: string): Promise<ReportDto.NetWorth> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    const accounts = await this.prisma.account.findMany({
      where: {
        projectId: finalProjectId,
        isActive: true,
        type: { notIn: EQUITY_TYPES },
      },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (accounts.length === 0) return emptyNetWorth();

    // 투자성 계좌의 최신 평가액
    const valuedIds = accounts.filter((a) => VALUED_TYPES.includes(a.type)).map((a) => a.id);
    const marketValues = await this.latestMarketValues(valuedIds);

    /*
     * 외화 계좌는 최신 환율로 재평가한다.
     *
     * `account.balance`는 그 계좌의 통화다(달러 통장이면 달러). 순자산은 기준통화
     * 한 가지로 말해야 하므로 지금 환율로 환산한다. 반면 장부가는 거래마다 그때의
     * 환율로 쌓인 baseAmount 합계다. 둘의 차이가 미실현 환차손익이고, 투자 계좌의
     * 시가 - 장부가와 같은 자리에 더해진다.
     */
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(finalProjectId);
    const decimals = currencyDecimals(display);

    // 계좌 통화별 -> 표시 통화 환율. 저장 통화를 거치지 않고 바로 간다.
    const rates = new Map<string, Prisma.Decimal>();
    for (const currency of new Set(accounts.map((a) => a.currency))) {
      const info = await this.exchangeRates.getRate(
        finalProjectId,
        this.exchangeRates.assertCurrency(currency, '계좌 통화'),
        display,
      );
      rates.set(currency, new Prisma.Decimal(info.rate));
    }
    // 장부가는 저장 통화로 쌓여 있다. 표시 통화로 옮겨야 재평가액과 뺄 수 있다.
    const toDisplay = await this.exchangeRates.getDisplayConverter(finalProjectId, ledger, display);
    const bookValues = await this.bookValuesOf(accounts.map((a) => a.id));

    /*
     * 유형별 소계도 함께 담는다.
     *
     * 현금성·투자·부채 세 칸은 화면에 따라 너무 굵다. 홈은 예금/적금/투자/대출을
     * 따로 보여 주는데, 그 값을 화면에서 계좌를 더해 만들면 시가 평가와 환율 재평가가
     * 빠져 같은 화면의 총자산과 어긋난다.
     */
    type Bucket = {
      cash: Prisma.Decimal;
      investment: Prisma.Decimal;
      liability: Prisma.Decimal;
      byType: Map<AccountType, Prisma.Decimal>;
    };
    const newBucket = (): Bucket => ({
      cash: ZERO,
      investment: ZERO,
      liability: ZERO,
      byType: new Map(),
    });
    const totals: Bucket = newBucket();
    const byPerson = new Map<string, Bucket & { personName: string }>();
    // 재평가 대상(투자 + 외화)의 "지금 값"과 "장부가". 둘의 차이가 미실현 손익이다.
    let revaluedNow = ZERO;
    let revaluedBook = ZERO;

    for (const account of accounts) {
      const isValued = VALUED_TYPES.includes(account.type);
      const isLiability = LIABILITY_TYPES.includes(account.type);
      const isForeign = account.currency !== ledger;

      /*
       * "지금 값"을 표시 통화로.
       *
       * 계좌 잔액은 그 계좌의 통화다. 외화든 아니든 표시 통화로 옮겨야 한 줄에
       * 더할 수 있다. 투자 계좌의 시가(AssetValuation.marketValue)는 통화 컬럼이
       * 없고 저장 통화로 본다.
       */
      const nativeToDisplay = (native: Prisma.Decimal) => {
        const rate = rates.get(account.currency) ?? new Prisma.Decimal(1);
        return native.mul(rate).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
      };

      let value: Prisma.Decimal;
      if (isValued || isForeign) {
        // 시가가 없으면 장부가로 대체한다 (평가 기록을 아직 안 넣은 경우)
        const marketValue = isValued ? marketValues.get(account.id) : undefined;
        value = marketValue ? toDisplay.convert(marketValue) : nativeToDisplay(account.balance);
        revaluedNow = revaluedNow.add(value);
        // 장부가는 거래마다 그때의 환율로 쌓인 저장 통화 합계다.
        revaluedBook = revaluedBook.add(toDisplay.convert(bookValues.get(account.id) ?? ZERO));
      } else {
        value = nativeToDisplay(account.balance);
      }

      // 외화라는 이유로 분류가 바뀌지는 않는다. 달러 통장은 여전히 현금성이다.
      const slot = isValued ? 'investment' : isLiability ? 'liability' : 'cash';
      const addTo = (bucket: Bucket) => {
        bucket[slot] = bucket[slot].add(value);
        bucket.byType.set(account.type, (bucket.byType.get(account.type) ?? ZERO).add(value));
      };

      addTo(totals);

      if (account.owner) {
        const bucket =
          byPerson.get(account.owner.id) ?? { ...newBucket(), personName: account.owner.name };
        addTo(bucket);
        byPerson.set(account.owner.id, bucket);
      }
    }

    const total = totals.cash.add(totals.investment).add(totals.liability);

    return {
      total: total.toString(),
      cash: totals.cash.toString(),
      investment: totals.investment.toString(),
      liability: totals.liability.toString(),
      // 투자 시가 + 외화 재평가액에서 각각의 장부가를 뺀 값
      unrealizedGain: revaluedNow.sub(revaluedBook).toString(),
      byType: serializeByType(totals.byType),
      byPerson: [...byPerson.entries()].map(([personId, bucket]) => ({
        personId,
        personName: bucket.personName,
        total: bucket.cash.add(bucket.investment).add(bucket.liability).toString(),
        cash: bucket.cash.toString(),
        investment: bucket.investment.toString(),
        liability: bucket.liability.toString(),
        byType: serializeByType(bucket.byType),
      })),
    };
  }

  /**
   * 자산 잔액 추이.
   *
   * getTrend는 "그 달에 발생한 금액"을 주지만 여기서는 "그 시점까지 쌓인 잔액"이 필요하다.
   * 그래서 창 시작 이전까지의 잔액을 기준선으로 깔고, 구간별 증감을 누적한다.
   *
   * 계좌별 잔액을 따로 들고 다니는 이유는 투자/부동산이다. 이 둘은 장부가가 아니라
   * 그 시점의 평가액으로 봐야 해서 계좌마다 값을 바꿔치기해야 한다. getNetWorth 와 같은 규칙이다.
   */
  async getBalanceHistory(
    userId: string,
    query: ReportDto.BalanceHistoryQuery,
  ): Promise<ReportDto.BalanceHistoryPoint[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const granularity =
      query.granularity === 'day' || query.granularity === 'year' ? query.granularity : 'month';

    /*
     * 여러 구성원을 한 선으로 볼 때 쓴다. 목록 필터와 같은 세 상태 규칙이라
     * 키가 없으면 전체, 빈 문자열이면 아무도 고르지 않은 것이라 빈 그래프를 준다.
     */
    const ownerIds = query.ownerIds === undefined ? undefined : splitList(query.ownerIds);
    if (ownerIds && ownerIds.length === 0) return [];

    const accounts = await this.prisma.account.findMany({
      where: {
        projectId,
        // 기초잔액 상대편은 자산이 아니다. getNetWorth 와 같은 기준으로 뺀다.
        type: { notIn: EQUITY_TYPES },
        /*
         * 계좌를 지정하면 비활성 계좌도 보여준다. 그 계좌를 보려고 고른 것이므로
         * 숨겼다고 빈 그래프를 주면 안 된다.
         *
         * 구성원을 지정하면(ownerId, ownerIds) 그 사람들의 계좌만 모은다.
         * 전체 합계일 때만 활성으로 좁힌다.
         */
        ...(query.accountId
          ? { id: query.accountId }
          : query.ownerId
            ? { ownerId: query.ownerId, isActive: true }
            : ownerIds
              ? { ownerId: { in: ownerIds }, isActive: true }
              : { isActive: true }),
      },
      select: { id: true, type: true },
    });
    if (accounts.length === 0) return [];
    const accountIds = accounts.map((a) => a.id);

    const endMonth = query.endMonth
      ? assertYearMonth(query.endMonth, '기준 월')
      : zonedCurrentYearMonth(timeZone);

    /*
     * 일 단위는 두 가지 방식이 있다.
     *
     * yearMonth가 있으면 그 달 1일~말일이다. 월별 그래프에서 한 달을 눌러 들어오는
     * 길이라 창이 그 달에 딱 맞아야 한다. 없으면 오늘까지 최근 days일을 그린다.
     * 단위를 직접 고르는 쪽은 "요즘 어떤가"를 보는 것이라 달 경계가 의미 없다.
     */
    const buckets =
      granularity === 'day'
        ? query.yearMonth
          ? dayBuckets(assertYearMonth(query.yearMonth, '조회 월'), timeZone)
          : recentDayBuckets(clampCount(query.days, 30, 366), timeZone)
        : granularity === 'year'
          ? yearBuckets(Number(endMonth.slice(0, 4)), clampCount(query.years, 5, 30), timeZone)
          : monthBuckets(endMonth, clampCount(query.months, 12, 60), timeZone);
    const windowStart = buckets[0].start;
    const windowEnd = buckets[buckets.length - 1].end;

    // 창 시작 이전까지 쌓인 계좌별 잔액 (기준선)
    const baseRows = await this.prisma.$queryRaw<
      Array<{ accountId: string; delta: Prisma.Decimal }>
    >`
      SELECT p."accountId" AS "accountId", SUM(p."baseAmount") AS delta
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      WHERE e."projectId" = ${projectId}
        AND p."accountId" IN (${Prisma.join(accountIds)})
        AND e."date" < ${windowStart}
      GROUP BY 1
    `;

    // 창 안의 구간별 계좌별 증감
    const stepRows = await this.prisma.$queryRaw<
      Array<{ accountId: string; period: Date; delta: Prisma.Decimal }>
    >`
      SELECT p."accountId" AS "accountId",
             -- 구간 경계는 프로젝트 타임존 기준이다. 로컬 벽시계로 바꿔 자른 뒤
             -- 다시 UTC 인스턴트로 되돌려야 아래 bucket.start와 값이 맞는다.
             timezone('UTC', timezone(${timeZone}, date_trunc(${granularity}, timezone(${timeZone}, timezone('UTC', e."date"))))) AS period,
             SUM(p."baseAmount") AS delta
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      WHERE e."projectId" = ${projectId}
        AND p."accountId" IN (${Prisma.join(accountIds)})
        AND e."date" >= ${windowStart}
        AND e."date" < ${windowEnd}
      GROUP BY 1, 2
    `;

    const book = new Map<string, Prisma.Decimal>(accountIds.map((id) => [id, ZERO]));
    for (const row of baseRows) book.set(row.accountId, row.delta);

    const stepsByPeriod = new Map<number, Array<{ accountId: string; delta: Prisma.Decimal }>>();
    for (const row of stepRows) {
      const key = row.period.getTime();
      const list = stepsByPeriod.get(key) ?? [];
      list.push({ accountId: row.accountId, delta: row.delta });
      stepsByPeriod.set(key, list);
    }

    const valuedIds = accounts.filter((a) => VALUED_TYPES.includes(a.type)).map((a) => a.id);
    const valuations =
      valuedIds.length > 0
        ? await this.prisma.assetValuation.findMany({
            where: { accountId: { in: valuedIds } },
            select: { accountId: true, date: true, marketValue: true },
            orderBy: { date: 'asc' },
          })
        : [];

    const show = await this.displayConverter(projectId);
    const points: ReportDto.BalanceHistoryPoint[] = [];
    for (const bucket of buckets) {
      for (const step of stepsByPeriod.get(bucket.start.getTime()) ?? []) {
        book.set(step.accountId, (book.get(step.accountId) ?? ZERO).add(step.delta));
      }

      let total = ZERO;
      for (const account of accounts) {
        const bookValue = book.get(account.id) ?? ZERO;
        if (!VALUED_TYPES.includes(account.type)) {
          total = total.add(bookValue);
          continue;
        }
        // 그 시점까지의 마지막 평가액. 아직 평가 기록이 없으면 장부가를 쓴다.
        let asOf: Prisma.Decimal | null = null;
        for (const v of valuations) {
          if (v.accountId !== account.id) continue;
          if (v.date >= bucket.end) break;
          asOf = v.marketValue;
        }
        total = total.add(asOf ?? bookValue);
      }

      points.push({ date: bucket.label, balance: show.toString(total) });
    }

    return points;
  }

  /**
   * 월별 시계열. BudgetDetailModal과 PaymentMethodTab이 각자 구현하던 것을 하나로 합쳤다.
   * 월 단위 그룹핑은 Prisma groupBy가 못 하므로 date_trunc를 쓴다.
   */
  async getTrend(userId: string, query: ReportDto.TrendQuery): Promise<ReportDto.TrendPoint[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const months = Math.min(Math.max(Number(query.months) || 12, 1), 60);
    const endMonth = query.endMonth
      ? assertYearMonth(query.endMonth, '기준 월')
      : zonedCurrentYearMonth(timeZone);
    const [endYear, endMonthNumber] = endMonth.split('-').map(Number);
    const end = zonedMonthStart(endYear, endMonthNumber + 1, timeZone);
    const start = zonedMonthStart(endYear, endMonthNumber - months + 1, timeZone);

    // 대상에 따라 집계 방식이 다르다.
    //
    // 카테고리/전체는 카테고리 posting을 그대로 더하면 된다.
    // 계좌/카드는 "그 수단으로 결제한 지출"이어야 하므로 계좌 posting을 더할 수 없다.
    // (계좌 posting을 더하면 입금과 출금이 상쇄되고, 체크카드 사용까지 섞인다)
    const rows =
      query.target === 'account' || query.target === 'card'
        ? await this.trendByPaymentMethod(projectId, query, start, end, timeZone)
        : await this.trendByCategory(projectId, query, start, end, timeZone);

    // 거래가 없는 달도 0으로 채워 그래프가 끊기지 않게 한다
    const show = await this.displayConverter(projectId);
    const byMonth = new Map(rows.map((r) => [wallClockYearMonth(r.month), show.toString(r.amount)]));
    const points: ReportDto.TrendPoint[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const key = shiftYearMonth(endYear, endMonthNumber, -i);
      points.push({ yearMonth: key, amount: byMonth.get(key) ?? '0' });
    }
    return points;
  }

  /** 카테고리(또는 전체) 기준 월별 합계 */
  private trendByCategory(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
    timeZone: string,
  ) {
    // 쿼리스트링 값은 문자열로 도착한다 (DTO가 인터페이스라 암묵 변환이 없다).
    const exact = query.exact === true || (query.exact as unknown) === 'true';
    const condition =
      query.target === 'category'
        ? exact
          ? // "미분류": 대분류에 바로 기록한 건만 본다.
            Prisma.sql`p."categoryId" = ${query.targetId}`
          : // 대분류를 지정하면 소분류까지 포함한다
            Prisma.sql`(p."categoryId" = ${query.targetId} OR c."parentId" = ${query.targetId})`
        : Prisma.sql`c."type" = ${query.type ?? 'expense'}::"CategoryType"`;

    return this.prisma.$queryRaw<Array<{ month: Date; amount: Prisma.Decimal }>>`
      SELECT date_trunc('month', timezone(${timeZone}, timezone('UTC', e."date"))) AS month,
             ABS(SUM(p."baseAmount")) AS amount
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
        AND ${condition}
        AND ${personFilter(query)}
        AND ${extraFilter(query, Prisma.sql`p`)}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  /**
   * 결제수단(계좌/카드) 기준 월별 지출 합계.
   *
   * 금액은 카테고리 posting에서 가져오고, 결제수단은 "돈이 나간 계좌 다리"로 판별한다.
   *   - 음수 조건: 이체의 받는 계좌(+)에 지출이 잡히는 중복을 막는다.
   *   - cardId IS NULL: 체크카드 결제는 연결 통장에도 걸리므로 계좌 집계에서 뺀다.
   *
   * 이체 수수료는 보내는 계좌의 지출로 잡힌다. 이체 금액 자체는 카테고리 다리가 없어
   * 합계에 들어가지 않으므로, 수수료만 정확히 반영된다.
   */
  private trendByPaymentMethod(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
    timeZone: string,
  ) {
    const methodCondition =
      query.target === 'card'
        ? Prisma.sql`ap."cardId" = ${query.targetId} AND ap."amount" < 0`
        : Prisma.sql`ap."accountId" = ${query.targetId} AND ap."cardId" IS NULL AND ap."amount" < 0`;

    return this.prisma.$queryRaw<Array<{ month: Date; amount: Prisma.Decimal }>>`
      SELECT date_trunc('month', timezone(${timeZone}, timezone('UTC', e."date"))) AS month,
             ABS(SUM(cp."baseAmount")) AS amount
      FROM "JournalEntry" e
      JOIN "Posting" cp ON cp."entryId" = e.id
      JOIN "Category" c ON c.id = cp."categoryId" AND c."type" = 'expense'
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
        AND ${personFilter(query)}
        AND ${extraFilter(query, Prisma.sql`cp`)}
        AND EXISTS (
          SELECT 1 FROM "Posting" ap
          WHERE ap."entryId" = e.id AND ${methodCondition}
        )
      GROUP BY 1
      ORDER BY 1
    `;
  }

  /**
   * 결제수단별 지출과, 통장으로 들어온 수입.
   *
   * 결제수단 판별은 전표 종류에 달려 있어(이체는 제외해야 한다) SQL로 표현하기 번거롭다.
   * 한 달치 전표만 읽어 entry-view의 판별 규칙을 재사용한다. 목록 화면과 같은 규칙이 보장된다.
   *
   * 통장은 결제수단이면서 수입이 들어오는 곳이다. 지출만 세면 월급이 들어온 통장이
   * 0원으로 보인다. 수입은 amount와 섞지 않고 income에 따로 담는다.
   */
  async getPaymentMethods(
    userId: string,
    query: ReportDto.PeriodQuery,
  ): Promise<ReportDto.PaymentMethodItem[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = this.resolvePeriod(query, timeZone);

    const entries = await this.prisma.journalEntry.findMany({
      where: this.entryScope(projectId, range, query),
      include: ENTRY_INCLUDE,
    });
    const filter = parseEntryFilter(query);
    const extraOnly = filter.extra;

    // 조회용 맵은 비활성/숨김 계정까지 담는다. 예전 거래가 가리키는 계좌를
    // 못 찾으면 그 거래가 집계에서 조용히 빠진다.
    const [cards, accounts] = await Promise.all([
      this.prisma.card.findMany({
        where: { projectId },
        include: { paymentAccount: { include: { owner: true } } },
      }),
      this.prisma.account.findMany({ where: { projectId }, include: { owner: true } }),
    ]);
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const buckets = new Map<string, ReportDto.PaymentMethodItem>();

    // 이번 달에 쓰지 않은 수단도 0원으로 보여준다. 화면에서 "왜 내 카드가 없나"를
    // 묻지 않게 하려면 목록이 거래 유무와 무관해야 한다.
    // 카드 부채 계정과 자본 계정은 결제수단이 아니므로 제외한다.
    // 사람 필터는 "그 사람의 자산만 보여준다"는 뜻이다. 소유자로 거른다.
    // 아무도 고르지 않았으면 빈 배열이므로 어떤 수단도 남지 않는다.
    const visiblePersonIds = filter.personIds ?? null;
    const isVisibleOwner = (ownerId: string | null | undefined) =>
      !visiblePersonIds || (ownerId ? visiblePersonIds.includes(ownerId) : false);

    for (const account of accounts) {
      if (!account.isActive) continue;
      if (HIDDEN_ACCOUNT_TYPES.includes(account.type)) continue;
      if (!isVisibleOwner(account.ownerId)) continue;
      this.addTo(buckets, {
        kind: 'account',
        id: account.id,
        name: account.name,
        ownerId: account.owner?.id ?? null,
        ownerName: account.owner?.name ?? null,
        amount: '0',
        count: 0,
        income: '0',
      });
    }

    /*
     * 실적 기준액을 표시 통화로 옮긴다.
     *
     * 카드에 저장된 값은 결제 통장의 통화다. 통장 통화는 카드마다 다를 수 있어
     * 통화별로 환산기를 하나씩 만든다. 대부분의 프로젝트는 한 통화뿐이라 한 번에
     * 끝나고, 그때는 환산기가 곱셈을 건너뛴다.
     */
    const { display } = await this.projectAccess.getProjectCurrencies(projectId);
    const converters = new Map<string, DisplayConverter>();
    const performanceTargets = new Map<string, string>();
    for (const card of cards) {
      if (card.performanceAmount === null) continue;

      const currency = card.paymentAccount.currency;
      let converter = converters.get(currency);
      if (!converter) {
        converter = await this.exchangeRates.getDisplayConverter(
          projectId,
          this.exchangeRates.assertCurrency(currency, '통장 통화'),
          display,
        );
        converters.set(currency, converter);
      }
      performanceTargets.set(card.id, converter.toString(card.performanceAmount));
    }

    /** 카드 한 장의 빈 칸. 목록을 채울 때와 금액을 더할 때가 같은 모양이어야 한다. */
    const cardBucket = (
      card: (typeof cards)[number],
      amount: string,
      count: number,
    ): ReportDto.PaymentMethodItem => {
      const owner = card.paymentAccount.owner;
      return {
        kind: card.cardType === 'credit' ? 'credit_card' : 'debit_card',
        id: card.id,
        name: card.name,
        ownerId: owner?.id ?? null,
        ownerName: owner?.name ?? null,
        amount,
        count,
        income: '0',
        ...(performanceTargets.has(card.id)
          ? { performanceTarget: performanceTargets.get(card.id) }
          : {}),
        // 홈 화면이 카드 앞면을 이 색으로 그린다. 고르지 않은 카드는 키 자체가 없다.
        ...(card.color !== null ? { color: card.color } : {}),
        ...(card.statementClosingDay !== null
          ? { statementClosingDay: card.statementClosingDay }
          : {}),
      };
    };

    for (const card of cards) {
      if (!card.isActive) continue;
      if (!isVisibleOwner(card.paymentAccount.owner?.id ?? null)) continue;
      this.addTo(buckets, cardBucket(card, '0', 0));
    }

    // 일반/과소비를 하나도 고르지 않았으면 금액은 없지만 목록은 그대로 둔다.
    // 어떤 수단이 있는지는 필터와 무관한 정보다.
    const show = await this.displayConverter(projectId);
    const entriesToCount = filter.matchNothing ? [] : entries;

    for (const entry of entriesToCount) {
      const item = toListItem(entry, show);

      // 일반/과소비 필터. item.extraAmount는 카테고리 다리에서 온 값이다
      // (이체는 수수료 카테고리가 그 값을 정한다).
      if (extraOnly !== undefined && Number(item.extraAmount) > 0 !== extraOnly) continue;

      // 이체 자체는 소비가 아니지만 수수료는 지출이다.
      // 보내는 계좌에 붙여야 summary(지출 카테고리 합계)와 총액이 맞는다.
      if (item.kind === 'transfer') {
        const fee = new Prisma.Decimal(item.feeAmount ?? 0);
        if (fee.gt(ZERO) && item.accountId) {
          const account = accountById.get(item.accountId);
          // 다른 사람이 감춰진 사람의 계좌로 결제했더라도 그 계좌는 목록에 넣지 않는다.
          // 목록에 있는 수단은 "지금 보고 있는 사람들의 자산"이어야 한다.
          if (account && isVisibleOwner(account.ownerId)) {
            this.addTo(buckets, {
              kind: 'account',
              id: account.id,
              name: account.name,
              ownerId: account.owner?.id ?? null,
              ownerName: account.owner?.name ?? null,
              amount: fee.toString(),
              count: 1,
              income: '0',
            });
          }
        }
        continue;
      }

      /*
       * 통장으로 들어온 수입.
       *
       * 수입은 받는 계좌 다리에 붙는다(entry-view가 accountId를 그 계좌로 준다).
       * 카드는 여기에 걸리지 않는다. 카드로는 수입이 들어오지 않고, 환불 입금은
       * card_payment로 기록된다.
       */
      if (item.kind === 'income') {
        if (!item.accountId) continue;
        const account = accountById.get(item.accountId);
        if (!account || !isVisibleOwner(account.ownerId)) continue;
        this.addTo(buckets, {
          kind: 'account',
          id: account.id,
          name: account.name,
          ownerId: account.owner?.id ?? null,
          ownerName: account.owner?.name ?? null,
          amount: '0',
          count: 0,
          income: item.amount,
        });
        continue;
      }

      if (item.kind !== 'expense') continue;

      if (item.cardId) {
        const card = cardById.get(item.cardId);
        if (!card) continue;
        if (!isVisibleOwner(card.paymentAccount.owner?.id ?? null)) continue;
        this.addTo(buckets, cardBucket(card, item.amount, 1));
      } else if (item.accountId) {
        const account = accountById.get(item.accountId);
        if (!account || !isVisibleOwner(account.ownerId)) continue;
        this.addTo(buckets, {
          kind: 'account',
          id: account.id,
          name: account.name,
          ownerId: account.owner?.id ?? null,
          ownerName: account.owner?.name ?? null,
          amount: item.amount,
          count: 1,
          income: '0',
        });
      }
    }

    return [...buckets.values()].sort((a, b) => Number(b.amount) - Number(a.amount));
  }

  /**
   * 투자·저축 계좌의 누적 수익.
   *
   * 그 계좌에 이체로 넣은 돈은 원금이다. 수입·지출로 기록한 것만 수익과 손실이다
   * (배당, 매매 차익, 이자, 수수료). 이체·카드대금·잔액조정은 원금이 오간 것이라 뺀다.
   * 기초잔액 전표도 잔액조정으로 분류되므로 저절로 빠진다(classifyEntry 참고).
   *
   * 구간을 받지 않는다. 자산 화면의 잔액이 전 기간 누적이라 수익도 같은 기준이어야
   * "원금 얼마에 수익 얼마"로 나란히 읽힌다.
   */
  async getAccountProfit(
    userId: string,
    query: { projectId?: string },
  ): Promise<ReportDto.AccountProfit[]> {
    const { id: projectId } = await this.projectAccess.resolveProject(userId, query.projectId);

    const accounts = await this.prisma.account.findMany({
      where: { projectId, type: { in: PROFIT_TYPES } },
      select: { id: true },
    });
    if (accounts.length === 0) return [];

    const accountIds = accounts.map((account) => account.id);
    const entries = await this.prisma.journalEntry.findMany({
      where: { projectId, postings: { some: { accountId: { in: accountIds } } } },
      include: ENTRY_INCLUDE,
    });

    const profit = new Map<string, Prisma.Decimal>(accountIds.map((id) => [id, ZERO]));

    for (const entry of entries) {
      const kind = classifyEntry(entry.postings);
      if (kind !== 'income' && kind !== 'expense') continue;

      // 계좌 다리의 금액을 그대로 더한다. 수입은 +, 지출은 -로 저장되어 있어
      // 합이 곧 순수익이다. 계좌 통화이므로 환산하지 않는다.
      for (const posting of entry.postings) {
        const current = posting.accountId ? profit.get(posting.accountId) : undefined;
        if (!current) continue;
        profit.set(posting.accountId!, current.add(posting.amount));
      }
    }

    return accountIds.map((accountId) => ({
      accountId,
      profit: profit.get(accountId)!.toString(),
    }));
  }

  private addTo(
    buckets: Map<string, ReportDto.PaymentMethodItem>,
    item: ReportDto.PaymentMethodItem,
  ) {
    const key = `${item.kind}:${item.id}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, item);
      return;
    }
    existing.amount = new Prisma.Decimal(existing.amount).add(item.amount).toString();
    existing.count += item.count;
    existing.income = new Prisma.Decimal(existing.income).add(item.income).toString();
  }

  /**
   * 월 집계의 전표 범위.
   *
   * 자산 주인 필터는 목록(/entries)과 같은 규칙을 쓴다. 목록만 걸러 놓으면
   * 상단 합계와 소계가 어긋난다.
   */
  /**
   * 집계 구간을 정한다.
   *
   * startDate/endDate 를 주면 그 구간을, 아니면 yearMonth 의 한 달을 본다.
   * 날짜는 프로젝트 타임존의 달력 날짜이고 **양끝을 포함한다**. 끝날을 그대로
   * 상한으로 쓰면 그날 0시 이후의 거래가 전부 빠지므로 다음 날 0시를 상한으로 삼는다
   * (entryScope 가 `date < end` 로 거른다).
   */
  private resolvePeriod(
    query: ReportDto.PeriodQuery,
    timeZone: string,
  ): { start: Date; end: Date } {
    const { startDate, endDate } = query;

    if (!startDate && !endDate) {
      return zonedMonthRange(assertYearMonth(query.yearMonth ?? '', '조회 월'), timeZone);
    }
    if (!startDate || !endDate) {
      throw new BadRequestException('기간은 시작일과 종료일을 함께 지정해야 합니다.');
    }

    const start = assertDateKey(startDate, '시작일');
    const end = assertDateKey(endDate, '종료일');
    if (start > end) {
      throw new BadRequestException('시작일이 종료일보다 뒤입니다.');
    }

    const [year, month, day] = end.split('-').map(Number);
    return {
      start: zonedDateStringToUtc(start, timeZone),
      // 하루를 더한다. Date 생성자가 월·연 넘김을 처리하므로 말일을 따로 보지 않는다.
      end: zonedDayStart(year, month, day + 1, timeZone),
    };
  }

  /** 응답에 실을 구간 표시. 한 달을 본 경우에는 yearMonth 도 함께 준다. */
  private periodLabel(
    query: ReportDto.PeriodQuery,
    range: { start: Date; end: Date },
    timeZone: string,
  ) {
    const startParts = zonedParts(range.start, timeZone);
    // end 는 다음 날 0시라 하루를 빼야 사용자가 고른 종료일이 된다.
    const endParts = zonedParts(new Date(range.end.getTime() - 1), timeZone);
    const key = (p: { year: number; month: number; day: number }) =>
      `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

    return {
      startDate: key(startParts),
      endDate: key(endParts),
      ...(query.startDate && query.endDate ? {} : { yearMonth: query.yearMonth }),
    };
  }

  private entryScope(
    projectId: string,
    range: { start: Date; end: Date },
    query: ReportDto.PeriodQuery,
  ): Prisma.JournalEntryWhereInput {
    const filter = parseEntryFilter(query);
    // 아무것도 고르지 않았으면 어떤 전표도 걸리지 않아야 한다.
    if (filter.matchNothing) return { projectId, ...MATCH_NOTHING };

    const owner = assetOwnerCondition(filter);

    return {
      projectId,
      date: { gte: range.start, lt: range.end },
      ...(owner ? { AND: [owner] } : {}),
    };
  }

  /**
   * 계좌별 장부가 (기준통화).
   *
   * 외화 계좌의 balance는 그 통화라서 순자산에 바로 못 넣는다. 장부가는 거래마다
   * 그때의 환율로 쌓인 baseAmount 합계이고, 최신 환율로 환산한 값과의 차이가
   * 미실현 환차손익이 된다.
   */
  private async bookValuesOf(accountIds: string[]) {
    if (accountIds.length === 0) return new Map<string, Prisma.Decimal>();

    const rows = await this.prisma.posting.groupBy({
      by: ['accountId'],
      _sum: { baseAmount: true },
      where: { accountId: { in: accountIds } },
    });
    return new Map(
      rows.map((row) => [row.accountId!, row._sum.baseAmount ?? ZERO] as const),
    );
  }

  /** 계좌별 최신 평가액. 계좌 수만큼 쿼리를 돌리지 않는다. */
  private async latestMarketValues(accountIds: string[]) {
    if (accountIds.length === 0) return new Map<string, Prisma.Decimal>();

    const rows = await this.prisma.$queryRaw<
      Array<{ accountId: string; marketValue: Prisma.Decimal }>
    >`
      SELECT DISTINCT ON ("accountId") "accountId", "marketValue"
      FROM "AssetValuation"
      WHERE "accountId" IN (${Prisma.join(accountIds)})
      ORDER BY "accountId", "date" DESC
    `;
    return new Map(rows.map((r) => [r.accountId, r.marketValue]));
  }
}

/**
 * 사람 필터를 SQL 조각으로. 필터가 없으면 항상 참인 조건을 돌려준다.
 * (Prisma.sql 템플릿에서는 조건을 빼는 것보다 참을 넣는 편이 단순하다)
 */
/**
 * 자산 주인 필터를 SQL 조각으로.
 *
 * Prisma 쪽 assetOwnerCondition 과 같은 규칙이다.
 *   - 돈이 나간 다리(음수)의 계좌 주인을 본다 (이체는 보내는 계좌).
 *   - 나간 다리가 없으면(수입 등) 들어온 다리를 본다.
 * 자본 계정은 주인이 없어 "나간 다리" 판단에서 제외한다.
 */
function personFilter(query: ReportDto.TrendQuery & { personId?: string }): Prisma.Sql {
  const filter = parseEntryFilter(query);
  // 아무것도 고르지 않았으면 한 건도 나오지 않아야 한다.
  if (filter.matchNothing) return Prisma.sql`FALSE`;
  if (!filter.personIds) return Prisma.sql`TRUE`;

  const ids = Prisma.join(filter.personIds);
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "Posting" op JOIN "Account" oa ON oa.id = op."accountId"
      WHERE op."entryId" = e.id AND op."amount" < 0 AND oa."ownerId" IN (${ids})
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM "Posting" op JOIN "Account" oa ON oa.id = op."accountId"
        WHERE op."entryId" = e.id AND op."amount" < 0 AND oa."ownerId" IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM "Posting" op JOIN "Account" oa ON oa.id = op."accountId"
        WHERE op."entryId" = e.id AND op."amount" > 0 AND oa."ownerId" IN (${ids})
      )
    )
  )`;
}

/** 일반/과소비 필터를 SQL 조각으로. 카테고리 다리(alias)에만 건다. */
function extraFilter(query: ReportDto.TrendQuery, alias: Prisma.Sql): Prisma.Sql {
  const extra = parseEntryFilter(query).extra;
  if (extra === undefined) return Prisma.sql`TRUE`;
  return extra
    ? Prisma.sql`${alias}."extraAmount" > 0`
    : Prisma.sql`${alias}."extraAmount" = 0`;
}

/** Prisma where에 붙이는 같은 조건. 필터가 없으면 아무것도 붙이지 않는다. */
function extraCondition(extra: boolean | undefined) {
  if (extra === undefined) return {};
  return { extraAmount: extra ? { gt: 0 } : { equals: 0 } };
}

/** 잔액 추이의 한 구간. 값은 end 직전까지 쌓인 잔액이다. */
type BalanceBucket = { label: string; start: Date; end: Date };

/** 월 단위 구간. endMonth를 포함해 뒤로 months개. 경계는 프로젝트 타임존 기준이다. */
function monthBuckets(endMonth: string, months: number, timeZone: string): BalanceBucket[] {
  const [year, month] = endMonth.split('-').map(Number);
  const buckets: BalanceBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    buckets.push({
      label: shiftYearMonth(year, month, -i),
      start: zonedMonthStart(year, month - i, timeZone),
      end: zonedMonthStart(year, month - i + 1, timeZone),
    });
  }
  return buckets;
}

/** 구간 개수. 쿼리스트링으로 오는 값이라 숫자가 아닐 수 있다. */
function clampCount(value: unknown, fallback: number, max: number): number {
  return Math.min(Math.max(Number(value) || fallback, 1), max);
}

/** 연 단위 구간. endYear를 포함해 뒤로 years개. 경계는 프로젝트 타임존 기준이다. */
function yearBuckets(endYear: number, years: number, timeZone: string): BalanceBucket[] {
  const buckets: BalanceBucket[] = [];
  for (let i = years - 1; i >= 0; i--) {
    const year = endYear - i;
    buckets.push({
      label: String(year),
      start: zonedMonthStart(year, 1, timeZone),
      end: zonedMonthStart(year + 1, 1, timeZone),
    });
  }
  return buckets;
}

/**
 * 일 단위 구간. 오늘을 포함해 뒤로 days개.
 *
 * zonedDayStart는 day가 1보다 작아도 앞 달로 넘어간다(Date.UTC의 규칙).
 * 달 경계를 따로 다루지 않아도 되는 이유다.
 */
function recentDayBuckets(days: number, timeZone: string): BalanceBucket[] {
  const { year, month, day } = zonedParts(new Date(), timeZone);
  const buckets: BalanceBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = zonedDayStart(year, month, day - i, timeZone);
    buckets.push({
      label: zonedDateKey(start, timeZone),
      start,
      end: zonedDayStart(year, month, day - i + 1, timeZone),
    });
  }
  return buckets;
}

/** 일 단위 구간. 그 달 1일부터 말일까지. 경계는 프로젝트 타임존 기준이다. */
function dayBuckets(yearMonth: string, timeZone: string): BalanceBucket[] {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthEnd = zonedMonthStart(year, month + 1, timeZone);
  const buckets: BalanceBucket[] = [];

  for (let day = 1; ; day++) {
    const start = zonedDayStart(year, month, day, timeZone);
    if (start.getTime() >= monthEnd.getTime()) break;
    const next = zonedDayStart(year, month, day + 1, timeZone);
    buckets.push({
      label: `${year}-${pad(month)}-${pad(day)}`,
      start,
      end: next,
    });
  }
  return buckets;
}

/** (year, month)에서 delta개월 옮긴 "YYYY-MM". month는 1~12지만 범위를 벗어나도 된다. */
function shiftYearMonth(year: number, month: number, delta: number): string {
  const index = month - 1 + delta;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = (((index % 12) + 12) % 12) + 1;
  return `${shiftedYear}-${pad(shiftedMonth)}`;
}

/**
 * date_trunc 결과가 속한 "YYYY-MM".
 *
 * SQL에서 프로젝트 타임존의 벽시계로 자른 값이라 인스턴트가 아니다.
 * Prisma가 `timestamp`를 UTC로 읽어 주므로 UTC 필드가 곧 그 지역의 벽시계 값이다.
 */
function wallClockYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function emptyNetWorth(): ReportDto.NetWorth {
  return {
    total: '0',
    cash: '0',
    investment: '0',
    liability: '0',
    unrealizedGain: '0',
    byType: {},
    byPerson: [],
  };
}

/** 유형별 소계를 응답 형태로. 0인 유형은 넣지 않는다 (없는 것과 뜻이 같다). */
function serializeByType(byType: Map<AccountType, Prisma.Decimal>): ReportDto.NetWorthByType {
  const result: ReportDto.NetWorthByType = {};
  for (const [type, amount] of byType) {
    if (amount.isZero()) continue;
    result[type] = amount.toString();
  }
  return result;
}
