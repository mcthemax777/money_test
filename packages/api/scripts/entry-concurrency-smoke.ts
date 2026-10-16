/**
 * 같은 거래를 동시에 고칠 때.
 *
 * 실행: cd packages/api && npx ts-node --transpile-only scripts/entry-concurrency-smoke.ts
 *
 * 다른 스모크와 다른 점은 **요청을 겹쳐 던진다**는 것이다. 동기화의 버그는 값이 아니라
 * 타이밍에서 나오고, 순서대로 부르는 검사는 그 자리를 영영 지나친다. 실제로 그랬다 --
 * 기존 스모크 전부가 통과하는 동안 두 사람이 같은 거래를 저장하면 통장 잔액이 조용히
 * 어긋나고 있었다.
 *
 * 못 박는 것 다섯.
 *
 *   1. **잔액은 다리 합계다.** 무엇을 어떻게 겹쳐 저장해도 이 불변식이 깨지지 않는다.
 *      잔액은 캐시일 뿐이라 한 번 어긋나면 스스로 맞지 않는다.
 *   2. **내가 본 판이 아니면 저장되지 않는다.** 폼을 열어 둔 사이 남이 고쳤으면
 *      `ENTRY_MODIFIED` 로 거절한다. 조용히 덮으면 그 편집이 흔적 없이 사라진다 (D6).
 *   3. **본 판 그대로면 저장된다.** 1·2 를 지키느라 멀쩡한 수정까지 막으면 안 된다.
 *   4. **같은 뜻의 두 요청은 같은 곳에 닿는다.** 같은 태그를 동시에 붙여도 오류가 아니다.
 *   5. **지우기는 확인한 조건 위에서만 이뤄진다.** 잔액이 남은 통장, 쓰이는 분류는 그대로
 *      거절되고, 지운 자리에는 자리표가 남는다(그러지 않으면 기기의 사본에 유령이 남는다).
 */
import { Prisma } from '@prisma/client';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeCategories,
  makeEntries,
  makeBudgets,
  makeLedger,
  makePeople,
  makeTags,
  projectAccessStub,
  runSmoke,
  lineTargets,
} from './smoke-harness';

runSmoke('entry-concurrency', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = makePeople(ctx.prisma, access);
  const categories = makeCategories(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const tags = makeTags(ctx.prisma, access);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;

  const bank = await accounts.createAccount(
    uid,
    {
      type: 'deposit',
      ownerId: person.id,
      name: '보통예금',
      institutionId: 'fi_bank_shinhan',
      openingBalance: '1000000',
    } as never,
    pid,
  );

  /** 잔액과 다리 합계가 같은가. 이 스크립트가 지키려는 단 하나의 불변식이다. */
  const balanceMatchesPostings = async (label: string) => {
    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } });
    const sum = await ctx.prisma.posting.aggregate({
      _sum: { amount: true },
      where: { accountId: bank.id },
    });
    const total = sum._sum.amount ?? new Prisma.Decimal(0);
    ctx.check(label, account.balance.toString(), total.toString());
  };

  const write = (amount: string) => ({
    kind: 'expense' as const,
    personId: person.id,
    date: '2026-09-03T00:00:00.000Z',
    description: '점심',
    amount,
    categoryId: dining.id,
    accountId: bank.id,
  });

  await balanceMatchesPostings('기초잔액만 있을 때');

  // ── 1. 같은 거래를 동시에 고친다 ──
  //
  // 겹치지 않으면 이 검사는 아무것도 보지 않는다. Promise.all 로 던져 커넥션 둘을
  // 쓰게 하고, 잠금이 없다면 둘 다 같은 옛 다리를 읽는 자리를 만든다.
  const target = await entries.createEntry(uid, write('10000'), pid);

  const [a, b] = await Promise.allSettled([
    entries.updateEntry(target.id, uid, write('20000')),
    entries.updateEntry(target.id, uid, write('30000')),
  ]);
  ctx.check('겹친 수정 둘 다 처리됨', `${a.status},${b.status}`, 'fulfilled,fulfilled');
  await balanceMatchesPostings('같은 거래를 동시에 고친 뒤');

  // ── 2. 수정과 삭제가 겹칠 때 ──
  //
  // 지운 전표를 고치려던 쪽은 실패해야 하고, 실패했다면 잔액에 자국을 남기지 않아야 한다.
  const doomed = await entries.createEntry(uid, write('7000'), pid);
  await Promise.allSettled([
    entries.updateEntry(doomed.id, uid, write('9000')),
    entries.deleteEntry(doomed.id, uid),
  ]);
  await balanceMatchesPostings('수정과 삭제가 겹친 뒤');

  // ── 3. 여럿이 한꺼번에 만들 때 ──
  const many = await Promise.all(
    ['1000', '2000', '3000', '4000', '5000'].map((amount) =>
      entries.createEntry(uid, write(amount), pid),
    ),
  );
  ctx.check('동시에 만든 거래 수', many.length, 5);
  await balanceMatchesPostings('동시에 다섯 건을 만든 뒤');

  // ── 4. 내가 본 판이 아니면 거절한다 ──
  //
  // 목록에도 실려야 한다. 수정 폼은 상세가 아니라 목록 한 줄에서 열리므로, 여기가
  // 비면 화면이 보낼 값이 없어 검사가 통째로 꺼진다 -- 아무 오류도 나지 않은 채로.
  const list = await entries.getEntries(uid, { limit: 5 }, pid);
  ctx.check('목록 한 줄에 시계가 실린다', typeof list.data[0]?.updatedHlc, 'string');

  const seen = await entries.getEntryById(target.id, uid);
  ctx.check('상세에도 실린다', typeof seen.updatedHlc, 'string');

  // 본 판 그대로면 저장된다.
  await entries.updateEntry(target.id, uid, { ...write('11000'), baseHlc: seen.updatedHlc });
  const after = await entries.getEntryById(target.id, uid);
  ctx.check('본 판 그대로면 저장된다', after.amount, '11000');
  ctx.check('저장하면 시계가 바뀐다', after.updatedHlc !== seen.updatedHlc, true);

  // 그 사이 남이 고쳤으면(= 내가 든 시계가 옛것이면) 거절한다.
  let code: unknown = '거절되지 않음';
  try {
    await entries.updateEntry(target.id, uid, { ...write('99000'), baseHlc: seen.updatedHlc });
  } catch (error) {
    code = (error as { response?: { code?: string } })?.response?.code;
  }
  ctx.check('옛 판으로 저장하면 거절', code, 'ENTRY_MODIFIED');

  const kept = await entries.getEntryById(target.id, uid);
  ctx.check('거절된 값은 반영되지 않는다', kept.amount, '11000');
  await balanceMatchesPostings('충돌로 거절된 뒤');

  // 시계를 보내지 않으면 지금까지처럼 그냥 저장된다 (옛 화면).
  await entries.updateEntry(target.id, uid, write('12000'));
  ctx.check(
    '시계를 안 보내면 검사하지 않는다',
    (await entries.getEntryById(target.id, uid)).amount,
    '12000',
  );
  await balanceMatchesPostings('마지막');

  // ── 5. 같은 태그를 동시에 붙일 때 ──
  //
  // 둘 다 "아직 없다"로 읽고 둘 다 넣는다. 늦은 쪽이 유일 제약에 걸려 500 이 되던 자리다.
  // 둘이 바란 결과는 같으므로 오류가 아니라 같은 상태에 닿아야 한다.
  const tag = await tags.createTag(uid, { name: '여행' } as never, pid);
  const tagTargets = await lineTargets(ctx.prisma, [target.id]);
  const tagged = await Promise.allSettled([
    entries.changeTags(uid, { targets: tagTargets, addTagIds: [tag.id] }, pid),
    entries.changeTags(uid, { targets: tagTargets, addTagIds: [tag.id] }, pid),
  ]);
  ctx.check(
    '같은 태그를 동시에 붙여도 터지지 않는다',
    tagged.map((one) => one.status).join(','),
    'fulfilled,fulfilled',
  );
  ctx.check(
    '연결은 하나만 남는다',
    await ctx.prisma.entryTag.count({ where: { entryId: target.id, tagId: tag.id } }),
    1,
  );

  // ── 6. 숨기기는 확인한 조건 위에서만 이뤄진다 ──
  //
  // 잔액이 남은 통장은 숨길 수 없다. 확인을 트랜잭션 밖에서 하던 때에는 그 사이에
  // 들어온 거래가 이 조건을 깨도 그대로 숨겨졌다.
  await ctx.expectReject('잔액이 남은 통장 숨기기 거부', () =>
    accounts.deactivateAccount(bank.id, uid),
  );

  // ── 7. 분류를 지우면 행이 사라지고 자리표가 남는다 ──
  //
  // 감춰 두는 자리는 없어졌다(20260919150000_no_hidden_rows). 지운 것을 오프라인 기기에
  // 알리는 길은 자리표뿐이라, 남기지 않으면 지운 줄이 그 기기의 사본에 그대로 남는다.
  const spare = await categories.createCategory(uid, { name: '안 쓰는 분류', type: 'expense' } as never, pid);
  await categories.deleteCategory(spare.id, uid);
  ctx.check('분류가 지워졌다', await ctx.prisma.category.count({ where: { id: spare.id } }), 0);
  ctx.check(
    '지운 자리에 자리표가 남는다',
    await ctx.prisma.tombstone.count({ where: { entity: 'Category', entityId: spare.id } }),
    1,
  );

  // 쓰이고 있는 분류는 지울 수 없다. 확인이 트랜잭션 안으로 들어가도 그대로다.
  await ctx.expectReject('쓰이는 분류 지우기 거부', () =>
    categories.deleteCategory(dining.id, uid),
  );

  // ── 8. 같은 예산을 동시에 정할 때 (2026-10-16) ──
  //
  // 둘 다 "그 달에 규칙이 없다"를 보고 각자 만들어 같은 달에 규칙이 둘 서던 자리다. 유일 조건은
  // 분류 예산의 tagId(null) 때문에 걸리지 않는다. 예산 잠금으로 줄을 세운다.
  const budgets = makeBudgets(ctx.prisma, access);
  const budgetCat = cats.find((c) => c.name === '교통')!;
  const budgetRuns = await Promise.allSettled(
    ['100000', '200000', '300000', '400000'].map((amount) =>
      budgets.createBudget(
        uid,
        { categoryId: budgetCat.id, monthlyAmount: amount, yearMonth: '2026-09' } as never,
        pid,
      ),
    ),
  );
  ctx.check(
    '동시에 정한 예산 모두 처리됨',
    budgetRuns.map((one) => one.status).join(','),
    'fulfilled,fulfilled,fulfilled,fulfilled',
  );
  ctx.check(
    '같은 달의 규칙은 하나',
    await ctx.prisma.budget.count({ where: { projectId: pid, categoryId: budgetCat.id } }),
    1,
  );

  // ── 9. 태그·분류 바꾸기와 거래 고치기가 겹칠 때 (2026-10-16) ──
  //
  // 둘은 원장 잠금을 잡지 않아, 고치기가 시계를 확인한 뒤 태그를 갈아 끼우는 사이에 끼어들거나
  // 잠그는 차례가 엇갈려 교착(500)이 났다. 겹쳐 던져도 모두 끝나고 잔액이 맞아야 한다.
  const tag2 = await tags.createTag(uid, { name: '출장' } as never, pid);
  const shopping = cats.find((c) => c.name === '쇼핑')!;
  for (let round = 0; round < 5; round += 1) {
    const lines = await lineTargets(ctx.prisma, [target.id]);
    const overlapped = await Promise.allSettled([
      entries.changeTags(uid, { targets: lines, addTagIds: [tag2.id] }, pid),
      entries.changeCategory(
        uid,
        { targets: lines, categoryId: round % 2 ? dining.id : shopping.id } as never,
        pid,
      ),
      entries.updateEntry(target.id, uid, write(String(13000 + round))),
    ]);
    const failed = overlapped.filter((one) => one.status === 'rejected') as PromiseRejectedResult[];
    ctx.check(
      `겹친 태그·분류·고치기가 모두 끝난다 (${round + 1})`,
      failed.map((one) => String(one.reason?.message ?? one.reason)).join(' | '),
      '',
    );
  }
  await balanceMatchesPostings('태그·분류·고치기를 겹친 뒤');

  // ── 10. 갈 곳 없는 분류 합치기와 그 분류로 적기가 겹칠 때 (2026-10-16) ──
  //
  // 합치기가 "거래 0건"을 잠금 밖에서 센 뒤 지우면, 그 사이 적힌 거래의 분류 다리가 cascade 로
  // 사라지고 잔액만 남았다. 어느 쪽이 이기든 다리가 반쪽인 전표가 남으면 안 된다.
  for (let round = 0; round < 5; round += 1) {
    const doomedCat = await categories.createCategory(
      uid,
      { name: `곧 없어질 분류 ${round}`, type: 'expense' } as never,
      pid,
    );
    // 적기를 먼저 던진다. 적기가 잠금을 쥔 사이 합치기의 바깥 세기가 0 을 보는 자리다.
    const raced = await Promise.allSettled([
      entries.createEntry(uid, { ...write('1500'), categoryId: doomedCat.id }, pid),
      categories.mergeCategories(uid, { moves: [{ fromId: doomedCat.id }] } as never, pid),
    ]);
    const created = raced[0].status === "fulfilled" ? raced[0].value : null;
    if (created) {
      ctx.check(
        `적힌 거래의 다리가 온전하다 (${round + 1})`,
        await ctx.prisma.posting.count({ where: { entryId: created.id } }),
        2,
      );
    }
  }
  await balanceMatchesPostings('합치기와 적기를 겹친 뒤');

  // ── 12. 숨긴 통장에 새로 적기 (2026-10-16) ──
  //
  // 숨기기는 잔액 0 을 확인하고 숨기는데, 거래 쪽이 숨겼는지를 보지 않아 숨긴 뒤 도착한 거래가 숨긴 통장에
  // 잔액을 남겼다. 새로 적는 것만 막고, 그 통장을 이미 쓰던 거래를 고치는 것은 막지 않는다.
  const salary = cats.find((c) => c.name === '급여')!;
  const makeWallet = (name: string) =>
    accounts.createAccount(
      uid,
      { type: 'deposit', ownerId: person.id, name, institutionId: 'fi_bank_shinhan' } as never,
      pid,
    );
  const sleepy = await makeWallet('숨길 통장');
  const spent = await entries.createEntry(uid, { ...write('1000'), accountId: sleepy.id }, pid);
  await entries.createEntry(
    uid,
    { kind: 'income', personId: person.id, date: '2026-09-03T00:00:00.000Z', description: '채움', amount: '1000', categoryId: salary.id, accountId: sleepy.id } as never,
    pid,
  );
  await accounts.deactivateAccount(sleepy.id, uid);
  let hiddenCode: unknown = '거절되지 않음';
  try {
    await entries.createEntry(uid, { ...write('500'), accountId: sleepy.id }, pid);
  } catch (error) {
    hiddenCode = (error as { response?: { code?: string } })?.response?.code;
  }
  ctx.check('숨긴 통장에 새로 적기는 거절', hiddenCode, 'ACCOUNT_INACTIVE');
  await entries.updateEntry(spent.id, uid, { ...write('1000'), accountId: sleepy.id, description: '메모만 고침' });
  ctx.check(
    '숨긴 통장을 쓰던 거래는 고칠 수 있다',
    (await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: spent.id } })).description,
    '메모만 고침',
  );

  // 숨기기와 그 통장에 적기가 겹쳐도, 숨긴 통장에 잔액이 남지 않는다.
  for (let round = 0; round < 5; round += 1) {
    const wallet = await makeWallet(`겹칠 통장 ${round}`);
    await Promise.allSettled([
      accounts.deactivateAccount(wallet.id, uid),
      entries.createEntry(uid, { ...write('700'), accountId: wallet.id }, pid),
    ]);
    const after = await ctx.prisma.account.findUniqueOrThrow({ where: { id: wallet.id } });
    ctx.check(
      `숨긴 통장에 잔액이 남지 않는다 (${round + 1})`,
      after.isActive || after.balance.isZero(),
      true,
    );
  }

  // ── 11. 같은 줄의 다른 필드를 겹쳐 고칠 때 (2026-10-16) ──
  //
  // 필드별 시계를 읽어 찍고 통째로 다시 쓰면 늦게 쓴 쪽이 앞 필드의 시계를 지웠다. 그러면 그 필드에
  // 대한 더 오래된 오프라인 편집이 충돌 없이 이긴다. 겹쳐도 두 필드의 시계가 모두 남아야 한다.
  for (let round = 0; round < 5; round += 1) {
    const someone = await people.createPerson(uid, { name: `시계 ${round}` }, pid);
    // 만들 때 두 필드에 시계가 찍힌다. 비워 두어야 겹친 편집이 남긴 것만 본다.
    await ctx.prisma.person.update({ where: { id: someone.id }, data: { fieldHlc: {} } });
    await Promise.all([
      people.updatePerson(someone.id, uid, { name: `이름 ${round}` } as never),
      people.updatePerson(someone.id, uid, { relationship: `관계 ${round}` } as never),
    ]);
    const row = await ctx.prisma.person.findUniqueOrThrow({ where: { id: someone.id } });
    const clocks = (row.fieldHlc ?? {}) as Record<string, string>;
    ctx.check(
      `겹친 편집 뒤 두 필드의 시계가 남는다 (${round + 1})`,
      ['name', 'relationship'].every((field) => typeof clocks[field] === 'string'),
      true,
    );
  }
});
