/**
 * 소유자 넘기기 (2026-10-09).
 *
 * 넘기면 받은 사람은 소유자, 넘긴 사람은 편집자가 된다. 소유자가 아닌 사람, 본인에게,
 * 멤버가 아닌 사람에게는 넘기지 못하고, 막혔을 때는 두 줄 다 그대로다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 */
import { ExchangeRatesService } from '../src/modules/exchange-rates/exchange-rates.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { PlansService } from '../src/modules/plans/plans.service';
import { runSmoke } from './smoke-harness';

runSmoke('ownership-transfer', async (ctx) => {
  const projects = new ProjectsService(
    ctx.prisma as any,
    {} as any,
    new ExchangeRatesService(ctx.prisma as any),
    new PlansService(ctx.prisma as any),
    // 구독 해지는 이 검사의 관심이 아니다. 지울 가계부에 이어지는 구독이 없다.
    { cancelRenewing: async () => undefined } as any,
  );
  const project = await ctx.createProject();

  const join = async (role: 'owner' | 'editor' | 'viewer') => {
    const user = await ctx.createUser();
    await ctx.prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, role } });
    return user.id;
  };
  const owner = await join('owner');
  const editor = await join('editor');
  const viewer = await join('viewer');
  const stranger = (await ctx.createUser()).id;

  const roles = async () => {
    const rows = await ctx.prisma.projectMember.findMany({ where: { projectId: project.id } });
    return Object.fromEntries(rows.map((row) => [row.userId, row.role]));
  };
  const codeOf = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return 'ok';
    } catch (error: any) {
      const body = error?.getResponse?.();
      return (typeof body === 'object' && body?.code) || error?.constructor?.name || String(error);
    }
  };

  // ── 막히는 경우: 두 줄 다 그대로다 ─────────────────────────
  const before = await roles();
  ctx.check('편집자는 넘기지 못한다', await codeOf(() => projects.transferOwnership(project.id, viewer, editor)), 'PROJECT_OWNER_ONLY');
  ctx.check('본인에게는 넘기지 못한다', await codeOf(() => projects.transferOwnership(project.id, owner, owner)), 'CANNOT_TRANSFER_TO_SELF');
  ctx.check('멤버가 아닌 사람에게는 넘기지 못한다', await codeOf(() => projects.transferOwnership(project.id, stranger, owner)), 'NOT_PROJECT_MEMBER');
  ctx.check('멤버가 아닌 사람은 넘기지 못한다', await codeOf(() => projects.transferOwnership(project.id, viewer, stranger)), 'ForbiddenException');
  ctx.check('막히면 권한이 그대로다', JSON.stringify(await roles()), JSON.stringify(before));

  // ── 조회자에게 넘긴다 ──────────────────────────────────────
  const result = await projects.transferOwnership(project.id, viewer, owner);
  ctx.check('넘기기 성공', result.success, true);
  let now = await roles();
  ctx.check('받은 조회자는 소유자', now[viewer], 'owner');
  ctx.check('넘긴 사람은 편집자', now[owner], 'editor');
  ctx.check('다른 편집자는 그대로', now[editor], 'editor');
  ctx.check('소유자는 한 명', Object.values(now).filter((role) => role === 'owner').length, 1);

  // ── 옛 소유자는 더 넘기지 못하고, 새 소유자가 되돌린다 ────────
  ctx.check('옛 소유자는 다시 넘기지 못한다', await codeOf(() => projects.transferOwnership(project.id, editor, owner)), 'PROJECT_OWNER_ONLY');
  await projects.transferOwnership(project.id, owner, viewer);
  now = await roles();
  ctx.check('되돌리면 원래 소유자가 소유자', now[owner], 'owner');
  ctx.check('되돌려 준 사람은 편집자', now[viewer], 'editor');

  // ── 넘긴 뒤 옛 소유자는 탈퇴할 수 있다(마지막 소유자가 아니다) ──
  await projects.transferOwnership(project.id, editor, owner);
  ctx.check('넘긴 뒤 탈퇴', await codeOf(() => projects.leaveProject(project.id, owner)), 'ok');
  now = await roles();
  ctx.check('탈퇴 뒤에도 소유자가 남는다', now[editor], 'owner');

  // ── 겹친 요청 (2026-10-16) ─────────────────────────────────
  // 두 기기에서 서로 다른 사람에게 동시에 넘기면 하나만 된다. 잠금 없이는 둘 다 옛 역할을 읽고 통과해
  // 소유자가 둘 남았다.
  const second = await join('editor');
  const third = await join('editor');
  const overlapped = await Promise.all([
    codeOf(() => projects.transferOwnership(project.id, second, editor)),
    codeOf(() => projects.transferOwnership(project.id, third, editor)),
  ]);
  ctx.check('겹친 넘기기는 하나만 된다', overlapped.filter((code) => code === 'ok').length, 1);
  now = await roles();
  ctx.check('겹친 넘기기 뒤에도 소유자는 한 명', Object.values(now).filter((role) => role === 'owner').length, 1);

  // 소유자가 넘기는 사이 받을 사람이 나가면, 둘 중 하나만 되고 소유자는 남는다.
  const owners = Object.entries(now).filter(([, role]) => role === 'owner').map(([id]) => id);
  const receiver = await join('editor');
  await Promise.all([
    codeOf(() => projects.transferOwnership(project.id, receiver, owners[0])),
    codeOf(() => projects.leaveProject(project.id, receiver)),
  ]);
  now = await roles();
  ctx.check('넘기기와 나가기가 겹쳐도 소유자가 있다', Object.values(now).filter((role) => role === 'owner').length, 1);

  // 가입 승인을 두 번 누르면 하나만 되고 둘째는 "이미 처리됨"이다 (2026-10-16). 예전에는 둘째가 구성원
  // 유일 조건에 걸려 500 이 났다.
  const currentOwner = Object.entries(now).find(([, role]) => role === 'owner')![0];
  const applicant = (await ctx.createUser()).id;
  const request = await ctx.prisma.projectJoinRequest.create({
    data: { projectId: project.id, userId: applicant },
  });
  const approvals = await Promise.all([
    codeOf(() => projects.approveJoinRequest(request.id, currentOwner, 'editor')),
    codeOf(() => projects.approveJoinRequest(request.id, currentOwner, 'editor')),
  ]);
  ctx.check('겹친 승인 결과', approvals.slice().sort().join(','), 'JOIN_REQUEST_HANDLED,ok');
  ctx.check(
    '승인된 사람은 한 번만 들어온다',
    await ctx.prisma.projectMember.count({ where: { projectId: project.id, userId: applicant } }),
    1,
  );
});
