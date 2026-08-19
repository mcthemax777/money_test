import { LedgerService } from '@/modules/ledger/ledger.service';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { StatementsService } from '@/modules/statements/statements.service';
import { runSmoke } from './smoke-harness';

/**
 * 결제된 청구서 보호.
 *
 * 청구액을 바꾸는 수정과 삭제는 막고, 청구서와 무관한 값은 계속 고칠 수 있어야 한다.
 */
runSmoke('statement-lock', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = {
    resolveAndVerifyProjectId: async (_u: string, p?: string) => p ?? pid,
    verifyUserHasAccessToProject: async () => undefined,
  } as any;

  const ledger = new LedgerService(ctx.prisma as any);
  const accounts = new AccountsService(ctx.prisma as any, access, ledger);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access);
  const entries = new EntriesService(ctx.prisma as any, access, ledger);
  const statements = new StatementsService(ctx.prisma as any, access, ledger);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
  const shopping = await categories.createCategory(uid, { name: '쇼핑', type: 'expense' }, pid);
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    openingBalance: '1000000', openingBalanceDate: '2026-01-01T00:00:00.000Z',
  }, pid);
  const card = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuer: '신한', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);

  const base = { personId: person.id, cardId: card.id, kind: 'expense' as const };

  // 8월분 두 건: 하나는 결제 대상, 하나는 다음 청구서(9월)
  const paidPurchase = await entries.createEntry(uid, {
    ...base, date: '2026-08-03T00:00:00.000Z', description: '8월 구매',
    amount: '50000', categoryId: food.id,
  }, pid);
  const openPurchase = await entries.createEntry(uid, {
    ...base, date: '2026-09-03T00:00:00.000Z', description: '9월 구매',
    amount: '30000', categoryId: food.id,
  }, pid);

  const list = await statements.getStatements(uid, { projectId: pid });
  const augStatement = list.find((s) => s.periodEnd.startsWith('2026-08-15'))!;
  await statements.payStatement(augStatement.id, uid, {
    accountId: bank.id, personId: person.id, date: '2026-08-25T00:00:00.000Z',
  });

  // ── 잠금 상태가 응답에 실리는가 ──
  const rows = await entries.getEntries(uid, { kind: 'expense' }, pid);
  const paidRow = rows.data.find((e) => e.description === '8월 구매')!;
  const openRow = rows.data.find((e) => e.description === '9월 구매')!;
  ctx.check('결제된 청구서 내역은 잠김', paidRow.lockedByStatement, true);
  ctx.check('미결제 청구서 내역은 안 잠김', openRow.lockedByStatement, false);
  // 화면이 날짜 입력 범위를 제한할 수 있도록 청구 기간을 함께 준다
  ctx.check('청구 기간 시작', paidRow.statementPeriodStart?.slice(0, 10), '2026-07-16');
  ctx.check('청구 기간 끝 (마감일)', paidRow.statementPeriodEnd?.slice(0, 10), '2026-08-15');

  // ── 막아야 하는 것 ──
  const edit = (over: Record<string, unknown>) =>
    entries.updateEntry(paidPurchase.id, uid, {
      ...base, date: '2026-08-05T00:00:00.000Z', description: '8월 구매',
      amount: '50000', categoryId: food.id, ...over,
    } as any);

  await ctx.expectReject('금액 변경 거부', () => edit({ amount: '60000' }));
  await ctx.expectReject('다른 청구서로 옮기는 날짜 변경 거부',
    () => edit({ date: '2026-09-03T00:00:00.000Z' }));
  await ctx.expectReject('결제수단 변경 거부',
    () => edit({ cardId: undefined, accountId: bank.id }));
  await ctx.expectReject('유형 변경 거부',
    () => edit({ kind: 'income', cardId: undefined, accountId: bank.id }));
  await ctx.expectReject('삭제 거부', () => entries.deleteEntry(paidPurchase.id, uid));

  // ── 같은 청구 주기 안에서의 날짜 수정은 허용되어야 한다 ──
  //
  // 마감 15일 카드라면 8/3과 8/5는 같은 청구서(7/16~8/15)에 속한다.
  // 청구액이 그대로이므로 막을 이유가 없다. 날짜 오타 정정이 여기에 해당한다.
  await edit({ date: '2026-08-05T00:00:00.000Z' });
  const sameCycle = await entries.getEntryById(paidPurchase.id, uid);
  ctx.check('같은 주기 안 날짜 수정 허용', sameCycle.date.slice(0, 10), '2026-08-05');
  await ctx.expectReject('주기를 넘는 날짜는 여전히 거부',
    () => entries.updateEntry(paidPurchase.id, uid, {
      ...base, date: '2026-08-20T00:00:00.000Z', description: '8월 구매',
      amount: '50000', categoryId: food.id,
    }));

  // ── 허용해야 하는 것 ──
  await edit({ description: '8월 구매 (수정)', merchant: '이마트', categoryId: shopping.id, isFixed: true });
  const afterEdit = await entries.getEntryById(paidPurchase.id, uid);
  ctx.check('설명 수정 허용', afterEdit.description, '8월 구매 (수정)');
  ctx.check('거래처 수정 허용', afterEdit.merchant, '이마트');
  ctx.check('분류 수정 허용', afterEdit.categoryName, '쇼핑');
  ctx.check('고정 여부 수정 허용', afterEdit.isFixed, true);

  // 수정 후에도 청구서가 그대로여야 한다
  const afterStatements = await statements.getStatements(uid, { projectId: pid });
  const augAfter = afterStatements.find((s) => s.periodEnd.startsWith('2026-08-15'))!;
  ctx.check('청구액 유지', augAfter.chargedAmount, '50000');
  ctx.check('미결제액 유지', augAfter.outstanding, '0');
  ctx.check('상태 유지', augAfter.status, 'paid');

  // ── 미결제 청구서 내역은 자유롭게 ──
  await entries.updateEntry(openPurchase.id, uid, {
    ...base, date: '2026-09-05T00:00:00.000Z', description: '9월 구매 (금액변경)',
    amount: '40000', categoryId: food.id,
  });
  const openAfter = await entries.getEntryById(openPurchase.id, uid);
  ctx.check('미결제 내역은 금액 변경 가능', openAfter.amount, '40000');
  // 미결제끼리는 청구 주기를 넘어가는 이동도 자유롭다
  await entries.updateEntry(openPurchase.id, uid, {
    ...base, date: '2026-10-05T00:00:00.000Z', description: '10월로 이동',
    amount: '40000', categoryId: food.id,
  });
  const moved = await entries.getEntryById(openPurchase.id, uid);
  ctx.check('미결제끼리는 다른 청구서로 이동 가능', moved.date.slice(0, 10), '2026-10-05');
  ctx.check('이동 후에도 안 잠김', moved.lockedByStatement, false);

  // 비워진 청구서가 목록에 남는지 확인 (청구액 0)
  const emptyStatements = (await statements.getStatements(uid, { projectId: pid }))
    .filter((st) => Number(st.chargedAmount) === 0);
  ctx.check('내역이 빠져 비워진 청구서가 남는다', emptyStatements.length >= 1, true);

  await entries.deleteEntry(openPurchase.id, uid);
  ctx.check('미결제 내역은 삭제 가능',
    (await entries.getEntries(uid, { kind: 'expense' }, pid)).data.length, 1);

  // ── 미결제 내역이라도 완납한 청구서로 옮기는 것은 막는다 ──
  //
  // 나가는 쪽만 검사하면 이 경로로 완납 청구서가 되살아난다(paid -> partial).
  const movable = await entries.createEntry(uid, {
    ...base, date: '2026-09-10T00:00:00.000Z', description: '옮길 내역',
    amount: '20000', categoryId: food.id,
  }, pid);
  ctx.check('옮기기 전에는 안 잠김',
    (await entries.getEntryById(movable.id, uid)).lockedByStatement, false);
  await ctx.expectReject('완납 청구서로 옮기는 것 거부',
    () => entries.updateEntry(movable.id, uid, {
      ...base, date: '2026-08-03T00:00:00.000Z', description: '옮길 내역',
      amount: '20000', categoryId: food.id,
    }));
  const augStill = await statements.getStatementById(augStatement.id, uid);
  ctx.check('완납 청구서 상태 유지', augStill.status, 'paid');
  ctx.check('완납 청구서 청구액 유지', augStill.chargedAmount, '50000');
  await entries.deleteEntry(movable.id, uid);

  // ── 부분 결제도 잠긴다 ──
  const sepPurchase = await entries.createEntry(uid, {
    ...base, date: '2026-10-03T00:00:00.000Z', description: '10월 구매',
    amount: '20000', categoryId: food.id,
  }, pid);
  const octStatement = (await statements.getStatements(uid, { projectId: pid }))
    .find((s) => s.periodEnd.startsWith('2026-10-15'))!;
  await statements.payStatement(octStatement.id, uid, {
    accountId: bank.id, personId: person.id, amount: '5000',
    date: '2026-10-25T00:00:00.000Z',
  });
  await ctx.expectReject('부분 결제된 청구서도 잠김',
    () => entries.deleteEntry(sepPurchase.id, uid));

  // ── 정합성 ──
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
