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
 *   5. **숨기기는 확인한 조건 위에서만 이뤄진다.** 잔액이 남은 통장, 쓰이는 분류는 그대로
 *      거절되고, 숨긴 자리에는 시계가 남는다(그러지 않으면 옛 편집이 되살린다).
 */
import { Prisma } from '@prisma/client';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeTags,
  projectAccessStub,
  runSmoke,
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
  const tagged = await Promise.allSettled([
    entries.changeTags(uid, { entryIds: [target.id], addTagIds: [tag.id] }, pid),
    entries.changeTags(uid, { entryIds: [target.id], addTagIds: [tag.id] }, pid),
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

  // ── 7. 분류를 숨기면 시계가 남는다 ──
  //
  // 남기지 않으면 그보다 앞선 오프라인 편집이 나중에 도착해 되살린다. 나머지 넷
  // (구성원·통장·카드·태그)과 같은 규칙이다.
  const spare = await categories.createCategory(uid, { name: '안 쓰는 분류', type: 'expense' } as never, pid);
  await categories.deleteCategory(spare.id, uid);
  const hidden = await ctx.prisma.category.findUniqueOrThrow({ where: { id: spare.id } });
  ctx.check('분류가 숨겨졌다', hidden.isActive, false);
  ctx.check(
    '숨기기에 시계가 남는다',
    typeof (hidden.fieldHlc as Record<string, string> | null)?.isActive,
    'string',
  );

  // 쓰이고 있는 분류는 숨길 수 없다. 확인이 트랜잭션 안으로 들어가도 그대로다.
  await ctx.expectReject('쓰이는 분류 숨기기 거부', () =>
    categories.deleteCategory(dining.id, uid),
  );
});
