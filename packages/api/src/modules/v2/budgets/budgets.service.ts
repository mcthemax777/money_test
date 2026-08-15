import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { BudgetDto } from '@money/types';

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

    // 카테고리 확인 (있으면)
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });

      if (!category || category.projectId !== projectId || category.userId !== userId) {
        throw new NotFoundException('유효한 카테고리가 아닙니다.');
      }
    }

    const budget = await this.prisma.budget.create({
      data: {
        projectId,
        userId,
        categoryId: dto.categoryId || null,
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

    if (!budget || budget.userId !== userId) {
      throw new NotFoundException('예산을 찾을 수 없습니다.');
    }

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
          userId: budget.userId,
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

    // 1. 직접 오버라이드된 예산 확인
    const overrides = await this.prisma.budgetOverride.findMany({
      where: {
        budget: { projectId, userId },
        year,
        month,
      },
      include: { budget: { include: { category: true } } },
    });

    const overrideMap = new Map<string, BudgetDto.MonthlyBudget>();
    for (const override of overrides) {
      overrideMap.set(override.budgetId, {
        budgetId: override.budgetId,
        categoryId: override.budget.categoryId || undefined,
        categoryName: override.budget.category?.name,
        monthlyAmount: override.amount,
        isOverridden: true,
      });
    }

    // 2. 기본 규칙 조회
    const budgets = await this.prisma.budget.findMany({
      where: { projectId, userId },
      include: { category: true },
    });

    const result: BudgetDto.MonthlyBudget[] = [];

    for (const budget of budgets) {
      // 오버라이드가 있으면 그것 사용
      if (overrideMap.has(budget.id)) {
        result.push(overrideMap.get(budget.id)!);
        continue;
      }

      // 기본 규칙이 이 월에 적용되는지 확인
      if (this.isBudgetApplicable(budget, yearMonth)) {
        result.push({
          budgetId: budget.id,
          categoryId: budget.categoryId || undefined,
          categoryName: budget.category?.name,
          monthlyAmount: budget.monthlyAmount,
          isOverridden: false,
        });
      }
    }

    return result;
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

    if (!override || override.budget.userId !== userId) {
      throw new NotFoundException('오버라이드를 찾을 수 없습니다.');
    }

    await this.prisma.budgetOverride.delete({
      where: { id },
    });
  }

  private toBudgetResponse(budget: any): BudgetDto.Response {
    return {
      id: budget.id,
      projectId: budget.projectId,
      userId: budget.userId,
      categoryId: budget.categoryId || undefined,
      monthlyAmount: budget.monthlyAmount,
      effectiveFrom: budget.effectiveFrom || undefined,
      effectiveTo: budget.effectiveTo || undefined,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  private toOverrideResponse(override: any): BudgetDto.OverrideResponse {
    return {
      id: override.id,
      budgetId: override.budgetId,
      year: override.year,
      month: override.month,
      amount: override.amount,
      createdAt: override.createdAt,
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
