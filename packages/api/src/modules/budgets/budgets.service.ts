import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { BudgetDto } from '@money/types';

const ZERO = new Prisma.Decimal(0);

/** 내부 계산용. 응답으로 나갈 때 금액을 문자열로 바꾼다. */
type InternalBudgetRow = Omit<BudgetDto.MonthlyBudget, 'monthlyAmount' | 'usedAmount'> & {
  monthlyAmount: Prisma.Decimal;
  usedAmount: Prisma.Decimal;
};

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createBudget(
    userId: string,
    dto: BudgetDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<BudgetDto.Response> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
    );

    // 전체 예산 특수 처리: 특수 categoryId → categoryId: undefined + type 설정
    let categoryId: string | undefined = dto.categoryId;
    let type = dto.type;

    if (categoryId === 'BUDGET_TOTAL_INCOME') {
      categoryId = undefined;
      type = 'income';
    } else if (categoryId === 'BUDGET_TOTAL_EXPENSE') {
      categoryId = undefined;
      type = 'expense';
    }

    // 카테고리 확인
    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category || category.projectId !== projectId) {
        throw new NotFoundException('유효한 카테고리가 아닙니다.');
      }
    }

    // 같은 카테고리의 기존 예산 확인
    const existingBudget = await this.prisma.budget.findFirst({
      where: {
        projectId,
        categoryId: categoryId ?? null,
        type: type || undefined,
      },
    });

    // 기존 예산이 있으면 업데이트
    if (existingBudget) {
      return this.toBudgetResponse(
        await this.prisma.budget.update({
          where: { id: existingBudget.id },
          data: { monthlyAmount: dto.monthlyAmount },
        }),
      );
    }

    const budget = await this.prisma.budget.create({
      data: {
        projectId,
        categoryId: categoryId ?? null,
        type: type || undefined,
        monthlyAmount: dto.monthlyAmount,
      },
    });

    return this.toBudgetResponse(budget);
  }

  async getBudgets(
    userId: string,
    query: BudgetDto.ListQuery,
  ): Promise<BudgetDto.Response[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      query.projectId,
    );

    const where: any = { projectId, userId };
    if (query.categoryId) where.categoryId = query.categoryId;

    const budgets = await this.prisma.budget.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return budgets.map((b) => this.toBudgetResponse(b));
  }

  async getBudgetById(id: string, userId: string): Promise<BudgetDto.Response> {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
    });

    if (!budget) {
      throw new NotFoundException('예산을 찾을 수 없습니다.');
    }
    await this.projectAccess.verifyUserHasAccessToProject(userId, budget.projectId);

    return this.toBudgetResponse(budget);
  }

  async updateBudget(
    id: string,
    userId: string,
    dto: BudgetDto.UpdateRequest,
  ): Promise<BudgetDto.Response> {
    const budget = await this.getBudgetById(id, userId);

    if (!dto.monthlyAmount) {
      throw new BadRequestException('월 예산을 입력해주세요.');
    }

    if (dto.applyMode === 'from' && !dto.applyFromMonth) {
      throw new BadRequestException('적용 시작 월을 입력해주세요.');
    }

    // applyMode='all': 기본 규칙만 수정
    if (!dto.applyMode || dto.applyMode === 'all') {
      const updated = await this.prisma.budget.update({
        where: { id },
        data: { monthlyAmount: dto.monthlyAmount },
      });
      return this.toBudgetResponse(updated);
    }

    // applyMode='from': 새 규칙 생성 + 기존 규칙의 effectiveTo 설정
    if (dto.applyMode === 'from') {
      const beforeMonth = this.getPreviousMonth(dto.applyFromMonth!);

      // 기존 규칙의 effectiveTo 설정
      await this.prisma.budget.update({
        where: { id },
        data: { effectiveTo: beforeMonth },
      });

      // 새 규칙 생성
      const newBudget = await this.prisma.budget.create({
        data: {
          projectId: budget.projectId,
          categoryId: budget.categoryId,
          monthlyAmount: dto.monthlyAmount,
          effectiveFrom: dto.applyFromMonth,
        },
      });

      return this.toBudgetResponse(newBudget);
    }

    throw new BadRequestException('applyMode가 잘못되었습니다.');
  }

  async deleteBudget(id: string, userId: string): Promise<void> {
    const budget = await this.getBudgetById(id, userId);

    await this.prisma.budget.delete({
      where: { id },
    });
  }

  async getBudgetForMonth(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): Promise<BudgetDto.MonthlyBudget[]> {
    await this.projectAccess.verifyUserHasAccessToProject(userId, projectId);

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

    const overrideMap = new Map<string, Prisma.Decimal>();
    for (const override of overrides) {
      overrideMap.set(override.budgetId, override.amount);
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
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const usage = await this.prisma.posting.groupBy({
      by: ['categoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        categoryId: { in: categories.map((c) => c.id) },
        entry: { projectId, date: { gte: startDate, lt: endDate } },
      },
    });

    // 수입 posting은 음수로 기록되므로 표시용으로 절댓값을 쓴다.
    const ownAmount = new Map<string, Prisma.Decimal>();
    const ownCount = new Map<string, number>();
    for (const row of usage) {
      if (!row.categoryId) continue;
      ownAmount.set(row.categoryId, (row._sum.amount ?? ZERO).abs());
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
      return overrideMap.get(budget.id) ?? budget.monthlyAmount;
    };

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
        // 대분류 사용액의 합. 소분류는 이미 대분류에 롤업되어 있으므로 중복되지 않는다.
        usedAmount: categories
          .filter((c) => !c.parentId && c.type === type)
          .reduce((acc, c) => acc.add(usedAmount.get(c.id) ?? ZERO), ZERO),
        isOverridden: budget ? overrideMap.has(budget.id) : false,
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
        usedAmount: usedAmount.get(category.id) ?? ZERO,
        isOverridden: budget ? overrideMap.has(budget.id) : false,
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

    return ordered.map((row) => ({
      ...row,
      monthlyAmount: row.monthlyAmount.toString(),
      usedAmount: row.usedAmount.toString(),
    }));
  }

  async createOverride(
    userId: string,
    dto: BudgetDto.OverrideRequest,
  ): Promise<BudgetDto.OverrideResponse> {
    const budget = await this.getBudgetById(dto.budgetId, userId);

    const override = await this.prisma.budgetOverride.upsert({
      where: {
        budgetId_year_month: {
          budgetId: dto.budgetId,
          year: dto.year,
          month: dto.month,
        },
      },
      update: { amount: dto.amount },
      create: {
        budgetId: dto.budgetId,
        year: dto.year,
        month: dto.month,
        amount: dto.amount,
      },
    });

    return this.toOverrideResponse(override);
  }

  async deleteOverride(id: string, userId: string): Promise<void> {
    const override = await this.prisma.budgetOverride.findUnique({
      where: { id },
      include: { budget: true },
    });

    if (!override) {
      throw new NotFoundException('오버라이드를 찾을 수 없습니다.');
    }
    await this.projectAccess.verifyUserHasAccessToProject(userId, override.budget.projectId);

    await this.prisma.budgetOverride.delete({
      where: { id },
    });
  }

  private toBudgetResponse(budget: any): BudgetDto.Response {
    return {
      id: budget.id,
      projectId: budget.projectId,
      categoryId: budget.categoryId || undefined,
      type: budget.type || undefined,
      // 금액은 문자열로 내보낸다 (정밀도 손실 방지)
      monthlyAmount: budget.monthlyAmount.toString(),
      effectiveFrom: budget.effectiveFrom || undefined,
      effectiveTo: budget.effectiveTo || undefined,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }

  private toOverrideResponse(override: any): BudgetDto.OverrideResponse {
    return {
      id: override.id,
      budgetId: override.budgetId,
      year: override.year,
      month: override.month,
      amount: override.amount.toString(),
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
