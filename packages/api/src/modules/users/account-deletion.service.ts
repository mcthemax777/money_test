/**
 * 계정 삭제. Play 정책(계정을 만들 수 있는 앱은 앱 안에서 지울 수 있어야 한다)과 사용자의 요청.
 *
 * 무엇이 어떻게 되는지는 `@money/types` 의 AccountDeletionPreview 주석이 정한다. 요약하면:
 *   - 혼자 쓰는 가계부는 함께 지운다.
 *   - 다른 구성원이 있는 가계부의 소유자면 막는다(ACCOUNT_OWNS_SHARED_PROJECTS).
 *   - 참여만 한 가계부에서는 빠진다. 내가 적은 거래는 가계부의 자료라 남고 입력자만 비운다.
 *   - 이용권 결제 기록은 남긴다(외래 키 SetNull).
 *   - 함께 지울 가계부에 Play 구독이 이어지는 중이면 먼저 해지한다. 구독은 사용자의 Google 계정에
 *     묶여 있어 우리 계정을 지워도 Google 은 계속 결제하는데, 갱신 알림이 가리키는 가계부는 이미
 *     없어 돈만 나가고 아무것도 주지 못한다. 해지는 다음 갱신만 막고 이미 낸 기간은 돌려주지
 *     않는다(2026-10-10 사용자 결정). 해지하지 못하면 지우지 않는다.
 * 알림 원문·문의·푸시 기기·가입 요청은 사용자와 함께 지워진다(외래 키 Cascade).
 *
 * 남은 토큰은 따로 끊지 않아도 된다. 토큰을 검사할 때마다 사용자가 있는지 본다
 * (AuthService.validateUser) -- 지운 뒤의 요청은 401 이다.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AccountDeletionPreview } from '@money/types';

import { conflict } from '@/common/app-error';
import { recordProjectWrite } from '@/common/project-write-context';
import { PrismaService } from '@/config/prisma.service';
import { PlansService } from '../plans/plans.service';
import { SubscriptionCancelService } from '../plans/subscription-cancel.service';

/** 큰 가계부를 지우면 연쇄 삭제가 길다. 대화형 트랜잭션 기본 시한(5초)으로는 모자란다. */
const DELETE_TX_TIMEOUT_MS = 60_000;

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionCancelService,
  ) {}

  /** 지우면 무엇이 사라지고, 무엇이 막는가. */
  async preview(userId: string, now = new Date()): Promise<AccountDeletionPreview> {
    const memberships = await membershipsOf(this.prisma, userId);
    const { solo, sharedOwned, joined } = classify(memberships);
    const renewing = new Set(
      (await this.plans.renewingStoreSubscriptions(solo.map((row) => row.projectId), now)).map(
        (subscription) => subscription.projectId,
      ),
    );

    return {
      soloProjects: solo.map((row) => ({
        id: row.projectId,
        name: row.project.name,
        hasRenewingSubscription: renewing.has(row.projectId),
      })),
      sharedOwnedProjects: sharedOwned.map((row) => ({
        id: row.projectId,
        name: row.project.name,
        memberCount: row.project._count.members,
      })),
      joinedProjectCount: joined.length,
    };
  }

  /**
   * 계정을 지운다. 막는 가계부가 있으면 아무것도 지우지 않고 409, 구독을 해지하지 못하면 502 다.
   *
   * 해지는 되돌릴 수 없는 바깥 일이라 막는 가계부부터 본 뒤에 한다. 지우는 트랜잭션이 다시 한 번
   * 보므로, 그 사이에 누가 들어와 막히면 구독만 해지된 채 계정이 남는다 -- 드물고, 구독은 낸
   * 기간까지 쓰므로 잃는 돈은 없다.
   */
  async deleteAccount(userId: string, now = new Date()): Promise<{ success: true }> {
    const { solo, sharedOwned } = classify(await membershipsOf(this.prisma, userId));
    if (sharedOwned.length > 0) throw sharedOwnedError(sharedOwned);
    // 함께 지울 가계부의 이어지는 Play 구독을 먼저 해지한다. 해지하지 못하면 지우지 않는다.
    await this.subscriptions.cancelRenewing(
      solo.map((row) => ({ id: row.projectId, name: row.project.name })),
      now,
    );

    const joinedIds = await this.prisma.$transaction(
      async (tx) => {
        // 확인과 삭제를 한 트랜잭션에 둔다. 그 사이 누가 혼자 쓰던 가계부에 들어오면 남의 자료까지 지운다.
        const memberships = await membershipsOf(tx, userId);
        const { solo, sharedOwned, joined } = classify(memberships);
        if (sharedOwned.length > 0) throw sharedOwnedError(sharedOwned);

        // 내가 만든 초대 링크. 외래 키에 연쇄 삭제가 없어 사용자를 지우지 못하게 막는다.
        await tx.projectInvitation.deleteMany({ where: { invitedByUserId: userId } });
        // 외래 키 없이 id 만 적어 둔 입력자 칸. 남의 가계부에 내 id 를 남기지 않는다(전표는 SetNull 이 비운다).
        await tx.entryDraft.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } });
        await tx.recurringRule.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } });

        await tx.project.deleteMany({ where: { id: { in: solo.map((row) => row.projectId) } } });
        await tx.user.delete({ where: { id: userId } });

        // 남은 가계부의 구성원 목록이 바뀌었다. 프로젝트 번호를 올려 다른 구성원의 화면이 따라오게 한다.
        const remaining = joined.map((row) => row.projectId);
        if (remaining.length > 0) {
          await tx.project.updateMany({ where: { id: { in: remaining } }, data: { updatedAt: new Date() } });
        }
        return remaining;
      },
      { timeout: DELETE_TX_TIMEOUT_MS },
    );

    for (const projectId of joinedIds) recordProjectWrite(projectId);
    this.logger.log(`계정 삭제 ${userId} (남은 참여 가계부 ${joinedIds.length})`);
    return { success: true };
  }

}

function sharedOwnedError(sharedOwned: Awaited<ReturnType<typeof membershipsOf>>) {
  return conflict(
    'ACCOUNT_OWNS_SHARED_PROJECTS',
    '다른 구성원이 있는 가계부의 소유자입니다. 소유자를 넘기거나 구성원을 내보낸 뒤 계정을 지워 주세요.',
    { projects: sharedOwned.map((row) => row.project.name).join(', ') },
  );
}

type Db = Pick<PrismaService, 'projectMember'>;

function membershipsOf(db: Db, userId: string) {
  return db.projectMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      projectId: true,
      role: true,
      project: { select: { name: true, _count: { select: { members: true } } } },
    },
  });
}

/**
 * 혼자 쓰는 것(구성원이 나 하나 -- 역할과 상관없이), 막는 것(내가 소유자이고 다른 구성원이
 * 있다), 참여만 한 것으로 나눈다.
 */
function classify(memberships: Awaited<ReturnType<typeof membershipsOf>>) {
  const solo = memberships.filter((row) => row.project._count.members === 1);
  const shared = memberships.filter((row) => row.project._count.members > 1);
  return {
    solo,
    sharedOwned: shared.filter((row) => row.role === 'owner'),
    joined: shared.filter((row) => row.role !== 'owner'),
  };
}
