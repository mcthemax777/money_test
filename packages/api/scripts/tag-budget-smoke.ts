/**
 * 태그 예산.
 *
 *   1. 사용액은 **태그가 붙은 줄**의 지출 − 수입이다. 분할 거래의 다른 줄은 들지 않는다.
 *   2. 태그 예산은 태그마다 하나다. type 을 실어 보내도 버리고 같은 규칙을 고친다.
 *   3. 태그 예산은 분류 없는 줄이지만 **전체 예산으로 읽히지 않는다.** 만들고, 구간으로
 *      나누고, 지워도 전체 예산은 그대로다.
 *   4. 태그를 지우면 그 예산도 사라진다.
 *
 * 실행 (memory 의 api_smoke_scripts):
 *   cd packages/api && node -r <tsconfig-paths>/register.js -r ts-node/register/transpile-only \
 *     scripts/tag-budget-smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeBudgets,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeReports,
  makeTags,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

runSmoke('tag-budget', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;

  const access = projectAccessStub(ctx.prisma, pid);
  const ledger = makeLedger(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const categories = makeCategories(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = makePeople(ctx.prisma, access);
  const tags = makeTags(ctx.prisma, access);
  const budgets = makeBudgets(ctx.prisma, access);
  const reports = makeReports(ctx.prisma, access);

  const person = await people.createPerson(uid, { name: '나' } as never, pid);
  const bankIssuer = await institutions.createInstitution(
    uid,
    { name: '신한은행', type: 'bank' } as never,
    pid,
  );
  const bank = await accounts.createAccount(
    uid,
    {
      name: '월급통장',
      type: 'deposit',
      ownerId: person.id,
      institutionId: bankIssuer.id,
      initialBalance: '1000000',
    } as never,
    pid,
  );
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' } as never, pid);
  const ride = await categories.createCategory(uid, { name: '교통', type: 'expense' } as never, pid);
  const salary = await categories.createCategory(uid, { name: '급여', type: 'income' } as never, pid);
  const trip = await tags.createTag(uid, { name: '여행' } as never, pid);
  const other = await tags.createTag(uid, { name: '회식' } as never, pid);

  const date = new Date('2026-09-05T03:00:00.000Z').toISOString();

  // 식비 7,000(여행) + 교통 3,000(태그 없음)으로 나눈 결제
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      date,
      description: '여행 중 점심',
      accountId: bank.id,
      splits: [
        { categoryId: food.id, amount: '7000', lineKey: randomUUID(), tagIds: [trip.id] },
        { categoryId: ride.id, amount: '3000', lineKey: randomUUID(), tagIds: [] },
      ],
    } as never,
    pid,
  );
  // 교통 2,000 한 줄에 태그 둘
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      date,
      description: '택시',
      accountId: bank.id,
      splits: [
        { categoryId: ride.id, amount: '2000', lineKey: randomUUID(), tagIds: [trip.id, other.id] },
      ],
    } as never,
    pid,
  );
  // 수입 50,000(여행) -- 지출 예산에 들면 안 된다
  await entries.createEntry(
    uid,
    {
      kind: 'income',
      personId: person.id,
      date,
      description: '여행 경비 정산',
      accountId: bank.id,
      splits: [
        { categoryId: salary.id, amount: '50000', lineKey: randomUUID(), tagIds: [trip.id] },
      ],
    } as never,
    pid,
  );

  const tagRow = async (tagId: string, month = 9) =>
    (await budgets.getTagBudgetsForMonth(uid, pid, 2026, month)).find(
      (row) => row.tagId === tagId,
    )!;
  const totalExpense = async (month = 9) =>
    (await budgets.getBudgetForMonth(uid, pid, 2026, month)).find(
      (row) => !row.categoryId && row.categoryType === 'expense',
    )!;

  // ── 1·2. 사용액 ──
  ctx.check('태그마다 한 줄', (await budgets.getTagBudgetsForMonth(uid, pid, 2026, 9)).length, 2);
  // 지출 7,000 + 2,000 에서 수입 50,000 을 뺀다
  ctx.check('여행: 태그 줄의 지출 − 수입', Number((await tagRow(trip.id)).usedAmount), -41000);
  ctx.check('한 줄에 태그 둘이면 둘 다 든다', Number((await tagRow(other.id)).usedAmount), 2000);
  ctx.check('예산이 없으면 자리표', (await tagRow(trip.id)).budgetId.startsWith('placeholder-'), true);

  // ── 3. 전체 예산과 섞이지 않는다 ──
  const total = await budgets.createBudget(
    uid,
    { categoryId: 'BUDGET_TOTAL_EXPENSE', type: 'expense', monthlyAmount: '500000' },
    pid,
  );
  const tagBudget = await budgets.createBudget(
    uid,
    { tagId: trip.id, monthlyAmount: '100000', yearMonth: '2026-09' },
    pid,
  );
  ctx.check('태그 예산이 새 줄로 선다', tagBudget.id !== total.id, true);
  ctx.check('태그 예산에는 type 이 없다', tagBudget.type ?? null, null);
  ctx.check('태그 예산 금액', Number((await tagRow(trip.id)).monthlyAmount), 100000);
  ctx.check('전체 예산은 그대로', Number((await totalExpense()).monthlyAmount), 500000);
  ctx.check('전체 예산 id 도 그대로', (await totalExpense()).budgetId, total.id);

  const again = await budgets.createBudget(
    uid,
    { tagId: trip.id, type: 'income', monthlyAmount: '120000', yearMonth: '2026-09' },
    pid,
  );
  ctx.check('type 을 실어 보내도 같은 태그의 그 줄을 고친다', again.id, tagBudget.id);
  ctx.check('실어 보낸 type 은 버린다', again.type ?? null, null);

  await budgets.updateBudget(tagBudget.id, uid, {
    monthlyAmount: '80000',
    applyMode: 'from',
    applyFromMonth: '2026-10',
  });
  ctx.check('구간: 9월은 옛 금액', Number((await tagRow(trip.id, 9)).monthlyAmount), 120000);
  ctx.check('구간: 10월은 새 금액', Number((await tagRow(trip.id, 10)).monthlyAmount), 80000);
  ctx.check('구간을 나눠도 전체 예산은 그대로', Number((await totalExpense(10)).monthlyAmount), 500000);

  const schedule = await budgets.getBudgetSchedule(uid, {
    projectId: pid,
    tagId: trip.id,
    startMonth: '2026-09',
    months: 2,
  });
  ctx.check('월별 목록', schedule.map((row) => Number(row.amount)).join(','), '120000,80000');

  const totalSchedule = await budgets.getBudgetSchedule(uid, {
    projectId: pid,
    categoryId: 'BUDGET_TOTAL_EXPENSE',
    type: 'expense',
    startMonth: '2026-09',
    months: 2,
  });
  ctx.check('전체 예산의 월별 목록에 태그 예산이 끼지 않는다',
    totalSchedule.map((row) => Number(row.amount)).join(','), '500000,500000');

  // 태그 예산은 분류와 함께 설 수 없다
  let rejected = 0;
  await budgets
    .createBudget(uid, { tagId: trip.id, categoryId: food.id, type: 'expense', monthlyAmount: '1' }, pid)
    .catch(() => rejected++);
  ctx.check('분류와 함께는 거절', rejected, 1);

  // 한 태그에 같은 달부터 시작하는 규칙은 하나 (부분 유일 색인)
  let duplicate = false;
  await ctx.prisma.budget
    .create({ data: { projectId: pid, tagId: trip.id, monthlyAmount: '1', effectiveFrom: '2026-10' } })
    .catch(() => (duplicate = true));
  ctx.check('같은 태그·같은 시작 달의 규칙은 DB 가 막는다', duplicate, true);

  // ── 5. 태그 분석 (예산 화면에서 태그 줄을 누르면 여는 창) ──
  const trend = await reports.getTrend(uid, {
    projectId: pid,
    target: 'tag',
    targetId: trip.id,
    type: 'expense',
    endMonth: '2026-09',
    months: 2,
  });
  ctx.check('태그 추이: 태그 줄의 지출만 (7,000 + 2,000)',
    trend.map((point) => Number(point.amount)).join(','), '0,9000');
  const breakdown = await reports.getCategoryBreakdown(uid, {
    projectId: pid,
    yearMonth: '2026-09',
    type: 'expense',
    rollup: false,
    tagIds: trip.id,
  } as never);
  ctx.check('태그로 좁힌 분류별: 교통 3,000 줄은 빠진다',
    breakdown.map((row) => `${row.categoryName}:${Number(row.amount)}`).sort().join(','),
    '교통:2000,식비:7000');

  // ── 4. 태그를 지우면 예산도 사라진다 ──
  await tags.deleteTag(trip.id, uid);
  ctx.check('태그를 지우면 태그 예산이 사라진다',
    await ctx.prisma.budget.count({ where: { projectId: pid, tagId: trip.id } }), 0);
  ctx.check('전체 예산은 남는다', Number((await totalExpense()).monthlyAmount), 500000);
});
