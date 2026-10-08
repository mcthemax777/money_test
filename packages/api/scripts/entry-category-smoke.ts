/**
 * 분류 손보기 (2026-10-09). 고른 줄의 분류를 한 분류로 바꾼다 (`EntriesService.changeCategory`).
 *
 * 실행: cd packages/api && node -r <tsconfig-paths 훅> -r ts-node/register/transpile-only \
 *       scripts/entry-category-smoke.ts
 *
 * 못 박는 것.
 *
 *   1. 같은 유형의 줄만 바뀐다. 수입 줄과 이체는 그대로 두고 센다(excluded).
 *   2. 분할은 고른 줄만, 줄을 가리지 않으면 분류 줄 전부.
 *   3. 할부는 다리를 다시 만들지 않는다 -- 일정이 그대로, 회차 기준 합계도 분류만 옮겨 간다.
 *   4. 원거래 줄을 바꾸면 걸린 환불도 따라간다. 환불만 따로 고르면 바꾸지 않는다.
 *   5. 다시 보내도 달라지지 않는다. 늦게 도착한 재생은 그 뒤에 고친 전표를 덮지 않는다.
 *   6. 남의 분류는 거절, 바뀐 전표는 번호가 오른다.
 */
import { randomUUID } from 'node:crypto';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

runSmoke('entry-category', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const uid = (await ctx.createUser()).id;

  const access = projectAccessStub(ctx.prisma, pid);
  const ledger = makeLedger(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const categories = makeCategories(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const reports = makeReports(ctx.prisma, access);

  const me = await makePeople(ctx.prisma, access).createPerson(uid, { name: '나' } as never, pid);
  const bank = await makeAccounts(ctx.prisma, access, ledger, institutions).createAccount(
    uid,
    { name: '통장', type: 'deposit', ownerId: me.id, institutionId: (await institutions.createInstitution(uid, { name: '은행', type: 'bank' } as never, pid)).id, initialBalance: '1000000' } as never,
    pid,
  );
  const card = await makeCards(ctx.prisma, access, institutions).createCard(
    uid,
    { name: '카드', cardType: 'credit', issuerId: (await institutions.createInstitution(uid, { name: '카드사', type: 'card_issuer' } as never, pid)).id, paymentAccountId: bank.id, statementClosingDay: 15, paymentDueDay: 25 } as never,
    pid,
  );
  const cat = (name: string, type: 'expense' | 'income') =>
    categories.createCategory(uid, { name, type } as never, pid);
  const food = await cat('식비', 'expense');
  const trip = await cat('여행', 'expense');
  const life = await cat('생활', 'expense');
  const salary = await cat('급여', 'income');
  const bonus = await cat('상여', 'income');

  const base = { personId: me.id, date: '2026-10-05T03:00:00.000Z' };
  const simple = await entries.createEntry(uid, { ...base, kind: 'expense', description: '점심', amount: '9000', categoryId: food.id, accountId: bank.id, lineKey: randomUUID() } as never, pid);
  const foodLine = randomUUID();
  const tripLine = randomUUID();
  const split = await entries.createEntry(uid, {
    ...base, kind: 'expense', description: '여행 겸 식사', amount: '10000', accountId: bank.id,
    splits: [
      { categoryId: food.id, amount: '6000', lineKey: foodLine },
      { categoryId: trip.id, amount: '4000', lineKey: tripLine },
    ],
  } as never, pid);
  const income = await entries.createEntry(uid, { ...base, kind: 'income', description: '월급', amount: '300000', categoryId: salary.id, accountId: bank.id, lineKey: randomUUID() } as never, pid);
  const transfer = await entries.createEntry(uid, { ...base, kind: 'transfer', description: '이체', amount: '1000', accountId: bank.id, toAccountId: card.liabilityAccountId } as never, pid);
  const buyLine = randomUUID();
  const installment = await entries.createEntry(uid, {
    ...base, kind: 'expense', description: '가전', cardId: card.id, amount: '120000', categoryId: food.id,
    lineKey: buyLine, installmentMonths: 3,
  } as never, pid);
  const refund = await entries.createEntry(uid, {
    ...base, date: '2026-11-10T03:00:00.000Z', kind: 'payback', paybackType: 'refund', description: '환불',
    cardId: card.id, categoryId: food.id, amount: '30000', lineKey: randomUUID(),
    paybackOfEntryId: installment.id, paybackOfLineKey: buyLine, installmentCut: ['0', '0', '30000'],
  } as never, pid);

  const categoriesOf = async (entryId: string) =>
    (await ctx.prisma.posting.findMany({ where: { entryId, categoryId: { not: null } }, orderBy: { lineKey: 'asc' } }))
      .map((leg) => leg.categoryId)
      .join(',');
  const versionOf = async (entryId: string) =>
    (await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } })).updatedVersion;
  const codeOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); return '통과'; } catch (error) {
      const body = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      return body?.code ?? (error instanceof Error ? error.message : String(error));
    }
  };

  // ── 1·2. 섞어서 고른다 ──
  const simpleVersion = await versionOf(simple.id);
  const first = await entries.changeCategory(uid, {
    targets: [
      { entryId: simple.id },
      { entryId: split.id, lineKey: foodLine },
      { entryId: income.id },
      { entryId: transfer.id },
    ],
    categoryId: life.id,
  }, pid);
  ctx.check('바뀐 거래는 둘 (단건 + 분할의 식비 줄)', first.entries, 2);
  ctx.check('수입 줄과 이체는 그대로 두고 센다', first.excluded, 2);
  ctx.check('단건은 생활로', await categoriesOf(simple.id), life.id);
  ctx.check('분할은 고른 줄만 생활로, 여행 줄은 그대로',
    (await ctx.prisma.posting.findMany({ where: { entryId: split.id, categoryId: { not: null } } }))
      .map((leg) => `${leg.lineKey === foodLine ? 'food' : 'trip'}:${leg.categoryId === life.id ? 'life' : leg.categoryId === trip.id ? 'trip' : '?'}`)
      .sort().join(','),
    'food:life,trip:trip');
  ctx.check('수입은 급여 그대로', await categoriesOf(income.id), salary.id);
  ctx.check('바뀐 전표는 번호가 오른다', (await versionOf(simple.id)) > simpleVersion, true);

  ctx.check('다시 보내면 달라지는 것이 없다',
    (await entries.changeCategory(uid, { targets: [{ entryId: simple.id }], categoryId: life.id }, pid)).entries, 0);
  ctx.check('수입 줄은 수입 분류로 바뀐다',
    (await entries.changeCategory(uid, { targets: [{ entryId: income.id }], categoryId: bonus.id }, pid)).entries, 1);

  // ── 3·4. 할부와 걸린 환불 ──
  const plansOf = () => ctx.prisma.installmentPlan.count({ where: { posting: { entryId: installment.id } } });
  const plansBefore = await plansOf();
  const monthly = async (categoryId: string) =>
    (await Promise.all(['2026-10', '2026-11', '2026-12'].map(async (yearMonth) =>
      (await reports.getSummary(uid, { yearMonth, projectId: pid, basis: 'installment', categoryIds: categoryId } as never)).expense))).join(' / ');
  const foodBefore = await monthly(food.id);
  const tripBefore = await monthly(trip.id);
  const plus = (a: string, b: string) => {
    const right = b.split(' / ').map(Number);
    return a.split(' / ').map((value, index) => Number(value) + right[index]).join(' / ');
  };

  ctx.check('환불만 따로 고르면 바꾸지 않는다',
    (await entries.changeCategory(uid, { targets: [{ entryId: refund.id }], categoryId: trip.id }, pid)).excluded, 1);
  ctx.check('환불의 분류는 그대로 식비', await categoriesOf(refund.id), food.id);

  const second = await entries.changeCategory(uid, { targets: [{ entryId: installment.id }], categoryId: trip.id }, pid);
  ctx.check('할부 원거래가 바뀐다', second.entries, 1);
  ctx.check('할부 일정은 그대로', await plansOf(), plansBefore);
  ctx.check('걸린 환불도 원거래를 따라 여행으로', await categoriesOf(refund.id), trip.id);
  ctx.check('회차 기준 합계가 식비에서 여행으로 그대로 옮겨 간다', await monthly(trip.id), plus(tripBefore, foodBefore));
  ctx.check('식비 쪽에는 남는 것이 없다', await monthly(food.id), '0 / 0 / 0');
  ctx.check('환불의 링크와 줄인 회차는 그대로',
    JSON.stringify(await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: refund.id }, select: { paybackOfEntryId: true, paybackOfLineKey: true } })),
    JSON.stringify({ paybackOfEntryId: installment.id, paybackOfLineKey: buyLine }));

  // ── 5. 늦게 도착한 재생은 그 뒤의 편집을 덮지 않는다 ──
  const stale = '0000000000001-0000-old';
  const staleResult = await entries.changeCategory(uid, { targets: [{ entryId: simple.id }], categoryId: food.id }, pid, { hlc: stale });
  ctx.check('늦은 재생은 건너뛴다', `${staleResult.entries} ${staleResult.skipped.length}`, '0 1');
  ctx.check('그 뒤의 분류가 남는다', await categoriesOf(simple.id), life.id);

  // ── 6. 거절 ──
  const otherProject = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const foreign = await ctx.prisma.category.create({ data: { projectId: otherProject.id, name: '남의 것', type: 'expense', sortRank: 'a' } });
  ctx.check('남의 분류는 거절',
    await codeOf(() => entries.changeCategory(uid, { targets: [{ entryId: simple.id }], categoryId: foreign.id }, pid)), 'CATEGORY_NOT_FOUND');
  ctx.check('없는 거래가 섞이면 거절',
    await codeOf(() => entries.changeCategory(uid, { targets: [{ entryId: 'nope' }], categoryId: food.id }, pid)), 'ENTRY_NOT_FOUND');
});
