/**
 * 고양이 엠블럼의 획득 판정 (2026-10-28).
 *
 * 새 가계부는 기본 고양이 한 마리, 거래·계좌·숨긴 미션(야옹·1월 1일·7,777)을 채우면 그 고양이, 데리고 다닐 고양이는
 * 얻은 것만·다섯까지, 다섯을 고르면 그 미션, 얻은 고양이는 조건이 깨져도 남는다. 지난 달 미션(순수입)과 날 수
 * 미션(100일)은 `now` 를 옮겨 본다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 *   cd packages/api && node -r <tsconfig-paths>/register.js -r ts-node/register/transpile-only scripts/cats-smoke.ts
 */
import { CatsService } from '../src/modules/cats/cats.service';
import { makeBudgets, makeReports, projectAccessStub, runSmoke } from './smoke-harness';

runSmoke('cats', async (ctx) => {
  const { prisma } = ctx;
  const createdAt = new Date('2026-08-01T00:00:00.000Z');
  const project = await ctx.createProject({ createdAt, timezone: 'Asia/Seoul' });
  const user = await ctx.createUser();
  await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, role: 'owner' } });
  const access = projectAccessStub(prisma, project.id);
  const cats = new CatsService(prisma as any, access, makeBudgets(prisma, access), makeReports(prisma, access));
  const at = new Date('2026-08-02T00:00:00.000Z');
  const owned = async () =>
    (await prisma.projectCat.findMany({ where: { projectId: project.id } })).map((cat) => cat.breedId).sort();

  ctx.check('새 가계부는 기본 고양이만', JSON.stringify(await cats.evaluate(project.id, user.id, at)), '["maine-coon"]');
  ctx.check('다시 읽어도 새로 오지 않는다', (await cats.evaluate(project.id, user.id, at)).length, 0);

  const unassigned = await prisma.account.create({
    data: { projectId: project.id, type: 'unassigned', name: '미지정', currency: 'KRW' },
  });
  ctx.check('미지정 계정은 계좌가 아니다', (await cats.evaluate(project.id, user.id, at)).length, 0);

  const deposit = await prisma.account.create({
    data: { projectId: project.id, type: 'deposit', name: '통장', currency: 'KRW' },
  });
  ctx.check('계좌를 만들면 페르시안', JSON.stringify(await cats.evaluate(project.id, user.id, at)), '["persian"]');

  const food = await prisma.category.create({
    data: { projectId: project.id, name: '식비', type: 'expense', createdAt: new Date(createdAt.getTime() + 1000) },
  });
  const salary = await prisma.category.create({
    data: { projectId: project.id, name: '월급', type: 'income', createdAt: new Date(createdAt.getTime() + 1000) },
  });
  const expense = (date: string, amount: number, description = '점심') =>
    prisma.journalEntry.create({
      data: {
        projectId: project.id,
        date: new Date(date),
        description,
        postings: {
          create: [
            { categoryId: food.id, amount, baseAmount: amount, lineKey: `l${Math.random()}` },
            { accountId: unassigned.id, amount: -amount, baseAmount: -amount },
          ],
        },
      },
    });

  // 1월 1일(서울) 날짜, 7,777원, 메모에 야옹 -- 한 건으로 세 미션.
  await expense('2025-12-31T16:00:00.000Z', 7777, '고양이 간식 야옹');
  const got = (await cats.evaluate(project.id, user.id, at)).sort();
  ctx.check('첫 거래', got.includes('ragdoll'), true);
  ctx.check('1월 1일 (서울 날짜)', got.includes('korat'), true);
  ctx.check('7,777', got.includes('khao-manee'), true);
  ctx.check('야옹', got.includes('balinese'), true);
  ctx.check('12월 25일은 아니다', got.includes('havana-brown'), false);
  ctx.check('기본 분류 여유 안에 만든 분류는 사용자 분류가 아니다', got.includes('british-shorthair'), false);

  // 지난 달 순수입: 8월에 수입 100, 지출 10. 9월 2일에 읽으면 8월이 다 지났다.
  await prisma.journalEntry.create({
    data: {
      projectId: project.id,
      date: new Date('2026-08-10T03:00:00.000Z'),
      description: '월급',
      postings: {
        create: [
          { categoryId: salary.id, amount: -100, baseAmount: -100, lineKey: 'salary' },
          { accountId: deposit.id, amount: 100, baseAmount: 100 },
        ],
      },
    },
  });
  await expense('2026-08-11T03:00:00.000Z', 10);
  const september = new Date('2026-09-02T00:00:00.000Z');
  const later = await cats.evaluate(project.id, user.id, september);
  ctx.check('첫 수입', later.includes('devon-rex'), true);
  ctx.check('지난 달 순수입 플러스', later.includes('bombay'), true);
  ctx.check('예산이 없으면 지킨 것이 아니다', later.includes('japanese-bobtail'), false);
  const state = await prisma.projectCatState.findUnique({ where: { projectId: project.id } });
  ctx.check('센 달을 적는다', state?.monthlyCheckedThrough, '2026-08');

  ctx.check('100일 전', (await cats.evaluate(project.id, user.id, september)).includes('colorpoint-shorthair'), false);
  ctx.check(
    '100일',
    (await cats.evaluate(project.id, user.id, new Date('2026-11-10T00:00:00.000Z'))).includes('colorpoint-shorthair'),
    true,
  );

  // 데리고 다니기
  await ctx.expectReject('얻지 않은 고양이', () => cats.setParade(user.id, project.id, { breedIds: ['toybob'] }));
  await ctx.expectReject('겹친 고양이', () => cats.setParade(user.id, project.id, { breedIds: ['ragdoll', 'ragdoll'] }));
  await ctx.expectReject('여섯 마리', () =>
    cats.setParade(user.id, project.id, {
      breedIds: ['maine-coon', 'ragdoll', 'persian', 'devon-rex', 'korat', 'bombay'],
    }),
  );
  const before = await cats.getState(user.id, project.id);
  ctx.check('고른 적이 없으면 null', before.parade, null);
  const after = await cats.setParade(user.id, project.id, {
    breedIds: ['maine-coon', 'ragdoll', 'persian', 'devon-rex', 'korat'],
  });
  ctx.check('다섯을 고르면 그 미션', after.owned.some((cat) => cat.breedId === 'american-wirehair'), true);
  ctx.check('고른 차례 그대로', after.parade?.join(','), 'maine-coon,ragdoll,persian,devon-rex,korat');

  // 조건이 깨져도 남는다
  await prisma.journalEntry.deleteMany({ where: { projectId: project.id } });
  await prisma.account.delete({ where: { id: deposit.id } });
  await cats.evaluate(project.id, user.id, september);
  const kept = await owned();
  ctx.check('거래를 지워도 남는다', kept.includes('ragdoll') && kept.includes('persian'), true);
});
