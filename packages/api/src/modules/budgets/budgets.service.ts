import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { toMoney } from '@/common/money';
import {
  DisplayConverter,
  ExchangeRatesService,
} from '../exchange-rates/exchange-rates.service';
import { assertYearMonth, shiftYearMonth } from '@/common/year-month';
import {
  BudgetDto,
  EntryFilterQuery,
  zonedCurrentYearMonth,
  zonedMonthRange,
} from '@money/types';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  parseEntryFilter,
} from '@/common/entry-filter';

const ZERO = new Prisma.Decimal(0);

/**
 * 전체 예산의 센티널 categoryId를 푼다.
 *
 * 전체 예산은 분류가 없는 예산이라 categoryId로 가리킬 수 없다. 화면은 대신
 * 약속된 문자열을 보내고, 서버는 그것을 "분류 없음 + type"으로 바꾼다.
 * 예산을 만드는 쪽과 조회하는 쪽이 같은 규칙을 써야 하므로 한 곳에 둔다.
 */
function resolveBudgetTarget(
  categoryId?: string,
  type?: 'income' | 'expense',
): { categoryId?: string; type?: 'income' | 'expense' } {
  if (categoryId === 'BUDGET_TOTAL_INCOME') return { categoryId: undefined, type: 'income' };
  if (categoryId === 'BUDGET_TOTAL_EXPENSE') return { categoryId: undefined, type: 'expense' };
  return { categoryId, type };
}

/** 내부 계산용. 응답으로 나갈 때 금액을 문자열로 바꾼다. */
type InternalBudgetRow = Omit<
  BudgetDto.MonthlyBudget,
  'monthlyAmount' | 'ruleAmount' | 'usedAmount'
> & {
  monthlyAmount: Prisma.Decimal;
  ruleAmount: Prisma.Decimal;
  usedAmount: Prisma.Decimal;
};

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async createBudget(
    userId: string,
    dto: BudgetDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<BudgetDto.Response> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );

    const { categoryId, type } = resolveBudgetTarget(dto.categoryId, dto.type);

    // 카테고리 확인
    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category || category.projectId !== projectId) {
        throw new NotFoundException('유효한 카테고리가 아닙니다.');
      }
    }

    /*
     * 같은 카테고리의 기존 예산 확인.
     *
     * 적용 기간을 함께 봐야 한다. 예산은 applyMode='from'으로 기간이 나뉠 수 있어
     * 한 카테고리에 규칙이 여러 개 있을 수 있다. 예전에는 정렬도 기간 조건도 없이
     * findFirst로 아무거나 집어서, 8월 화면에서 금액을 바꿨는데 9월 규칙이
     * 바뀌는 일이 있었다. 화면상으로는 저장이 안 된 것처럼 보였다.
     */
    const timeZone = await this.projectAccess.getProjectTimeZone(projectId);
    const targetMonth = dto.yearMonth
      ? assertYearMonth(dto.yearMonth, '적용 월')
      : zonedCurrentYearMonth(timeZone);

    const candidates = await this.prisma.budget.findMany({
      where: {
        projectId,
        categoryId: categoryId ?? null,
        type: type || undefined,
      },
    });
    const existingBudget = candidates.find((budget) =>
      this.isBudgetApplicable(budget, targetMonth),
    );

    // 입력은 표시 통화다. 저장은 저장 통화로 한다.
    const { show, store } = await this.currencyView(projectId);
    const monthlyAmount = store.convert(toMoney(dto.monthlyAmount, '월 예산'));

    // 그 달에 적용되는 규칙이 있으면 그것을 고친다
    if (existingBudget) {
      return this.toBudgetResponse(
        await this.prisma.budget.update({
          where: { id: existingBudget.id },
          data: { monthlyAmount },
        }),
        show,
      );
    }

    const budget = await this.prisma.budget.create({
      data: {
        projectId,
        categoryId: categoryId ?? null,
        type: type || undefined,
        monthlyAmount,
      },
    });

    return this.toBudgetResponse(budget, show);
  }

  async getBudgets(
    userId: string,
    query: BudgetDto.ListQuery,
  ): Promise<BudgetDto.Response[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      query.projectId,
    );

    // 예산은 프로젝트 단위 값이다 (Budget에 userId 컬럼이 없다).
    // 예전에는 where에 userId를 함께 걸어 Prisma가 알 수 없는 인자로 거부했고,
    // 이 엔드포인트는 항상 500이었다. 스토어가 오류를 삼켜서 드러나지 않았을 뿐이다.
    const where: Prisma.BudgetWhereInput = { projectId };
    if (query.categoryId) where.categoryId = query.categoryId;

    const budgets = await this.prisma.budget.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const { show } = await this.currencyView(projectId);
    return budgets.map((b) => this.toBudgetResponse(b, show));
  }

  /** 수정·삭제 경로는 requiredRole에 'editor'를 넘긴다. */
  async getBudgetById(
    id: string,
    userId: string,
    requiredRole: ProjectRole = 'viewer',
  ): Promise<BudgetDto.Response> {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
    });

    if (!budget) {
      throw new NotFoundException('예산을 찾을 수 없습니다.');
    }
    await this.projectAccess.verifyUserHasAccessToProject(userId, budget.projectId, requiredRole);

    const { show } = await this.currencyView(budget.projectId);
    return this.toBudgetResponse(budget, show);
  }

  async updateBudget(
    id: string,
    userId: string,
    dto: BudgetDto.UpdateRequest,
  ): Promise<BudgetDto.Response> {
    const budget = await this.getBudgetById(id, userId, 'editor');

    if (!dto.monthlyAmount) {
      throw new BadRequestException('월 예산을 입력해주세요.');
    }

    if (dto.applyMode === 'from' && !dto.applyFromMonth) {
      throw new BadRequestException('적용 시작 월을 입력해주세요.');
    }

    // 입력은 표시 통화, 저장은 저장 통화다.
    const { show, store } = await this.currencyView(budget.projectId);
    const monthlyAmount = store.convert(toMoney(dto.monthlyAmount, '월 예산'));

    // applyMode='all': 기본 규칙만 수정
    if (!dto.applyMode || dto.applyMode === 'all') {
      const updated = await this.prisma.budget.update({
        where: { id },
        data: { monthlyAmount },
      });
      return this.toBudgetResponse(updated, show);
    }

    // applyMode='from': 기존 규칙을 앞 달까지로 끊고 새 규칙을 만든다
    if (dto.applyMode === 'from') {
      const applyFrom = assertYearMonth(dto.applyFromMonth!, '적용 시작 월');
      const beforeMonth = this.getPreviousMonth(applyFrom);

      // 두 쓰기를 한 트랜잭션으로 묶는다. 끊기만 하고 새 규칙 생성이 실패하면
      // 그 달부터 예산이 통째로 사라진 상태로 남는다.
      const newBudget = await this.prisma
        .$transaction(async (tx) => {
          await tx.budget.update({
            where: { id },
            data: { effectiveTo: beforeMonth },
          });

          return tx.budget.create({
            data: {
              projectId: budget.projectId,
              categoryId: budget.categoryId,
              // type을 빠뜨리면 안 된다. 전체 예산(categoryId = null)은 type이
              // 유일한 구분자라, 없이 만들면 조회 맵의 키가 `__total__undefined`가
              // 되어 그 달부터 전체 예산 칸이 빈 값으로 보인다.
              type: budget.type,
              monthlyAmount,
              effectiveFrom: applyFrom,
            },
          });
        })
        .catch((error) => {
          // @@unique([projectId, categoryId, type, effectiveFrom]).
          // 같은 달부터 두 번 나누려 한 경우다. 트랜잭션이 통째로 되돌아가므로
          // 기존 규칙의 effectiveTo도 원래대로 남는다.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new BadRequestException(
              `${applyFrom}부터 적용되는 예산이 이미 있습니다. 그 예산을 수정하세요.`,
            );
          }
          throw error;
        });

      return this.toBudgetResponse(newBudget, show);
    }

    throw new BadRequestException('applyMode가 잘못되었습니다.');
  }

  /**
   * 프로젝트의 예산을 모두 지운다.
   *
   * 규칙 하나씩 지우는 경로(DELETE /budgets/:id)만으로는 분류가 수십 개일 때
   * 화면에서 지울 수가 없다. 월별 조정값은 Budget에 cascade로 걸려 있어 함께 사라진다.
   *
   * 지운 개수를 돌려준다. 화면이 "지울 예산이 없습니다"와 "12개를 지웠습니다"를
   * 구분해 알려줄 수 있어야 한다.
   */
  async resetBudgets(userId: string, projectIdParam?: string): Promise<{ deleted: number }> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam,
      'editor',
    );

    const { count } = await this.prisma.budget.deleteMany({ where: { projectId } });
    return { deleted: count };
  }

  async deleteBudget(id: string, userId: string): Promise<void> {
    await this.getBudgetById(id, userId, 'editor');

    await this.prisma.budget.delete({
      where: { id },
    });
  }

  /**
   * 특정 월의 예산과 사용금액.
   *
   * filter는 가계 화면의 자산주인/고정 필터다. 사용금액이 필터를 타지 않으면
   * 왼쪽 예산 카드와 오른쪽 상세 통계가 서로 다른 숫자를 보여준다.
   * 예산액 자체는 프로젝트 단위 값이라 필터와 무관하게 그대로 둔다.
   */
  async getBudgetForMonth(
    userId: string,
    projectId: string,
    year: number,
    month: number,
    filter: EntryFilterQuery = {},
  ): Promise<BudgetDto.MonthlyBudget[]> {
    await this.projectAccess.verifyUserHasAccessToProject(userId, projectId);
    const timeZone = await this.projectAccess.getProjectTimeZone(projectId);

    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

    const [categories, budgets, overrides] = await Promise.all([
      this.prisma.category.findMany({ where: { projectId, isActive: true } }),
      this.prisma.budget.findMany({ where: { projectId }, include: { category: true } }),
      this.prisma.budgetOverride.findMany({
        where: { budget: { projectId }, year, month },
        include: { budget: true },
      }),
    ]);

    // 예산 맵. categoryId가 없으면 전체 예산이므로 type을 키로 쓴다.
    const budgetMap = new Map<string, (typeof budgets)[number]>();
    for (const budget of budgets) {
      if (this.isBudgetApplicable(budget, yearMonth)) {
        budgetMap.set(budget.categoryId || `__total__${budget.type}`, budget);
      }
    }

    const overrideMap = new Map<string, { id: string; amount: Prisma.Decimal }>();
    for (const override of overrides) {
      overrideMap.set(override.budgetId, { id: override.id, amount: override.amount });
    }

    const childrenByParent = new Map<string, typeof categories>();
    for (const category of categories) {
      if (!category.parentId) continue;
      const list = childrenByParent.get(category.parentId) ?? [];
      list.push(category);
      childrenByParent.set(category.parentId, list);
    }

    // 사용금액: groupBy 한 번으로 끝난다.
    //
    // 예전에는 (대분류/소분류) x (지출/수입) 4개의 groupBy를 돌리고 credit_usage를
    // 포함할지 매번 판단해야 했다. 이제 "지출 = 지출 카테고리 posting의 합"이므로
    // 결제수단과 무관하게 한 번에 집계된다.
    // 월 경계는 프로젝트 타임존 기준이다 (reports의 월 합계와 같은 규칙).
    const { start: startDate, end: endDate } = zonedMonthRange(yearMonth, timeZone);

    // 사용금액에도 화면의 필터를 그대로 건다 (reports.summary 와 같은 규칙).
    const parsed = parseEntryFilter(filter);
    const owner = assetOwnerCondition(parsed);
    const entryScope: Prisma.JournalEntryWhereInput = parsed.matchNothing
      ? { projectId, ...MATCH_NOTHING }
      : {
          projectId,
          date: { gte: startDate, lt: endDate },
          ...(owner ? { AND: [owner] } : {}),
        };

    const usage = await this.prisma.posting.groupBy({
      by: ['categoryId'],
      // 예산은 프로젝트 기준통화로 세운다. 사용액도 환산액으로 더해야
      // 외화 결제가 섞였을 때 진행률이 맞는다.
      _sum: { baseAmount: true },
      _count: true,
      where: {
        categoryId: { in: categories.map((c) => c.id) },
        entry: entryScope,
        ...(parsed.fixed !== undefined ? { isFixed: parsed.fixed } : {}),
      },
    });

    // 수입 posting은 음수로 기록되므로 표시용으로 절댓값을 쓴다.
    const ownAmount = new Map<string, Prisma.Decimal>();
    const ownCount = new Map<string, number>();
    for (const row of usage) {
      if (!row.categoryId) continue;
      ownAmount.set(row.categoryId, (row._sum.baseAmount ?? ZERO).abs());
      ownCount.set(row.categoryId, row._count);
    }

    // 대분류 사용액은 자신 + 소분류 합이다.
    // (posting은 가장 구체적인 카테고리 하나만 가리키므로 롤업이 필요하다)
    const usedAmount = new Map<string, Prisma.Decimal>();
    const usageCount = new Map<string, number>();
    for (const category of categories) {
      let amount = ownAmount.get(category.id) ?? ZERO;
      let count = ownCount.get(category.id) ?? 0;
      for (const child of childrenByParent.get(category.id) ?? []) {
        amount = amount.add(ownAmount.get(child.id) ?? ZERO);
        count += ownCount.get(child.id) ?? 0;
      }
      usedAmount.set(category.id, amount);
      usageCount.set(category.id, count);
    }

    const amountOf = (key: string): Prisma.Decimal => {
      const budget = budgetMap.get(key);
      if (!budget) return ZERO;
      return overrideMap.get(budget.id)?.amount ?? budget.monthlyAmount;
    };

    /** 조정을 걷어냈을 때의 금액. 조정이 없으면 amountOf와 같다. */
    const ruleAmountOf = (key: string): Prisma.Decimal =>
      budgetMap.get(key)?.monthlyAmount ?? ZERO;

    const rows: InternalBudgetRow[] = [];

    for (const type of ['expense', 'income'] as const) {
      const budget = budgetMap.get(`__total__${type}`);
      rows.push({
        budgetId: budget?.id ?? `placeholder-total-${type}`,
        categoryId: undefined,
        categoryName: type === 'expense' ? '전체 지출' : '전체 수입',
        categoryType: type,
        parentCategoryId: undefined,
        monthlyAmount: amountOf(`__total__${type}`),
        ruleAmount: ruleAmountOf(`__total__${type}`),
        // 대분류 사용액의 합. 소분류는 이미 대분류에 롤업되어 있으므로 중복되지 않는다.
        usedAmount: categories
          .filter((c) => !c.parentId && c.type === type)
          .reduce((acc, c) => acc.add(usedAmount.get(c.id) ?? ZERO), ZERO),
        isOverridden: budget ? overrideMap.has(budget.id) : false,
        overrideId: budget ? overrideMap.get(budget.id)?.id : undefined,
        effectiveFrom: budget?.effectiveFrom ?? undefined,
        effectiveTo: budget?.effectiveTo ?? undefined,
        hasChildren: childrenByParent.size > 0,
      });
    }

    for (const category of categories) {
      const budget = budgetMap.get(category.id);
      rows.push({
        budgetId: budget?.id ?? `placeholder-${category.id}`,
        categoryId: category.id,
        categoryName: category.name,
        categoryType: category.type,
        parentCategoryId: category.parentId ?? undefined,
        monthlyAmount: amountOf(category.id),
        ruleAmount: ruleAmountOf(category.id),
        usedAmount: usedAmount.get(category.id) ?? ZERO,
        isOverridden: budget ? overrideMap.has(budget.id) : false,
        overrideId: budget ? overrideMap.get(budget.id)?.id : undefined,
        effectiveFrom: budget?.effectiveFrom ?? undefined,
        effectiveTo: budget?.effectiveTo ?? undefined,
        hasChildren: childrenByParent.has(category.id),
      });
    }

    // 대분류는 사용 건수 순, 그 아래 소분류도 사용 건수 순으로 붙인다.
    const totals = rows.filter((r) => !r.categoryId);
    const mains = rows
      .filter((r) => r.categoryId && !r.parentCategoryId)
      .sort((a, b) => (usageCount.get(b.categoryId!) ?? 0) - (usageCount.get(a.categoryId!) ?? 0));

    const ordered: InternalBudgetRow[] = [...totals];
    for (const main of mains) {
      ordered.push(main);
      const children = rows
        .filter((r) => r.parentCategoryId === main.categoryId)
        .sort((a, b) => (usageCount.get(b.categoryId!) ?? 0) - (usageCount.get(a.categoryId!) ?? 0));
      ordered.push(...children);
    }

    // 예산액과 사용액 모두 저장 통화로 계산됐다. 표시 통화로 옮겨 내보낸다.
    const { show } = await this.currencyView(projectId);
    return ordered.map((row) => ({
      ...row,
      monthlyAmount: show.toString(row.monthlyAmount),
      ruleAmount: show.toString(row.ruleAmount),
      usedAmount: show.toString(row.usedAmount),
    }));
  }

  /**
   * 한 분류(또는 전체 예산)가 달마다 얼마인지.
   *
   * 예산은 규칙 하나가 여러 달을 덮고, 거기에 달별 조정이 얹힌다. 그래서 "지금
   * 얼마로 되어 있나"를 화면에서 조립하려면 적용 기간 판정을 다시 구현해야 하는데,
   * 그 규칙은 서버에만 있어야 한다. 달마다 답을 미리 풀어서 내려준다.
   */
  async getBudgetSchedule(
    userId: string,
    query: BudgetDto.ScheduleQuery,
  ): Promise<BudgetDto.ScheduleMonth[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      query.projectId,
    );
    const timeZone = await this.projectAccess.getProjectTimeZone(projectId);
    const { categoryId, type } = resolveBudgetTarget(query.categoryId, query.type);

    const startMonth = query.startMonth
      ? assertYearMonth(query.startMonth, '시작 월')
      : zonedCurrentYearMonth(timeZone);
    const months = Math.min(Math.max(Number(query.months) || 12, 1), 60);

    const rules = await this.prisma.budget.findMany({
      where: { projectId, categoryId: categoryId ?? null, type: type || undefined },
    });
    const overrides =
      rules.length > 0
        ? await this.prisma.budgetOverride.findMany({
            where: { budgetId: { in: rules.map((rule) => rule.id) } },
          })
        : [];

    const overrideKey = (budgetId: string, year: number, month: number) =>
      `${budgetId}:${year}-${String(month).padStart(2, '0')}`;
    const overrideMap = new Map(
      overrides.map((override) => [
        overrideKey(override.budgetId, override.year, override.month),
        override,
      ]),
    );

    const { show } = await this.currencyView(projectId);
    const schedule: BudgetDto.ScheduleMonth[] = [];

    for (let offset = 0; offset < months; offset++) {
      const yearMonth = shiftYearMonth(startMonth, offset);
      const rule = rules.find((candidate) => this.isBudgetApplicable(candidate, yearMonth));

      // 규칙이 안 걸치는 달이 있을 수 있다. applyMode='from'으로 나눈 규칙의
      // 시작 달보다 앞이면 그렇다. 0원이 아니라 "예산 없음"이므로 금액을 비워 둔다.
      if (!rule) {
        schedule.push({ yearMonth, isOverridden: false });
        continue;
      }

      const [year, month] = yearMonth.split('-').map(Number);
      const override = overrideMap.get(overrideKey(rule.id, year, month));

      schedule.push({
        yearMonth,
        amount: show.toString(override?.amount ?? rule.monthlyAmount),
        ruleAmount: show.toString(rule.monthlyAmount),
        budgetId: rule.id,
        overrideId: override?.id,
        isOverridden: Boolean(override),
        effectiveFrom: rule.effectiveFrom ?? undefined,
        effectiveTo: rule.effectiveTo ?? undefined,
      });
    }

    return schedule;
  }

  async createOverride(
    userId: string,
    dto: BudgetDto.OverrideRequest,
  ): Promise<BudgetDto.OverrideResponse> {
    await this.getBudgetById(dto.budgetId, userId, 'editor');

    const budget = await this.prisma.budget.findUniqueOrThrow({
      where: { id: dto.budgetId },
      select: { projectId: true },
    });
    const { show, store } = await this.currencyView(budget.projectId);
    const amount = store.convert(toMoney(dto.amount, '예산 조정액'));

    const override = await this.prisma.budgetOverride.upsert({
      where: {
        budgetId_year_month: {
          budgetId: dto.budgetId,
          year: dto.year,
          month: dto.month,
        },
      },
      update: { amount },
      create: {
        budgetId: dto.budgetId,
        year: dto.year,
        month: dto.month,
        amount,
      },
    });

    return this.toOverrideResponse(override, show);
  }

  async deleteOverride(id: string, userId: string): Promise<void> {
    const override = await this.prisma.budgetOverride.findUnique({
      where: { id },
      include: { budget: true },
    });

    if (!override) {
      throw new NotFoundException('오버라이드를 찾을 수 없습니다.');
    }
    await this.projectAccess.verifyUserHasAccessToProject(
      userId,
      override.budget.projectId,
      'editor',
    );

    await this.prisma.budgetOverride.delete({
      where: { id },
    });
  }

  /**
   * 표시 통화 <-> 저장 통화.
   *
   * 예산액은 저장 통화로 보관한다. 사용자는 화면의 표시 통화로 입력하므로 저장할
   * 때 저장 통화로 옮기고, 보여줄 때 다시 표시 통화로 옮긴다. 표시 통화를 바꿔도
   * 저장값은 그대로다.
   */
  private async currencyView(projectId: string) {
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(projectId);
    const show = await this.exchangeRates.getDisplayConverter(projectId, ledger, display);
    const store = await this.exchangeRates.getDisplayConverter(projectId, display, ledger);
    return { show, store };
  }

  private toBudgetResponse(budget: any, show?: DisplayConverter): BudgetDto.Response {
    return {
      id: budget.id,
      projectId: budget.projectId,
      categoryId: budget.categoryId || undefined,
      type: budget.type || undefined,
      // 금액은 문자열로 내보낸다 (정밀도 손실 방지). 저장 통화 -> 표시 통화.
      monthlyAmount: show
        ? show.toString(budget.monthlyAmount)
        : budget.monthlyAmount.toString(),
      effectiveFrom: budget.effectiveFrom || undefined,
      effectiveTo: budget.effectiveTo || undefined,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }

  private toOverrideResponse(
    override: any,
    show?: DisplayConverter,
  ): BudgetDto.OverrideResponse {
    return {
      id: override.id,
      budgetId: override.budgetId,
      year: override.year,
      month: override.month,
      amount: show ? show.toString(override.amount) : override.amount.toString(),
      createdAt: override.createdAt.toISOString(),
    };
  }

  private isBudgetApplicable(budget: any, yearMonth: string): boolean {
    const from = budget.effectiveFrom || '2000-01';
    const to = budget.effectiveTo || '9999-12';
    return yearMonth >= from && yearMonth <= to;
  }

  private getPreviousMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split('-');
    let prevMonth = parseInt(month) - 1;
    let prevYear = parseInt(year);

    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear--;
    }

    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  }
}
