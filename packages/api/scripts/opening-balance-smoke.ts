import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { ledgerOpeningDate } from '@money/types';
import { makeAccounts, makeEntries, makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 기초잔액 검증.
 *
 * 이 파일은 `balance-date-smoke.ts`를 대체한다. 예전에는 사용자가 "기준일"을 골라
 * 그 시점 잔액을 맞추고, 차액을 조정 전표로 그 날짜에 쌓았다. 지금은 그 개념이 없다.
 * 기초잔액 전표 하나를 원장 맨 앞(1899-01-01)에 두고 금액만 다시 계산해 덮어쓴다.
 * 옛 스크립트는 사라진 `openingBalanceDate`/`balanceDate`를 계속 넘기고 있었는데,
 * DTO가 인터페이스라 조용히 무시됐고 검사만 깨진 채로 남아 있었다.
 *
 * 지금 지켜야 하는 성질은 아래 넷이다.
 *   1. 잔액을 설정하면 현재 잔액이 정확히 목표값이 된다.
 *   2. 그 사이의 거래는 지워지거나 바뀌지 않는다.
 *   3. 몇 번을 고쳐도 기초잔액 전표는 하나뿐이다 (조정 전표가 쌓이지 않는다).
 *   4. 잔액 = posting 합계 (드리프트 없음).
 */
runSmoke('opening-balance', async (ctx) => {
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

  const balanceOf = async (accountId: string) =>
    (await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance.toString();

  const openingEntries = (accountId: string) =>
    ctx.prisma.journalEntry.count({
      where: { projectId: pid, postings: { some: { accountId } }, date: ledgerOpeningDate() },
    });

  // ── 개설 잔액 ──────────────────────────────────────────────
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  ctx.check('개설 잔액', bank.balance, '1000000');
  ctx.check('기초잔액 전표 1건', await openingEntries(bank.id), 1);

  // 기준일을 고르지 않으므로 항상 원장 맨 앞에 놓인다.
  // 그래야 어떤 과거 거래를 넣어도 원장의 첫 줄이 기초잔액으로 남는다.
  const opening = await ctx.prisma.journalEntry.findFirstOrThrow({
    where: { projectId: pid, postings: { some: { accountId: bank.id } } },
    orderBy: { date: 'asc' },
  });
  ctx.check('기초잔액은 원장 맨 앞', opening.date.toISOString(), ledgerOpeningDate().toISOString());

  // ── 거래가 있는 상태에서 잔액을 고친다 ─────────────────────
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-20T03:00:00.000Z',
    description: '저녁', amount: '100000', categoryId: dining.id, accountId: bank.id,
  }, pid);
  ctx.check('지출 반영 잔액', await balanceOf(bank.id), '900000');

  await accounts.updateAccount(bank.id, uid, { balance: '850000' });
  ctx.check('잔액이 목표값이 된다', await balanceOf(bank.id), '850000');
  ctx.check('기초잔액 전표는 여전히 1건', await openingEntries(bank.id), 1);
  ctx.check(
    '지출은 그대로 남는다',
    await ctx.prisma.journalEntry.count({ where: { projectId: pid, description: '저녁' } }),
    1,
  );
  // 850,000 = 기초잔액 950,000 - 지출 100,000
  ctx.check(
    '기초잔액이 역산되어 덮어써진다',
    (await ctx.prisma.posting.findFirstOrThrow({
      where: { accountId: bank.id, entry: { date: ledgerOpeningDate() } },
    })).amount.toString(),
    '950000',
  );

  // 여러 번 고쳐도 전표는 늘지 않는다 (옛 설계는 고칠 때마다 조정 전표를 쌓았다)
  await accounts.updateAccount(bank.id, uid, { balance: '700000' });
  await accounts.updateAccount(bank.id, uid, { balance: '1200000' });
  ctx.check('세 번 고쳐도 기초잔액 전표는 1건', await openingEntries(bank.id), 1);
  ctx.check('마지막 목표값', await balanceOf(bank.id), '1200000');
  ctx.check(
    '이 계좌의 전표는 기초잔액 + 지출 2건뿐',
    await ctx.prisma.journalEntry.count({
      where: { projectId: pid, postings: { some: { accountId: bank.id } } },
    }),
    2,
  );

  // ── 기초잔액이 0이 되면 전표를 남기지 않는다 ───────────────
  // 지출 10만이 있으므로 잔액을 -10만으로 맞추면 기초잔액이 정확히 0이 된다.
  await accounts.updateAccount(bank.id, uid, { balance: '-100000' });
  ctx.check('기초잔액 0이면 전표를 지운다', await openingEntries(bank.id), 0);
  ctx.check('그래도 잔액은 목표값', await balanceOf(bank.id), '-100000');

  /*
   * 커버되지 않는 부분: setBalanceTo의 동시 실행.
   *
   * 읽고-고쳐-쓰기 구조라 프로젝트 단위 자문 잠금으로 직렬화한다. 이 스크립트에
   * 동시 호출 검사를 넣어 봤지만, 잠금을 빼고 돌려도 5회 중 2회만 재현됐다.
   * 첫 트랜잭션이 다른 트랜잭션이 읽기 전에 커밋되는 경우가 많아서다.
   * 확률적으로만 잡히는 검사는 통과했다는 사실이 아무것도 보장하지 않으므로
   * 넣지 않았다. 이 경로를 고칠 때는 잠금이 그대로 있는지 눈으로 확인해야 한다.
   */

  // ── 잔액 = posting 합계 불변식 ─────────────────────────────
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
