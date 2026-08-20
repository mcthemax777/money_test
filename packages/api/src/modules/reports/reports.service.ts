import { Injectable } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ENTRY_INCLUDE, toListItem } from '../entries/entry-view';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  parseEntryFilter,
} from '@/common/entry-filter';
import { HIDDEN_ACCOUNT_TYPES } from '../accounts/accounts.service';
import {
  ReportDto,
  zonedCurrentYearMonth,
  zonedDayStart,
  zonedMonthRange,
  zonedMonthStart,
} from '@money/types';

const ZERO = new Prisma.Decimal(0);

/** 순자산에서 제외할 계정. 자본 계정은 자산이 아니다. */
const EQUITY_TYPES: AccountType[] = [AccountType.opening_balance];
/** 시가로 평가하는 계정. 장부 잔액 대신 최신 AssetValuation을 쓴다. */
const VALUED_TYPES: AccountType[] = [AccountType.investment, AccountType.real_estate];
/** 부채 계정. 잔액이 음수로 저장된다. */
const LIABILITY_TYPES: AccountType[] = [AccountType.credit_card, AccountType.loan];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 월 수입/지출 합계.
   *
   * 결제수단과 무관하게 "지출 카테고리 posting의 합"으로 정의된다.
   * dashboard는 credit_usage를 더하고 statistics는 빼던 불일치가 정의상 사라진다.
   */
  async getSummary(userId: string, query: ReportDto.MonthQuery): Promise<ReportDto.Summary> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = zonedMonthRange(query.yearMonth, timeZone);
    const scope = this.entryScope(projectId, range, query);
    // 고정/변동 필터. 지출은 groupBy로 이미 나뉘므로 해당 쪽만 남기고,
    // 수입도 같은 조건을 걸어야 목록 합계와 맞는다.
    const fixedOnly = parseEntryFilter(query).fixed;

    const [expenseRows, incomeAgg] = await Promise.all([
      // isFixed로 나눠 고정/변동을 한 번에 얻는다
      this.prisma.posting.groupBy({
        by: ['isFixed'],
        _sum: { amount: true },
        where: {
          category: { type: CategoryType.expense },
          entry: scope,
          ...(fixedOnly !== undefined ? { isFixed: fixedOnly } : {}),
        },
      }),
      this.prisma.posting.aggregate({
        _sum: { amount: true },
        where: {
          category: { type: CategoryType.income },
          entry: scope,
          ...(fixedOnly !== undefined ? { isFixed: fixedOnly } : {}),
        },
      }),
    ]);

    const fixed = expenseRows.find((r) => r.isFixed)?._sum.amount ?? ZERO;
    const variable = expenseRows.find((r) => !r.isFixed)?._sum.amount ?? ZERO;
    const expense = fixed.add(variable);
    // 수입 posting은 음수로 기록되므로 표시용으로 뒤집는다
    const income = (incomeAgg._sum.amount ?? ZERO).neg();

    return {
      yearMonth: query.yearMonth,
      income: income.toString(),
      expense: expense.toString(),
      fixedExpense: fixed.toString(),
      variableExpense: variable.toString(),
      net: income.sub(expense).toString(),
    };
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
    const range = zonedMonthRange(query.yearMonth, timeZone);
    // 쿼리스트링 값은 문자열로 도착한다. 이 DTO는 클래스가 아니라 인터페이스라서
    // ValidationPipe의 암묵 변환이 걸리지 않고 ?rollup=false 가 'false' 문자열로 들어온다.
    // 불리언 비교만 하면 항상 롤업이 켜져서 소분류 구성비를 볼 수 없다.
    const rollup = query.rollup !== false && (query.rollup as unknown) !== 'false';

    const rows = await this.prisma.posting.groupBy({
      by: ['categoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        category: { type: query.type as CategoryType },
        entry: this.entryScope(projectId, range, query),
        ...(parseEntryFilter(query).fixed !== undefined
          ? { isFixed: parseEntryFilter(query).fixed }
          : {}),
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
      bucket.amount = bucket.amount.add((row._sum.amount ?? ZERO).abs());
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

    return [...buckets.entries()]
      .map(([categoryId, bucket]) => {
        const category = byId.get(categoryId)!;
        return {
          categoryId,
          categoryName: category.name,
          parentCategoryId: category.parent?.id ?? null,
          parentCategoryName: category.parent?.name ?? null,
          amount: bucket.amount.toString(),
          count: bucket.count,
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

    type Bucket = { cash: Prisma.Decimal; investment: Prisma.Decimal; liability: Prisma.Decimal };
    const totals: Bucket = { cash: ZERO, investment: ZERO, liability: ZERO };
    const byPerson = new Map<string, Bucket & { personName: string }>();
    let bookValueOfValued = ZERO;

    for (const account of accounts) {
      const isValued = VALUED_TYPES.includes(account.type);
      const isLiability = LIABILITY_TYPES.includes(account.type);
      // 시가가 없으면 장부가로 대체한다 (평가 기록을 아직 안 넣은 경우)
      const value = isValued
        ? marketValues.get(account.id) ?? account.balance
        : account.balance;

      if (isValued) bookValueOfValued = bookValueOfValued.add(account.balance);

      const slot: keyof Bucket = isValued ? 'investment' : isLiability ? 'liability' : 'cash';
      totals[slot] = totals[slot].add(value);

      if (account.owner) {
        const bucket =
          byPerson.get(account.owner.id) ??
          { cash: ZERO, investment: ZERO, liability: ZERO, personName: account.owner.name };
        bucket[slot] = bucket[slot].add(value);
        byPerson.set(account.owner.id, bucket);
      }
    }

    const total = totals.cash.add(totals.investment).add(totals.liability);

    return {
      total: total.toString(),
      cash: totals.cash.toString(),
      investment: totals.investment.toString(),
      liability: totals.liability.toString(),
      unrealizedGain: totals.investment.sub(bookValueOfValued).toString(),
      byPerson: [...byPerson.entries()].map(([personId, bucket]) => ({
        personId,
        personName: bucket.personName,
        total: bucket.cash.add(bucket.investment).add(bucket.liability).toString(),
        cash: bucket.cash.toString(),
        investment: bucket.investment.toString(),
        liability: bucket.liability.toString(),
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
    const granularity = query.granularity === 'day' ? 'day' : 'month';

    const accounts = await this.prisma.account.findMany({
      where: {
        projectId,
        // 기초잔액 상대편은 자산이 아니다. getNetWorth 와 같은 기준으로 뺀다.
        type: { notIn: EQUITY_TYPES },
        // 계좌를 지정하면 비활성 계좌도 보여준다. 전체 합계일 때만 활성으로 좁힌다.
        ...(query.accountId ? { id: query.accountId } : { isActive: true }),
      },
      select: { id: true, type: true },
    });
    if (accounts.length === 0) return [];
    const accountIds = accounts.map((a) => a.id);

    const buckets =
      granularity === 'day'
        ? dayBuckets(query.yearMonth ?? zonedCurrentYearMonth(timeZone), timeZone)
        : monthBuckets(
            query.endMonth ?? zonedCurrentYearMonth(timeZone),
            Math.min(Math.max(Number(query.months) || 12, 1), 60),
            timeZone,
          );
    const windowStart = buckets[0].start;
    const windowEnd = buckets[buckets.length - 1].end;

    // 창 시작 이전까지 쌓인 계좌별 잔액 (기준선)
    const baseRows = await this.prisma.$queryRaw<
      Array<{ accountId: string; delta: Prisma.Decimal }>
    >`
      SELECT p."accountId" AS "accountId", SUM(p."amount") AS delta
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
             SUM(p."amount") AS delta
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

      points.push({ date: bucket.label, balance: total.toString() });
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
    const endMonth = query.endMonth ?? zonedCurrentYearMonth(timeZone);
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
    const byMonth = new Map(rows.map((r) => [wallClockYearMonth(r.month), r.amount.toString()]));
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
    const condition =
      query.target === 'category'
        ? // 대분류를 지정하면 소분류까지 포함한다
          Prisma.sql`(p."categoryId" = ${query.targetId} OR c."parentId" = ${query.targetId})`
        : Prisma.sql`c."type" = ${query.type ?? 'expense'}::"CategoryType"`;

    return this.prisma.$queryRaw<Array<{ month: Date; amount: Prisma.Decimal }>>`
      SELECT date_trunc('month', timezone(${timeZone}, timezone('UTC', e."date"))) AS month,
             ABS(SUM(p."amount")) AS amount
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
        AND ${condition}
        AND ${personFilter(query)}
        AND ${fixedFilter(query, Prisma.sql`p`)}
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
             ABS(SUM(cp."amount")) AS amount
      FROM "JournalEntry" e
      JOIN "Posting" cp ON cp."entryId" = e.id
      JOIN "Category" c ON c.id = cp."categoryId" AND c."type" = 'expense'
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
        AND ${personFilter(query)}
        AND ${fixedFilter(query, Prisma.sql`cp`)}
        AND EXISTS (
          SELECT 1 FROM "Posting" ap
          WHERE ap."entryId" = e.id AND ${methodCondition}
        )
      GROUP BY 1
      ORDER BY 1
    `;
  }

  /**
   * 결제수단별 지출.
   *
   * 결제수단 판별은 전표 종류에 달려 있어(이체는 제외해야 한다) SQL로 표현하기 번거롭다.
   * 한 달치 전표만 읽어 entry-view의 판별 규칙을 재사용한다. 목록 화면과 같은 규칙이 보장된다.
   */
  async getPaymentMethods(
    userId: string,
    query: ReportDto.MonthQuery,
  ): Promise<ReportDto.PaymentMethodItem[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      query.projectId,
    );
    const range = zonedMonthRange(query.yearMonth, timeZone);

    const entries = await this.prisma.journalEntry.findMany({
      where: this.entryScope(projectId, range, query),
      include: ENTRY_INCLUDE,
    });
    const filter = parseEntryFilter(query);
    const fixedOnly = filter.fixed;

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
      });
    }

    for (const card of cards) {
      if (!card.isActive) continue;
      const owner = card.paymentAccount.owner;
      if (!isVisibleOwner(owner?.id ?? null)) continue;
      this.addTo(buckets, {
        kind: card.cardType === 'credit' ? 'credit_card' : 'debit_card',
        id: card.id,
        name: card.name,
        ownerId: owner?.id ?? null,
        ownerName: owner?.name ?? null,
        amount: '0',
        count: 0,
      });
    }

    // 고정/변동을 하나도 고르지 않았으면 금액은 없지만 목록은 그대로 둔다.
    // 어떤 수단이 있는지는 필터와 무관한 정보다.
    const entriesToCount = filter.matchNothing ? [] : entries;

    for (const entry of entriesToCount) {
      const item = toListItem(entry);

      // 고정/변동 필터. item.isFixed는 카테고리 다리에서 온 값이다
      // (이체는 수수료 카테고리가 그 값을 정한다).
      if (fixedOnly !== undefined && item.isFixed !== fixedOnly) continue;

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
            });
          }
        }
        continue;
      }

      if (item.kind !== 'expense') continue;

      if (item.cardId) {
        const card = cardById.get(item.cardId);
        if (!card) continue;
        const owner = card.paymentAccount.owner;
        if (!isVisibleOwner(owner?.id ?? null)) continue;
        this.addTo(buckets, {
          kind: card.cardType === 'credit' ? 'credit_card' : 'debit_card',
          id: card.id,
          name: card.name,
          ownerId: owner?.id ?? null,
          ownerName: owner?.name ?? null,
          amount: item.amount,
          count: 1,
        });
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
        });
      }
    }

    return [...buckets.values()].sort((a, b) => Number(b.amount) - Number(a.amount));
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
  }

  /**
   * 월 집계의 전표 범위.
   *
   * 자산 주인 필터는 목록(/entries)과 같은 규칙을 쓴다. 목록만 걸러 놓으면
   * 상단 합계와 소계가 어긋난다.
   */
  private entryScope(
    projectId: string,
    range: { start: Date; end: Date },
    query: ReportDto.MonthQuery,
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

/** 고정/변동 필터를 SQL 조각으로. 카테고리 다리(alias)에만 건다. */
function fixedFilter(query: ReportDto.TrendQuery, alias: Prisma.Sql): Prisma.Sql {
  const fixed = parseEntryFilter(query).fixed;
  if (fixed === undefined) return Prisma.sql`TRUE`;
  return Prisma.sql`${alias}."isFixed" = ${fixed}`;
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
    total: '0', cash: '0', investment: '0', liability: '0', unrealizedGain: '0', byPerson: [],
  };
}
