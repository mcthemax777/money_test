/**
 * 프로젝트 이용권 권한.
 *
 * 결제(또는 관리자 지급) 한 건을 `ProjectPlanGrant` 한 줄로 적고, 지금 상태는 줄들에서
 * 계산한다(`planStatusOf`). 스토어 웹훅(BillingWebhookService)과 관리 도구가 `grant`·`revoke`
 * 를 부른다. 관리 도구의 지급은 `adminGrant` 다 -- Play 결제일을 함께 미룬다.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, ProjectPlanGrant } from '@prisma/client';
import {
  addPlanMonths,
  chainEndOf,
  DAY_MS,
  FREE_PLAN_STATUS,
  MAX_ADMIN_GRANT_DAYS,
  PLAN_GRANT_DAYS,
  planOf,
  planStatusOf,
  type AdminPlanGrantResult,
  type AdminPlanProjectDto,
  type AdminProjectPlanDto,
  type PlanGrantDto,
  type PlanGrantPlan,
  type PlanGrantSource,
  type ProjectPlanStatus,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { StoreBillingService } from './store-billing.service';

export interface GrantInput {
  projectId: string;
  /** `days` 는 관리자 지급만 쓴다. 그때 `days` 칸에 날 수를 넣는다. */
  plan: PlanGrantPlan;
  days?: number;
  source: PlanGrantSource;
  /** 결제한 사람. 관리자 지급이면 null. */
  userId: string | null;
  /** 스토어 주문 번호·PG 결제 번호. 관리자 지급이면 null. */
  externalId: string | null;
  /** 실제로 낸 금액(원). */
  amount: number;
  note?: string | null;
  /**
   * 스토어가 정한 기간. `google_play` 는 반드시 넘긴다 -- 갱신·유예 기간을 스토어가 정하므로
   * 서버가 개월을 더해 만든 날과 어긋난다. 다른 출처는 넘기지 않는다(서버가 이어 붙인다).
   */
  window?: { startsAt: Date; endsAt: Date | null };
}

export interface AdminGrantInput {
  projectId: string;
  plan: PlanGrantPlan;
  days?: number;
  note?: string | null;
  /** false 면 Play 구독이 이어지는 중이어도 결제일을 미루지 않는다(이미 해지한 구독). 기본은 미룬다. */
  deferStoreBilling?: boolean;
}

/**
 * Play 결제일을 미루는 동안 권한 쓰기 잠금을 잡고 있다. Prisma 의 대화형 트랜잭션 기본
 * 시한(5초)으로는 RevenueCat 의 답을 다 기다리지 못한다.
 */
const ADMIN_GRANT_TX_TIMEOUT_MS = 30_000;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    /** 없으면(스모크 스크립트) Play 구독 중인 프로젝트에는 결제일을 미루지 않고는 주지 못한다. */
    @Optional() private readonly store?: StoreBillingService,
  ) {}

  /** 프로젝트들의 지금 이용권. 권한 줄이 없는 프로젝트는 무료다. */
  async statusMap(projectIds: string[], now = new Date()): Promise<Map<string, ProjectPlanStatus>> {
    const result = new Map<string, ProjectPlanStatus>(
      projectIds.map((projectId) => [projectId, FREE_PLAN_STATUS]),
    );
    if (projectIds.length === 0) return result;

    const grants = await this.prisma.projectPlanGrant.findMany({
      where: { projectId: { in: projectIds }, revokedAt: null },
      select: { projectId: true, startsAt: true, endsAt: true, revokedAt: true },
    });

    const byProject = new Map<string, typeof grants>();
    for (const grant of grants) {
      // where 가 projectId 로 걸렀으므로 null 은 오지 않는다.
      const list = byProject.get(grant.projectId!) ?? [];
      list.push(grant);
      byProject.set(grant.projectId!, list);
    }
    for (const [projectId, list] of byProject) {
      result.set(projectId, planStatusOf(list, now));
    }
    return result;
  }

  async statusOf(projectId: string, now = new Date()): Promise<ProjectPlanStatus> {
    return (await this.statusMap([projectId], now)).get(projectId) ?? FREE_PLAN_STATUS;
  }

  /** 한 프로젝트의 권한 줄 전부. 취소한 줄도 보인다. 오래된 것이 먼저다. */
  async listGrants(projectId: string): Promise<PlanGrantDto[]> {
    const grants = await this.prisma.projectPlanGrant.findMany({
      where: { projectId },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    });
    return grants.map(toDto);
  }

  /** 관리 도구의 한 프로젝트 이용권. 없는 프로젝트면 404 -- 빈 목록이면 "무료"와 구별되지 않는다. */
  async adminProjectPlan(projectId: string, now = new Date()): Promise<AdminProjectPlanDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('프로젝트가 없습니다.');

    const [status, grants] = await Promise.all([this.statusOf(projectId, now), this.listGrants(projectId)]);
    return { status, grants };
  }

  /**
   * 관리 도구의 프로젝트 찾기. 이름의 일부, 참여 키, id, 소유자 이메일의 일부로 찾는다.
   * 빈 말이면 최근에 만든 것부터 보인다.
   */
  async adminSearchProjects(query: string | undefined, now = new Date()): Promise<AdminPlanProjectDto[]> {
    const q = (query ?? '').trim();
    const projects = await this.prisma.project.findMany({
      where: q
        ? {
            OR: [
              { id: q },
              { projectKey: q.toUpperCase() },
              { name: { contains: q, mode: 'insensitive' } },
              {
                members: {
                  some: { role: 'owner', user: { email: { contains: q, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        projectKey: true,
        createdAt: true,
        members: { where: { role: 'owner' }, select: { user: { select: { email: true } } } },
      },
    });

    const plans = await this.statusMap(projects.map((project) => project.id), now);
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      projectKey: project.projectKey,
      createdAt: project.createdAt.toISOString(),
      ownerEmail: project.members[0]?.user.email ?? null,
      plan: plans.get(project.id)!,
    }));
  }

  /**
   * 권한 한 줄을 적는다.
   *
   * - 같은 `source`·`externalId` 가 이미 있으면 새로 적지 않고 그 줄을 돌려준다. 웹훅은
   *   같은 알림을 여러 번 보낼 수 있다. 다른 프로젝트의 줄이면 잘못 온 알림이라 막는다.
   * - 기간제는 지금 이어지는 기간의 끝에서 시작한다. 쓰던 기간을 잃지 않게.
   * - 평생 이용권이 있어도 적는다. 돈은 이미 받았으므로 기록은 남아야 한다 -- 사지 못하게
   *   막는 일은 결제 앞에서 한다.
   */
  async grant(input: GrantInput, now = new Date()): Promise<PlanGrantDto> {
    validateGrant(input);

    return this.prisma.$transaction(async (tx) => {
      await lockPlanWrites(tx, input.projectId);

      if (input.externalId !== null) {
        const existing = await tx.projectPlanGrant.findUnique({
          where: { source_externalId: { source: input.source, externalId: input.externalId } },
        });
        if (existing) {
          if (existing.projectId !== input.projectId) {
            throw new ConflictException('이 결제 번호는 다른 프로젝트에 적혀 있습니다.');
          }
          return toDto(existing);
        }
      }

      await requireProject(tx, input.projectId);
      const window = input.window ?? nextWindow(input, await liveGrantsOf(tx, input.projectId), now);
      return toDto(await createGrant(tx, input, window, now));
    });
  }

  /**
   * 관리자 지급 (보상·시험, 금액 0). 개월(이용권 종류)이나 날 수로 준다.
   *
   * **Play 구독과 겹치지 않게.** 지급은 지금 이어지는 기간의 끝에 붙는데, Play 구독이 이어지는
   * 중이면 Google 은 원래 결제일에 그대로 결제하고 그 갱신이 지급한 기간을 덮는다 -- 준 날이
   * 사라진다. 그래서 구독이 이어지는 중이면 다음 결제일을 이 줄의 끝으로 미룬 뒤 적는다.
   * 미루지 못하면 적지 않고 알린다. 사용자가 이미 해지해 미룰 결제가 없으면
   * `deferStoreBilling: false` 로 미루지 않고 준다.
   *
   * 평생 이용권이 있는 프로젝트에는 주지 않는다. 돈을 받은 것이 아니라 적어 둘 까닭이 없고,
   * 실수로 누른 것일 가능성이 크다.
   */
  async adminGrant(input: AdminGrantInput, now = new Date()): Promise<AdminPlanGrantResult> {
    const base: GrantInput = {
      projectId: input.projectId,
      plan: input.plan,
      days: input.days,
      source: 'admin',
      userId: null,
      externalId: null,
      amount: 0,
      note: input.note?.trim() || null,
    };
    validateGrant(base);
    const defer = input.deferStoreBilling !== false;

    return this.prisma.$transaction(
      async (tx) => {
        await lockPlanWrites(tx, input.projectId);
        await requireProject(tx, input.projectId);

        const live = await liveGrantsOf(tx, input.projectId);
        if (planStatusOf(live, now).kind === 'lifetime') {
          throw new BadRequestException('이미 평생 이용권이 있는 프로젝트입니다.');
        }
        const window = nextWindow(base, live, now);

        // 이어지는 Play 구독. 끝이 지났으면 갱신되지 않은(해지·결제 실패) 구독이라 미룰 결제가 없다.
        const playRenewing = live.some(
          (grant) => grant.source === 'google_play' && grant.endsAt !== null && grant.endsAt > now,
        );
        let deferredTo: Date | null = null;
        if (playRenewing && defer) {
          if (window.endsAt === null) {
            throw new BadRequestException(
              'Play 구독이 이어지는 중이라 평생을 주어도 구독 결제가 계속됩니다. 사용자가 구독을 해지했으면 "Play 결제일 미루기"를 끄고 주세요.',
            );
          }
          if (!this.store) {
            throw new ServiceUnavailableException('Play 결제일을 미룰 수 없는 서버입니다.');
          }
          await this.store.deferPlaySubscription(input.projectId, window.endsAt);
          deferredTo = window.endsAt;
        }

        const note = [base.note, deferredTo ? `Play 결제일 ${deferredTo.toISOString().slice(0, 10)}(UTC)로 미룸` : null]
          .filter(Boolean)
          .join(' · ');
        const created = await createGrant(tx, { ...base, note: note || null }, window, now);
        return { grant: toDto(created), storeDeferredTo: deferredTo?.toISOString() ?? null };
      },
      { timeout: ADMIN_GRANT_TX_TIMEOUT_MS },
    );
  }

  /**
   * 권한을 거둔다 (환불, 관리자 회수).
   *
   * 줄은 지우지 않고 `revokedAt` 을 적는다. 거둔 줄 뒤에 이어 붙어 있던 기간제는 앞으로
   * 당긴다 -- 그대로 두면 거둔 기간만큼 빈 날이 생겨 그 사이에 무료로 떨어진다. 스토어
   * 결제는 기간을 스토어가 정하므로 당기지 않는다.
   */
  async revoke(grantId: string, reason: string, now = new Date()): Promise<PlanGrantDto> {
    // 잠글 이름(프로젝트)을 알려고 한 번 읽는다. 판단은 잠근 뒤에 다시 읽은 값으로 한다 --
    // 같은 환불 알림이 두 번 오면 둘 다 "아직 안 거뒀다"를 보고 들어온다.
    const located = await this.prisma.projectPlanGrant.findUnique({
      where: { id: grantId },
      select: { projectId: true },
    });
    if (!located) throw new NotFoundException('권한 줄이 없습니다.');

    return this.prisma.$transaction(async (tx) => {
      if (located.projectId) await lockPlanWrites(tx, located.projectId);

      const target = await tx.projectPlanGrant.findUnique({ where: { id: grantId } });
      if (!target) throw new NotFoundException('권한 줄이 없습니다.');
      if (target.revokedAt) throw new BadRequestException('이미 거둔 권한입니다.');

      const revoked = await tx.projectPlanGrant.update({
        where: { id: grantId },
        data: { revokedAt: now, revokeReason: reason || null },
      });

      // 프로젝트가 지워졌거나 평생 이용권이면 뒤에 당길 것이 없다.
      if (!target.projectId || target.endsAt === null) return toDto(revoked);

      await this.rechain(tx, target.projectId, target.startsAt);
      return toDto(revoked);
    });
  }

  /**
   * 스토어 결제 줄 찾기. 결제 번호의 앞부분(`거래번호@`)으로 찾는다 -- 같은 구독의 갱신은
   * 거래번호가 같을 수 있어 열쇠 뒤에 산 시각을 붙여 두었다(`BillingWebhookService`).
   * 오래된 것이 먼저다.
   */
  async findStoreGrants(source: PlanGrantSource, externalIdPrefix: string): Promise<ProjectPlanGrant[]> {
    return this.prisma.projectPlanGrant.findMany({
      where: { source, externalId: { startsWith: externalIdPrefix } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * 스토어가 기간을 바꿨다(끝을 앞당기거나 미뤘다). 그 줄의 끝만 고친다.
   * 평생 줄(endsAt null)은 고치지 않는다.
   */
  async setEndsAt(grantId: string, endsAt: Date): Promise<void> {
    await this.prisma.projectPlanGrant.updateMany({
      where: { id: grantId, endsAt: { not: null } },
      data: { endsAt },
    });
  }

  /** 환불이 되돌려졌다. 거둔 줄을 다시 살린다. 스토어 결제 줄만 쓴다(당길 기간이 없다). */
  async unrevoke(grantId: string): Promise<void> {
    await this.prisma.projectPlanGrant.updateMany({
      where: { id: grantId, revokedAt: { not: null } },
      data: { revokedAt: null, revokeReason: null },
    });
  }

  /**
   * `from` 이후에 시작하는 서버 계산 기간제를 산 차례대로 다시 이어 붙인다.
   *
   * 각 줄은 "산 시각에 이어지던 기간의 끝"에서 시작한다. 산 시각보다 앞으로는 당기지
   * 않는다 -- 사기 전 날짜를 쓴 것으로 칠 수는 없다.
   */
  private async rechain(tx: Prisma.TransactionClient, projectId: string, from: Date): Promise<void> {
    const live = await tx.projectPlanGrant.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const movable = live.filter(
      (grant) => grant.source !== 'google_play' && grant.endsAt !== null && grant.startsAt >= from,
    );
    const settled = live.filter((grant) => !movable.includes(grant));

    for (const grant of movable) {
      const startsAt = chainEndOf(settled, grant.createdAt);
      // 날 수 줄은 처음 준 날 수를 그대로 옮긴다.
      const days =
        grant.plan === PLAN_GRANT_DAYS
          ? Math.round((grant.endsAt!.getTime() - grant.startsAt.getTime()) / DAY_MS)
          : undefined;
      const endsAt = periodEndOf(grant.plan, startsAt, days);
      // movable 은 endsAt 이 있는 줄만 골랐다. 평생이 나오면 표와 줄이 어긋난 것이다.
      if (endsAt === null) throw new Error(`기간제 줄의 이용권이 평생입니다: ${grant.id}`);
      settled.push({ ...grant, startsAt, endsAt });

      if (startsAt.getTime() !== grant.startsAt.getTime() || endsAt.getTime() !== grant.endsAt!.getTime()) {
        await tx.projectPlanGrant.update({ where: { id: grant.id }, data: { startsAt, endsAt } });
      }
    }
  }
}

/**
 * 한 프로젝트의 권한 쓰기를 줄 세운다. 트랜잭션의 첫 문장이어야 한다.
 *
 * 두 결제가 같은 순간에 오면 둘 다 같은 "기간의 끝"을 읽고 같은 날부터 시작해 한 장이
 * 사라진다. 원장 쓰기 잠금(ledger-lock)과는 이름을 달리한다 -- 결제가 거래 저장을 기다릴
 * 까닭이 없다.
 */
async function lockPlanWrites(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan-write:${projectId}`}))`;
}

function liveGrantsOf(tx: Prisma.TransactionClient, projectId: string) {
  return tx.projectPlanGrant.findMany({
    where: { projectId, revokedAt: null },
    select: { source: true, startsAt: true, endsAt: true, revokedAt: true },
  });
}

/** 넣은 값 검사. 잠그기 전에 한다. */
function validateGrant(input: GrantInput): void {
  if (input.plan === PLAN_GRANT_DAYS) {
    if (input.source !== 'admin') throw new BadRequestException('날 수로는 관리자만 줍니다.');
    if (!Number.isInteger(input.days) || input.days! < 1 || input.days! > MAX_ADMIN_GRANT_DAYS) {
      throw new BadRequestException(`날 수는 1~${MAX_ADMIN_GRANT_DAYS} 사이의 정수여야 합니다.`);
    }
  } else if (input.days !== undefined) {
    throw new BadRequestException('날 수는 이용권 종류가 days 일 때만 넘깁니다.');
  }
  if (input.source === 'google_play' && !input.window) {
    throw new BadRequestException('스토어 결제는 스토어가 정한 기간이 있어야 합니다.');
  }
  if (input.source !== 'google_play' && input.window) {
    throw new BadRequestException('기간은 스토어 결제만 넘깁니다.');
  }
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    throw new BadRequestException('금액은 0 이상의 정수(원)여야 합니다.');
  }
}

async function requireProject(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new NotFoundException('프로젝트가 없습니다.');
}

/** 이 줄이 `startsAt` 에서 시작하면 끝나는 때. 평생이면 null. */
function periodEndOf(plan: PlanGrantPlan, startsAt: Date, days: number | undefined): Date | null {
  if (plan === PLAN_GRANT_DAYS) return new Date(startsAt.getTime() + days! * DAY_MS);
  const months = planOf(plan).months;
  return months === null ? null : addPlanMonths(startsAt, months);
}

/** 서버가 계산하는 기간. 평생은 지금부터, 기간제는 지금 이어지는 기간의 끝에서 시작한다. */
function nextWindow(
  input: GrantInput,
  live: Awaited<ReturnType<typeof liveGrantsOf>>,
  now: Date,
): { startsAt: Date; endsAt: Date | null } {
  if (input.plan !== PLAN_GRANT_DAYS && planOf(input.plan).months === null) {
    return { startsAt: now, endsAt: null };
  }
  const startsAt = chainEndOf(live, now);
  return { startsAt, endsAt: periodEndOf(input.plan, startsAt, input.days) };
}

function createGrant(
  tx: Prisma.TransactionClient,
  input: GrantInput,
  window: { startsAt: Date; endsAt: Date | null },
  now: Date,
): Promise<ProjectPlanGrant> {
  return tx.projectPlanGrant.create({
    data: {
      projectId: input.projectId,
      userId: input.userId,
      plan: input.plan,
      source: input.source,
      externalId: input.externalId,
      amount: input.amount,
      note: input.note ?? null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      // 산 시각. 거둔 뒤 다시 이어 붙일 때 이보다 앞으로 당기지 않는 기준이라, 기간을
      // 계산한 그 now 와 같아야 한다.
      createdAt: now,
    },
  });
}

function toDto(grant: ProjectPlanGrant): PlanGrantDto {
  return {
    id: grant.id,
    projectId: grant.projectId,
    userId: grant.userId,
    plan: grant.plan,
    source: grant.source,
    externalId: grant.externalId,
    amount: grant.amount,
    currency: grant.currency,
    startsAt: grant.startsAt.toISOString(),
    endsAt: grant.endsAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokeReason: grant.revokeReason,
    note: grant.note,
    createdAt: grant.createdAt.toISOString(),
  };
}
