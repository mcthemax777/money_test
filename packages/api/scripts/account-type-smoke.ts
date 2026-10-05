/**
 * 계좌 유형 바꾸기와 "지금 잔액" 검사.
 *
 * 실행 (api 스모크 공통, 로컬 Postgres 필요):
 *   cd packages/api && node \
 *     -r <워크스페이스>/node_modules/.pnpm/tsconfig-paths@4.2.0/node_modules/tsconfig-paths/register.js \
 *     -r ts-node/register/transpile-only scripts/account-type-smoke.ts
 *
 *   1. 입출금으로 만든 통장을 예금으로 바꿀 수 있다. 자산 탭의 묶음이 이것으로 정해진다.
 *   2. 카드 부채·자본·미지정 유형으로는 바꿀 수 없다.
 *   3. 기관이 없는 유형(포인트·페이)으로 바꾸면 남은 기관 연결을 끊는다.
 *   4. 화면에 나가는 잔액은 지금까지의 거래만 센다. 미래 날짜의 거래는 빠진다.
 *   5. 잔액 맞추기의 목표도 지금 잔액이다. 칸(Account.balance)은 여전히 전부의 합이다.
 *   6. 카드 대금은 결제 통장의 묶음에 든다. 마이너스통장(대출) 카드는 대출 묶음이다.
 */
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

runSmoke('account-type', async (ctx) => {
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

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;

  // ── 유형 바꾸기 ────────────────────────────────────────────
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '정기예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  } as any, pid);

  const changed = await accounts.updateAccount(bank.id, uid, { type: 'time_deposit' });
  ctx.check('입출금을 예금으로 바꾼다', changed.type, 'time_deposit');
  ctx.check('기관은 그대로 남는다', changed.institutionId, 'fi_bank_shinhan');
  ctx.check('잔액은 그대로다', changed.balance.toString(), '1000000');

  await ctx.expectReject('카드 부채 유형으로는 바꿀 수 없다', () =>
    accounts.updateAccount(bank.id, uid, { type: 'credit_card' }),
  );
  await ctx.expectReject('자본 유형으로는 바꿀 수 없다', () =>
    accounts.updateAccount(bank.id, uid, { type: 'opening_balance' }),
  );
  await ctx.expectReject('없는 유형으로는 바꿀 수 없다', () =>
    accounts.updateAccount(bank.id, uid, { type: 'nope' as never }),
  );

  const pay = await accounts.updateAccount(bank.id, uid, { type: 'point_pay' });
  ctx.check('포인트·페이로 바꾸면 기관 연결을 끊는다', pay.institutionId, null);
  await ctx.expectReject('포인트·페이에는 기관을 붙일 수 없다', () =>
    accounts.updateAccount(bank.id, uid, { institutionId: 'fi_bank_shinhan' }),
  );

  // ── 지금 잔액 ─────────────────────────────────────────────
  const wallet = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '생활비', openingBalance: '500000',
  } as any, pid);
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: future,
    description: '다음 주 지출', amount: '200000', categoryId: dining.id, accountId: wallet.id,
  }, pid);

  const column = async () =>
    (await ctx.prisma.account.findUniqueOrThrow({ where: { id: wallet.id } })).balance.toString();
  const listed = async () =>
    (await accounts.getAccounts(uid, pid)).find((a) => a.id === wallet.id)!.balance.toString();

  ctx.check('칸은 미래 거래까지 더한다', await column(), '300000');
  ctx.check('목록 잔액은 미래 거래를 뺀다', await listed(), '500000');
  ctx.check(
    '상세 잔액도 미래 거래를 뺀다',
    (await accounts.getAccountById(wallet.id, uid)).balance.toString(),
    '500000',
  );

  await accounts.updateAccount(wallet.id, uid, { balance: '450000' });
  ctx.check('잔액 맞추기의 목표는 지금 잔액이다', await listed(), '450000');
  ctx.check('칸에는 미래 거래가 그 위에 얹힌다', await column(), '250000');

  await ctx.expectReject('미래 거래가 남은 통장은 숨길 수 없다', () =>
    accounts.deactivateAccount(wallet.id, uid),
  );

  // ── 카드 대금의 묶음 ──────────────────────────────────────
  const cards = makeCards(ctx.prisma, access, institutions);
  const reports = makeReports(ctx.prisma, access);
  const minus = await accounts.createAccount(uid, {
    type: 'loan', ownerId: person.id, name: '마이너스통장', openingBalance: '-1000000',
  } as any, pid);
  const minusCard = await cards.createCard(uid, {
    paymentAccountId: minus.id, name: '마이너스 카드', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);
  const walletCard = await cards.createCard(uid, {
    paymentAccountId: wallet.id, name: '생활비 카드', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const [cardId, amount] of [[minusCard.id, '30000'], [walletCard.id, '10000']] as const) {
    await entries.createEntry(uid, {
      kind: 'expense', personId: person.id, cardId, date: past,
      description: '카드 사용', amount, categoryId: dining.id,
    }, pid);
  }

  const worth = await reports.getNetWorth(uid, pid);
  // 입출금·현금 = 생활비 450,000 + 포인트·페이 1,000,000 - 생활비 카드 10,000
  ctx.check('바로 쓸 돈에는 그 통장 카드의 대금만 빠진다', worth.byGroup?.cash, '1440000');
  ctx.check('마이너스통장 카드 대금은 대출 묶음에 든다', worth.byGroup?.debt, '-1030000');
  ctx.check(
    '사람별 소계도 같다',
    worth.byPerson.find((row) => row.personId === person.id)?.byGroup?.debt,
    '-1030000',
  );
  ctx.check('유형별 소계는 그대로 카드 전부다', worth.byType.credit_card, '-40000');
});
