import { Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import {
  CAT_BREEDS,
  CAT_COLLECT_GOAL,
  CAT_PARADE_MAX,
  Dec,
  daysInMonth,
  isCatBreedId,
  zonedCurrentYearMonth,
  zonedYearMonth,
  type CatDto,
  type CatMission,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { badRequest } from '@/common/app-error';
import { entryKindCondition } from '@/common/entry-filter';
import { shiftYearMonth } from '@/common/year-month';
import { BudgetsService } from '../budgets/budgets.service';
import { ReportsService } from '../reports/reports.service';

/** 하루. "가계부를 쓴 지 N일"을 잰다. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 달 단위 미션이 처음 셀 때 거슬러 올라가는 달 수. 그보다 오래된 달은 보지 않는다. */
const MONTHLY_LOOKBACK = 12;

/** 가계부를 만들며 함께 생긴 기본 분류를 사용자가 만든 것과 가르는 여유. */
const DEFAULT_CATEGORY_GRACE_MS = 60 * 1000;

/** 메모에 적으면 고양이가 오는 말. 세 언어의 울음소리다. */
const MEOW_WORDS = ['야옹', 'meow', 'にゃ', 'ニャ'];

/** 달 단위로만 판정하는 미션. 지난 달만 세고, 센 달은 다시 세지 않는다 (`ProjectCatState`). */
const MONTHLY_MISSIONS: readonly CatMission[] = ['budget-kept', 'budget-kept-3', 'net-positive', 'no-spend-10'];

/** 다른 고양이를 다 판정한 뒤에 세는 미션 -- 이번에 새로 온 고양이까지 센다. */
const COLLECT_MISSIONS: readonly CatMission[] = ['collect-20', 'collect-all'];

interface EvalContext {
  projectId: string;
  userId: string;
  timeZone: string;
  ledgerCurrency: string;
  createdAt: Date;
  now: Date;
}

type Judge = (ctx: EvalContext) => Promise<boolean>;

/**
 * 고양이 엠블럼의 획득 판정 (2026-10-28).
 *
 * **읽을 때 판정한다.** 화면이 동기화 신호를 받을 때마다 다시 읽으므로, 구성원 누가 무엇을 바꿔도 곧 판정이 돈다.
 * 쓰기 경로마다 판정을 끼우지 않는 까닭은 길이 많아서다 -- 거래만 해도 화면·사본 재생·엑셀·보관함이 있고, 하나를
 * 빠뜨리면 그 길로 채운 미션은 영영 오지 않는다. "가계부를 쓴 지 100일"처럼 아무것도 바뀌지 않아도 채워지는 미션도
 * 읽을 때가 아니면 판정할 자리가 없다.
 *
 * 이미 얻은 고양이의 미션은 다시 보지 않는다. 그래서 모을수록 판정이 가벼워진다. 얻은 고양이는 조건이 깨져도
 * 지우지 않는다 (사용자 결정). 기능을 내기 전에 쌓인 자료로도 첫 읽기에서 한꺼번에 받는다.
 */
@Injectable()
export class CatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly budgets: BudgetsService,
    private readonly reports: ReportsService,
  ) {}

  async getState(userId: string, projectIdParam?: string): Promise<CatDto.State> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectIdParam);
    await this.evaluate(projectId, userId);
    return this.stateOf(projectId, userId);
  }

  /**
   * 데리고 다닐 고양이를 정한다. 조회자도 정할 수 있다 -- 가계부의 자료가 아니라 내 화면의 모양이라서다.
   *
   * 얻지 않은 고양이와 겹친 이름은 거절한다. 화면은 얻은 것만 고르게 하므로 그런 요청은 옛 화면이나 잘못 만든 요청이다.
   */
  async setParade(userId: string, projectIdParam: string | undefined, body: CatDto.ParadeRequest): Promise<CatDto.State> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectIdParam);
    const breedIds = Array.isArray(body?.breedIds) ? body.breedIds : null;
    if (!breedIds || !breedIds.every(isCatBreedId)) {
      throw badRequest('CAT_PARADE_INVALID', '고양이 목록이 올바르지 않습니다.');
    }
    if (new Set(breedIds).size !== breedIds.length) {
      throw badRequest('CAT_PARADE_INVALID', '같은 고양이를 두 번 고를 수 없습니다.');
    }
    if (breedIds.length > CAT_PARADE_MAX) {
      throw badRequest('CAT_PARADE_INVALID', `고양이는 ${CAT_PARADE_MAX}마리까지 데리고 다닐 수 있습니다.`);
    }
    const owned = await this.prisma.projectCat.count({ where: { projectId, breedId: { in: breedIds } } });
    if (owned !== breedIds.length) {
      throw badRequest('CAT_PARADE_INVALID', '아직 얻지 않은 고양이가 있습니다.');
    }

    await this.prisma.projectCatParade.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, breedIds },
      update: { breedIds },
    });
    // 다섯 마리를 데리고 다니는 것도 미션이다.
    await this.evaluate(projectId, userId);
    return this.stateOf(projectId, userId);
  }

  private async stateOf(projectId: string, userId: string): Promise<CatDto.State> {
    const [cats, parade] = await Promise.all([
      this.prisma.projectCat.findMany({ where: { projectId }, orderBy: { grantedAt: 'asc' } }),
      this.prisma.projectCatParade.findUnique({ where: { projectId_userId: { projectId, userId } } }),
    ]);
    const ownedIds = new Set(cats.map((cat) => cat.breedId));
    return {
      owned: cats
        .filter((cat) => isCatBreedId(cat.breedId))
        .map((cat) => ({ breedId: cat.breedId, grantedAt: cat.grantedAt.toISOString() })),
      // 표에서 빠진 품종은 내려보내지 않는다. 데리고 다니던 것도 같다. 고른 적이 없으면 null 이다.
      parade: parade ? parade.breedIds.filter((id) => ownedIds.has(id) && isCatBreedId(id)) : null,
    };
  }

  /** 아직 얻지 않은 고양이의 미션을 판정하고, 채운 것을 적는다. 새로 온 품종을 돌려준다. */
  async evaluate(projectId: string, userId: string, now: Date = new Date()): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { timezone: true, ledgerCurrency: true, createdAt: true },
    });
    if (!project) return [];
    const ctx: EvalContext = {
      projectId,
      userId,
      timeZone: project.timezone,
      ledgerCurrency: project.ledgerCurrency,
      createdAt: project.createdAt,
      now,
    };

    const owned = new Set(
      (await this.prisma.projectCat.findMany({ where: { projectId }, select: { breedId: true } })).map(
        (cat) => cat.breedId,
      ),
    );
    const missing = CAT_BREEDS.filter((breed) => !owned.has(breed.id));
    if (missing.length === 0) return [];

    const granted: string[] = [];
    const missingMissions = new Set(missing.map((breed) => breed.mission));

    // 하나씩 차례로 묻는다. 한꺼번에 띄우면 서른 개 질의가 연결을 다 잡아 다른 요청이 기다린다.
    for (const breed of missing) {
      if (MONTHLY_MISSIONS.includes(breed.mission) || COLLECT_MISSIONS.includes(breed.mission)) continue;
      if (await this.judges[breed.mission](ctx)) granted.push(breed.id);
    }

    if (MONTHLY_MISSIONS.some((mission) => missingMissions.has(mission))) {
      const monthly = await this.judgeMonthly(ctx, missingMissions);
      for (const breed of missing) {
        if (monthly.has(breed.mission)) granted.push(breed.id);
      }
    }

    const ownedAfter = owned.size + granted.length;
    for (const breed of missing) {
      if (breed.mission === 'collect-20' && ownedAfter >= CAT_COLLECT_GOAL) granted.push(breed.id);
    }
    // "다 모으기"는 자기 자신을 뺀 나머지 전부다. 위에서 "20종"이 막 왔으면 그것도 센다.
    const allOthers = CAT_BREEDS.length - 1;
    for (const breed of missing) {
      if (breed.mission === 'collect-all' && owned.size + granted.length >= allOthers) granted.push(breed.id);
    }

    if (granted.length > 0) {
      // 두 사람이 같은 순간에 읽어도 한 마리로 남는다 (열쇠가 가계부+품종).
      await this.prisma.projectCat.createMany({
        data: granted.map((breedId) => ({ projectId, breedId, grantedAt: now })),
        skipDuplicates: true,
      });
    }
    return granted;
  }

  // ─────────────────────────────────────────────
  // 미션 하나씩
  // ─────────────────────────────────────────────

  /** 사람이 적은 거래. 계좌를 만들 때 생기는 기초잔액 전표(조정)는 세지 않는다. */
  private userEntries(projectId: string, extra?: Prisma.JournalEntryWhereInput): Prisma.JournalEntryWhereInput {
    const base: Prisma.JournalEntryWhereInput = {
      projectId,
      postings: { none: { account: { type: AccountType.opening_balance } } },
    };
    return extra ? { AND: [base, extra] } : base;
  }

  private async hasEntry(projectId: string, extra?: Prisma.JournalEntryWhereInput): Promise<boolean> {
    return (await this.prisma.journalEntry.findFirst({ where: this.userEntries(projectId, extra), select: { id: true } })) !== null;
  }

  private async entryCountAtLeast(projectId: string, count: number): Promise<boolean> {
    // 다 세지 않는다. count 번째 줄이 있는지만 본다.
    const row = await this.prisma.journalEntry.findFirst({
      where: this.userEntries(projectId),
      orderBy: { id: 'asc' },
      skip: count - 1,
      select: { id: true },
    });
    return row !== null;
  }

  /** 사람이 만든 자산(입출금·예적금·투자·대출 따위). 카드 부채·기초잔액·미지정 계정은 사람이 만든 계좌가 아니다. */
  private readonly realAccount = {
    type: { notIn: [AccountType.opening_balance, AccountType.unassigned, AccountType.credit_card] },
  } satisfies Prisma.AccountWhereInput;

  private readonly judges: Record<CatMission, Judge> = {
    start: async () => true,
    'first-entry': async ({ projectId }) => this.hasEntry(projectId),
    'first-account': async ({ projectId }) =>
      (await this.prisma.account.count({ where: { projectId, ...this.realAccount } })) >= 1,
    'first-card': async ({ projectId }) => (await this.prisma.card.count({ where: { projectId } })) >= 1,
    'first-income': async ({ projectId }) => this.hasEntry(projectId, entryKindCondition(['income'])),
    'first-transfer': async ({ projectId }) => this.hasEntry(projectId, entryKindCondition(['transfer'])),
    'custom-category': async ({ projectId, createdAt }) =>
      (await this.prisma.category.count({
        where: { projectId, createdAt: { gt: new Date(createdAt.getTime() + DEFAULT_CATEGORY_GRACE_MS) } },
      })) >= 1,
    'first-tag': async ({ projectId }) =>
      (await this.prisma.entryTag.findFirst({ where: { entry: { projectId } }, select: { id: true } })) !== null,
    budget: async ({ projectId }) => (await this.prisma.budget.count({ where: { projectId, tagId: null } })) >= 1,
    // "나"로 이어진 사람은 구성원이 들어올 때 저절로 생긴다. 아무 구성원과도 이어지지 않은 사람이 손으로 더한 사람이다.
    'add-person': async ({ projectId }) =>
      (await this.prisma.person.count({ where: { projectId, members: { none: {} } } })) >= 1,
    shared: async ({ projectId }) => (await this.prisma.projectMember.count({ where: { projectId } })) >= 2,
    'entries-10': async ({ projectId }) => this.entryCountAtLeast(projectId, 10),
    split: async ({ projectId }) => {
      const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM "Posting" p JOIN "JournalEntry" e ON e.id = p."entryId"
        WHERE e."projectId" = ${projectId} AND p."categoryId" IS NOT NULL
        GROUP BY p."entryId" HAVING COUNT(*) > 1 LIMIT 1`;
      return rows.length > 0;
    },
    recurring: async ({ projectId }) => (await this.prisma.recurringRule.count({ where: { projectId } })) >= 1,
    'tag-budget': async ({ projectId }) => (await this.prisma.budget.count({ where: { projectId, tagId: { not: null } } })) >= 1,
    installment: async ({ projectId }) =>
      this.hasEntry(projectId, { postings: { some: { installmentPlan: { isNot: null } } } }),
    discount: async ({ projectId }) => this.hasEntry(projectId, { postings: { some: { discountAmount: { gt: 0 } } } }),
    refund: async ({ projectId }) => this.hasEntry(projectId, { paybackType: 'refund' }),
    // 페이백 칸이 생기기 전의 행은 종류가 비어 있고 그것도 페이백이다 (entry-view 의 paybackType).
    payback: async ({ projectId }) =>
      this.hasEntry(projectId, {
        AND: [entryKindCondition(['payback'])!, { OR: [{ paybackType: null }, { paybackType: 'payback' }] }],
      }),
    inbox: async ({ projectId }) =>
      (await this.prisma.entryDraft.count({ where: { projectId, registeredEntryId: { not: null } } })) >= 1,
    subcategory: async ({ projectId, createdAt }) =>
      (await this.prisma.category.count({
        where: {
          projectId,
          parentId: { not: null },
          createdAt: { gt: new Date(createdAt.getTime() + DEFAULT_CATEGORY_GRACE_MS) },
        },
      })) >= 1,
    foreign: async ({ projectId, ledgerCurrency }) =>
      this.hasEntry(projectId, { originalCurrency: { not: null }, NOT: { originalCurrency: ledgerCurrency } }),
    maturity: async ({ projectId }) =>
      (await this.prisma.account.count({ where: { projectId, maturityDate: { not: null } } })) >= 1,
    valuation: async ({ projectId }) =>
      (await this.prisma.assetValuation.findFirst({ where: { account: { projectId } }, select: { id: true } })) !== null,
    loan: async ({ projectId }) => (await this.prisma.account.count({ where: { projectId, type: AccountType.loan } })) >= 1,
    'entries-100': async ({ projectId }) => this.entryCountAtLeast(projectId, 100),
    'entries-1000': async ({ projectId }) => this.entryCountAtLeast(projectId, 1000),
    'streak-7': async (ctx) => (await this.longestRecordStreak(ctx)) >= 7,
    'streak-30': async (ctx) => (await this.longestRecordStreak(ctx)) >= 30,
    'accounts-5': async ({ projectId }) =>
      (await this.prisma.account.count({ where: { projectId, ...this.realAccount } })) >= 5,
    'days-100': async ({ createdAt, now }) => now.getTime() - createdAt.getTime() >= 100 * DAY_MS,
    'night-owl': async ({ projectId, timeZone }) => {
      const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM "JournalEntry" e
        WHERE e."projectId" = ${projectId}
          AND EXTRACT(HOUR FROM (e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}) < 4
          AND ${this.notOpeningSql()}
        LIMIT 1`;
      return rows.length > 0;
    },
    // 다리마다 금액이 따로다. 분류 다리 중 하나라도 7,777 이면 된다 (외화면 그 통화의 금액).
    'lucky-7777': async ({ projectId }) =>
      (await this.prisma.posting.findFirst({
        where: { entry: { projectId }, categoryId: { not: null }, amount: { in: [7777, -7777] } },
        select: { id: true },
      })) !== null,
    'new-year': async (ctx) => this.hasEntryOnDay(ctx, '01-01'),
    christmas: async (ctx) => this.hasEntryOnDay(ctx, '12-25'),
    meow: async ({ projectId }) =>
      this.hasEntry(projectId, {
        OR: MEOW_WORDS.flatMap((word) => [
          { description: { contains: word, mode: 'insensitive' as const } },
          { merchant: { contains: word, mode: 'insensitive' as const } },
          { detailedNote: { contains: word, mode: 'insensitive' as const } },
        ]),
      }),
    // 같은 날(거래 날짜)에 20건. 엑셀로 한꺼번에 넣어도 날짜가 갈리면 채워지지 않는다.
    'busy-day': async ({ projectId, timeZone }) => {
      const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM "JournalEntry" e
        WHERE e."projectId" = ${projectId} AND ${this.notOpeningSql()}
        GROUP BY ((e."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date
        HAVING COUNT(*) >= 20 LIMIT 1`;
      return rows.length > 0;
    },
    'days-365': async ({ createdAt, now }) => now.getTime() - createdAt.getTime() >= 365 * DAY_MS,
    'parade-5': async ({ projectId }) => {
      const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM "ProjectCatParade"
        WHERE "projectId" = ${projectId} AND COALESCE(array_length("breedIds", 1), 0) >= ${CAT_PARADE_MAX}
        LIMIT 1`;
      return rows.length > 0;
    },
    // 아래 여섯은 `evaluate` 가 따로 센다. 여기 오지 않는다.
    'budget-kept': async () => false,
    'budget-kept-3': async () => false,
    'net-positive': async () => false,
    'no-spend-10': async () => false,
    'collect-20': async () => false,
    'collect-all': async () => false,
  };

  /** 기초잔액 전표를 빼는 SQL 조각. 별칭 `e` 가 거래다. */
  private notOpeningSql(): Prisma.Sql {
    return Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "Posting" op JOIN "Account" oa ON oa.id = op."accountId"
      WHERE op."entryId" = e.id AND oa.type = 'opening_balance')`;
  }

  /** 그 날(월-일, 가계부 시간대의 거래 날짜)에 적은 거래가 있는가. */
  private async hasEntryOnDay({ projectId, timeZone }: EvalContext, monthDay: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM "JournalEntry" e
      WHERE e."projectId" = ${projectId}
        AND to_char((e."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'MM-DD') = ${monthDay}
        AND ${this.notOpeningSql()}
      LIMIT 1`;
    return rows.length > 0;
  }

  /**
   * 거래를 **적은 날**이 가장 길게 이어진 날 수.
   *
   * 거래 날짜가 아니라 적은 날(createdAt, 가계부 시간대)이다. 지난 날짜로 몰아 적어 채우지 못하게 한다. 오프라인에서
   * 적은 거래는 서버에 닿은 날로 센다 -- 기기 시계는 믿을 수 없다.
   */
  private async longestRecordStreak({ projectId, timeZone }: EvalContext): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date }>>`
      SELECT DISTINCT ((e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date AS day
      FROM "JournalEntry" e
      WHERE e."projectId" = ${projectId} AND ${this.notOpeningSql()}
      ORDER BY day`;
    let best = 0;
    let run = 0;
    let previous: number | null = null;
    for (const { day } of rows) {
      const time = day.getTime();
      run = previous !== null && time - previous === DAY_MS ? run + 1 : 1;
      best = Math.max(best, run);
      previous = time;
    }
    return best;
  }

  /**
   * 달 단위 미션. 다 지난 달만 본다 -- 이번 달은 아직 바뀔 수 있다.
   *
   * 처음에는 최근 `MONTHLY_LOOKBACK` 달(가계부를 만든 달부터)을, 그 뒤로는 새로 지난 달만 센다. "3달 연속"을 보려고
   * 새 달의 앞 두 달도 함께 센다 (한 달에 한 번이라 비용이 작다). 지난 달의 거래를 나중에 고쳐도 다시 세지 않는다.
   */
  private async judgeMonthly(ctx: EvalContext, wanted: Set<CatMission>): Promise<Set<CatMission>> {
    const { projectId, timeZone } = ctx;
    const lastCompleted = shiftYearMonth(zonedCurrentYearMonth(timeZone, ctx.now), -1);
    const firstMonth = zonedYearMonth(ctx.createdAt, timeZone);
    const state = await this.prisma.projectCatState.findUnique({ where: { projectId } });
    const checked = state?.monthlyCheckedThrough ?? null;
    const met = new Set<CatMission>();
    if (lastCompleted < firstMonth || (checked !== null && checked >= lastCompleted)) return met;

    const newFrom = checked !== null ? shiftYearMonth(checked, 1) : shiftYearMonth(lastCompleted, -(MONTHLY_LOOKBACK - 1));
    // "3달 연속"의 앞 두 달까지.
    let month = shiftYearMonth(newFrom, -2);
    if (month < firstMonth) month = firstMonth;

    let keptRun = 0;
    for (; month <= lastCompleted; month = shiftYearMonth(month, 1)) {
      const result = await this.monthResult(ctx, month);
      keptRun = result.budgetKept ? keptRun + 1 : 0;
      // 앞 두 달은 연속을 잇는 데만 쓴다. 미션 자체는 새로 지난 달에서 채운다.
      if (month < newFrom) continue;
      if (result.budgetKept) met.add('budget-kept');
      if (keptRun >= 3) met.add('budget-kept-3');
      if (result.netPositive) met.add('net-positive');
      if (result.noSpend10) met.add('no-spend-10');
    }

    await this.prisma.projectCatState.upsert({
      where: { projectId },
      create: { projectId, monthlyCheckedThrough: lastCompleted },
      update: { monthlyCheckedThrough: lastCompleted },
    });
    return new Set([...met].filter((mission) => wanted.has(mission)));
  }

  private async monthResult(
    ctx: EvalContext,
    yearMonth: string,
  ): Promise<{ budgetKept: boolean; netPositive: boolean; noSpend10: boolean }> {
    const { projectId, userId, timeZone } = ctx;
    const [year, month] = yearMonth.split('-').map(Number);
    const summary = await this.reports.getSummary(userId, { projectId, yearMonth });
    const spent = Dec.of(summary.expense).isPositive();

    /*
     * 예산 지키기: 그 달에 지출 예산(전체·분류)이 하나라도 있고, 그 모두가 넘치지 않았다. 지출이 하나도 없는 달은
     * 지킨 것이 아니라 적지 않은 것이라 세지 않는다. 소분류 합으로 만든 가상 예산은 대분류를 두 번 세는 것이라 뺀다.
     */
    let budgetKept = false;
    if (spent) {
      const rows = (await this.budgets.getBudgetForMonth(userId, projectId, year, month)).filter(
        (row) => row.categoryType === 'expense' && !row.isVirtualBudget && Dec.of(row.monthlyAmount).isPositive(),
      );
      budgetKept =
        rows.length > 0 && rows.every((row) => Dec.of(row.usedAmount ?? '0').lte(row.monthlyAmount));
    }

    const netPositive = spent && Dec.of(summary.net).isPositive();

    /*
     * 무지출 10일: 꾸준히 적은 달(지출한 날 15일 이상)에 지출이 없는 날이 10일 이상. 기록이 드문 달을 빼지 않으면
     * 아무것도 적지 않은 가계부가 저절로 받는다.
     */
    let noSpend10 = false;
    if (spent) {
      const rows = await this.prisma.$queryRaw<Array<{ days: bigint }>>`
        SELECT COUNT(DISTINCT ((e."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date) AS days
        FROM "JournalEntry" e
        WHERE e."projectId" = ${projectId}
          AND to_char((e."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM') = ${yearMonth}
          AND EXISTS (
            SELECT 1 FROM "Posting" p JOIN "Category" c ON c.id = p."categoryId"
            WHERE p."entryId" = e.id AND c.type = 'expense' AND p."baseAmount" > 0)`;
      const spendDays = Number(rows[0]?.days ?? 0);
      noSpend10 = spendDays >= 15 && daysInMonth(year, month) - spendDays >= 10;
    }

    return { budgetKept, netPositive, noSpend10 };
  }
}
