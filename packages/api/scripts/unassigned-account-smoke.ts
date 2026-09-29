import { NO_ACCOUNT } from '@money/types';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

/**
 * 결제수단을 고르지 않은 지출·수입 (미지정 계정).
 *
 * 비워 두면 조립이 프로젝트의 미지정 계정에 붙인다. 그 계정은 자산 목록과 순자산에서
 * 빠지고, 검색은 `NO_ACCOUNT` 로, 수단별은 미지정 칸으로 그 거래를 찾는다. 사람 필터는
 * 주인이 없는 그 거래를 거래를 낸 사람으로 본다.
 *
 * 실행:
 *   node -r <tsconfig-paths/register> -r ts-node/register/transpile-only \
 *     scripts/unassigned-account-smoke.ts
 */
runSmoke('unassigned', async (ctx) => {
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
  const reports = makeReports(ctx.prisma, access);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  const younghee = await people.createPerson(uid, { name: '이영희' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const salary = cats.find((c) => c.type === 'income')!;
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: chulsoo.id, name: '보통예금', institutionId: 'fi_bank_shinhan',
    openingBalance: '1000000',
  }, pid);

  const aug = (day: number) => `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`;

  // ── 미지정 계정이 없으면 거절한다 ──
  // 하네스는 프로젝트를 Prisma 로 바로 만들어 ProjectsService 를 거치지 않는다.
  await ctx.expectReject('미지정 계정 없는 프로젝트는 수단 없이 적을 수 없다', () =>
    entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(1),
      description: '없음', amount: '1000', categoryId: dining.id, lineKey: 'x0' }, pid));

  // ProjectsService.createProject 와 마이그레이션이 만드는 것과 같은 행.
  const unassigned = await ctx.prisma.account.create({
    data: { projectId: pid, type: 'unassigned', name: '미지정', ownerId: null, currency: 'KRW' },
  });

  // ── 적기 ──
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(3),
    description: '현금 점심', amount: '8000', categoryId: dining.id, lineKey: 'u1' }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: younghee.id, date: aug(4),
    description: '영희 현금', amount: '5000', categoryId: dining.id, lineKey: 'u2' }, pid);
  await entries.createEntry(uid, { kind: 'income', personId: chulsoo.id, date: aug(5),
    description: '용돈', amount: '20000', categoryId: salary.id, lineKey: 'u3' }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(6),
    description: '통장 저녁', amount: '30000', categoryId: dining.id, accountId: bank.id,
    lineKey: 'b1' }, pid);

  const legs = await ctx.prisma.posting.findMany({ where: { accountId: unassigned.id } });
  ctx.check('미지정 계정에 붙은 다리 수', legs.length, 3);

  // ── 이체에는 쓸 수 없다 ──
  await ctx.expectReject('미지정 계정으로 이체 거부', () =>
    entries.createEntry(uid, { kind: 'transfer', personId: chulsoo.id, date: aug(7),
      description: '이체', amount: '1000', accountId: bank.id, toAccountId: unassigned.id }, pid));

  // ── 목록: 계좌 id·이름이 비어 온다 ──
  const range = { startDate: aug(1), endDate: aug(28) };
  const all = await entries.getEntries(uid, range, pid);
  const lunch = all.data.find((e) => e.description === '현금 점심');
  ctx.check('목록: 미지정 거래의 accountId', lunch?.accountId, null);
  ctx.check('목록: 미지정 거래의 accountName', lunch?.accountName, null);

  // ── 검색 ──
  const noAccount = await entries.getEntries(uid, { ...range, paymentAccountIds: NO_ACCOUNT }, pid);
  ctx.check('검색 자산 미선택: 건수', noAccount.data.length, 3);
  const noAccountOrBank = await entries.getEntries(uid, {
    ...range, paymentAccountIds: `${NO_ACCOUNT},${bank.id}`,
  }, pid);
  ctx.check('검색 자산 미선택 또는 통장: 건수', noAccountOrBank.data.length, 4);
  const bankOnly = await entries.getEntries(uid, { ...range, paymentAccountIds: bank.id }, pid);
  ctx.check('검색 통장만: 미지정은 빠진다',
    bankOnly.data.some((e) => e.description === '현금 점심'), false);

  // ── 사람 필터: 주인이 없으면 거래를 낸 사람으로 ──
  const forChulsoo = await entries.getEntries(uid, { ...range, personIds: chulsoo.id }, pid);
  const chulsooNames = forChulsoo.data.map((e) => e.description).sort().join(',');
  ctx.check('사람 필터: 철수 목록', chulsooNames, '용돈,통장 저녁,현금 점심');
  const forYounghee = await entries.getEntries(uid, { ...range, personIds: younghee.id }, pid);
  ctx.check('사람 필터: 영희 목록',
    forYounghee.data.map((e) => e.description).join(','), '영희 현금');

  // ── 수단별 ──
  const month = { projectId: pid, yearMonth: '2026-08' };
  const methods = await reports.getPaymentMethods(uid, month);
  const bucket = methods.find((m) => m.unassigned);
  ctx.check('수단별: 미지정 칸 id', bucket?.id, NO_ACCOUNT);
  ctx.check('수단별: 미지정 칸 지출', bucket?.amount, '13000');
  ctx.check('수단별: 미지정 칸 건수', bucket?.count, 2);
  ctx.check('수단별: 미지정 칸 수입', bucket?.income, '20000');
  const chulsooMethods = await reports.getPaymentMethods(uid, { ...month, personIds: chulsoo.id });
  ctx.check('수단별 철수: 미지정 칸 지출',
    chulsooMethods.find((m) => m.unassigned)?.amount, '8000');

  const trend = await reports.getTrend(uid, {
    projectId: pid, target: 'account', targetId: NO_ACCOUNT, endMonth: '2026-08', months: 1,
  });
  ctx.check('수단별 추이: 미지정', trend[0]?.amount, '13000');

  // 쓰지 않은 달에는 칸이 서지 않는다.
  const july = await reports.getPaymentMethods(uid, { projectId: pid, yearMonth: '2026-07' });
  ctx.check('안 쓴 달에는 미지정 칸이 없다', july.some((m) => m.unassigned), false);

  // ── 자산 목록·순자산에서 빠진다 ──
  const listed = await accounts.getAccounts(uid, pid);
  ctx.check('자산 목록에 미지정 없음', listed.some((a) => a.id === unassigned.id), false);
  const netWorth = await reports.getNetWorth(uid, pid);
  // 통장 100만 - 저녁 3만. 미지정 쪽의 지출·수입은 세지 않는다.
  ctx.check('순자산은 보이는 자산의 합', netWorth.total, '970000');
});
