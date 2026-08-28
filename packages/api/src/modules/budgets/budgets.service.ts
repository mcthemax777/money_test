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
 * effectiveFrom/effectiveTo가 비어 있을 때 쓰는 양끝.
 *
 * 적용 기간 비교를 "YYYY-MM" 문자열로 하므로 열린 끝도 같은 형식의 값이어야
 * 한다. 기간을 끊는 쪽과 걸리는 달을 따지는 쪽이 다른 값을 쓰면, 규칙을 끊었는데
 * 여전히 걸리거나 그 반대가 된다.
 */
const BUDGET_MONTH_FLOOR = '2000-01';
const BUDGET_MONTH_CEILING = '9999-12';

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

    /*
     * applyMode='all': 이 규칙이 덮는 모든 달을 이 금액으로 만든다.
     *
     * 그 달만 따로 잡아 둔 값(BudgetOverride)도 함께 지운다. 남겨 두면 모든 달을
     * 바꿨는데 어떤 달만 옛 조정값으로 남아, 손댄 적 없는 금액이 튀어 보인다.
     */
    if (!dto.applyMode || dto.applyMode === 'all') {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.budgetOverride.deleteMany({ where: { budgetId: id } });
        return tx.budget.update({ where: { id }, data: { monthlyAmount } });
      });
      return this.toBudgetResponse(updated, show);
    }

    /*
     * applyMode='from': 그 달부터 끝까지를 이 금액으로 만든다.
     *
     * "8월부터"는 끝이 없는 말이다. 뒤에 남아 있던 규칙까지 걷어내야 한다.
     * 예전에는 고치던 규칙만 앞 달까지로 끊고 새 규칙을 만들어서, 9월부터
     * 20만원으로 나눠 둔 뒤에 8월부터 100만원으로 바꾸면 8월만 100만원이 되고
     * 9월부터는 20만원이 되살아났다.
     */
    if (dto.applyMode === 'from') {
      const applyFrom = assertYearMonth(dto.applyFromMonth!, '적용 시작 월');

      // 한 트랜잭션으로 묶는다. 걷어내기만 하고 새 규칙 생성이 실패하면
      // 그 달부터 예산이 통째로 사라진 상태로 남는다.
      const newBudget = await this.prisma.$transaction(async (tx) => {
        const siblings = await this.findSiblingBudgets(tx, budget);

        // 규칙을 걷어내기 전에 지운다. 걷어낸 뒤에는 어느 규칙의 것이었는지 알 수 없다.
        await this.clearOverridesFrom(tx, siblings, applyFrom);
        await this.clearFromMonth(tx, siblings, applyFrom);

        return tx.budget.create({
          data: {
            projectId: budget.projectId,
            categoryId: budget.categoryId ?? null,
            // type을 빠뜨리면 안 된다. 전체 예산(categoryId = null)은 type이
            // 유일한 구분자라, 없이 만들면 조회 맵의 키가 `__total__undefined`가
            // 되어 그 달부터 전체 예산 칸이 빈 값으로 보인다.
            type: budget.type,
            monthlyAmount,
            effectiveFrom: applyFrom,
          },
        });
      });

      return this.toBudgetResponse(newBudget, show);
    }

    throw new BadRequestException('applyMode가 잘못되었습니다.');
  }

  /**
   * 한 대상(분류 하나, 또는 전체 예산 하나)의 규칙 전부.
   *
   * 분류 예산은 categoryId로 갈린다. 전체 예산은 categoryId가 없으므로 type이
   * 유일한 구분자다(스키마 주석과 같은 규칙). 이 둘을 한 곳에서 뽑아야 "그 달부터"가
   * 어디까지 덮을지 판단하는 쪽과 조회하는 쪽이 같은 묶음을 본다.
   */
  private async findSiblingBudgets(
    tx: Prisma.TransactionClient,
    budget: { projectId: string; categoryId?: string; type?: 'income' | 'expense' },
  ) {
    const rows = await tx.budget.findMany({
      where: { projectId: budget.projectId, categoryId: budget.categoryId ?? null },
    });

    return budget.categoryId ? rows : rows.filter((row) => row.type === budget.type);
  }

  /**
   * applyFrom부터의 "그 달만 조정한 값"을 지운다.
   *
   * 여러 달을 한꺼번에 바꾸는 것은 그 구간을 새로 정하겠다는 말이다. 그 달만 따로
   * 잡아 둔 값이 남아 있으면, 8월부터 2000원으로 바꿨는데 10월만 옛 조정값으로 남아
   * 손댄 적 없는 금액이 튀어 보인다.
   *
   * 규칙을 지우면 딸린 조정값도 cascade로 사라지지만 그것만으로는 모자란다. 앞
   * 달까지로 끊기는 규칙은 살아남고, 그 뒤쪽 조정값이 데이터로 남아 있다가 나중에
   * 그 규칙을 다시 늘리면 되살아난다.
   *
   * applyFrom 앞의 달은 손대지 않는다. 그쪽 규칙과 조정은 그대로 남아야 한다.
   */
  private async clearOverridesFrom(
    tx: Prisma.TransactionClient,
    siblings: Array<{ id: string }>,
    applyFrom: string,
  ): Promise<void> {
    const [year, month] = applyFrom.split('-').map(Number);

    await tx.budgetOverride.deleteMany({
      where: {
        budgetId: { in: siblings.map((rule) => rule.id) },
        // year/month가 숫자 두 칸이라 "YYYY-MM" 비교를 그대로 쓸 수 없다.
        OR: [{ year: { gt: year } }, { year, month: { gte: month } }],
      },
    });
  }

  /**
   * applyFrom부터 끝까지를 비운다.
   *
   * 그 달 이후에 시작하는 규칙은 통째로 지우고, 그 달에 걸쳐 있는 규칙은 앞 달까지로
   * 끊는다. 그 달 앞에서 이미 끝난 규칙은 건드리지 않는다 (effectiveTo를 뒤로 밀면
   * 없애려던 규칙이 오히려 늘어난다).
   *
   * 조정값은 여기서 다루지 않는다. 지워지는 규칙의 것은 cascade로 함께 사라지지만
   * 끊기는 규칙의 것은 남으므로, 호출부가 `clearOverridesFrom`을 따로 불러야 한다.
   */
  private async clearFromMonth(
    tx: Prisma.TransactionClient,
    siblings: Array<{ id: string; effectiveFrom: string | null; effectiveTo: string | null }>,
    applyFrom: string,
  ): Promise<void> {
    const beforeMonth = this.getPreviousMonth(applyFrom);

    for (const rule of siblings) {
      if ((rule.effectiveFrom || BUDGET_MONTH_FLOOR) >= applyFrom) {
        await tx.budget.delete({ where: { id: rule.id } });
        continue;
      }

      if ((rule.effectiveTo || BUDGET_MONTH_CEILING) >= applyFrom) {
        await tx.budget.update({ where: { id: rule.id }, data: { effectiveTo: beforeMonth } });
      }
    }
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

  /**
   * 예산 규칙을 없앤다.
   *
   * fromMonth를 주면 그 달부터 끝까지를 없앤다. 이전 달의 예산은 그대로 남는다.
   * 뒤에 나뉘어 있던 다른 규칙도 함께 걷어낸다. 남겨 두면 없앤 줄 알았던 예산이
   * 몇 달 뒤부터 되살아난다.
   *
   * "그 달부터 예산 없음"은 "0원 예산"과 다르다. 0원 예산은 진행률이 늘 초과로
   * 보이지만, 예산 없음은 진행률 칸 자체가 사라진다.
   */
  async deleteBudget(id: string, userId: string, fromMonth?: string): Promise<void> {
    const budget = await this.getBudgetById(id, userId, 'editor');

    if (fromMonth) {
      const applyFrom = assertYearMonth(fromMonth, '적용 시작 월');

      await this.prisma.$transaction(async (tx) => {
        const siblings = await this.findSiblingBudgets(tx, budget);
        await this.clearFromMonth(tx, siblings, applyFrom);
      });
      return;
    }

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
        // 일반/과소비 필터. 목록·리포트와 같은 기준이어야 진행률이 화면과 맞는다.
        ...(parsed.extra !== undefined
          ? { extraAmount: parsed.extra ? { gt: 0 } : { equals: 0 } }
          : {}),
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
    const from = budget.effectiveFrom || BUDGET_MONTH_FLOOR;
    const to = budget.effectiveTo || BUDGET_MONTH_CEILING;
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
