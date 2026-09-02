import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeEntries, makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 과소비 금액이 어디서 정해지는지.
 *
 * 예전에는 거래를 저장할 때 그 거래가 쓴 카테고리의 기본값을 거꾸로 갱신했다
 * (category-fixed-smoke 가 그것을 지켰다). 지금은 방향이 하나다.
 * 카테고리의 `defaultIsExtra` 는 카테고리 화면에서 사람이 정하고, 거래는 적을 때
 * 그 값을 기본값으로 물려받는다. 거래가 카테고리를 고치지는 않는다.
 *
 * 그래서 여기서 보는 것은 세 가지다.
 *   1. 표시한 카테고리로 적으면 전액이 과소비가 되고, 표시하지 않았으면 0이다.
 *   2. 거래에서 금액을 직접 주면 그것이 기본값을 이긴다 (부분 과소비 포함).
 *   3. 그 값이 실제로 다리에 저장되어 일반/과소비 필터에 걸린다.
 */
runSmoke('category-extra', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const entries = makeEntries(ctx.prisma, access, ledger);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const utility = cats.find((c) => c.name === '공과금')!;

  // 배달은 과소비로 표시한 소분류, 수도요금은 표시하지 않은 소분류다.
  const delivery = await categories.createCategory(uid, {
    name: '배달', parentId: dining.id, type: 'expense', defaultIsExtra: true,
  }, pid);
  const water = await categories.createCategory(uid, {
    name: '수도요금', parentId: utility.id, type: 'expense',
  }, pid);
  const fee = await categories.createCategory(uid, {
    name: '수수료', type: 'expense', defaultIsExtra: true,
  }, pid);

  ctx.check('표시한 소분류만 기본값이 켜져 있다', delivery.defaultIsExtra, true);
  ctx.check('표시하지 않은 소분류는 꺼져 있다', water.defaultIsExtra, false);
  ctx.check('대분류는 건드리지 않는다',
    (await ctx.prisma.category.findUniqueOrThrow({ where: { id: dining.id } })).defaultIsExtra,
    false);

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  const other = await accounts.createAccount(uid, {
    type: 'savings', ownerId: person.id, name: '저축통장', institutionId: 'fi_bank_kb',
  }, pid);

  const aug = (day: number) => `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`;
  const expense = (day: number, description: string, categoryId: string, amount: string,
                   extraAmount?: string) =>
    entries.createEntry(uid, {
      kind: 'expense', personId: person.id, date: aug(day),
      description, amount, categoryId, accountId: bank.id, extraAmount,
    }, pid);

  // ── 1. 기본값을 물려받는다 ──
  const first = await expense(5, '치킨', delivery.id, '30000');
  ctx.check('표시한 카테고리로 적으면 전액 과소비', first.extraAmount, '30000');

  const plain = await expense(6, '수도요금', water.id, '20000');
  ctx.check('표시하지 않은 카테고리는 과소비 0', plain.extraAmount, '0');

  // ── 2. 거래에서 직접 준 값이 기본값을 이긴다 ──
  const declined = await expense(7, '치킨(회식비 정산)', delivery.id, '40000', '0');
  ctx.check('0을 주면 일반 거래가 된다', declined.extraAmount, '0');

  const partial = await expense(8, '장보기 중 간식', delivery.id, '50000', '20000');
  ctx.check('부분 과소비는 그 값만', partial.extraAmount, '20000');
  const partialPosting = await ctx.prisma.posting.findFirstOrThrow({
    where: { entryId: partial.id, categoryId: delivery.id },
  });
  ctx.check('나머지는 일반 몫으로 남는다', partialPosting.normalAmount, '30000');
  ctx.check('두 몫의 합이 거래 금액이다',
    partialPosting.extraAmount.add(partialPosting.normalAmount), '50000');

  const raised = await expense(9, '수도요금(연체료 포함)', water.id, '25000', '5000');
  ctx.check('표시하지 않은 카테고리도 직접 주면 과소비가 된다', raised.extraAmount, '5000');

  // ── 3. 거래 금액을 넘는 과소비는 거부한다 ──
  await ctx.expectReject('금액보다 큰 과소비는 거부', () =>
    expense(10, '치킨', delivery.id, '10000', '20000'),
  );
  await ctx.expectReject('음수 과소비는 거부', () =>
    expense(11, '치킨', delivery.id, '10000', '-1000'),
  );

  // ── 4. 카테고리 기본값을 나중에 바꿔도 지난 거래는 그대로다 ──
  await categories.updateCategory(delivery.id, uid, { defaultIsExtra: false });
  const beforeChange = await entries.getEntryById(first.id, uid);
  ctx.check('이미 적은 거래는 바뀌지 않는다', beforeChange.extraAmount, '30000');
  const afterChange = await expense(12, '치킨(기본값 끈 뒤)', delivery.id, '30000');
  ctx.check('그 뒤 거래는 새 기본값을 따른다', afterChange.extraAmount, '0');

  // ── 5. 이체 수수료도 같은 규칙을 따른다 ──
  const transfer = await entries.createEntry(uid, {
    kind: 'transfer', personId: person.id, date: aug(13),
    description: '이체', amount: '100000', accountId: bank.id, toAccountId: other.id,
    transferFee: '1000', transferFeeCategoryId: fee.id, extraAmount: '1000',
  }, pid);
  ctx.check('수수료 다리에 과소비가 붙는다', transfer.extraAmount, '1000');

  // ── 6. 저장된 값이 필터에 걸린다 ──
  // 과소비가 남아 있는 건: 치킨 30000, 장보기 20000, 수도요금 5000, 이체 수수료 1000
  const extraList = await entries.getEntries(uid, {
    extraTypes: 'extra', startDate: aug(1), endDate: aug(28),
  }, pid);
  ctx.check('과소비 필터 건수', extraList.data.length, 4);

  // 일반 몫이 남아 있는 건: 수도요금 20000, 치킨(정산) 40000, 장보기 30000,
  // 수도요금(연체료) 20000, 치킨(기본값 끈 뒤) 30000
  const normalList = await entries.getEntries(uid, {
    extraTypes: 'normal', startDate: aug(1), endDate: aug(28),
  }, pid);
  ctx.check('일반 필터 건수', normalList.data.length, 5);

  // 한 줄이 둘로 나뉜 거래는 양쪽 목록에 모두 든다. 한쪽에서 빼면 합계와 목록이 어긋난다.
  // 장보기(20000/30000)와 수도요금 연체료 건(5000/20000)이 그렇다.
  const inBoth = extraList.data
    .filter((e) => normalList.data.some((n) => n.id === e.id))
    .map((e) => e.description)
    .sort();
  ctx.check('부분 과소비 거래는 양쪽에 든다', inBoth.join(','),
    '수도요금(연체료 포함),장보기 중 간식');

  // ── 7. 다른 프로젝트 카테고리를 수수료로 쓰지 못한다 ──
  const otherProject = await ctx.createProject();
  const foreign = await categories.createCategory(uid, {
    name: '남의 수수료', type: 'expense',
  }, otherProject.id);
  await ctx.expectReject('다른 프로젝트 카테고리를 수수료로 쓰는 것 거부', () =>
    entries.createEntry(uid, {
      kind: 'transfer', personId: person.id, date: aug(14),
      description: '이체 3', amount: '10000', accountId: bank.id, toAccountId: other.id,
      transferFee: '100', transferFeeCategoryId: foreign.id,
    }, pid),
  );
});
