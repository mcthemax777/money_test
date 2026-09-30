/**
 * 태그 예산.
 *
 *   1. 사용액은 **태그가 붙은 줄**의 합이다. 분할 거래의 다른 줄은 들지 않는다.
 *   2. 한 태그의 지출 예산과 수입 목표는 따로다 (type 으로 갈린다).
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

  const tagRow = async (tagId: string, type: 'income' | 'expense', month = 9) =>
    (await budgets.getTagBudgetsForMonth(uid, pid, 2026, month)).find(
      (row) => row.tagId === tagId && row.type === type,
    )!;
  const totalExpense = async (month = 9) =>
    (await budgets.getBudgetForMonth(uid, pid, 2026, month)).find(
      (row) => !row.categoryId && row.categoryType === 'expense',
    )!;

  // ── 1·2. 사용액 ──
  ctx.check('태그마다 지출·수입 두 줄', (await budgets.getTagBudgetsForMonth(uid, pid, 2026, 9)).length, 4);
  ctx.check('여행 지출: 태그 붙은 줄만 (7,000 + 2,000)', Number((await tagRow(trip.id, 'expense')).usedAmount), 9000);
  ctx.check('여행 수입은 따로', Number((await tagRow(trip.id, 'income')).usedAmount), 50000);
  ctx.check('한 줄에 태그 둘이면 둘 다 든다', Number((await tagRow(other.id, 'expense')).usedAmount), 2000);
  ctx.check('예산이 없으면 자리표', (await tagRow(trip.id, 'expense')).budgetId.startsWith('placeholder-'), true);

  // ── 3. 전체 예산과 섞이지 않는다 ──
  const total = await budgets.createBudget(
    uid,
    { categoryId: 'BUDGET_TOTAL_EXPENSE', type: 'expense', monthlyAmount: '500000' },
    pid,
  );
  const tagBudget = await budgets.createBudget(
    uid,
    { tagId: trip.id, type: 'expense', monthlyAmount: '100000', yearMonth: '2026-09' },
    pid,
  );
  ctx.check('태그 예산이 새 줄로 선다', tagBudget.id !== total.id, true);
  ctx.check('태그 예산 금액', Number((await tagRow(trip.id, 'expense')).monthlyAmount), 100000);
  ctx.check('수입 목표는 그대로 없다', Number((await tagRow(trip.id, 'income')).monthlyAmount), 0);
  ctx.check('전체 예산은 그대로', Number((await totalExpense()).monthlyAmount), 500000);
  ctx.check('전체 예산 id 도 그대로', (await totalExpense()).budgetId, total.id);

  const again = await budgets.createBudget(
    uid,
    { tagId: trip.id, type: 'expense', monthlyAmount: '120000', yearMonth: '2026-09' },
    pid,
  );
  ctx.check('같은 태그·유형으로 다시 만들면 그 줄을 고친다', again.id, tagBudget.id);

  await budgets.updateBudget(tagBudget.id, uid, {
    monthlyAmount: '80000',
    applyMode: 'from',
    applyFromMonth: '2026-10',
  });
  ctx.check('구간: 9월은 옛 금액', Number((await tagRow(trip.id, 'expense', 9)).monthlyAmount), 120000);
  ctx.check('구간: 10월은 새 금액', Number((await tagRow(trip.id, 'expense', 10)).monthlyAmount), 80000);
  ctx.check('구간을 나눠도 전체 예산은 그대로', Number((await totalExpense(10)).monthlyAmount), 500000);

  const schedule = await budgets.getBudgetSchedule(uid, {
    projectId: pid,
    tagId: trip.id,
    type: 'expense',
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

  // 태그 예산에는 type 이 있어야 하고, 분류와 함께 설 수 없다
  let rejected = 0;
  await budgets.createBudget(uid, { tagId: trip.id, monthlyAmount: '1' } as never, pid).catch(() => rejected++);
  await budgets
    .createBudget(uid, { tagId: trip.id, categoryId: food.id, type: 'expense', monthlyAmount: '1' }, pid)
    .catch(() => rejected++);
  ctx.check('유형 없음·분류와 함께는 거절', rejected, 2);

  // ── 4. 태그를 지우면 예산도 사라진다 ──
  await tags.deleteTag(trip.id, uid);
  ctx.check('태그를 지우면 태그 예산이 사라진다',
    await ctx.prisma.budget.count({ where: { projectId: pid, tagId: trip.id } }), 0);
  ctx.check('전체 예산은 남는다', Number((await totalExpense()).monthlyAmount), 500000);
});
