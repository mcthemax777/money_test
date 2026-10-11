/**
 * 계정 삭제 (2026-10-10).
 *
 * 혼자 쓰는 가계부는 함께 지워지고, 다른 구성원이 있는 가계부의 소유자면 막히고, 참여만 한
 * 가계부에서는 빠진다. 결제 기록은 사람·가계부와의 연결만 끊고 남는다. 함께 지울 가계부의 Play
 * 구독은 먼저 해지하고, 해지하지 못하면(이미 해지한 것이 아니라면) 지우지 않는다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 */
import { AccountDeletionService } from '../src/modules/users/account-deletion.service';
import { PlansService } from '../src/modules/plans/plans.service';
import { runSmoke } from './smoke-harness';

runSmoke('account-deletion', async (ctx) => {
  // RevenueCat 대역. 해지 요청을 적고, 실패·고객 정보를 시험마다 바꾼다.
  const cancelled: string[] = [];
  let cancelFails = false;
  let stillRenewing = true;
  const store = {
    async cancelPlaySubscription(projectId: string, transactionId: string) {
      if (cancelFails) throw new Error('RevenueCat 거절(시험)');
      cancelled.push(`${projectId}/${transactionId}`);
    },
    async hasRenewingPlaySubscription() {
      return stillRenewing;
    },
  };
  const service = new AccountDeletionService(ctx.prisma as any, new PlansService(ctx.prisma as any), store as any);
  const me = await ctx.createUser();
  const other = await ctx.createUser();

  const solo = await ctx.createProject({ name: '혼자 쓰는 가계부' });
  const shared = await ctx.createProject({ name: '함께 쓰는 내 가계부' });
  const joined = await ctx.createProject({ name: '참여한 가계부' });
  await ctx.prisma.projectMember.createMany({
    data: [
      { projectId: solo.id, userId: me.id, role: 'owner' },
      { projectId: shared.id, userId: me.id, role: 'owner' },
      { projectId: shared.id, userId: other.id, role: 'editor' },
      { projectId: joined.id, userId: other.id, role: 'owner' },
      { projectId: joined.id, userId: me.id, role: 'editor' },
    ],
  });
  await ctx.prisma.user.update({ where: { id: me.id }, data: { defaultProjectId: solo.id } });

  const now = new Date();
  const grantIds: string[] = [];
  const grant = await ctx.prisma.projectPlanGrant.create({
    data: {
      projectId: solo.id,
      userId: me.id,
      plan: 'month1',
      source: 'google_play',
      externalId: `GPA.smoke-${process.pid}@1`,
      amount: 2900,
      startsAt: new Date(now.getTime() - 86_400_000),
      endsAt: new Date(now.getTime() + 20 * 86_400_000),
    },
  });
  grantIds.push(grant.id);
  // 내가 만든 초대 링크(외래 키가 막는다)와 사용자에 딸린 것들.
  const invitation = await ctx.prisma.projectInvitation.create({
    data: { projectId: joined.id, invitationCode: `smoke-${process.pid}`, invitedByUserId: me.id },
  });
  await ctx.prisma.pushDevice.create({ data: { userId: me.id, token: `smoke-token-${process.pid}`, platform: 'android' } });

  try {
    const preview = await service.preview(me.id, now);
    ctx.check('미리 보기: 함께 지워지는 가계부', preview.soloProjects.map((row) => row.name).join(), '혼자 쓰는 가계부');
    ctx.check('미리 보기: 구독 중임을 알린다', preview.soloProjects[0]?.hasRenewingSubscription, true);
    ctx.check('미리 보기: 막는 가계부', preview.sharedOwnedProjects.map((row) => row.name).join(), '함께 쓰는 내 가계부');
    ctx.check('미리 보기: 막는 가계부의 구성원 수', preview.sharedOwnedProjects[0]?.memberCount, 2);
    ctx.check('미리 보기: 참여한 가계부 수', preview.joinedProjectCount, 1);

    await ctx.expectReject('함께 쓰는 가계부의 소유자면 막는다', () => service.deleteAccount(me.id));
    ctx.check('막히면 구독을 해지하지 않는다', cancelled.length, 0);
    ctx.check('막히면 사용자가 남는다', (await ctx.prisma.user.count({ where: { id: me.id } })), 1);
    ctx.check('막히면 혼자 쓰는 가계부도 남는다', (await ctx.prisma.project.count({ where: { id: solo.id } })), 1);

    // 소유자를 넘기면 지울 수 있다.
    await ctx.prisma.projectMember.updateMany({ where: { projectId: shared.id, userId: other.id }, data: { role: 'owner' } });
    await ctx.prisma.projectMember.updateMany({ where: { projectId: shared.id, userId: me.id }, data: { role: 'editor' } });
    ctx.check('넘긴 뒤에는 막는 것이 없다', (await service.preview(me.id, now)).sharedOwnedProjects.length, 0);

    // 해지가 거절되고 아직 갱신될 구독이 남았으면 지우지 않는다.
    cancelFails = true;
    stillRenewing = true;
    await ctx.expectReject('구독을 해지하지 못하면 지우지 않는다', () => service.deleteAccount(me.id));
    ctx.check('해지 실패면 사용자가 남는다', await ctx.prisma.user.count({ where: { id: me.id } }), 1);
    cancelFails = false;

    const versionBefore = (await ctx.prisma.project.findUniqueOrThrow({ where: { id: joined.id } })).syncVersion;
    await service.deleteAccount(me.id);
    ctx.check('혼자 쓰던 가계부의 구독을 마지막 거래 번호로 해지한다', cancelled.join(), `${solo.id}/GPA.smoke-${process.pid}`);

    ctx.check('사용자가 지워진다', await ctx.prisma.user.count({ where: { id: me.id } }), 0);
    ctx.check('혼자 쓰던 가계부가 지워진다', await ctx.prisma.project.count({ where: { id: solo.id } }), 0);
    ctx.check('함께 쓰던 가계부는 남는다', await ctx.prisma.project.count({ where: { id: shared.id } }), 1);
    ctx.check('참여한 가계부는 남는다', await ctx.prisma.project.count({ where: { id: joined.id } }), 1);
    ctx.check('구성원에서 빠진다', await ctx.prisma.projectMember.count({ where: { userId: me.id } }), 0);
    ctx.check('다른 구성원은 그대로', await ctx.prisma.projectMember.count({ where: { userId: other.id } }), 2);
    ctx.check('내가 만든 초대 링크가 지워진다', await ctx.prisma.projectInvitation.count({ where: { id: invitation.id } }), 0);
    ctx.check('푸시 기기가 지워진다', await ctx.prisma.pushDevice.count({ where: { userId: me.id } }), 0);
    const kept = await ctx.prisma.projectPlanGrant.findUnique({ where: { id: grant.id } });
    ctx.check('결제 기록은 남는다', kept !== null, true);
    ctx.check('결제 기록의 사람 연결은 끊긴다', kept?.userId ?? null, null);
    ctx.check('결제 기록의 가계부 연결은 끊긴다', kept?.projectId ?? null, null);
    const versionAfter = (await ctx.prisma.project.findUniqueOrThrow({ where: { id: joined.id } })).syncVersion;
    ctx.check('참여한 가계부의 번호가 올라 다른 구성원이 따라온다', versionAfter > versionBefore, true);
    await ctx.expectReject('지운 계정을 다시 지우면 거부', () => service.deleteAccount(me.id));

    // 사용자가 이미 Play 스토어에서 해지했으면 해지 요청이 거절되어도 지운다.
    const already = await ctx.createUser();
    const alreadyProject = await ctx.createProject({ name: '이미 해지한 가계부' });
    await ctx.prisma.projectMember.create({ data: { projectId: alreadyProject.id, userId: already.id, role: 'owner' } });
    grantIds.push(
      (
        await ctx.prisma.projectPlanGrant.create({
          data: {
            projectId: alreadyProject.id,
            plan: 'month1',
            source: 'google_play',
            externalId: `GPA.smoke-already-${process.pid}@1`,
            amount: 2900,
            startsAt: new Date(now.getTime() - 86_400_000),
            endsAt: new Date(now.getTime() + 20 * 86_400_000),
          },
        })
      ).id,
    );
    cancelFails = true;
    stillRenewing = false;
    await service.deleteAccount(already.id);
    ctx.check('이미 해지한 구독이면 그대로 지운다', await ctx.prisma.user.count({ where: { id: already.id } }), 0);
  } finally {
    // 결제 기록은 가계부를 지워도 남으므로 검사가 만든 것을 직접 치운다.
    await ctx.prisma.projectPlanGrant.deleteMany({ where: { id: { in: grantIds } } });
  }
});
