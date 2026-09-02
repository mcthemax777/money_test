import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { makeAccounts, makeEntries, makeLedger, makeReports, projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 카드 부채 총액 모델.
 *
 * 신용카드 거래는 계좌 거래와 똑같이 자유롭게 추가·수정·삭제된다.
 * 청구서를 저장하지 않고, 주기별 사용액은 카드의 현재 마감일로 읽을 때 계산한다.
 */
runSmoke('card-usage', async (ctx) => {
  const pid = (await ctx.createProject({ timezone: 'Asia/Seoul' } as any)).id;
  const uid = (await ctx.createUser()).id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access, ledger);
  const reports = makeReports(ctx.prisma, access);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금', openingBalance: '1000000',
  }, pid);
  const card = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);

  const base = { personId: person.id, cardId: card.id, kind: 'expense' as const };
  const spend = (over: Record<string, unknown>) =>
    entries.createEntry(uid, {
      ...base, date: '2026-08-03T00:00:00.000Z', description: '사용',
      amount: '10000', categoryId: food.id, ...over,
    } as any, pid);
  const usageOf = async (periodEnd: string, months = 24) =>
    (await cardLedger.getUsage(card.id, uid, months)).periods
      .find((p) => p.periodEnd.startsWith(periodEnd));
  const outstanding = async () => (await cardLedger.getUsage(card.id, uid)).outstanding;

  // ── 주기 배정 ──
  // 마감 15일이면 8/3은 7/16~8/15 주기, 8/20은 8/16~9/15 주기다.
  const aug = await spend({ date: '2026-08-03T00:00:00.000Z', amount: '50000' });
  await spend({ date: '2026-08-20T00:00:00.000Z', amount: '30000' });
  ctx.check('8/15 마감 주기 사용액', (await usageOf('2026-08-15'))?.usage, '50000');
  ctx.check('9/15 마감 주기 사용액', (await usageOf('2026-09-15'))?.usage, '30000');
  ctx.check('결제일은 마감 이후 처음 오는 25일',
    (await usageOf('2026-08-15'))?.dueDate?.slice(0, 10), '2026-08-25');
  ctx.check('남은 대금', await outstanding(), '80000');

  // ── 결제해도 사용분은 자유롭게 고쳐진다 (핵심) ──
  await cardLedger.transfer(card.id, uid, {
    accountId: bank.id, personId: person.id, amount: '80000',
    direction: 'payment', date: '2026-08-25T00:00:00.000Z',
  });
  ctx.check('전액 결제 후 남은 대금', await outstanding(), '0');

  const editAug = (over: Record<string, unknown>) =>
    entries.updateEntry(aug.id, uid, {
      ...base, date: '2026-08-03T00:00:00.000Z', description: '사용',
      amount: '50000', categoryId: food.id, ...over,
    } as any);

  await editAug({ amount: '20000' });
  ctx.check('결제 뒤에도 감액 가능', (await entries.getEntryById(aug.id, uid)).amount, '20000');
  ctx.check('감액분이 환불 예정으로 남는다', await outstanding(), '-30000');
  ctx.check('주기 사용액도 따라 줄어든다', (await usageOf('2026-08-15'))?.usage, '20000');

  // 카드사가 30,000을 통장에 넣어 주면 0으로 돌아온다
  await cardLedger.transfer(card.id, uid, {
    accountId: bank.id, personId: person.id, amount: '30000',
    direction: 'refund', date: '2026-09-01T00:00:00.000Z',
  });
  ctx.check('환불 입금 후 남은 대금', await outstanding(), '0');
  ctx.check('환불 입금은 사용액에 안 섞인다', (await usageOf('2026-08-15'))?.usage, '20000');

  const refundRow = (await entries.getEntries(uid, { kind: 'card_payment' }, pid)).data
    .find((e) => e.date.startsWith('2026-09-01'))!;
  ctx.check('환불 입금 방향', refundRow.cardTransferDirection, 'refund');
  ctx.check('결제 방향',
    (await entries.getEntries(uid, { kind: 'card_payment' }, pid)).data
      .find((e) => e.date.startsWith('2026-08-25'))!.cardTransferDirection, 'payment');
  ctx.check('카드별 조회에 이체가 잡힌다',
    (await entries.getEntries(uid, { cardId: card.id, kind: 'card_payment' }, pid)).data.length, 2);

  // 결제 전표 자체도 자유롭게 수정·삭제된다
  await entries.updateEntry(refundRow.id, uid, {
    personId: person.id, kind: 'card_payment', cardId: card.id, accountId: bank.id,
    date: '2026-09-01T00:00:00.000Z', description: '환불 입금', amount: '10000',
    cardTransferDirection: 'refund',
  } as any);
  ctx.check('환불 입금 감액 후 남은 대금', await outstanding(), '-20000');
  await entries.deleteEntry(refundRow.id, uid);
  ctx.check('환불 입금 삭제 후 남은 대금', await outstanding(), '-30000');

  // 사용분을 통째로 지워도 막히지 않는다
  await entries.deleteEntry(aug.id, uid);
  ctx.check('사용분 삭제 허용', (await usageOf('2026-08-15'))?.usage, '0');

  // ── 할부 ──
  // 10,000원 3개월. 끝수는 첫 회차에 몰아준다.
  const debtBefore = Number(await outstanding());
  const plan = await spend({
    date: '2026-10-03T00:00:00.000Z', amount: '10000', installmentMonths: 3,
  });
  ctx.check('할부 개월수가 응답에 실린다',
    (await entries.getEntryById(plan.id, uid)).installmentMonths, 3);
  ctx.check('1회차', (await usageOf('2026-10-15'))?.usage, '3334');
  ctx.check('2회차', (await usageOf('2026-11-15'))?.usage, '3333');
  ctx.check('3회차', (await usageOf('2026-12-15'))?.usage, '3333');
  // 청구는 3회로 나뉘지만 갚아야 할 돈은 구매 시점에 전액 생긴다
  ctx.check('부채는 구매 시점에 전액', Number(await outstanding()) - debtBefore, 10000);

  // 수정해도 할부 일정이 유지되어야 한다 (posting을 새로 만들기 때문)
  await entries.updateEntry(plan.id, uid, {
    ...base, date: '2026-10-03T00:00:00.000Z', description: '할부 수정',
    amount: '30000', categoryId: food.id, installmentMonths: 3,
  } as any);
  ctx.check('수정 후에도 할부 유지',
    (await entries.getEntryById(plan.id, uid)).installmentMonths, 3);
  ctx.check('수정 후 1회차', (await usageOf('2026-10-15'))?.usage, '10000');

  // ── 마감일을 바꾸면 과거 주기까지 즉시 다시 그려진다 ──
  await cards.updateCard(card.id, uid, { statementClosingDay: 25, paymentDueDay: 5 });
  ctx.check('마감 25일로 바꾸면 10/3은 10/25 마감 주기',
    (await usageOf('2026-10-25'))?.usage, '10000');
  ctx.check('옛 경계 주기는 사라진다', await usageOf('2026-10-15'), undefined);
  ctx.check('결제일도 다시 계산된다',
    (await usageOf('2026-10-25'))?.dueDate?.slice(0, 10), '2026-11-05');

  // ── 이체로도 같은 결과가 나와야 한다 ──
  //
  // 카드 화면의 "대금 기록하기"와 거래 추가의 이체는 같은 전표를 만든다.
  // 사용자가 어느 입구로 들어오든 결과가 하나로 모여야 한다.
  const liability = card.liabilityAccountId!;
  const debtBeforeTransfer = Number(await outstanding());

  await entries.createEntry(uid, {
    personId: person.id, kind: 'transfer', description: '통장에서 카드로',
    date: '2026-11-05T00:00:00.000Z', amount: '5000',
    accountId: bank.id, toAccountId: liability,
  } as any, pid);
  ctx.check('통장 -> 카드는 대금 결제',
    Number(await outstanding()) - debtBeforeTransfer, -5000);

  const payRow = (await entries.getEntries(uid, { cardId: card.id }, pid)).data
    .find((e) => e.date.startsWith('2026-11-05'))!;
  ctx.check('이체가 카드별 조회에 잡힌다', payRow.kind, 'card_payment');
  ctx.check('이체 방향 (대금 결제)', payRow.cardTransferDirection, 'payment');

  await entries.createEntry(uid, {
    personId: person.id, kind: 'transfer', description: '카드에서 통장으로',
    date: '2026-11-06T00:00:00.000Z', amount: '2000',
    accountId: liability, toAccountId: bank.id,
  } as any, pid);
  ctx.check('카드 -> 통장은 환불 입금',
    Number(await outstanding()) - debtBeforeTransfer, -3000);

  const refundViaTransfer = (await entries.getEntries(uid, { cardId: card.id }, pid)).data
    .find((e) => e.date.startsWith('2026-11-06'))!;
  ctx.check('이체 방향 (환불 입금)', refundViaTransfer.cardTransferDirection, 'refund');

  await ctx.expectReject('카드 이체에 수수료는 거부',
    () => entries.createEntry(uid, {
      personId: person.id, kind: 'transfer', description: '수수료 붙은 카드 이체',
      date: '2026-11-07T00:00:00.000Z', amount: '1000',
      accountId: bank.id, toAccountId: liability,
      transferFee: '500', transferFeeCategoryId: food.id,
    } as any, pid));

  // ── 이체는 목록에 남지만 월 합계에는 안 들어간다 ──
  //
  // 내 계좌 사이의 이동이라 수입도 지출도 아니고, 카드 사용액은 그을 때 이미
  // 지출로 잡혔다. 결제할 때 또 세면 같은 돈을 두 번 세게 된다.
  const nov = await reports.getSummary(uid, { yearMonth: '2026-11', projectId: pid } as any);
  ctx.check('11월 지출 (이체 3건뿐이라 0)', nov.expense, '0');
  ctx.check('11월 수입 (환불 입금이 수입이 아니다)', nov.income, '0');

  const novRows = await entries.getEntries(uid, {
    startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-30T23:59:59.999Z',
  } as any, pid);
  ctx.check('11월 목록에는 이체가 보인다', novRows.data.length, 2);

  // ── 정합성 ──
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
