/**
 * 프로젝트 이용권 권한.
 *
 * 결제(또는 관리자 지급) 한 건을 `ProjectPlanGrant` 한 줄로 적고, 지금 상태는 줄들에서
 * 계산한다(`planStatusOf`). 결제가 붙으면 스토어·PG 웹훅이 `grant`·`revoke` 를 부른다.
 * 지금은 관리 도구만 부른다.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ProjectPlanGrant } from '@prisma/client';
import {
  addPlanMonths,
  chainEndOf,
  FREE_PLAN_STATUS,
  planOf,
  planStatusOf,
  type AdminPlanProjectDto,
  type AdminProjectPlanDto,
  type PlanGrantDto,
  type PlanGrantSource,
  type PlanId,
  type ProjectPlanStatus,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';

export interface GrantInput {
  projectId: string;
  plan: PlanId;
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

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

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
    const plan = planOf(input.plan);
    if (input.source === 'google_play' && !input.window) {
      throw new BadRequestException('스토어 결제는 스토어가 정한 기간이 있어야 합니다.');
    }
    if (input.source !== 'google_play' && input.window) {
      throw new BadRequestException('기간은 스토어 결제만 넘깁니다.');
    }
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      throw new BadRequestException('금액은 0 이상의 정수(원)여야 합니다.');
    }

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

      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('프로젝트가 없습니다.');

      let window = input.window;
      if (!window) {
        if (plan.months === null) {
          window = { startsAt: now, endsAt: null };
        } else {
          const live = await liveGrantsOf(tx, input.projectId);
          const startsAt = chainEndOf(live, now);
          window = { startsAt, endsAt: addPlanMonths(startsAt, plan.months) };
        }
      }

      const created = await tx.projectPlanGrant.create({
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
      return toDto(created);
    });
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
      const months = planOf(grant.plan).months;
      // movable 은 endsAt 이 있는 줄만 골랐으므로 개월이 있다. 없으면 표와 줄이 어긋난 것이다.
      if (months === null) throw new Error(`기간제 줄의 이용권이 평생입니다: ${grant.id}`);

      const startsAt = chainEndOf(settled, grant.createdAt);
      const endsAt = addPlanMonths(startsAt, months);
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
    select: { startsAt: true, endsAt: true, revokedAt: true },
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
