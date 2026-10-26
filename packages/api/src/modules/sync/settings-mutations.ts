/**
 * 예산·환율·가계부·반복 등록 명령의 재생 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 모두 온라인 설정 화면과 같은 서비스로 흘려보낸다. 여기서 정하는 것은 이미 있거나 없을 때의
 * 답과, 시계가 진 칸을 걸러 내는 병합뿐이다. Nest 공급자가 아니라 재생 서비스가 자기 의존성으로
 * 만들어 쓴다 (mutation-claim.ts 머리말).
 */
import {
  type BudgetDeletePayload,
  type BudgetOverridePayload,
  type BudgetSetFromPayload,
  type BudgetSetPayload,
  type ExchangeRateClearPayload,
  type ExchangeRateSetPayload,
  type Mutation,
  type MutationResult,
  type ProjectUpdatePayload,
  type RecurringCreatePayload,
  type RecurringDeletePayload,
  type RecurringUpdatePayload,
  mergeFields,
  recurringClockOf,
  zonedParts,
} from '@money/types';
import type { PrismaService } from '@/config/prisma.service';
import type { ProjectAccessService } from '@/common/project-access.guard';
import { readFieldClocks } from '@/common/field-clock';
import { toMoney } from '@/common/money';
import type { BudgetsService } from '../budgets/budgets.service';
import type { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { ProjectsService } from '../projects/projects.service';
import type { RecurringService } from '../entry-drafts/recurring.service';
import { allFieldsLost, appliedResult, sameOrForeign, targetNotFound } from './mutation-results';

export class SettingsMutations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly budgets: BudgetsService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly projects: ProjectsService,
    private readonly recurring: RecurringService,
  ) {}

  /**
   * 예산 한 줄을 정한다. 없으면 만들고, 있으면 금액만 바꾼다.
   *
   * 구간 편집(applyMode='from')은 여기로 오지 않는다. 그 사이 달라진 규칙들 위에서 다시
   * 계산되는 조작이라 재생하면 결과가 달라진다 -- 온라인에서만 한다 (D12).
   */
  async setBudget(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetSetPayload;

    const existing = await this.prisma.budget.findUnique({ where: { id: payload.id } });
    if (existing && existing.projectId !== projectId) {
      return sameOrForeign(mutation, existing.projectId, projectId, '예산');
    }

    const target = {
      categoryId: payload.categoryId ?? undefined,
      tagId: payload.tagId ?? undefined,
      type: payload.type ?? undefined,
      /*
       * 어느 달의 규칙을 고칠지. 없으면 서버가 재생하는 오늘이 속한 달이다.
       *
       * 예산은 구간으로 나뉠 수 있어 한 분류에 규칙이 여럿일 수 있다. 이 값이 없으면
       * 8월 화면에서 고친 금액이 9월 규칙에 적힌다.
       */
      yearMonth: payload.yearMonth,
    };

    /*
     * 이 id 가 아직 없으면 같은 자리의 규칙부터 찾는다.
     *
     * 두 기기가 끊긴 채 같은 예산을 각자 새로 정하면 id 가 다르다. 찾지 않고 만들기로
     * 넘기면 서비스가 내용으로 찾아 시계 없이 덮는다 -- 늦게 도착한 옛 값이 이긴다.
     * 찾았으면 그 규칙과 시계를 견주고, 기기에는 별칭으로 그 id 를 알려 준다. 알리지
     * 않으면 기기 사본에 서버에 없는 규칙이 하나 더 남는다.
     */
    const rule = existing ?? (await this.budgets.findRuleFor(projectId, target as never));
    const alias = rule && rule.id !== payload.id ? { from: payload.id, to: rule.id } : undefined;

    if (!rule) {
      const made = await this.budgets.createBudget(
        userId,
        { id: payload.id, monthlyAmount: payload.monthlyAmount, ...target } as never,
        projectId,
        mutation.hlc,
      );
      // 찾은 뒤 다른 요청이 먼저 만들었으면 서비스가 그 규칙을 고친다. 그 id 를 알린다.
      return {
        ...(await appliedResult(this.prisma, mutation, projectId)),
        ...(made.id !== payload.id ? { alias: { from: payload.id, to: made.id } } : {}),
      };
    }

    const merged = mergeFields(
      { monthlyAmount: payload.monthlyAmount },
      mutation.hlc,
      readFieldClocks(rule.fieldHlc),
    );
    if (Object.keys(merged.apply).length === 0) {
      return { ...allFieldsLost(mutation, merged.lost), ...(alias ? { alias } : {}) };
    }

    await this.budgets.updateBudget(
      rule.id,
      userId,
      { monthlyAmount: payload.monthlyAmount, applyMode: 'all' } as never,
      mutation.hlc,
    );
    return { ...(await appliedResult(this.prisma, mutation, projectId)), ...(alias ? { alias } : {}) };
  }

  /**
   * "고른 달부터"를 대상으로 다시 계산한다 (`BudgetsService.setBudgetFrom`). 끊긴 동안 다른 기기가
   * 그 달 이후를 고쳤다면 이 명령이 덮는다 -- 받아들인 규칙이다 (BudgetSetFromPayload 머리말).
   * 새 규칙 id 가 이미 있으면(재전송) 다시 만들지 않는다.
   */
  async setBudgetFrom(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetSetFromPayload;
    const existing = await this.prisma.budget.findUnique({ where: { id: payload.ruleId } });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '예산');
    await this.budgets.setBudgetFrom(userId, projectId, payload, mutation.hlc);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 예산 규칙 하나를 지운다. 이미 없으면 할 일이 없다 -- 다른 기기가 먼저 지웠거나 구간
   * 편집으로 사라진 것이다. 그것을 실패로 돌리면 기기가 없는 줄을 두고 계속 다시 보낸다.
   */
  async deleteBudget(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetDeletePayload;

    const existing = await this.prisma.budget.findUnique({ where: { id: payload.id } });
    if (existing && existing.projectId !== projectId) return targetNotFound(mutation, '예산');
    if (existing) await this.budgets.deleteBudget(payload.id, userId);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 그 달만 다른 금액으로. 없으면 만들고, 값이 없으면 지운다.
   *
   * 키가 (예산, 년, 월)이라 다른 달을 고친 두 편집은 서로 다른 행이다 -- 애초에 다툴 일이
   * 없다. 같은 달을 고친 것끼리만 시계로 가른다.
   */
  async setOverride(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetOverridePayload;

    const budget = await this.prisma.budget.findUnique({ where: { id: payload.budgetId } });
    if (!budget || budget.projectId !== projectId) return targetNotFound(mutation, '예산');

    const existing = await this.prisma.budgetOverride.findUnique({
      where: {
        budgetId_year_month: {
          budgetId: payload.budgetId,
          year: payload.year,
          month: payload.month,
        },
      },
    });

    if (existing) {
      const merged = mergeFields(
        { amount: payload.amount ?? null },
        mutation.hlc,
        readFieldClocks(existing.fieldHlc),
      );
      if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);
    }

    if (payload.amount == null) {
      if (existing) await this.budgets.deleteOverride(existing.id, userId);
      return appliedResult(this.prisma, mutation, projectId);
    }

    await this.budgets.createOverride(
      userId,
      {
        id: payload.id,
        budgetId: payload.budgetId,
        year: payload.year,
        month: payload.month,
        amount: payload.amount,
      } as never,
      mutation.hlc,
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 환율 한 쌍을 직접 정한다. 온라인 설정 화면(`PUT /exchange-rates`)과 같은 규칙으로 **재생하는
   * 날의** 줄에 적는다 -- 같은 날 다시 넣으면 덮고, 목록은 날짜가 늦은 줄을 쓴다.
   * 권한(editor)은 push 입구에서 이미 보았다.
   */
  async setExchangeRate(projectId: string, mutation: Mutation): Promise<MutationResult> {
    const payload = mutation.payload as ExchangeRateSetPayload;
    const timeZone = await this.projectAccess.getProjectTimeZone(projectId);
    const today = zonedParts(new Date(), timeZone);
    await this.exchangeRates.setRate(
      projectId,
      this.exchangeRates.assertCurrency(payload.from, '기준 통화'),
      this.exchangeRates.assertCurrency(payload.to, '대상 통화'),
      toMoney(payload.rate, '환율'),
      new Date(Date.UTC(today.year, today.month - 1, today.day)),
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  /** 직접 정한 환율을 지운다 (그 쌍의 줄 전부). 이미 없으면 그대로 끝난다. */
  async clearExchangeRate(projectId: string, mutation: Mutation): Promise<MutationResult> {
    const payload = mutation.payload as ExchangeRateClearPayload;
    await this.exchangeRates.clearRate(
      projectId,
      this.exchangeRates.assertCurrency(payload.from, '기준 통화'),
      this.exchangeRates.assertCurrency(payload.to, '대상 통화'),
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 가계부 이름·설명·표시 통화. 온라인과 같은 서비스라 **주인만** 된다(주인이 아니면 거절).
   * 기준 타임존은 싣지 않는다 -- 온라인 전용으로 남긴 값이다. 명령은 push 한 가계부의 것만
   * 고친다(짐의 id 가 다르면 남의 가계부를 고칠 뻔한 것이라 거절).
   */
  async updateProject(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as ProjectUpdatePayload;
    if (payload.id !== projectId) return targetNotFound(mutation, '가계부');
    await this.projects.updateProject(projectId, userId, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.displayCurrency !== undefined ? { displayCurrency: payload.displayCurrency } : {}),
    } as never);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 반복 등록 만들기. 온라인과 같은 서비스다 -- 같은 검사를 하고, 밀린 회차의 후보를 곧바로
   * 만든다(그 후보는 다음 pull 로 기기에 간다). 같은 id 가 이미 있으면 재전송이다.
   */
  async createRecurring(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as RecurringCreatePayload;
    const existing = await this.prisma.recurringRule.findUnique({ where: { id: payload.id } });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '반복 등록');
    await this.recurring.create(userId, payload as never, projectId, mutation.hlc);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 반복 등록 고치기. 바꾼 칸만 온다 -- 서버가 지금 규칙에 합쳐 검사한다. 없으면 거절이다.
   *
   * 다른 설정처럼 이긴 칸만 적는다. 일정 칸들과 결제 칸들은 시계 하나를 나눠 써서 함께
   * 이기고 함께 진다 (`recurringClockOf`). 전부 지면 충돌이다 (D6).
   */
  async updateRecurring(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const { id, ...patch } = mutation.payload as RecurringUpdatePayload;
    const existing = await this.prisma.recurringRule.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) return targetNotFound(mutation, '반복 등록');

    const merged = mergeFields(
      patch,
      mutation.hlc,
      readFieldClocks(existing.fieldHlc),
      recurringClockOf,
    );
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    await this.recurring.update(id, userId, merged.apply as never, mutation.hlc);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /** 반복 등록 지우기. 이미 없으면 끝난 것이다. 만들어진 후보는 남는다(서비스 규칙). */
  async deleteRecurring(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const { id } = mutation.payload as RecurringDeletePayload;
    const existing = await this.prisma.recurringRule.findUnique({ where: { id } });
    if (!existing) return appliedResult(this.prisma, mutation, projectId);
    if (existing.projectId !== projectId) return targetNotFound(mutation, '반복 등록');
    await this.recurring.remove(id, userId);
    return appliedResult(this.prisma, mutation, projectId);
  }
}
