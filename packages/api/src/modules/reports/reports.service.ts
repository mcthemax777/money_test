/**
 * 리포트 서비스. 합계·일별·구성비·순자산·잔액 추이·달 목록·시계열·결제수단·수익.
 *
 * 읽을 범위는 report-scope.ts, 기간 읽기는 report-period.ts, 행 옮기기는 report-rows.ts 에
 * 있다 (2026-10-26 나눔). 더하는 규칙은 `@money/types` 의 공용 함수가 갖는다.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { readEnum } from '@/common/text';
import { ENTRY_INCLUDE, classifyEntry, toListItem } from '../entries/entry-view';
import { lineMatcherOf, parseEntryFilter, splitList } from '@/common/entry-filter';
import { assertDateKey, assertYearMonth } from '@/common/year-month';
import { analysisScopes } from '@/common/payback-scope';
import { withBalancesAsOf } from '@/common/balance-as-of';
import { installmentScope, spreadOf } from '@/common/installment-scope';
import {
  DisplayConverter,
  ExchangeRatesService,
} from '../exchange-rates/exchange-rates.service';
import {
  Dec,
  type EntryBasis,
  installmentEntryViews,
  parseEntryBasis,
  ReportDto,
  categoryBreakdown,
  dailyTotals,
  entryMonths,
  asWeekStart,
  balanceBuckets,
  stackBalanceHistory,
  isEntryPeriodUnit,
  DEFAULT_ENTRY_PERIOD,
  isPeriodKey,
  asPeriodAnchor,
  nextDateKey,
  periodDayRange,
  periodTotals,
  shiftPeriodKey,
  parseEntrySearch,
  netWorth,
  type NetWorthAccountRow,
  paymentMethods,
  EQUITY_ACCOUNT_TYPES,
  VALUED_ACCOUNT_TYPES,
  nonZeroAmounts,
  groupOfRow,
  isAssetGroupKey,
  summarize,
  zonedCurrentYearMonth,
  zonedDayStart,
  PROFIT_ACCOUNT_TYPES,
} from '@money/types';
import {
  AGGREGATE_SELECT,
  REPORT_CATEGORY_TYPES,
  emptyNetWorth,
  toAggregateRows,
  toDecimal,
  toNamedRows,
} from './report-rows';
import { periodLabel, resolvePeriod, resolveWindow } from './report-period';
import {
  entryConditions,
  entryScope,
  trendByCategoryWhere,
  trendByPaymentMethodWhere,
  trendByTagWhere,
} from './report-scope';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /**
   * 회차 기준의 질의 두 벌. 발생 기준이면 지금까지의 한 벌 그대로다.
   *
   * 할부는 산 달이 창보다 앞이어도 이번 달에 회차가 선다. 그래서 할부만 창을 앞으로
   * 넓혀 따로 읽고, 본 질의에서는 빼 둔다 -- 그러지 않으면 산 달의 전액과 회차가
   * 함께 세어진다.
   */
  private async aggregatePostings<S extends Prisma.PostingSelect>(args: {
    basis: EntryBasis;
    postingWhere: Prisma.PostingWhereInput;
    scope: Prisma.JournalEntryWhereInput;
    select: S;
    /**
     * 자산 관점이면 참. 페이백을 들어온 날짜로 고른다 (`toAggregateRows` 의 같은 이름과 짝).
     *
     * 거짓(분석)이면 연결된 페이백을 원거래 날짜로 고른다 (common/payback-scope).
     */
    ownDate?: boolean;
  }) {
    const { basis, postingWhere, scope, select, ownDate = false } = args;
    const find = (entry: Prisma.JournalEntryWhereInput) =>
      this.prisma.posting.findMany({ where: { ...postingWhere, entry }, select });

    if (!ownDate) {
      const parts = await Promise.all(analysisScopes(scope, basis === 'installment').map(find));
      return parts.flat();
    }

    if (basis !== 'installment') return find(scope);

    const spread = installmentScope(scope);
    const [plain, installments] = await Promise.all([
      find((spread.OR as Prisma.JournalEntryWhereInput[])[0]),
      find((spread.OR as Prisma.JournalEntryWhereInput[])[1]),
    ]);
    return [...plain, ...installments];
  }

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
    const range = resolvePeriod(query, timeZone);
    const scope = await entryScope(this.prisma, projectId, range, query);
    /*
     * 합계는 전부 기준통화 환산액이다. amount는 그 다리의 통화라 섞으면 못 더한다.
     *
     * 더하기를 SQL이 아니라 공용 함수가 한다. 기기가 오프라인에서 같은 합계를 내야
     * 하고, 규칙이 두 벌이면 같은 달의 숫자가 갈린다. 한 프로젝트의 한 달치 다리는
     * 수백 줄 규모라 읽어 와 더해도 부담이 없다.
     */
    const basis = parseEntryBasis(query.basis);
    const rows = await this.aggregatePostings({
      basis,
      postingWhere: { categoryId: { not: null } },
      scope,
      select: AGGREGATE_SELECT,
    });
    const totals = summarize(
      toAggregateRows(
        rows,
        lineMatcherOf(parseEntrySearch(query)),
        spreadOf(basis, timeZone, { gte: range.start, lt: range.end }),
      ),
    );

    const show = await this.displayConverter(projectId);
    const asString = (value: Dec) => show.toString(toDecimal(value));
    return {
      ...periodLabel(query, range, timeZone),
      income: asString(totals.income),
      expense: asString(totals.expense),
      net: asString(totals.net),
    };
  }

  /**
   * 날짜별 지출·수입.
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
    const range = resolvePeriod(query, timeZone);
    // 쿼리스트링은 문자열로 도착한다. 아는 값이 아니면 지출이다.
    const isIncome = query.type === 'income';
    const type = isIncome ? CategoryType.income : CategoryType.expense;
    const basis = parseEntryBasis(query.basis);
    const postings = await this.aggregatePostings({
      basis,
      postingWhere: { category: { type } },
      scope: await entryScope(this.prisma, projectId, range, query),
      select: AGGREGATE_SELECT,
    });

    // 날짜별로 묶는 규칙은 공용 함수가 갖는다.
    const days = dailyTotals(
      toAggregateRows(
        postings,
        lineMatcherOf(parseEntrySearch(query)),
        spreadOf(basis, timeZone, { gte: range.start, lt: range.end }),
      ),
      { timeZone, type },
    );

    const show = await this.displayConverter(projectId);
    return days.map((day) => ({
      date: day.date,
      amount: show.toString(toDecimal(day.amount)),
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
    const range = resolvePeriod(query, timeZone);
    // 쿼리스트링 값은 문자열로 도착한다. 이 DTO는 클래스가 아니라 인터페이스라서
    // ValidationPipe의 암묵 변환이 걸리지 않고 ?rollup=false 가 'false' 문자열로 들어온다.
    // 불리언 비교만 하면 항상 롤업이 켜져서 소분류 구성비를 볼 수 없다.
    const rollup = query.rollup !== false && (query.rollup as unknown) !== 'false';

    // 목록 밖의 유형은 400 이다 (`readEnum`). 예전에는 enum 칸에서 500 이었다.
    const type = readEnum(query.type, REPORT_CATEGORY_TYPES, '유형') as CategoryType;

    /*
     * 이름을 행에 함께 실어 온다. 예전에는 카테고리를 따로 조회하고, 롤업 대상인
     * 대분류 이름을 얻으려고 한 번 더 조회했다. 소분류 행이 부모 이름까지 들고 오면
     * 그 두 번째 조회가 사라지고, 기기도 같은 모양의 행으로 같은 함수를 쓸 수 있다.
     */
    const basis = parseEntryBasis(query.basis);
    const rows = await this.aggregatePostings({
      basis,
      postingWhere: { category: { type } },
      scope: await entryScope(this.prisma, projectId, range, query),
      select: {
        ...AGGREGATE_SELECT,
        category: {
          select: {
            type: true,
            name: true,
            parentId: true,
            parent: { select: { id: true, name: true } },
          },
        },
      },
    });

    const matchLine = lineMatcherOf(parseEntrySearch(query));
    const spread = spreadOf(basis, timeZone, { gte: range.start, lt: range.end });
    const counted = toNamedRows(rows, matchLine, spread);

    const buckets = categoryBreakdown(counted, { type, rollup });
    const show = await this.displayConverter(projectId);

    return buckets.map((bucket) => ({
      categoryId: bucket.categoryId,
      categoryName: bucket.categoryName,
      parentCategoryId: bucket.parentCategoryId,
      parentCategoryName: bucket.parentCategoryName,
      amount: show.toString(toDecimal(bucket.amount)),
      count: bucket.count,
      ratio: bucket.ratio,
    }));
  }

  /**
   * 순자산.
   *
   * 현금성 계좌는 balance를 그대로, 투자성 계좌는 최신 시가를 쓴다.
   * 자본 계정(opening_balance)은 자산이 아니므로 제외한다. 포함하면 항상 0에 가까워진다.
   */
  async getNetWorth(userId: string, projectId?: string): Promise<ReportDto.NetWorth> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    // 잔액은 지금까지의 것이다. 미래 날짜로 적어 둔 거래는 아직 자산이 아니다.
    const accounts = await withBalancesAsOf(
      this.prisma,
      await this.prisma.account.findMany({
        where: {
          projectId: finalProjectId,
          isActive: true,
          type: { notIn: [...EQUITY_ACCOUNT_TYPES] as AccountType[] },
        },
        include: {
          owner: { select: { id: true, name: true } },
          // 카드 대금을 결제 통장의 묶음에 넣으려고 그 통장의 유형을 함께 읽는다 (groupOfRow).
          cardAsLiability: { select: { paymentAccount: { select: { type: true } } } },
        },
      }),
    );
    if (accounts.length === 0) return emptyNetWorth();

    // 투자성 계좌의 최신 평가액
    const valuedIds = accounts
      .filter((account) => VALUED_ACCOUNT_TYPES.includes(account.type))
      .map((account) => account.id);
    const marketValues = await this.latestMarketValues(valuedIds);
    const bookValues = await this.bookValuesOf(accounts.map((account) => account.id));

    /*
     * 환율을 두 층으로 모은다.
     *
     * 계좌 통화 -> 표시 통화는 계좌 잔액을 옮기는 데 쓴다(달러 통장의 달러 잔액).
     * 저장 통화 -> 표시 통화는 장부가와 시가를 옮기는 데 쓴다(둘 다 저장 통화로 쌓인다).
     * 그 차이가 미실현 손익이라, 두 환율을 섞으면 손익이 엉뚱한 값이 된다.
     */
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(finalProjectId);
    const toDisplay: Record<string, string> = {};
    for (const currency of new Set(accounts.map((account) => account.currency))) {
      const info = await this.exchangeRates.getRate(
        finalProjectId,
        this.exchangeRates.assertCurrency(currency, '계좌 통화'),
        display,
      );
      toDisplay[currency] = String(info.rate);
    }
    const ledgerConverter = await this.exchangeRates.getDisplayConverter(
      finalProjectId,
      ledger,
      display,
    );

    const rows: NetWorthAccountRow[] = accounts.map((account) => ({
      id: account.id,
      type: account.type,
      paymentAccountType: account.cardAsLiability?.paymentAccount.type ?? null,
      currency: account.currency,
      balance: account.balance,
      ownerId: account.owner?.id ?? null,
      ownerName: account.owner?.name ?? null,
      marketValue: marketValues.get(account.id) ?? null,
      bookValue: bookValues.get(account.id) ?? null,
    }));

    // 칸을 나누고 재평가하는 규칙은 공용 함수가 갖는다.
    const result = netWorth(rows, {
      ledgerCurrency: ledger,
      displayCurrency: display,
      toDisplay,
      ledgerToDisplay: ledgerConverter.rate,
    });

    return {
      total: result.total.toString(),
      cash: result.cash.toString(),
      investment: result.investment.toString(),
      liability: result.liability.toString(),
      unrealizedGain: result.unrealizedGain.toString(),
      byType: nonZeroAmounts(result.byType),
      byGroup: nonZeroAmounts(result.byGroup),
      byAccount: result.byAccount.map((part) => ({ ...part, amount: part.amount.toString() })),
      byPerson: result.byPerson.map((bucket) => ({
        personId: bucket.personId,
        personName: bucket.personName,
        total: bucket.total.toString(),
        cash: bucket.cash.toString(),
        investment: bucket.investment.toString(),
        liability: bucket.liability.toString(),
        byType: nonZeroAmounts(bucket.byType),
        byGroup: nonZeroAmounts(bucket.byGroup),
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
      query.granularity === 'day' || query.granularity === 'week' || query.granularity === 'year'
        ? query.granularity
        : 'month';
    /*
     * 주를 어느 요일에서 끊을지. 사용자 설정이고 조회에 실려 온다 (`BalanceHistoryQuery`).
     *
     * 거래 목록의 주 묶음(`getEntryMonths`)과 같은 값을 받아야 한다. 한쪽만 월요일이면
     * 같은 주를 두 화면이 다른 날에서 끊어, 그래프의 한 칸과 목록의 한 줄이 다른 이레가
     * 된다. 주 단위가 아니면 쓰이지 않는다.
     */
    const weekStart = asWeekStart(query.weekStart);

    /*
     * 여러 구성원을 한 선으로 볼 때 쓴다. 목록 필터와 같은 세 상태 규칙이라
     * 키가 없으면 전체, 빈 문자열이면 아무도 고르지 않은 것이라 빈 그래프를 준다.
     */
    const ownerIds = query.ownerIds === undefined ? undefined : splitList(query.ownerIds);
    if (ownerIds && ownerIds.length === 0) return [];
    if (query.group !== undefined && !isAssetGroupKey(query.group)) {
      throw new BadRequestException('알 수 없는 자산 묶음입니다.');
    }

    const found = await this.prisma.account.findMany({
      where: {
        projectId,
        // 기초잔액 상대편은 자산이 아니다. getNetWorth 와 같은 기준으로 뺀다.
        type: { notIn: [...EQUITY_ACCOUNT_TYPES] as AccountType[] },
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
      select: {
        id: true,
        type: true,
        // 묶음으로 고를 때 카드 대금은 결제 통장의 묶음을 따른다 (getNetWorth 와 같다).
        cardAsLiability: { select: { paymentAccount: { select: { type: true } } } },
      },
    });
    // 합계 제외로 둔 계좌. 계좌 하나를 보려고 고른 때는 그 계좌를 그대로 그린다.
    const excluded = new Set(
      query.excludeAccountIds && !query.accountId ? splitList(query.excludeAccountIds) : [],
    );
    const accounts = found
      .filter((a) => !excluded.has(a.id))
      .filter(
        (a) =>
          !query.group ||
          groupOfRow({
            type: a.type,
            paymentAccountType: a.cardAsLiability?.paymentAccount.type ?? null,
          }) === query.group,
      );
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
    /*
     * 칸 나누기는 공용 함수다 (`@money/types` 의 balance-history). 기기 사본도 같은 칸을 쓴다.
     * 여기서는 쿼리스트링의 모양만 먼저 검사한다.
     */
    const buckets = balanceBuckets(
      {
        granularity,
        endMonth,
        yearMonth: query.yearMonth ? assertYearMonth(query.yearMonth, '조회 월') : undefined,
        endDate: query.endDate ? assertDateKey(query.endDate, '기준일') : undefined,
        days: query.days,
        weeks: query.weeks,
        months: query.months,
        years: query.years,
        weekStart,
      },
      timeZone,
    );
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

    /*
     * 구간의 첫 시각을 세는 식. 로컬 벽시계로 바꾼 뒤 자른다.
     *
     * **주는 사용자가 고른 요일에서 끊는다.** 포스트그레스의 `date_trunc('week')` 는 늘
     * 월요일에서 끊으므로, 고른 요일이 월요일에 오도록 밀어 자르고 같은 만큼 되돌린다
     * (일요일 시작이면 하루다). 칸의 경계는 `weekBuckets` 가 따로 세므로 두 셈이 같은
     * 날을 가리켜야 한다 -- 어긋나면 그 칸의 증감이 이웃 칸으로 넘어간다.
     */
    const localDate = Prisma.sql`timezone(${timeZone}, timezone('UTC', e."date"))`;
    /*
     * 고른 요일을 월요일 자리로 옮기는 날수. 0~6 이다 (월요일 시작이면 0).
     *
     * `::int` 를 붙이는 것은 Prisma 가 자바스크립트의 수를 bigint 로 실어 보내기
     * 때문이다. `make_interval(days => bigint)` 라는 함수는 없어, 캐스트가 없으면
     * 질의가 42883 으로 떨어진다(실제로 그랬다).
     */
    const toMonday = (8 - weekStart) % 7;
    const bucketStart =
      granularity === 'week'
        ? Prisma.sql`date_trunc('week', ${localDate} + make_interval(days => ${toMonday}::int)) - make_interval(days => ${toMonday}::int)`
        : Prisma.sql`date_trunc(${granularity}, ${localDate})`;

    // 창 안의 구간별 계좌별 증감
    const stepRows = await this.prisma.$queryRaw<
      Array<{ accountId: string; period: Date; delta: Prisma.Decimal }>
    >`
      SELECT p."accountId" AS "accountId",
             -- 구간 경계는 프로젝트 타임존 기준이다. 로컬 벽시계로 바꿔 자른 뒤
             -- 다시 UTC 인스턴트로 되돌려야 아래 bucket.start와 값이 맞는다.
             timezone('UTC', timezone(${timeZone}, ${bucketStart})) AS period,
             SUM(p."baseAmount") AS delta
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      WHERE e."projectId" = ${projectId}
        AND p."accountId" IN (${Prisma.join(accountIds)})
        AND e."date" >= ${windowStart}
        AND e."date" < ${windowEnd}
      GROUP BY 1, 2
    `;

    const stepsByPeriod = new Map<number, Array<{ accountId: string; delta: Prisma.Decimal }>>();
    for (const row of stepRows) {
      const key = row.period.getTime();
      const list = stepsByPeriod.get(key) ?? [];
      list.push({ accountId: row.accountId, delta: row.delta });
      stepsByPeriod.set(key, list);
    }

    const valuedIds = accounts.filter((a) => VALUED_ACCOUNT_TYPES.includes(a.type)).map((a) => a.id);
    const valuations =
      valuedIds.length > 0
        ? await this.prisma.assetValuation.findMany({
            where: { accountId: { in: valuedIds } },
            select: { accountId: true, date: true, marketValue: true },
            orderBy: { date: 'asc' },
          })
        : [];

    // 칸마다 쌓는 규칙도 공용 함수다 -- 평가 계좌는 그때까지의 마지막 평가액, 없으면 장부가.
    const show = await this.displayConverter(projectId);
    return stackBalanceHistory({
      accounts,
      base: new Map(baseRows.map((row) => [row.accountId, row.delta])),
      steps: stepsByPeriod,
      valuations,
      buckets,
    }).map((point) => ({
      date: point.label,
      balance: show.toString(toDecimal(point.total)),
    }));
  }

  /**
   * 거래가 있는 달만, 최신 달부터. 거래 화면의 첫 목록이다.
   *
   * getTrend 와 갈라 두는 이유가 둘이다. 그쪽은 그래프용이라 개월 수를 받아 빈 달을
   * 0으로 채우고 지출·수입 중 하나만 낸다. 여기는 전체 기간을 훑어 **거래가 있는 달만**
   * 내고, 한 줄에 지출과 수입을 함께 적는다. 목록의 줄은 눌러서 들어가는 자리라,
   * 빈 달이 섞이면 눌러도 아무것도 없는 줄이 된다.
   *
   * 기간을 주면 그 구간에 걸친 달만 남고, 걸친 달의 합계도 **구간만큼만** 센다.
   * 달을 통째로 세면 년월 줄의 금액과 그 안을 펴서 나온 거래의 합이 어긋난다.
   * 주지 않으면 전체 기간이고, 그때는 그 프로젝트의 카테고리 다리를 전부 읽는다.
   * 한 가정의 원장은 십 년을 써도 수만 줄 규모다. 달을 SQL 로 자르지 않는 것은
   * date_trunc 가 IANA 타임존을 아는 반면 기기의 SQLite 는 모르기 때문이다 --
   * 자르는 규칙을 공용 함수 하나로 두어야 사본이 같은 값을 낸다.
   */
  async getEntryMonths(
    userId: string,
    query: ReportDto.EntryMonthsQuery,
  ): Promise<ReportDto.EntryMonth[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );

    const filter = parseEntryFilter(query);
    const search = parseEntrySearch(query);
    if (filter.matchNothing || search.matchNothing) return [];

    const window = resolveWindow(query, timeZone);
    // 검색은 전표 수준으로 걸린다 (entryScope 와 같은 이유).
    const conditions = await entryConditions(this.prisma, projectId, filter, search, window);
    const scope = {
      projectId,
      ...(window ? { date: window } : {}),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };
    const basis = parseEntryBasis(query.basis);
    /*
     * 거래 탭의 달 목록이다. 달을 펼치면 그 달에 들어온 거래가 서므로, 머리의 합계도 들어온
     * 날짜로 센다 -- 페이백을 원거래의 달로 옮기면 펼친 줄과 머리 합계가 갈린다
     * (PAYBACK_DESIGN.md 결정 G).
     */
    const [rows, dates] = await Promise.all([
      this.aggregatePostings({
        basis,
        postingWhere: { categoryId: { not: null } },
        scope,
        select: AGGREGATE_SELECT,
        ownDate: true,
      }),
      /*
       * 달을 만들 전표의 시각.
       *
       * 다리만 보면 이체와 카드정산이 빠진다 -- 카테고리 다리가 없기 때문이다. 그
       * 유형만 골라 본 사람에게는 거래가 있는데도 목록이 비어 버린다. 금액은 0이 맞고,
       * 줄은 있어야 한다.
       *
       * **기초잔액 전표는 뺀다.** 계좌를 만들 때 원장 맨 앞(1970년)에 쌓이는 자본
       * 전표라, 넣으면 거래 목록의 첫 화면에 "1970년 1월"이 줄로 앉는다. 사용자가 적은
       * 거래가 아니고 카테고리 다리도 없어 금액도 0이다.
       */
      this.prisma.journalEntry.findMany({
        where: {
          ...scope,
          NOT: { postings: { some: { account: { type: AccountType.opening_balance } } } },
        },
        select: { date: true },
      }),
    ]);

    const show = await this.displayConverter(projectId);
    /*
     * 묶는 단위는 요청이 정한다. 옛 기기는 이 칸을 보내지 않고, 그때는 달이다.
     * 모르는 값이 오면 조용히 달로 읽는다 -- 목록이 비는 것보다 낫다.
     */
    const unit = isEntryPeriodUnit(query.unit) ? query.unit : DEFAULT_ENTRY_PERIOD;
    /*
     * 주를 어느 요일에서 끊을지. 사용자 설정이고 조회에 실려 온다 (`EntryMonthsQuery`).
     *
     * 질의 문자열이라 숫자가 문자로 온다. 읽을 수 없는 값은 일요일로 센다 -- 단위와
     * 같은 규칙이다. 달·해로 묶을 때는 쓰이지 않는다.
     */
    const weekStart = asWeekStart(query.weekStart);

    /*
     * 회차 기준이면 회차가 선 달도 줄이 되어야 한다.
     *
     * 달을 만드는 것은 전표의 날짜인데(`entryDates`), 지난달에 산 할부의 이번 달
     * 회차에는 전표가 없다. 편 줄의 날짜를 함께 넘겨야 그 달이 목록에 선다.
     */
    const spread = spreadOf(basis, timeZone, window);
    const counted = toAggregateRows(rows, lineMatcherOf(search), spread, true);
    const monthDates = [
      ...dates.map((row) => row.date),
      ...(spread
        ? counted.map((row) => (row.date instanceof Date ? row.date : new Date(row.date)))
        : []),
    ];

    return entryMonths(counted, {
      timeZone,
      entryDates: monthDates,
      unit,
      weekStart,
      // 달·해를 어디서 끊을지. 거래 화면의 검색이 고른다 (`PeriodAnchor`).
      anchor: asPeriodAnchor(query),
    }).map(
      (month) => ({
        yearMonth: month.yearMonth,
        income: show.toString(toDecimal(month.income)),
        expense: show.toString(toDecimal(month.expense)),
      }),
    );
  }

  /**
   * 기간별 시계열. 예산 상세와 결제수단 탭이 각자 구현하던 것을 하나로 합쳤다.
   * 고르는 일은 질의가, 기간으로 묶어 더하는 일은 공용 함수(`periodTotals`)가 한다.
   */
  async getTrend(userId: string, query: ReportDto.TrendQuery): Promise<ReportDto.TrendPoint[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const months = Math.min(Math.max(Number(query.months) || 12, 1), 60);
    /*
     * 마지막 막대의 열쇠. 기간 열쇠(해·달·주)를 주면 그 단위로 서고, 아니면 달이다.
     */
    if (query.endPeriod !== undefined && !isPeriodKey(query.endPeriod)) {
      throw new BadRequestException('기준 기간: YYYY, YYYY-MM, YYYY-MM-DD 중 하나여야 합니다.');
    }
    const endKey =
      query.endPeriod ??
      (query.endMonth ? assertYearMonth(query.endMonth, '기준 월') : zonedCurrentYearMonth(timeZone));
    /*
     * 막대가 덮는 기간. 검색 기간을 주면(clip) 그 안으로 자른다 -- 기간 이름은 그대로 두고
     * 세는 돈만 줄인다. 잘못 적은 시각은 버린다(자르지 않는 쪽이 조용히 비는 쪽보다 낫다).
     */
    const clip = (value: string | undefined) => {
      const at = value ? new Date(value) : null;
      return at && !Number.isNaN(at.getTime()) ? at : null;
    };
    const dayStart = (dateKey: string) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      return zonedDayStart(year, month, day, timeZone);
    };
    const fullEnd = dayStart(nextDateKey(periodDayRange(endKey).endKey));
    const fullStart = dayStart(periodDayRange(shiftPeriodKey(endKey, -(months - 1))).startKey);
    const clipFrom = clip(query.clipFrom);
    const clipTo = clip(query.clipTo);
    const start = clipFrom && clipFrom > fullStart ? clipFrom : fullStart;
    const end = clipTo && clipTo < fullEnd ? clipTo : fullEnd;

    /*
     * 대상에 따라 무엇을 고르는지가 다르다.
     *
     * 카테고리/전체는 카테고리 posting 을 그대로 더하면 된다.
     * 계좌/카드는 "그 수단으로 결제한 지출"이어야 하므로 계좌 posting 을 더할 수 없다.
     * (계좌 posting 을 더하면 입금과 출금이 상쇄되고, 체크카드 사용까지 섞인다)
     *
     * 고르는 일은 질의가, 더하는 일은 공용 함수가 한다. 예전에는 date_trunc 로 SQL이
     * 달을 자르고 합까지 냈는데, 그러면 기기가 오프라인에서 같은 값을 낼 방법이 없다.
     */
    const basis = parseEntryBasis(query.basis);
    // 다리 조건과 전표 조건을 갈라 둔다. 회차 기준이 전표 쪽만 넓혀 다시 묻기 때문이다.
    const { entry: trendScope, ...postingWhere } =
      query.target === 'account' || query.target === 'card'
        ? trendByPaymentMethodWhere(projectId, query, start, end)
        : query.target === 'tag'
          ? await trendByTagWhere(this.prisma, projectId, query, start, end)
          : await trendByCategoryWhere(this.prisma, projectId, query, start, end);
    // 결제수단 추이는 자산 관점이다. 페이백은 그 수단에 들어온 날짜에 선다.
    const byPaymentMethod = query.target === 'account' || query.target === 'card';
    const rows = await this.aggregatePostings({
      basis,
      postingWhere: { categoryId: { not: null }, ...postingWhere },
      scope: (trendScope ?? {}) as Prisma.JournalEntryWhereInput,
      select: AGGREGATE_SELECT,
      ownDate: byPaymentMethod,
    });

    /*
     * 분류·수단 추이는 판정기가 필요 없다. 조건이 이미 다리 자신에 걸려 있다
     * (`trendByCategoryWhere` 의 categoryId, `trendByPaymentMethodWhere` 의 결제수단).
     *
     * 태그와 검색은 다르다. 둘 다 전표 수준으로 걸려(`entryScope`) 분할의 다른 줄까지 데려오므로
     * 판정기가 걸린 줄만 남긴다 (리포트의 합계·구성비와 같은 판정이다). 결제수단 추이는
     * 검색을 받지 않는다.
     */
    const matchLine =
      query.target === 'tag'
        ? lineMatcherOf(parseEntrySearch({ ...query, tagIds: query.targetId }))
        : byPaymentMethod
          ? undefined
          : lineMatcherOf(parseEntrySearch(query));
    const points = periodTotals(
      toAggregateRows(
        rows,
        matchLine,
        spreadOf(basis, timeZone, { gte: start, lt: end }),
        byPaymentMethod,
      ),
      { timeZone, endKey, count: months },
    );

    const show = await this.displayConverter(projectId);
    return points.map((point) => ({
      yearMonth: point.yearMonth,
      amount: show.toString(toDecimal(point.amount)),
    }));
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
    const range = resolvePeriod(query, timeZone);

    const basis = parseEntryBasis(query.basis);
    const scope = await entryScope(this.prisma, projectId, range, query);
    /*
     * 회차 기준이면 **앞에서 산 할부도 이 구간의 거래가 된다.**
     *
     * 목록·분류 탭과 같은 규칙이다. 한 화면 안에서 탭마다 다른 규칙으로 세면 같은 달의
     * 카드 합계와 분류 합계가 어긋난다.
     */
    const entries = await this.prisma.journalEntry.findMany({
      where: basis === 'installment' ? installmentScope(scope) : scope,
      include: ENTRY_INCLUDE,
    });
    const filter = parseEntryFilter(query);

    // 조회용 맵은 비활성/숨김 계정까지 담는다. 예전 거래가 가리키는 계좌를
    // 못 찾으면 그 거래가 집계에서 조용히 빠진다.
    const [cards, accounts] = await Promise.all([
      this.prisma.card.findMany({
        where: { projectId },
        include: { paymentAccount: { include: { owner: true } } },
      }),
      this.prisma.account.findMany({ where: { projectId }, include: { owner: true } }),
    ]);

    /*
     * 실적 기준액을 표시 통화로 옮긴다.
     *
     * 카드에 저장된 값은 결제 통장의 통화다. 통장 통화는 카드마다 다를 수 있어
     * 통화별로 환산기를 하나씩 만든다. 대부분의 프로젝트는 한 통화뿐이라 한 번에
     * 끝나고, 그때는 환산기가 곱셈을 건너뛴다.
     *
     * 환율을 고르는 일이 질의의 몫이라 집계 함수 밖에 남는다.
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

    // 세는 규칙은 공용 함수가 갖는다. 기기도 오프라인에서 같은 함수를 부른다.
    const show = await this.displayConverter(projectId);
    /*
     * 걸린 줄만 세도록 판정기를 함께 넘긴다.
     *
     * 목록이 걸린 줄만 보여 주는데 수단 줄이 거래 전체를 더하면, 화면에 5,000원 한
     * 줄이 서 있고 그 카드 옆에는 10,000원이 적힌다.
     */
    const matchLine = lineMatcherOf(parseEntrySearch(query));
    const items = entries.map((entry) => toListItem(entry, show, matchLine));
    return paymentMethods(
      // 회차 기준이면 금액을 그 회차 몫으로 바꾸고, 회차가 없는 할부는 뺀다.
      basis === 'installment'
        ? installmentEntryViews(items, { timeZone, from: range.start, to: range.end })
        : items,
      accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        isActive: account.isActive,
        ownerId: account.owner?.id ?? null,
        ownerName: account.owner?.name ?? null,
      })),
      cards.map((card) => ({
        id: card.id,
        name: card.name,
        cardType: card.cardType,
        isActive: card.isActive,
        color: card.color,
        statementClosingDay: card.statementClosingDay,
        performanceTarget: performanceTargets.get(card.id) ?? null,
        // 카드의 주인은 결제 통장의 주인이다.
        ownerId: card.paymentAccount.owner?.id ?? null,
        ownerName: card.paymentAccount.owner?.name ?? null,
      })),
      {
        personIds: filter.personIds ?? null,
        matchNothing: filter.matchNothing,
      },
    );
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
      where: { projectId, type: { in: [...PROFIT_ACCOUNT_TYPES] as AccountType[] } },
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
      if (kind !== 'income' && kind !== 'expense' && kind !== 'payback') continue;

      // 계좌 다리의 금액을 그대로 더한다. 수입·페이백은 +, 지출은 -로 저장되어 있어
      // 합이 곧 순수익이다(되돌려 받은 수수료도 수익이다). 계좌 통화이므로 환산하지 않는다.
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

  /**
   * 계좌별 장부가 (기준통화).
   *
   * 외화 계좌의 balance는 그 통화라서 순자산에 바로 못 넣는다. 장부가는 거래마다
   * 그때의 환율로 쌓인 baseAmount 합계이고, 최신 환율로 환산한 값과의 차이가
   * 미실현 환차손익이 된다. 잔액과 같은 다리를 세도록 지금 뒤의 전표는 뺀다.
   */
  private async bookValuesOf(accountIds: string[]) {
    if (accountIds.length === 0) return new Map<string, Prisma.Decimal>();

    const rows = await this.prisma.posting.groupBy({
      by: ['accountId'],
      _sum: { baseAmount: true },
      where: { accountId: { in: accountIds }, entry: { date: { lte: new Date() } } },
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
