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
});
