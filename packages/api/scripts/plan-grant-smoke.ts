/**
 * 프로젝트 이용권 권한 (2026-10-09).
 *
 * 기간제는 이어 붙고, 평생이 이기고, 거두면 뒤의 기간이 당겨지고, 같은 결제 번호는 한
 * 줄만 남는다. 달 끝 날은 그 달 마지막 날로 내린다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 */
import { addPlanMonths } from '@money/types';

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
