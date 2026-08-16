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

      if (!category || category.projectId !== projectId || category.userId !== userId) {
        throw new NotFoundException('유효한 카테고리가 아닙니다.');
      }
    }

    // 같은 카테고리의 기존 예산 확인
    const existingBudget = await this.prisma.budget.findFirst({
      where: {
        projectId,
        userId,
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
        userId,
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

    // 1. 모든 카테고리 가져오기
    const categories = await this.prisma.category.findMany({
      where: { projectId, userId },
    });

    // 2. 예산 정보 가져오기
    const budgets = await this.prisma.budget.findMany({
      where: { projectId, userId },
      include: { category: true },
    });

    // 3. 오버라이드 정보 가져오기
    const overrides = await this.prisma.budgetOverride.findMany({
      where: {
        budget: { projectId, userId },
        year,
        month,
      },
      include: { budget: true },
    });

    // 4. 맵 생성: 예산 정보 (categoryId 또는 type => budget)
    const budgetMap = new Map<string | null, any>();
    for (const budget of budgets) {
      if (this.isBudgetApplicable(budget, yearMonth)) {
        // categoryId가 없으면 type을 키로 사용 (전체 예산 구분)
        const key = budget.categoryId || `__total__${budget.type}`;
        budgetMap.set(key, budget);
      }
    }

    // 오버라이드 맵 (budgetId => amount)
    const overrideMap = new Map<string, number>();
    for (const override of overrides) {
      overrideMap.set(override.budgetId, override.amount);
    }

    // 5. 부모-자식 관계 맵 생성
    const childCategoriesByParent = new Map<string, any[]>();
    for (const category of categories) {
      if (category.parentId) {
        if (!childCategoriesByParent.has(category.parentId)) {
          childCategoriesByParent.set(category.parentId, []);
        }
        childCategoriesByParent.get(category.parentId)!.push(category);
      }
    }

    // 6. 거래 정보 기반 사용금액 및 사용량 계산
    const categoryIds = categories.map(c => c.id);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    endDate.setMilliseconds(endDate.getMilliseconds() - 1);

    // 대분류별 사용금액 (지출: expense, credit_usage)
    const mainCategoryExpense = await this.prisma.transaction.groupBy({
      by: ['mainCategoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        projectId,
        userId,
        mainCategoryId: { in: categoryIds.filter(id => id) },
        date: { gte: startDate, lte: endDate },
        type: { in: ['expense', 'credit_usage'] },
      },
    });

    // 소분류별 사용금액 (지출: expense, credit_usage)
    const subCategoryExpense = await this.prisma.transaction.groupBy({
      by: ['subCategoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        projectId,
        userId,
        subCategoryId: { in: categoryIds.filter(id => id) },
        date: { gte: startDate, lte: endDate },
        type: { in: ['expense', 'credit_usage'] },
      },
    });

    // 대분류별 수입 (income)
    const mainCategoryIncome = await this.prisma.transaction.groupBy({
      by: ['mainCategoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        projectId,
        userId,
        mainCategoryId: { in: categoryIds.filter(id => id) },
        date: { gte: startDate, lte: endDate },
        type: 'income',
      },
    });

    // 소분류별 수입 (income)
    const subCategoryIncome = await this.prisma.transaction.groupBy({
      by: ['subCategoryId'],
      _sum: { amount: true },
      _count: true,
      where: {
        projectId,
        userId,
        subCategoryId: { in: categoryIds.filter(id => id) },
        date: { gte: startDate, lte: endDate },
        type: 'income',
      },
    });

    const usageCountMap = new Map<string, number>();
    const usedAmountMap = new Map<string, number>();

    // 지출 데이터 (expense, credit_usage)
    for (const item of mainCategoryExpense) {
      if (item.mainCategoryId) {
        usageCountMap.set(item.mainCategoryId, (item._count as number) || 0);
        usedAmountMap.set(item.mainCategoryId, Math.abs(item._sum?.amount || 0));
      }
    }
    for (const item of subCategoryExpense) {
      if (item.subCategoryId) {
        usageCountMap.set(item.subCategoryId, (item._count as number) || 0);
        usedAmountMap.set(item.subCategoryId, Math.abs(item._sum?.amount || 0));
      }
    }

    // 수입 데이터 (income)
    for (const item of mainCategoryIncome) {
      if (item.mainCategoryId) {
        usageCountMap.set(item.mainCategoryId, (item._count as number) || 0);
        usedAmountMap.set(item.mainCategoryId, Math.abs(item._sum?.amount || 0));
      }
    }
    for (const item of subCategoryIncome) {
      if (item.subCategoryId) {
        usageCountMap.set(item.subCategoryId, (item._count as number) || 0);
        usedAmountMap.set(item.subCategoryId, Math.abs(item._sum?.amount || 0));
      }
    }

    // 7. 결과 생성
    const result: BudgetDto.MonthlyBudget[] = [];

    // 전체 지출 예산 (없으면 placeholder로 생성)
    const totalExpenseBudget = budgetMap.get('__total__expense');
    const expenseMonthlyAmount = totalExpenseBudget
      ? (overrideMap.get(totalExpenseBudget.id) || totalExpenseBudget.monthlyAmount)
      : 0;

    result.push({
      budgetId: totalExpenseBudget?.id || 'placeholder-total-expense',
      categoryId: undefined,
      categoryName: '전체 지출',
      categoryType: 'expense',
      parentCategoryId: undefined,
      monthlyAmount: expenseMonthlyAmount,
      usedAmount: 0,
      isOverridden: totalExpenseBudget ? overrideMap.has(totalExpenseBudget.id) : false,
      hasChildren: childCategoriesByParent.size > 0,
    });

    // 전체 수입 예산 (없으면 placeholder로 생성)
    const totalIncomeBudget = budgetMap.get('__total__income');
    const incomeMonthlyAmount = totalIncomeBudget
      ? (overrideMap.get(totalIncomeBudget.id) || totalIncomeBudget.monthlyAmount)
      : 0;

    result.push({
      budgetId: totalIncomeBudget?.id || 'placeholder-total-income',
      categoryId: undefined,
      categoryName: '전체 수입',
      categoryType: 'income',
      parentCategoryId: undefined,
      monthlyAmount: incomeMonthlyAmount,
      usedAmount: 0,
      isOverridden: totalIncomeBudget ? overrideMap.has(totalIncomeBudget.id) : false,
      hasChildren: childCategoriesByParent.size > 0,
    });

    // 각 카테고리별 정보 (모든 카테고리 표시)
    for (const category of categories) {
      const budget = budgetMap.get(category.id);
      const monthlyAmount = overrideMap.get(budget?.id) || budget?.monthlyAmount || 0;
      const usedAmount = usedAmountMap.get(category.id) || 0;
      const categoryType = (category as any).type as 'income' | 'expense' | undefined;

      result.push({
        budgetId: budget?.id || `placeholder-${category.id}`,
        categoryId: category.id,
        categoryName: category.name,
        categoryType,
        monthlyAmount,
        usedAmount,
        parentCategoryId: category.parentId || undefined,
        hasChildren: childCategoriesByParent.has(category.id),
        isOverridden: budget ? overrideMap.has(budget.id) : false,
      });
    }

    // 8. 정렬: 대분류를 사용량 순으로, 소분류도 사용량 순으로 정렬
    const grouped = new Map<string, any[]>();
    const mainCategoryIds: string[] = [];
    let totalBudgetItem: any = null;

    // 전체예산 처리
    if (result[0] && !result[0].categoryId) {
      totalBudgetItem = result[0];
      grouped.set('total', [result[0]]);
    }

    // 대분류와 소분류 그룹화
    for (let i = result[0] && !result[0].categoryId ? 1 : 0; i < result.length; i++) {
      const item = result[i];
      if (!item.parentCategoryId) {
        // 대분류
        grouped.set(item.categoryId || '', [item]);
        mainCategoryIds.push(item.categoryId || '');
      } else {
        // 소분류
        const parentId = item.parentCategoryId;
        if (!grouped.has(parentId)) {
          grouped.set(parentId, []);
        }
        grouped.get(parentId)!.push(item);
      }
    }

    // 대분류를 사용량 순으로 정렬 (전체예산 제외)
    mainCategoryIds.sort((a, b) => {
      const aCount = usageCountMap.get(a) || 0;
      const bCount = usageCountMap.get(b) || 0;
      return bCount - aCount;
    });

    // 최종 결과 구성
    const finalResult: BudgetDto.MonthlyBudget[] = [];

    // 전체 지출과 전체 수입 처리
    const totalExpenseItem = result.find((item) => !item.categoryId && item.categoryType === 'expense');
    const totalIncomeItem = result.find((item) => !item.categoryId && item.categoryType === 'income');

    // 전체 지출 usedAmount 계산 (지출 대분류만)
    let totalExpenseUsedAmount = 0;
    for (const mainCategoryId of mainCategoryIds) {
      const items = grouped.get(mainCategoryId)!;
      const mainItem = items[0];
      if (mainItem.usedAmount && mainItem.categoryType === 'expense') {
        totalExpenseUsedAmount += mainItem.usedAmount;
      }
    }

    // 전체 수입 usedAmount 계산 (수입 대분류만)
    let totalIncomeUsedAmount = 0;
    for (const mainCategoryId of mainCategoryIds) {
      const items = grouped.get(mainCategoryId)!;
      const mainItem = items[0];
      if (mainItem.usedAmount && mainItem.categoryType === 'income') {
        totalIncomeUsedAmount += mainItem.usedAmount;
      }
    }

    // 전체 지출 추가
    if (totalExpenseItem) {
      totalExpenseItem.usedAmount = totalExpenseUsedAmount;
      finalResult.push(totalExpenseItem);
    }

    // 전체 수입 추가
    if (totalIncomeItem) {
      totalIncomeItem.usedAmount = totalIncomeUsedAmount;
      finalResult.push(totalIncomeItem);
    }

    // 대분류와 소분류 추가
    for (const mainCategoryId of mainCategoryIds) {
      const items = grouped.get(mainCategoryId)!;
      const mainItem = items[0];
      finalResult.push(mainItem);

      // 소분류 정렬해서 추가
      const children = items.slice(1);
      children.sort((a, b) => {
        const aCount = usageCountMap.get(a.categoryId || '') || 0;
        const bCount = usageCountMap.get(b.categoryId || '') || 0;
        return bCount - aCount;
      });
      finalResult.push(...children);
    }

    return finalResult;
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
