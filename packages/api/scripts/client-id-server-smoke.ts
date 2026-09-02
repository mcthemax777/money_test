/**
 * 서버가 기기가 만든 id 를 받아들이는지.
 *
 * 실행하려면 경로 별칭 '@/' 를 풀 것이 필요하다 (ledger-rules-smoke 머리말 참고).
 *
 * `client-id-smoke` 는 id 자체를 본다. 여기서 보는 것은 그 id 가 실제 행의 기본 키가
 * 되는지, 그리고 잘못된 값과 겹친 값이 어떻게 거절되는지다. 2단계의 아웃박스는
 * 이 경로 위에 얹힌다.
 */
import { Prisma } from '@prisma/client';
import { newId, setRandomBytes } from '@money/types';
import { randomFillSync } from 'crypto';
import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeBudgets, makeEntries, makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

setRandomBytes((byteCount) => randomFillSync(new Uint8Array(byteCount)));

runSmoke('client-id-server', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const budgets = makeBudgets(ctx.prisma, access);

  // ── 기기가 정한 id 가 그대로 기본 키가 된다 ──
  const personId = newId();
  const person = await people.createPerson(uid, { id: personId, name: '김철수' }, pid);
  ctx.check('구성원 id', person.id, personId);

  const categoryId = newId();
  const category = await categories.createCategory(uid, {
    id: categoryId, name: '식비', type: 'expense',
  }, pid);
  ctx.check('카테고리 id', category.id, categoryId);

  const accountId = newId();
  const account = await accounts.createAccount(uid, {
    id: accountId, type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  ctx.check('계좌 id', account.id, accountId);

  const entryId = newId();
  const entry = await entries.createEntry(uid, {
    id: entryId, kind: 'expense', personId: person.id, date: '2026-08-05T03:00:00.000Z',
    description: '점심', amount: '9000', categoryId: category.id, accountId: account.id,
  }, pid);
  ctx.check('거래 id', entry.id, entryId);

  const budgetId = newId();
  const budget = await budgets.createBudget(uid, {
    id: budgetId, categoryId: category.id, monthlyAmount: '300000',
  }, pid);
  ctx.check('예산 id', budget.id, budgetId);

  // 신용카드는 부채 계정까지 두 id 를 함께 받는다
  const cardId = newId();
  const liabilityId = newId();
  const card = await cards.createCard(uid, {
    id: cardId, liabilityAccountId: liabilityId,
    paymentAccountId: account.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);
  ctx.check('카드 id', card.id, cardId);
  ctx.check('카드 부채 계정 id', card.liabilityAccountId, liabilityId);
  ctx.check('그 부채 계정이 실제로 있다',
    (await ctx.prisma.account.findUnique({ where: { id: liabilityId } }))?.type, 'credit_card');

  // 그 id 로 곧바로 고치고 지울 수 있다. 오프라인에서 필요한 것이 이것이다.
  await entries.updateEntry(entryId, uid, {
    kind: 'expense', personId: person.id, date: '2026-08-05T03:00:00.000Z',
    description: '점심(수정)', amount: '9500', categoryId: category.id, accountId: account.id,
  });
  ctx.check('기기가 만든 id 로 수정된다',
    (await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } })).description,
    '점심(수정)');

  // ── 겹친 id 는 409 로 거절한다 (500 이 아니다) ──
  await ctx.expectReject('같은 id 로 구성원을 또 만들면 거절', () =>
    people.createPerson(uid, { id: personId, name: '겹침' }, pid),
  );
  await ctx.expectReject('같은 id 로 거래를 또 만들면 거절', () =>
    entries.createEntry(uid, {
      id: entryId, kind: 'expense', personId: person.id, date: '2026-08-06T03:00:00.000Z',
      description: '중복', amount: '1000', categoryId: category.id, accountId: account.id,
    }, pid),
  );

  // 겹침이 걸린 뒤에도 원래 행은 그대로다
  ctx.check('거절이 원래 행을 건드리지 않는다',
    (await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } })).description,
    '점심(수정)');
  ctx.check('구성원 수도 그대로',
    await ctx.prisma.person.count({ where: { projectId: pid } }), 1);

  // ── 형식이 아니면 받지 않는다 ──
  const bad = ['not-a-uuid', '', '  ', 'cmtipz71n000i6fxrurwwyuhv', "' OR 1=1 --", personId.replace(/-/g, '')];
  for (const value of bad) {
    // 빈 문자열은 "id 를 주지 않았다"로 본다(폼이 빈 칸을 그렇게 보낸다).
    // 공백만 있는 값은 다르다. 없는 것이 아니라 잘못된 값이므로 거절해야 한다.
    if (value === '') {
      const made = await people.createPerson(uid, { id: value, name: '빈 id' }, pid);
      ctx.check('빈 문자열은 서버가 만든 id 로', made.id.includes('-'), false);
      continue;
    }
    await ctx.expectReject(`형식이 아니면 거절 (${JSON.stringify(value)})`, () =>
      people.createPerson(uid, { id: value, name: '나쁜 id' }, pid),
    );
  }

  // ── id 를 주지 않으면 지금까지처럼 서버가 만든다 ──
  const auto = await people.createPerson(uid, { name: '자동 id' }, pid);
  ctx.check('서버가 만든 id 는 cuid 모양', /^[a-z0-9]{20,32}$/.test(auto.id), true);
  ctx.check('그 값은 기기 id 형식이 아니다', auto.id.includes('-'), false);

  // ── 변경 피드가 그 id 를 그대로 실어 준다 ──
  const tombstoneBefore = await ctx.prisma.tombstone.count({ where: { projectId: pid } });
  await entries.deleteEntry(entryId, uid);
  const tombstone = await ctx.prisma.tombstone.findFirst({
    where: { projectId: pid, entity: 'JournalEntry', entityId: entryId },
  });
  ctx.check('지운 뒤 자리표에 기기가 만든 id 가 남는다', tombstone?.entityId, entryId);
  ctx.check('자리표가 하나 늘었다',
    await ctx.prisma.tombstone.count({ where: { projectId: pid } }), tombstoneBefore + 1);

  // 같은 id 로 다시 만들면 자리표가 걷힌다 (트리거가 하는 일)
  await entries.createEntry(uid, {
    id: entryId, kind: 'expense', personId: person.id, date: '2026-08-07T03:00:00.000Z',
    description: '되살린 거래', amount: '1000', categoryId: category.id, accountId: account.id,
  }, pid);
  ctx.check('되살리면 자리표가 걷힌다',
    await ctx.prisma.tombstone.count({
      where: { projectId: pid, entity: 'JournalEntry', entityId: entryId },
    }), 0);

  // 잔액은 되살린 거래까지 반영된 값이어야 한다 (100만 - 1000)
  ctx.check('잔액이 어긋나지 않는다',
    (await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance.toString(),
    new Prisma.Decimal('999000').toString());
});
