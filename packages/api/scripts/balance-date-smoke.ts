import { Prisma } from '@prisma/client';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { PeopleService } from '@/modules/people/people.service';
import { projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 잔액 기준일 검증.
 *
 * 예전에는 차액을 "현재 총잔액" 기준으로 계산했다. 그래서 기준일 이후에 거래가 있는
 * 계좌에서는 기준일 잔액이 입력값과 달라졌다. 아래 검사는 기준일 종료 시점 잔액이
 * 정확히 목표값이 되는지, 그 뒤 거래는 그대로 남는지 본다.
 */
runSmoke('balance-date', async (ctx) => {
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
  const dining = cats.find((c) => c.name === '외식')!;

  // 개설 잔액 100만 (2026-08-01, 서울 기준 그 날 시작)
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000', openingBalanceDate: '2026-08-01',
  }, pid);
  ctx.check('개설 잔액', bank.balance, '1000000');

  // 8/20 지출 10만 -> 총잔액 90만
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-20T03:00:00.000Z',
    description: '저녁', amount: '100000', categoryId: dining.id, accountId: bank.id,
  }, pid);
  const afterExpense = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } });
  ctx.check('지출 반영 총잔액', afterExpense.balance.toString(), '900000');

  /** 그 날(서울 기준) 종료 시점까지의 잔액 */
  const asOf = async (dayEndUtc: string) => {
    const sum = await ctx.prisma.posting.aggregate({
      _sum: { amount: true },
      where: { accountId: bank.id, entry: { projectId: pid, date: { lt: new Date(dayEndUtc) } } },
    });
    return (sum._sum.amount ?? new Prisma.Decimal(0)).toString();
  };
  // 2026-08-11 00:00 KST = 2026-08-10T15:00Z
  const endOfAug10 = '2026-08-10T15:00:00.000Z';

  // 8/10 기준 잔액은 이미 100만이므로 100만으로 맞추면 전표가 생기지 않아야 한다
  await accounts.updateAccount(bank.id, uid, { balance: '1000000', balanceDate: '2026-08-10' });
  ctx.check('기준일 잔액이 이미 목표값이면 전표를 만들지 않는다',
    (await ctx.prisma.posting.count({ where: { accountId: bank.id } })), 2);
  ctx.check('총잔액도 그대로', (await ctx.prisma.account.findUniqueOrThrow({
    where: { id: bank.id },
  })).balance.toString(), '900000');

  // 8/10 기준 잔액을 95만으로 정정 -> 차액 -5만
  await accounts.updateAccount(bank.id, uid, { balance: '950000', balanceDate: '2026-08-10' });
  ctx.check('기준일 잔액이 목표값이 된다', await asOf(endOfAug10), '950000');
  ctx.check('기준일 이후 지출은 그대로 반영된다', (await ctx.prisma.account.findUniqueOrThrow({
    where: { id: bank.id },
  })).balance.toString(), '850000');

  // 조정 전표는 기준일에 놓인다
  const adjustment = await ctx.prisma.journalEntry.findFirstOrThrow({
    where: { projectId: pid, description: { contains: '잔액 조정' } },
  });
  ctx.check('조정 전표 날짜 (서울 8/10 00:00 = 8/9 15:00Z)',
    adjustment.date.toISOString(), '2026-08-09T15:00:00.000Z');

  // 잔액 = posting 합계 불변식
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
