import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ENTRY_INCLUDE, classifyEntry, toListItem } from '../entries/entry-view';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  entryFeatureCondition,
  entryKindCondition,
  entryPersonCondition,
  entryTagCondition,
  entryTextCondition,
  entrySearchConditions,
  lineMatcherOf,
  parseEntryFilter,
  splitEntryIds,
  splitList,
} from '@/common/entry-filter';
import { assertDateKey, assertYearMonth } from '@/common/year-month';
import { PAYBACK_DATE_SELECT, analysisDateOf, analysisScopes } from '@/common/payback-scope';
import { withBalancesAsOf } from '@/common/balance-as-of';
import {
  INSTALLMENT_LEG_SELECT,
  type InstallmentLeg,
  type InstallmentSpread,
  INSTALLMENT_REFUND_SELECT,
  type InstallmentRefundCuts,
  spreadRowOf,
  installmentScope,
  spreadOf,
  spreadRows,
} from '@/common/installment-scope';
import {
  DisplayConverter,
  ExchangeRatesService,
} from '../exchange-rates/exchange-rates.service';
import {
  type CategoryPostingRow,
  Dec,
  type EntryBasis,
  installmentEntryViews,
  parseEntryBasis,
  type LineMatcher,
  type NamedCategoryPostingRow,
  ReportDto,
  categoryBreakdown,
  currencyDecimals,
  dailyTotals,
  entryMonths,
  asWeekStart,
  balanceBuckets,
  stackBalanceHistory,
  DEFAULT_WEEK_START,
  isEntryPeriodUnit,
  DEFAULT_ENTRY_PERIOD,
  monthlyTotals,
  NO_ACCOUNT,
  parseEntrySearch,
  netWorth,
  type NetWorthAccountRow,
  paymentMethods,
  EQUITY_ACCOUNT_TYPES,
  VALUED_ACCOUNT_TYPES,
  nonZeroAmounts,
  groupOfRow,
  isAssetGroupKey,
  shiftYearMonth,
  summarize,
  weekStartKey,
  type WeekStart,
  zonedCurrentYearMonth,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
  zonedMonthStart,
  zonedParts,
} from '@money/types';

const ZERO = new Prisma.Decimal(0);

/*
 * 계좌 유형의 분류(자본·시가평가·부채)는 `@money/types` 의 net-worth-aggregation 이 갖는다.
 * 기기도 같은 분류로 총자산을 내야 하므로 서버에만 두면 두 벌이 된다.
 */
/**
 * 수익을 따로 계산해 보여 주는 계정.
 *
 * 원금은 이체로 넣고 불어난 몫은 수입으로 붙는 계좌들이다(투자는 배당·매매 차익,
 * 예적금·연금은 이자·운용 수익). 잔액만 보면 원금인지 수익인지 구별되지 않는다.
 * 기기의 `PROFIT_ACCOUNT_TYPES`(local-home-port)와 같은 목록이다.
 */
const PROFIT_TYPES: AccountType[] = [
  AccountType.investment,
  AccountType.crypto,
  AccountType.savings,
  AccountType.time_deposit,
  AccountType.pension,
];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /**
   * 집계 함수에 넘길 카테고리 다리.
   *
   * 더하는 규칙은 `@money/types` 의 report-aggregation 이 갖는다. 기기도 같은 함수를
   * 쓰기 때문에 서버가 SQL 로 다시 더하면 두 벌이 된다. 여기서는 행을 그 모양으로
   * 옮겨 주는 일만 한다.
   */
  /**
   * 집계가 다리에서 읽는 것.
   *
   * 줄 키와 부모 분류와 전표의 태그가 함께 온다. 분류나 태그로 좁힌 질의에서 **걸린
   * 줄만** 더하기 위해서다 -- 질의는 전표 수준으로 걸려 분할의 나머지 줄까지 데려온다.
   * 태그 행은 전표당 두엇이라 다리마다 실려도 가볍다.
   */
  private static readonly AGGREGATE_SELECT = {
    categoryId: true,
    lineKey: true,
    baseAmount: true,
    category: { select: { type: true, parentId: true } },
    entry: {
      select: {
        date: true,
        tags: { select: { lineKey: true, tagId: true } },
        /*
         * 이 거래에 걸린 할부. 회차 기준으로 셀 때만 읽힌다.
         *
         * 카드 다리 하나뿐이라 배열이어도 한 줄이다. 발생 기준에서는 쓰이지 않지만
         * 조건을 나누면 select 가 두 벌이 되어, 늘 싣고 읽는 쪽에서 가린다.
         */
        postings: INSTALLMENT_LEG_SELECT,
        // 페이백이면 원거래의 날짜. 분석은 그 달에 센다 (common/payback-scope).
        ...PAYBACK_DATE_SELECT,
        // 할부 환불과 할부 원거래가 줄인 회차 (installment-refund). 회차 기준에서만 읽힌다.
        ...INSTALLMENT_REFUND_SELECT,
      },
    },
  } as const;

  private toAggregateRows(
    rows: Array<{
      categoryId: string | null;
      lineKey: string | null;
      baseAmount: Prisma.Decimal;
      category: { type: CategoryType; parentId: string | null } | null;
      entry: {
        date: Date;
        tags: Array<{ lineKey: string | null; tagId: string }>;
        postings?: InstallmentLeg[];
        paybackOf?: { date: Date } | null;
        installmentAdjust?: unknown;
        paybacks?: InstallmentRefundCuts;
      };
    }>,
    matchLine?: LineMatcher,
    /** 회차 기준으로 셀 때만 준다. 없으면 발생 기준이다. */
    spread?: InstallmentSpread,
    /** 자산 관점(결제수단 추이)이면 참. 페이백을 들어온 날짜 그대로 센다. */
    ownDate = false,
  ): CategoryPostingRow[] {
    // 계좌 다리는 오지 않지만(질의가 카테고리 다리만 고른다) 타입이 null 을 허용하므로 걸러 둔다.
    const mapped = rows.flatMap((row) => {
      if (!(row.categoryId && row.category && this.lineMatches(row, matchLine))) return [];
      const base: CategoryPostingRow = {
        categoryId: row.categoryId,
        categoryType: row.category.type,
        baseAmount: row.baseAmount as CategoryPostingRow['baseAmount'],
        date: (ownDate ? row.entry.date : analysisDateOf(row.entry)) as CategoryPostingRow['date'],
      };
      // 회차 기준이면 할부를 펴고, 할부 환불은 남은 몫만 환불한 날에 센다 (spreadRowOf).
      return [spread ? spreadRowOf(base, row) : base];
    });
    return spread ? spreadRows(mapped, spread) : mapped;
  }

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

  /** 이 다리가 검색 조건에 걸린 줄인가. 조건이 없으면 언제나 참이다. */
  private lineMatches(
    row: {
      categoryId: string | null;
      lineKey: string | null;
      category: { parentId: string | null } | null;
      entry: { tags: Array<{ lineKey: string | null; tagId: string }> };
    },
    matchLine?: LineMatcher,
  ): boolean {
    if (!matchLine) return true;
    return matchLine({
      categoryId: row.categoryId,
      parentCategoryId: row.category?.parentId ?? null,
      tagIds: row.entry.tags
        .filter((tag) => tag.lineKey !== null && tag.lineKey === row.lineKey)
        .map((tag) => tag.tagId),
    });
  }

  /** 집계 결과를 표시 환산기에 넣을 수 있는 모양으로. */
  private toDecimal(value: Dec): Prisma.Decimal {
    return new Prisma.Decimal(value.toString());
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
    const range = this.resolvePeriod(query, timeZone);
    const scope = await this.entryScope(projectId, range, query);
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
      select: ReportsService.AGGREGATE_SELECT,
    });
    const totals = summarize(
      this.toAggregateRows(
        rows,
        lineMatcherOf(parseEntrySearch(query)),
        spreadOf(basis, timeZone, { gte: range.start, lt: range.end }),
      ),
    );

    const show = await this.displayConverter(projectId);
    const asString = (value: Dec) => show.toString(this.toDecimal(value));
    return {
      ...this.periodLabel(query, range, timeZone),
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
    const range = this.resolvePeriod(query, timeZone);
    // 쿼리스트링은 문자열로 도착한다. 아는 값이 아니면 지출이다.
    const isIncome = query.type === 'income';
    const type = isIncome ? CategoryType.income : CategoryType.expense;
    const basis = parseEntryBasis(query.basis);
    const postings = await this.aggregatePostings({
      basis,
      postingWhere: { category: { type } },
      scope: await this.entryScope(projectId, range, query),
      select: ReportsService.AGGREGATE_SELECT,
    });

    // 날짜별로 묶는 규칙은 공용 함수가 갖는다.
    const days = dailyTotals(
      this.toAggregateRows(
        postings,
        lineMatcherOf(parseEntrySearch(query)),
        spreadOf(basis, timeZone, { gte: range.start, lt: range.end }),
      ),
      { timeZone, type },
    );

    const show = await this.displayConverter(projectId);
    return days.map((day) => ({
      date: day.date,
      amount: show.toString(this.toDecimal(day.amount)),
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

    const type = query.type as CategoryType;

    /*
     * 이름을 행에 함께 실어 온다. 예전에는 카테고리를 따로 조회하고, 롤업 대상인
     * 대분류 이름을 얻으려고 한 번 더 조회했다. 소분류 행이 부모 이름까지 들고 오면
     * 그 두 번째 조회가 사라지고, 기기도 같은 모양의 행으로 같은 함수를 쓸 수 있다.
     */
    const basis = parseEntryBasis(query.basis);
    const rows = await this.aggregatePostings({
      basis,
      postingWhere: { category: { type } },
      scope: await this.entryScope(projectId, range, query),
      select: {
        ...ReportsService.AGGREGATE_SELECT,
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
    const named: NamedCategoryPostingRow[] = rows.flatMap((row) => {
      if (!(row.categoryId && row.category && this.lineMatches(row, matchLine))) return [];
      const base: NamedCategoryPostingRow = {
        categoryId: row.categoryId,
        categoryType: row.category.type,
        categoryName: row.category.name,
        parentCategoryId: row.category.parent?.id ?? null,
        parentCategoryName: row.category.parent?.name ?? null,
        baseAmount: row.baseAmount as NamedCategoryPostingRow['baseAmount'],
        // 페이백이면 원거래의 날짜 (toAggregateRows 와 같다).
        date: analysisDateOf(row.entry) as NamedCategoryPostingRow['date'],
      };
      // 회차 기준이면 할부를 펴고, 할부 환불은 남은 몫만 환불한 날에 센다 (spreadRowOf).
      return [spread ? spreadRowOf(base, row) : base];
    });
    // 회차 기준이면 줄마다 회차로 펴고 창 밖은 버린다. 이름은 그대로 따라간다.
    const counted = spread ? spreadRows(named, spread) : named;

    const buckets = categoryBreakdown(counted, { type, rollup });
    const show = await this.displayConverter(projectId);

    return buckets.map((bucket) => ({
      categoryId: bucket.categoryId,
      categoryName: bucket.categoryName,
      parentCategoryId: bucket.parentCategoryId,
      parentCategoryName: bucket.parentCategoryName,
      amount: show.toString(this.toDecimal(bucket.amount)),
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
    const accounts = query.group
      ? found.filter(
          (a) =>
            groupOfRow({
              type: a.type,
              paymentAccountType: a.cardAsLiability?.paymentAccount.type ?? null,
            }) === query.group,
        )
      : found;
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
      balance: show.toString(this.toDecimal(point.total)),
    }));
  }

  /**
   * 월별 시계열. BudgetDetailModal과 PaymentMethodTab이 각자 구현하던 것을 하나로 합쳤다.
   * 월 단위 그룹핑은 Prisma groupBy가 못 하므로 date_trunc를 쓴다.
   */
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

    const owner = assetOwnerCondition(filter);
    // 검색은 전표 수준으로 걸린다 (entryScope 와 같은 이유).
    const kindCondition = entryKindCondition(search.kinds);
    // 태그도 전표에 붙으므로 유형과 같은 자리에 온다. "태그 없음"도 이 무리다.
    const tagCondition = entryTagCondition(search.tagIds, search.noTag);
    // 설명의 글자와 낸 사람도 전표에 있다.
    const textCondition = entryTextCondition(search.text);
    const personCondition = entryPersonCondition(search.entryPersonIds);
    const window = this.resolveWindow(query, timeZone);
    // 모양(분할·할부). 분할은 분류 다리를 세어야 해서 id 를 먼저 받아 온다.
    const featureCondition = entryFeatureCondition(
      search.features,
      search.features?.includes('split')
        ? await splitEntryIds(this.prisma, {
            projectId,
            ...(window ? { date: window } : {}),
          })
        : undefined,
    );
    const conditions = [
      ...(owner ? [owner] : []),
      ...(kindCondition ? [kindCondition] : []),
      ...(tagCondition ? [tagCondition] : []),
      ...(textCondition ? [textCondition] : []),
      ...(personCondition ? [personCondition] : []),
      ...(featureCondition ? [featureCondition] : []),
      ...entrySearchConditions(search).map((posting) => ({ postings: { some: posting } })),
    ];
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
        select: ReportsService.AGGREGATE_SELECT,
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
    const counted = this.toAggregateRows(rows, lineMatcherOf(search), spread, true);
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
    }).map(
      (month) => ({
        yearMonth: month.yearMonth,
        income: show.toString(this.toDecimal(month.income)),
        expense: show.toString(this.toDecimal(month.expense)),
      }),
    );
  }

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
    /*
     * 막대가 덮는 12개월. 검색 기간을 주면(clip) 그 안으로 자른다 -- 달 이름은 그대로 두고
     * 세는 돈만 줄인다. 잘못 적은 시각은 버린다(자르지 않는 쪽이 조용히 비는 쪽보다 낫다).
     */
    const clip = (value: string | undefined) => {
      const at = value ? new Date(value) : null;
      return at && !Number.isNaN(at.getTime()) ? at : null;
    };
    const fullEnd = zonedMonthStart(endYear, endMonthNumber + 1, timeZone);
    const fullStart = zonedMonthStart(endYear, endMonthNumber - months + 1, timeZone);
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
        ? this.trendByPaymentMethodWhere(projectId, query, start, end)
        : query.target === 'tag'
          ? await this.trendByTagWhere(projectId, query, start, end)
          : await this.trendByCategoryWhere(projectId, query, start, end);
    // 결제수단 추이는 자산 관점이다. 페이백은 그 수단에 들어온 날짜에 선다.
    const byPaymentMethod = query.target === 'account' || query.target === 'card';
    const rows = await this.aggregatePostings({
      basis,
      postingWhere: { categoryId: { not: null }, ...postingWhere },
      scope: (trendScope ?? {}) as Prisma.JournalEntryWhereInput,
      select: ReportsService.AGGREGATE_SELECT,
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
    const points = monthlyTotals(
      this.toAggregateRows(
        rows,
        matchLine,
        spreadOf(basis, timeZone, { gte: start, lt: end }),
        byPaymentMethod,
      ),
      { timeZone, endYearMonth: endMonth, months },
    );

    const show = await this.displayConverter(projectId);
    return points.map((point) => ({
      yearMonth: point.yearMonth,
      amount: show.toString(this.toDecimal(point.amount)),
    }));
  }

  /** 카테고리(또는 전체) 기준. 대분류를 지정하면 소분류까지 포함한다. 검색 조건도 건다. */
  private async trendByCategoryWhere(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
  ): Promise<Prisma.PostingWhereInput> {
    // 쿼리스트링 값은 문자열로 도착한다 (DTO가 인터페이스라 암묵 변환이 없다).
    const exact = query.exact === true || (query.exact as unknown) === 'true';

    const target: Prisma.PostingWhereInput =
      query.target === 'category'
        ? exact
          ? // "미분류": 대분류에 바로 기록한 건만 본다.
            { categoryId: query.targetId }
          : {
              OR: [
                { categoryId: query.targetId },
                { category: { parentId: query.targetId } },
              ],
            }
        : { category: { type: (query.type ?? 'expense') as CategoryType } };

    // 사람 필터에 거래 화면의 검색이 얹힌 범위. 합계·구성비가 쓰는 것과 같다.
    return { ...target, entry: await this.entryScope(projectId, { start, end }, query) };
  }

  /** 태그 기준. 그 태그가 붙은 전표의 분류 다리를 고른다 -- 줄은 판정기가 가른다. */
  private async trendByTagWhere(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
  ): Promise<Prisma.PostingWhereInput> {
    if (!query.targetId) throw new BadRequestException('태그를 골라 주세요.');
    return {
      category: { type: (query.type ?? 'expense') as CategoryType },
      entry: await this.entryScope(projectId, { start, end }, { ...query, tagIds: query.targetId }),
    };
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
  private trendByPaymentMethodWhere(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
  ): Prisma.PostingWhereInput {
    /*
     * 수단별의 미지정 칸은 id 자리에 `NO_ACCOUNT` 를 들고 온다. 화면은 미지정 계정의 id 를
     * 모르므로(목록에 내려가지 않는다) 여기서 유형으로 바꿔 읽는다.
     */
    const accountTarget: Prisma.PostingWhereInput =
      query.targetId === NO_ACCOUNT
        ? { account: { type: AccountType.unassigned } }
        : { accountId: query.targetId };
    const method: Prisma.PostingWhereInput =
      query.target === 'card'
        ? { cardId: query.targetId, amount: { lt: 0 } }
        : { ...accountTarget, cardId: null, amount: { lt: 0 } };

    return {
      category: { type: CategoryType.expense },
      entry: {
        ...this.trendEntryScope(projectId, query, start, end),
        // 그 수단으로 돈이 나간 다리가 있는 전표만.
        postings: { some: method },
      },
    };
  }

  /** 시계열이 보는 전표 범위. 기간과 사람 필터는 목록·합계와 같은 규칙을 쓴다. */
  private trendEntryScope(
    projectId: string,
    query: ReportDto.TrendQuery,
    start: Date,
    end: Date,
  ): Prisma.JournalEntryWhereInput {
    const filter = parseEntryFilter(query);
    // 아무도 고르지 않았으면 한 건도 나오지 않아야 한다.
    if (filter.matchNothing) return { ...MATCH_NOTHING, projectId };

    const owner = assetOwnerCondition(filter);
    return {
      projectId,
      date: { gte: start, lt: end },
      ...(owner ?? {}),
    };
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

    const basis = parseEntryBasis(query.basis);
    const scope = await this.entryScope(projectId, range, query);
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

  /**
   * 기간을 받을 수도 있고 안 받을 수도 있는 조회의 구간.
   *
   * `resolvePeriod` 와 규칙이 같다 -- 달력 날짜, 양끝 포함, 끝날은 다음 날 0시를
   * 상한으로 삼는다. 다른 점은 **없어도 된다**는 것과 **한쪽만 와도 된다**는 것이다.
   *
   * 한쪽만 온 것은 열린 구간이다. 시작일만 적으면 그날부터 끝까지, 종료일만 적으면
   * 처음부터 그날까지다. "이 날 이후에 쓴 것"은 반쪽짜리 입력이 아니라 그 자체로
   * 사용자가 묻는 것이라, 나머지 칸을 채우게 하는 대신 그대로 건다.
   */
  private resolveWindow(
    query: { startDate?: string; endDate?: string },
    timeZone: string,
  ): { gte?: Date; lt?: Date } | null {
    const { startDate, endDate } = query;
    if (!startDate && !endDate) return null;

    const start = startDate ? assertDateKey(startDate, '시작일') : undefined;
    const end = endDate ? assertDateKey(endDate, '종료일') : undefined;
    if (start && end && start > end) {
      throw new BadRequestException('시작일이 종료일보다 뒤입니다.');
    }

    const window: { gte?: Date; lt?: Date } = {};
    if (start) window.gte = zonedDateStringToUtc(start, timeZone);
    if (end) {
      const [year, month, day] = end.split('-').map(Number);
      // 하루를 더한다. Date 생성자가 월·연 넘김을 처리하므로 말일을 따로 보지 않는다.
      window.lt = zonedDayStart(year, month, day + 1, timeZone);
    }
    return window;
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

  private async entryScope(
    projectId: string,
    range: { start: Date; end: Date },
    query: ReportDto.PeriodQuery,
  ): Promise<Prisma.JournalEntryWhereInput> {
    const filter = parseEntryFilter(query);
    const search = parseEntrySearch(query);
    // 아무것도 고르지 않았으면 어떤 전표도 걸리지 않아야 한다.
    if (filter.matchNothing || search.matchNothing) return { projectId, ...MATCH_NOTHING };

    const owner = assetOwnerCondition(filter);
    /*
     * 거래 화면의 검색이 여기로 함께 들어온다.
     *
     * 조건을 **전표 수준**으로 건다. 다리 자신이 검색에 맞는지 보는 것이 아니라
     * "그런 다리를 가진 전표인가"를 본다. 그래서 식비를 찾으면 식비가 섞인 분할 거래가
     * 통째로 들고, 그 달의 합계는 화면에 보이는 거래들의 합과 같아진다. 다리 쪽으로
     * 걸면 목록에는 있는 거래의 일부 금액이 합계에서 빠져 둘이 어긋난다.
     */
    const kindCondition = entryKindCondition(search.kinds);
    // 태그도 전표에 붙으므로 유형과 같은 자리에 온다. "태그 없음"도 이 무리다.
    const tagCondition = entryTagCondition(search.tagIds, search.noTag);
    // 설명의 글자와 낸 사람도 전표에 있다.
    const textCondition = entryTextCondition(search.text);
    const personCondition = entryPersonCondition(search.entryPersonIds);
    // 모양(분할·할부). 분할은 분류 다리를 세어야 해서 id 를 먼저 받아 온다.
    const featureCondition = entryFeatureCondition(
      search.features,
      search.features?.includes('split')
        ? await splitEntryIds(this.prisma, {
            projectId,
            date: { gte: range.start, lt: range.end },
          })
        : undefined,
    );
    const conditions = [
      ...(owner ? [owner] : []),
      ...(kindCondition ? [kindCondition] : []),
      ...(tagCondition ? [tagCondition] : []),
      ...(textCondition ? [textCondition] : []),
      ...(personCondition ? [personCondition] : []),
      ...(featureCondition ? [featureCondition] : []),
      ...entrySearchConditions(search).map((posting) => ({ postings: { some: posting } })),
    ];

    return {
      projectId,
      date: { gte: range.start, lt: range.end },
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };
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


/**
 * date_trunc 결과가 속한 "YYYY-MM".
 *
 * SQL에서 프로젝트 타임존의 벽시계로 자른 값이라 인스턴트가 아니다.
 * Prisma가 `timestamp`를 UTC로 읽어 주므로 UTC 필드가 곧 그 지역의 벽시계 값이다.
 */

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
    byGroup: {},
    byPerson: [],
  };
}


