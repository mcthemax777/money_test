import { AccountsService } from '@/modules/accounts/accounts.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { PeopleService } from '@/modules/people/people.service';
import { projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 고정 여부를 거래 입력으로 정하는 흐름.
 *
 * 카테고리 화면에는 고정 체크박스가 없다. 거래를 저장할 때 그 거래가 쓴 카테고리의
 * defaultIsFixed가 갱신되고, 다음 거래는 그 값을 물려받는다.
 * 이체는 카테고리 다리가 수수료뿐이라 수수료 카테고리가 대상이 된다.
 */
runSmoke('category-fixed', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = new LedgerService(ctx.prisma as any);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = new AccountsService(ctx.prisma as any, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const entries = new EntriesService(ctx.prisma as any, access, ledger);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const utility = cats.find((c) => c.name === '공과금')!;
  const water = await categories.createCategory(uid, {
    name: '수도요금', parentId: utility.id, type: 'expense',
  }, pid);
  const fee = await categories.createCategory(uid, { name: '수수료', type: 'expense' }, pid);

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000', openingBalanceDate: '2026-08-01',
  }, pid);
  const other = await accounts.createAccount(uid, {
    type: 'savings', ownerId: person.id, name: '저축통장', institutionId: 'fi_bank_kb',
  }, pid);

  const isFixedOf = async (categoryId: string) =>
    (await ctx.prisma.category.findUniqueOrThrow({ where: { id: categoryId } })).defaultIsFixed;

  ctx.check('처음에는 소분류가 변동', await isFixedOf(water.id), false);

  // ── 고정으로 체크해 저장하면 그 소분류에 저장된다 ──
  const first = await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-05T03:00:00.000Z',
    description: '수도요금', amount: '30000', categoryId: water.id, accountId: bank.id,
    isFixed: true,
  }, pid);
  ctx.check('거래는 고정으로 기록', first.isFixed, true);
  ctx.check('소분류 기본값이 고정으로 바뀐다', await isFixedOf(water.id), true);
  ctx.check('대분류는 건드리지 않는다', await isFixedOf(utility.id), false);

  // ── 다음 거래는 isFixed를 보내지 않아도 기본값을 물려받는다 ──
  const second = await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-06T03:00:00.000Z',
    description: '수도요금 2', amount: '31000', categoryId: water.id, accountId: bank.id,
  }, pid);
  ctx.check('기본값을 물려받아 고정', second.isFixed, true);

  // ── 수정으로 체크를 풀면 기본값도 내려간다 ──
  await entries.updateEntry(first.id, uid, {
    kind: 'expense', personId: person.id, date: '2026-08-05T03:00:00.000Z',
    description: '수도요금', amount: '30000', categoryId: water.id, accountId: bank.id,
    isFixed: false,
  });
  ctx.check('수정에서도 기본값이 갱신된다', await isFixedOf(water.id), false);

  // ── 이체: 수수료 카테고리가 대상 ──
  ctx.check('수수료 카테고리는 처음에 변동', await isFixedOf(fee.id), false);
  const transfer = await entries.createEntry(uid, {
    kind: 'transfer', personId: person.id, date: '2026-08-10T03:00:00.000Z',
    description: '이체', amount: '100000', accountId: bank.id, toAccountId: other.id,
    transferFee: '1000', transferFeeCategoryId: fee.id, isFixed: true,
  }, pid);
  ctx.check('수수료 다리가 고정으로 기록', transfer.isFixed, true);
  ctx.check('수수료 카테고리 기본값이 고정으로', await isFixedOf(fee.id), true);

  // 수수료만 있는 이체에서 isFixed를 안 보내면 카테고리 기본값을 따른다
  const transfer2 = await entries.createEntry(uid, {
    kind: 'transfer', personId: person.id, date: '2026-08-11T03:00:00.000Z',
    description: '이체 2', amount: '50000', accountId: bank.id, toAccountId: other.id,
    transferFee: '500', transferFeeCategoryId: fee.id,
  }, pid);
  ctx.check('수수료도 기본값을 물려받는다', transfer2.isFixed, true);

  // 고정 필터로도 잡혀야 한다 (posting.isFixed에 실제로 저장됐다는 뜻)
  const fixedList = await entries.getEntries(uid, {
    fixedTypes: 'fixed',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-28T00:00:00.000Z',
  }, pid);
  ctx.check('고정 필터에 잡히는 건수 (수도요금2 + 이체2건)', fixedList.data.length, 3);

  // 수수료 카테고리를 검증 없이 쓰지 못한다
  const otherProject = await ctx.createProject();
  const foreign = await categories.createCategory(uid, { name: '남의 수수료', type: 'expense' }, otherProject.id);
  await ctx.expectReject('다른 프로젝트 카테고리를 수수료로 쓰는 것 거부', () =>
    entries.createEntry(uid, {
      kind: 'transfer', personId: person.id, date: '2026-08-12T03:00:00.000Z',
      description: '이체 3', amount: '10000', accountId: bank.id, toAccountId: other.id,
      transferFee: '100', transferFeeCategoryId: foreign.id,
    }, pid),
  );
});
