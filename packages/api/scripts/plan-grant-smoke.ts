/**
 * 프로젝트 이용권 권한 (2026-10-09).
 *
 * 기간제는 이어 붙고, 평생이 이기고, 거두면 뒤의 기간이 당겨지고, 같은 결제 번호는 한
 * 줄만 남는다. 달 끝 날은 그 달 마지막 날로 내린다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 */
import { addPlanMonths, DAY_MS } from '@money/types';

import { PlansService } from '../src/modules/plans/plans.service';
import { runSmoke } from './smoke-harness';

runSmoke('plan-grant', async (ctx) => {
  const plans = new PlansService(ctx.prisma as any);
  const t0 = new Date('2026-01-31T03:00:00.000Z');
  const day = (date: Date | string | null) => (date ? new Date(date).toISOString().slice(0, 10) : null);

  // 달 끝 날
  ctx.check('1월 31일 + 1개월', day(addPlanMonths(t0, 1)), '2026-02-28');
  ctx.check('2024-01-31 + 1개월(윤년)', day(addPlanMonths(new Date('2024-01-31T00:00:00Z'), 1)), '2024-02-29');
  ctx.check('11월 30일 + 3개월', day(addPlanMonths(new Date('2026-11-30T00:00:00Z'), 3)), '2027-02-28');

  const project = await ctx.createProject();
  const admin = (plan: 'month1' | 'month3' | 'lifetime', now: Date) =>
    plans.grant({ projectId: project.id, plan, source: 'admin', userId: null, externalId: null, amount: 0 }, now);

  ctx.check('줄이 없으면 무료', (await plans.statusOf(project.id, t0)).kind, 'free');

  // 이어 붙이기: 1개월 뒤에 3개월을 사면 1개월이 끝나는 날부터 시작한다.
  const first = await admin('month1', t0);
  const second = await admin('month3', new Date('2026-02-10T00:00:00Z'));
  ctx.check('첫 장 끝', day(first.endsAt), '2026-02-28');
  ctx.check('둘째 장은 첫 장 끝에서 시작', day(second.startsAt), '2026-02-28');
  ctx.check('둘째 장 끝', day(second.endsAt), '2026-05-28');

  const mid = new Date('2026-03-15T00:00:00Z');
  const status = await plans.statusOf(project.id, mid);
  ctx.check('이어 산 기간 안은 기간제', status.kind, 'period');
  ctx.check('끝은 이어진 기간의 끝', day(status.endsAt), '2026-05-28');
  ctx.check('끝난 뒤는 무료', (await plans.statusOf(project.id, new Date('2026-06-01T00:00:00Z'))).kind, 'free');

  // 거두기: 첫 장을 거두면 둘째 장은 산 시각(2/10)으로 당겨진다.
  await plans.revoke(first.id, '환불', new Date('2026-02-11T00:00:00Z'));
  const pulled = (await plans.listGrants(project.id)).find((grant) => grant.id === second.id)!;
  ctx.check('거둔 뒤 둘째 장 시작은 산 날', day(pulled.startsAt), '2026-02-10');
  ctx.check('거둔 뒤 둘째 장 끝', day(pulled.endsAt), '2026-05-10');
  await ctx.expectReject('두 번 거두기', () => plans.revoke(first.id, '환불'));

  // 평생이 이긴다.
  await admin('lifetime', mid);
  const lifetime = await plans.statusOf(project.id, mid);
  ctx.check('평생이 기간제를 이긴다', lifetime.kind, 'lifetime');
  ctx.check('평생은 끝이 없다', lifetime.endsAt, null);
  ctx.check('평생은 기간이 지나도 평생', (await plans.statusOf(project.id, new Date('2030-01-01T00:00:00Z'))).kind, 'lifetime');

  // 같은 결제 번호는 한 줄만.
  const other = await ctx.createProject();
  const user = await ctx.createUser();
  const web = (projectId: string) =>
    plans.grant(
      { projectId, plan: 'month1', source: 'web', userId: user.id, externalId: 'pg-123', amount: 2900 },
      t0,
    );
  const once = await web(other.id);
  const twice = await web(other.id);
  ctx.check('같은 결제 번호는 같은 줄', twice.id, once.id);
  ctx.check('줄은 하나', (await plans.listGrants(other.id)).length, 1);
  await ctx.expectReject('다른 프로젝트에 같은 결제 번호', () => web(project.id));

  // 입력 검사
  await ctx.expectReject('스토어 결제에 기간이 없다', () =>
    plans.grant({ projectId: other.id, plan: 'month1', source: 'google_play', userId: null, externalId: 'gp-1', amount: 2900 }),
  );
  await ctx.expectReject('음수 금액', () =>
    plans.grant({ projectId: other.id, plan: 'month1', source: 'web', userId: null, externalId: 'pg-neg', amount: -1 }),
  );
  await ctx.expectReject('없는 프로젝트', () =>
    plans.grant({ projectId: 'no-such-project', plan: 'month1', source: 'admin', userId: null, externalId: null, amount: 0 }),
  );

  // 프로젝트 목록 한 번에
  const map = await plans.statusMap([project.id, other.id, 'no-such-project'], mid);
  ctx.check('목록: 평생', map.get(project.id)?.kind, 'lifetime');
  ctx.check('목록: 끝난 기간제는 무료', map.get(other.id)?.kind, 'free');
  ctx.check('목록: 줄 없는 id 는 무료', map.get('no-such-project')?.kind, 'free');

  // 날 수 지급 (관리자). Play 구독이 없으면 결제일을 미루지 않는다.
  const daysProject = await ctx.createProject();
  const dayGrant = await plans.adminGrant({ projectId: daysProject.id, plan: 'days', days: 3 }, t0);
  ctx.check('날 수: 지금부터', dayGrant.grant.startsAt, t0.toISOString());
  ctx.check('날 수: 3일 뒤 끝', dayGrant.grant.endsAt, new Date(t0.getTime() + 3 * DAY_MS).toISOString());
  ctx.check('날 수: 구독이 없으면 미루지 않는다', dayGrant.storeDeferredTo, null);
  ctx.check('날 수: 기간제', (await plans.statusOf(daysProject.id, t0)).kind, 'period');
  for (const [label, days] of [['0일', 0], ['366일', 366], ['1.5일', 1.5], ['날 수 없음', undefined]] as const) {
    await ctx.expectReject(`날 수 검사: ${label}`, () =>
      plans.adminGrant({ projectId: daysProject.id, plan: 'days', days }, t0),
    );
  }
  await ctx.expectReject('개월 이용권에 날 수', () =>
    plans.adminGrant({ projectId: daysProject.id, plan: 'month1', days: 3 }, t0),
  );

  // 이용권이 바뀌면 프로젝트 번호가 올라 기기가 목록을 다시 받는다.
  const versionOf = async (id: string) =>
    (await ctx.prisma.project.findUniqueOrThrow({ where: { id }, select: { syncVersion: true } })).syncVersion;
  const v0 = await versionOf(daysProject.id);
  const signalled = await plans.adminGrant({ projectId: daysProject.id, plan: 'days', days: 1 }, t0);
  const v1 = await versionOf(daysProject.id);
  ctx.check('지급하면 번호가 오른다', v1 > v0, true);
  await plans.revoke(signalled.grant.id, '시험', t0);
  ctx.check('거두면 번호가 오른다', (await versionOf(daysProject.id)) > v1, true);
  const v2 = await versionOf(daysProject.id);
  await plans.setEndsAt(dayGrant.grant.id, new Date(t0.getTime() + 4 * DAY_MS));
  ctx.check('끝을 고치면 번호가 오른다', (await versionOf(daysProject.id)) > v2, true);
  const v3 = await versionOf(daysProject.id);
  await plans.unrevoke(dayGrant.grant.id);
  ctx.check('살릴 것이 없으면 번호는 그대로', await versionOf(daysProject.id), v3);

  // 날 수 줄도 거두면 당겨지고, 날 수는 그대로다.
  const pullProject = await ctx.createProject();
  const month = await plans.adminGrant({ projectId: pullProject.id, plan: 'month1' }, t0);
  const later = new Date('2026-02-05T00:00:00Z');
  const tail = await plans.adminGrant({ projectId: pullProject.id, plan: 'days', days: 5 }, later);
  ctx.check('날 수 줄은 이어 붙는다', day(tail.grant.startsAt), '2026-02-28');
  await plans.revoke(month.grant.id, '시험', later);
  const pulledDays = (await plans.listGrants(pullProject.id)).find((grant) => grant.id === tail.grant.id)!;
  ctx.check('거둔 뒤 날 수 줄은 준 날로', pulledDays.startsAt, later.toISOString());
  ctx.check('거둔 뒤에도 5일', pulledDays.endsAt, new Date(later.getTime() + 5 * DAY_MS).toISOString());

  // Play 구독이 이어지는 중이면 결제일을 지급한 끝으로 미룬다.
  const deferred: Array<{ projectId: string; expiresAt: string }> = [];
  let storeFails = false;
  const store = {
    async deferPlaySubscription(projectId: string, expiresAt: Date) {
      if (storeFails) throw new Error('RevenueCat 거절(시험)');
      deferred.push({ projectId, expiresAt: expiresAt.toISOString() });
    },
  };
  const withStore = new PlansService(ctx.prisma as any, store as any);
  const playProject = await ctx.createProject();
  const playNow = new Date('2026-03-10T00:00:00Z');
  const playEnd = new Date('2026-03-20T00:00:00Z');
  await withStore.grant({
    projectId: playProject.id,
    plan: 'month1',
    source: 'google_play',
    userId: null,
    externalId: 'gp-smoke@1',
    amount: 2900,
    window: { startsAt: new Date('2026-02-20T00:00:00Z'), endsAt: playEnd },
  });
  const extra = await withStore.adminGrant({ projectId: playProject.id, plan: 'days', days: 7, note: '보상' }, playNow);
  const expectedEnd = new Date(playEnd.getTime() + 7 * DAY_MS).toISOString();
  ctx.check('Play: 지급은 구독 끝에서 시작', extra.grant.startsAt, playEnd.toISOString());
  ctx.check(
    'Play: 결제일을 지급 끝으로 미룬다',
    JSON.stringify(deferred),
    JSON.stringify([{ projectId: playProject.id, expiresAt: expectedEnd }]),
  );
  ctx.check('Play: 미룬 날을 알린다', extra.storeDeferredTo, expectedEnd);
  ctx.check('Play: 메모에 미룬 것을 남긴다', extra.grant.note, '보상 · Play 결제일 2026-03-27(UTC)로 미룸');

  const monthExtra = await withStore.adminGrant({ projectId: playProject.id, plan: 'month1' }, playNow);
  ctx.check('Play: 개월 지급도 미룬다', deferred[1]?.expiresAt, monthExtra.grant.endsAt);

  storeFails = true;
  const before = (await plans.listGrants(playProject.id)).length;
  await ctx.expectReject('Play: 미루지 못하면 주지 않는다', () =>
    withStore.adminGrant({ projectId: playProject.id, plan: 'days', days: 1 }, playNow),
  );
  ctx.check('Play: 실패하면 줄이 없다', (await plans.listGrants(playProject.id)).length, before);
  const noDefer = await withStore.adminGrant(
    { projectId: playProject.id, plan: 'days', days: 1, deferStoreBilling: false },
    playNow,
  );
  ctx.check('Play: 미루기를 끄면 그냥 준다', noDefer.storeDeferredTo, null);
  storeFails = false;

  await ctx.expectReject('Play: 구독 중에 평생은 막는다', () =>
    withStore.adminGrant({ projectId: playProject.id, plan: 'lifetime' }, playNow),
  );
  await ctx.expectReject('Play: 미룰 수단이 없으면 막는다', () =>
    plans.adminGrant({ projectId: playProject.id, plan: 'days', days: 1 }, playNow),
  );
  const afterPlay = await plans.adminGrant(
    { projectId: playProject.id, plan: 'days', days: 1 },
    new Date('2026-03-21T00:00:00Z'),
  );
  ctx.check('Play: 구독이 끝난 뒤에는 미루지 않는다', afterPlay.storeDeferredTo, null);
  await ctx.expectReject('평생 프로젝트에는 주지 않는다', () =>
    plans.adminGrant({ projectId: project.id, plan: 'days', days: 1 }, mid),
  );

  // 프로젝트를 지워도 결제 기록은 남는다.
  const doomed = await ctx.prisma.project.create({ data: { name: 'plan-grant 지울 것' } });
  const kept = await plans.grant(
    { projectId: doomed.id, plan: 'month1', source: 'web', userId: user.id, externalId: 'pg-kept', amount: 2900 },
    t0,
  );
  await ctx.prisma.project.delete({ where: { id: doomed.id } });
  const orphan = await ctx.prisma.projectPlanGrant.findUnique({ where: { id: kept.id } });
  ctx.check('프로젝트를 지워도 줄은 남는다', orphan !== null, true);
  ctx.check('남은 줄의 프로젝트는 비었다', orphan?.projectId ?? null, null);
  await ctx.prisma.projectPlanGrant.delete({ where: { id: kept.id } });
});
