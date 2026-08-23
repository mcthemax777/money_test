import { Prisma } from '@prisma/client';
import { CardsService } from '@/modules/cards/cards.service';

const D = (n: string | number) => new Prisma.Decimal(n);
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

runSmoke('ledger', async (ctx) => {
  // ── 준비 ──
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  // 권한 검증은 스모크 범위 밖이라 통과시킨다. 타임존은 실제 프로젝트 값을 읽는다.
  const access = projectAccessStub(ctx.prisma, pid);
  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const person = await ctx.prisma.person.create({ data: { projectId: pid, name: '김철수' } });

  const bank = await ctx.prisma.account.create({
    data: { projectId: pid, ownerId: person.id, type: 'deposit', name: '보통예금' },
  });
  await ledger.setBalanceTo({
    projectId: pid, accountId: bank.id, targetBalance: D(1_000_000),
  });
  const savings = await ctx.prisma.account.create({
    data: { projectId: pid, ownerId: person.id, type: 'savings', name: '저축통장' },
  });
  // 카드는 서비스로 만든다. 신용카드는 부채 계정이 자동으로 함께 생겨야 한다.
  const creditCard = await cards.createCard('u1', {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25, creditLimit: '5000000',
  }, pid);
  const debitCard = await cards.createCard('u1', {
    paymentAccountId: bank.id, name: '신한 체크', cardType: 'debit', issuerId: 'fi_card_shinhan',
  }, pid);

  ctx.check('신용카드 부채 계정 자동 생성', Boolean(creditCard.liabilityAccountId), true);
  ctx.check('체크카드는 부채 계정 없음', debitCard.liabilityAccountId, null);
  ctx.check('신용카드 결제 통장 = 사용자가 고른 통장', creditCard.paymentAccountId, bank.id);
  const cardLiability = await ctx.prisma.account.findUniqueOrThrow({
    where: { id: creditCard.liabilityAccountId! },
  });
  ctx.check('부채 계정 유형', cardLiability.type, 'credit_card');
  ctx.check('부채 계정 소유자 = 통장 소유자', cardLiability.ownerId, person.id);

  const food = await ctx.prisma.category.create({
    data: { projectId: pid, name: '식비', type: 'expense' },
  });
  const rent = await ctx.prisma.category.create({
    data: { projectId: pid, name: '주거', type: 'expense', defaultIsFixed: true },
  });
  const goods = await ctx.prisma.category.create({
    data: { projectId: pid, name: '생활용품', type: 'expense' },
  });
  const fee = await ctx.prisma.category.create({
    data: { projectId: pid, name: '수수료', type: 'expense' },
  });
  const salary = await ctx.prisma.category.create({
    data: { projectId: pid, name: '급여', type: 'income' },
  });

  const base = { projectId: pid, personId: person.id, date: new Date('2026-08-03T00:00:00Z') };

  // ── 1. 체크카드 지출 ──
  await ledger.createExpense({
    ...base, description: '스타벅스', cardId: debitCard.id,
    lines: [{ categoryId: food.id, amount: D(5000) }],
  });
  ctx.check('체크카드 지출 후 예금', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '995000');

  // ── 2. 신용카드 지출 (부채 계정에만 쌓인다) ──
  await ledger.createExpense({
    ...base, description: '이마트', cardId: creditCard.id,
    lines: [{ categoryId: food.id, amount: D(30000) }, { categoryId: goods.id, amount: D(10000) }],
  });
  ctx.check('신용카드 지출 후 예금 (변동 없어야 함)', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '995000');
  ctx.check('신용카드 부채', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: cardLiability.id } })).balance, '-40000');

  // 청구서 행을 만들지 않는다. 주기는 카드의 현재 마감일로 읽을 때 계산한다.
  ctx.check('청구서 행을 만들지 않는다',
    await ctx.prisma.cardStatement.count({ where: { cardId: creditCard.id } }), 0);

  // ── 3. isFixed 기본값이 카테고리에서 오는지 ──
  await ledger.createExpense({
    ...base, description: '월세', accountId: bank.id,
    lines: [{ categoryId: rent.id, amount: D(700000) }],
  });
  const rentPosting = await ctx.prisma.posting.findFirstOrThrow({ where: { categoryId: rent.id } });
  ctx.check('월세 isFixed 기본값 상속', rentPosting.isFixed, true);
  const foodPosting = await ctx.prisma.posting.findFirstOrThrow({ where: { categoryId: food.id } });
  ctx.check('식비 isFixed 기본값', foodPosting.isFixed, false);

  // ── 4. 수입 ──
  await ledger.createIncome({
    ...base, description: '8월 급여', accountId: bank.id,
    lines: [{ categoryId: salary.id, amount: D(3_000_000) }],
  });
  ctx.check('급여 입금 후 예금', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '3295000');

  // ── 5. 이체 + 수수료 (3-leg) ──
  const transfer = await ledger.createTransfer({
    ...base, description: '저축 이체',
    fromAccountId: bank.id, toAccountId: savings.id,
    amount: D(100_000), feeAmount: D(500), feeCategoryId: fee.id,
  });
  ctx.check('이체 전표 leg 수', transfer.postings.length, 3);
  ctx.check('이체 후 보내는 계좌', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '3194500');
  ctx.check('이체 후 받는 계좌', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: savings.id } })).balance, '100000');

  // ── 6. 카드대금 결제 ──
  await ledger.createCardTransfer({
    ...base, date: new Date('2026-08-25T00:00:00Z'), description: '신한카드 결제',
    cardId: creditCard.id, accountId: bank.id, amount: D(40000), direction: 'payment',
  });
  ctx.check('카드 결제 후 부채 (0이어야 함)', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: cardLiability.id } })).balance, '0');
  ctx.check('카드 결제 후 예금', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '3154500');

  // ── 7. 정합성: 모든 전표의 합이 0 ──
  /*
   * 균형은 환산액(baseAmount)으로 본다. 통화가 섞인 전표는 amount 합계가 0이 될
   * 수 없다(달러와 원을 더하는 셈이다). 그리고 이 프로젝트로 범위를 좁힌다.
   * 예전에는 Posting 전체를 훑어서, 다른 프로젝트의 외화 거래 하나에도 실패했다.
   */
  const unbalanced = await ctx.prisma.$queryRaw<{ entryId: string }[]>`
    SELECT p."entryId" FROM "Posting" p
    JOIN "JournalEntry" e ON e.id = p."entryId"
    WHERE e."projectId" = ${pid}
    GROUP BY p."entryId" HAVING SUM(p."baseAmount") <> 0`;
  ctx.check('불균형 전표 수', unbalanced.length, 0);

  // ── 8. 정합성: 캐시된 잔액 = posting 합계 ──
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a
    LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance
    HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트 계좌 수', drift.length, 0);

  // ── 9. 지출 합계가 결제수단과 무관한지 ──
  const expense = await ctx.prisma.posting.aggregate({
    _sum: { amount: true },
    where: { category: { type: 'expense' }, entry: { projectId: pid } },
  });
  // 5000 + 40000 + 700000 + 500(수수료) = 745500
  ctx.check('지출 카테고리 합계', expense._sum.amount, '745500');

  // ── 9-b. 순자산은 자본 계정을 제외해야 한다 ──
  const netWorth = await ctx.prisma.account.aggregate({
    _sum: { balance: true },
    where: { projectId: pid, type: { not: 'opening_balance' } },
  });
  ctx.check('순자산 (자본 계정 제외)', netWorth._sum.balance, '3254500');
  // 회계 항등식: 모든 계좌 잔액 합계 + 모든 카테고리 posting 합계 = 0
  // (계좌 합계는 자본 계정을 포함하면 "수입 - 지출"과 같아진다)
  const allAccounts = await ctx.prisma.account.aggregate({ _sum: { balance: true }, where: { projectId: pid } });
  const allCategoryPostings = await ctx.prisma.posting.aggregate({
    _sum: { amount: true },
    where: { categoryId: { not: null }, entry: { projectId: pid } },
  });
  ctx.check(
    '회계 항등식 (계좌 합계 + 카테고리 합계 = 0)',
    (allAccounts._sum.balance ?? D(0)).add(allCategoryPostings._sum.amount ?? D(0)).toString(),
    '0',
  );

  // ── 9-c. 부채 계정은 통장 목록에 안 보여야 한다 ──
  const visibleAccounts = await ctx.prisma.account.findMany({
    where: { projectId: pid, type: { notIn: ['credit_card', 'opening_balance'] } },
    select: { name: true },
  });
  ctx.check('통장 목록에 보이는 계좌 수 (보통예금+저축통장)', visibleAccounts.length, 2);

  // ── 9-d. 카드 화면의 "사용액"은 양수로 나와야 한다 ──
  const cardList = await cards.getCards('u1', pid);
  const credit = cardList.find((c: any) => c.id === creditCard.id);
  ctx.check('카드 사용액 표시 (결제 후 0)', credit?.currentUsage ?? '', '0');

  // ── 10. 전표 삭제 시 잔액 롤백 ──
  await ledger.deleteEntry(transfer.id, pid);
  ctx.check('이체 삭제 후 받는 계좌', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: savings.id } })).balance, '0');
  ctx.check('이체 삭제 후 보내는 계좌', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance, '3255000');

  // ── 11. 검증 실패 케이스 ──
  await ctx.expectReject('수입 카테고리로 지출 생성 거부', () => ledger.createExpense({
    ...base, description: 'x', accountId: bank.id, lines: [{ categoryId: salary.id, amount: D(100) }],
  }));
  await ctx.expectReject('계좌와 카드 동시 지정 거부', () => ledger.createExpense({
    ...base, description: 'x', accountId: bank.id, cardId: debitCard.id,
    lines: [{ categoryId: food.id, amount: D(100) }],
  }));
  await ctx.expectReject('같은 계좌 이체 거부', () => ledger.createTransfer({
    ...base, description: 'x', fromAccountId: bank.id, toAccountId: bank.id, amount: D(100),
  }));
  // 균형은 환산액(baseAmount)으로 판정한다. 원화 프로젝트라 amount와 같은 값이다.
  const krwLeg = (leg: { accountId?: string; categoryId?: string }, amount: Prisma.Decimal) => ({
    ...leg, amount, currency: 'KRW', exchangeRate: D(1), baseAmount: amount,
  });
  await ctx.expectReject('불균형 전표 직접 생성 거부', () => ledger.createEntry({
    ...base, description: 'x',
    postings: [krwLeg({ accountId: bank.id }, D(-100)), krwLeg({ categoryId: food.id }, D(50))],
  }));

  // ── 12. 미결제 사용액이 남은 카드는 삭제 불가 ──
  await ledger.createExpense({
    ...base, description: '미결제 남기기', cardId: creditCard.id,
    lines: [{ categoryId: food.id, amount: D(1000) }],
  });
  await ctx.expectReject('사용액 남은 카드 숨기기 거부', () => cards.deactivateCard(creditCard.id, 'u1'));
  await ledger.createCardTransfer({
    ...base, date: new Date('2026-09-25T00:00:00Z'), description: '잔액 정리',
    cardId: creditCard.id, accountId: bank.id, amount: D(1000), direction: 'payment',
  });
  await cards.deactivateCard(creditCard.id, 'u1');
  const deactivated = await ctx.prisma.account.findUniqueOrThrow({ where: { id: creditCard.liabilityAccountId! } });
  ctx.check('카드를 숨기면 부채 계정도 함께 내려간다', deactivated.isActive, false);
});
