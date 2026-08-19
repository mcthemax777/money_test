import { Injectable } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ENTRY_INCLUDE, toListItem } from '../entries/entry-view';
import { ReportDto } from '@money/types';

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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);
    const range = monthRange(query.yearMonth);
    const scope = this.entryScope(projectId, range, query.personId);

    const [expenseRows, incomeAgg] = await Promise.all([
      // isFixed로 나눠 고정/변동을 한 번에 얻는다
      this.prisma.posting.groupBy({
        by: ['isFixed'],
        _sum: { amount: true },
        where: { category: { type: CategoryType.expense }, entry: scope },
      }),
      this.prisma.posting.aggregate({
        _sum: { amount: true },
        where: { category: { type: CategoryType.income }, entry: scope },
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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);
    const range = monthRange(query.yearMonth);
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
        entry: this.entryScope(projectId, range, query.personId),
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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);
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
        ? dayBuckets(query.yearMonth ?? currentYearMonth())
        : monthBuckets(
            query.endMonth ?? currentYearMonth(),
            Math.min(Math.max(Number(query.months) || 12, 1), 60),
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
             date_trunc(${granularity}, e."date") AS period,
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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);
    const months = Math.min(Math.max(Number(query.months) || 12, 1), 60);
    const end = query.endMonth ? monthRange(query.endMonth).end : monthRange(currentYearMonth()).end;
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));

    // 대상에 따라 집계 방식이 다르다.
    //
    // 카테고리/전체는 카테고리 posting을 그대로 더하면 된다.
    // 계좌/카드는 "그 수단으로 결제한 지출"이어야 하므로 계좌 posting을 더할 수 없다.
    // (계좌 posting을 더하면 입금과 출금이 상쇄되고, 체크카드 사용까지 섞인다)
    const rows =
      query.target === 'account' || query.target === 'card'
        ? await this.trendByPaymentMethod(projectId, query, start, end)
        : await this.trendByCategory(projectId, query, start, end);

    // 거래가 없는 달도 0으로 채워 그래프가 끊기지 않게 한다
    const byMonth = new Map(rows.map((r) => [toYearMonth(r.month), r.amount.toString()]));
    const points: ReportDto.TrendPoint[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1 - i, 1));
      const key = toYearMonth(date);
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
  ) {
    const condition =
      query.target === 'category'
        ? // 대분류를 지정하면 소분류까지 포함한다
          Prisma.sql`(p."categoryId" = ${query.targetId} OR c."parentId" = ${query.targetId})`
        : Prisma.sql`c."type" = ${query.type ?? 'expense'}::"CategoryType"`;

    return this.prisma.$queryRaw<Array<{ month: Date; amount: Prisma.Decimal }>>`
      SELECT date_trunc('month', e."date") AS month,
             ABS(SUM(p."amount")) AS amount
      FROM "Posting" p
      JOIN "JournalEntry" e ON e.id = p."entryId"
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
        AND ${condition}
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
  ) {
    const methodCondition =
      query.target === 'card'
        ? Prisma.sql`ap."cardId" = ${query.targetId} AND ap."amount" < 0`
        : Prisma.sql`ap."accountId" = ${query.targetId} AND ap."cardId" IS NULL AND ap."amount" < 0`;

    return this.prisma.$queryRaw<Array<{ month: Date; amount: Prisma.Decimal }>>`
      SELECT date_trunc('month', e."date") AS month,
             ABS(SUM(cp."amount")) AS amount
      FROM "JournalEntry" e
      JOIN "Posting" cp ON cp."entryId" = e.id
      JOIN "Category" c ON c.id = cp."categoryId" AND c."type" = 'expense'
      WHERE e."projectId" = ${projectId}
        AND e."date" >= ${start} AND e."date" < ${end}
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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);
    const range = monthRange(query.yearMonth);

    const entries = await this.prisma.journalEntry.findMany({
      where: this.entryScope(projectId, range, query.personId),
      include: ENTRY_INCLUDE,
    });

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

    for (const entry of entries) {
      const item = toListItem(entry);

      // 이체 자체는 소비가 아니지만 수수료는 지출이다.
      // 보내는 계좌에 붙여야 summary(지출 카테고리 합계)와 총액이 맞는다.
      if (item.kind === 'transfer') {
        const fee = new Prisma.Decimal(item.feeAmount ?? 0);
        if (fee.gt(ZERO) && item.accountId) {
          const account = accountById.get(item.accountId);
          if (account) {
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
        if (!account) continue;
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

  private entryScope(
    projectId: string,
    range: { start: Date; end: Date },
    personId?: string,
  ): Prisma.JournalEntryWhereInput {
    return {
      projectId,
      date: { gte: range.start, lt: range.end },
      ...(personId ? { personId } : {}),
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

/** 잔액 추이의 한 구간. 값은 end 직전까지 쌓인 잔액이다. */
type BalanceBucket = { label: string; start: Date; end: Date };

/** 월 단위 구간. endMonth를 포함해 뒤로 months개. */
function monthBuckets(endMonth: string, months: number): BalanceBucket[] {
  const { start: lastStart } = monthRange(endMonth);
  const buckets: BalanceBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(lastStart.getUTCFullYear(), lastStart.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    buckets.push({ label: toYearMonth(start), start, end });
  }
  return buckets;
}

/** 일 단위 구간. 그 달 1일부터 말일까지. */
function dayBuckets(yearMonth: string): BalanceBucket[] {
  const { start, end } = monthRange(yearMonth);
  const buckets: BalanceBucket[] = [];
  for (let day = new Date(start); day < end; ) {
    const next = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1),
    );
    buckets.push({ label: day.toISOString().slice(0, 10), start: new Date(day), end: next });
    day = next;
  }
  return buckets;
}

function monthRange(yearMonth: string): { start: Date; end: Date } {
  const [year, month] = yearMonth.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function emptyNetWorth(): ReportDto.NetWorth {
  return {
    total: '0', cash: '0', investment: '0', liability: '0', unrealizedGain: '0', byPerson: [],
  };
}
