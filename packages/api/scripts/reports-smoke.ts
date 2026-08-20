
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { ReportsService } from '@/modules/reports/reports.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { projectAccessStub, runSmoke } from './smoke-harness';

runSmoke('reports', async (ctx) => {
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
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = new EntriesService(ctx.prisma as any, access, ledger);
  const reports = new ReportsService(ctx.prisma as any, access);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  const younghee = await people.createPerson(uid, { name: '이영희' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const housing = cats.find((c) => c.name === '공과금')!;
  const salary = cats.find((c) => c.name === '급여')!;
  const lunch = await categories.createCategory(uid, {
    name: '점심', parentId: dining.id, type: 'expense',
  }, pid);
  // 공과금은 고정지출로 표시
  await categories.updateCategory(housing.id, uid, { defaultIsFixed: true });
  const fee = await categories.createCategory(uid, { name: '수수료', type: 'expense' }, pid);

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: chulsoo.id, name: '보통예금', institutionId: 'fi_bank_shinhan',
    openingBalance: '1000000', openingBalanceDate: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  }, pid);
  const wifeBank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: younghee.id, name: '이영희 통장', institutionId: 'fi_bank_kb',
    openingBalance: '500000', openingBalanceDate: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  }, pid);
  const stock = await accounts.createAccount(uid, {
    type: 'investment', ownerId: chulsoo.id, name: '삼성전자',
  }, pid);
  const credit = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);
  const debit = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 체크', cardType: 'debit', issuerId: 'fi_card_shinhan',
  }, pid);

  // 서버로는 ISO 문자열이 간다 (IsoDateString). 테스트도 같은 형태로 보낸다.
  const aug = (d: number) => new Date(Date.UTC(2026, 7, d)).toISOString();
  const jul = (d: number) => new Date(Date.UTC(2026, 6, d)).toISOString();

  // 8월: 급여 300만, 공과금(고정) 20만, 점심 5만(신용), 외식 3만(체크), 커피 1만(계좌)
  await entries.createEntry(uid, { kind: 'income', personId: chulsoo.id, date: aug(25),
    description: '급여', amount: '3000000', categoryId: salary.id, accountId: bank.id }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(5),
    description: '전기요금', amount: '200000', categoryId: housing.id, accountId: bank.id }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(6),
    description: '점심', amount: '50000', categoryId: lunch.id, cardId: credit.id }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(7),
    description: '저녁', amount: '30000', categoryId: dining.id, cardId: debit.id }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: younghee.id, date: aug(8),
    description: '커피', amount: '10000', categoryId: dining.id, accountId: wifeBank.id }, pid);
  // 7월 데이터 (시계열 확인용)
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: jul(10),
    description: '7월 점심', amount: '40000', categoryId: lunch.id, accountId: bank.id }, pid);

  // 이체: 수수료 있는 것과 없는 것 각각
  await entries.createEntry(uid, { kind: 'transfer', personId: chulsoo.id, date: aug(10),
    description: '저축 이체', amount: '500000', accountId: bank.id, toAccountId: wifeBank.id,
    transferFee: '1000', transferFeeCategoryId: fee.id }, pid);
  await entries.createEntry(uid, { kind: 'transfer', personId: chulsoo.id, date: aug(11),
    description: '무료 이체', amount: '100000', accountId: bank.id, toAccountId: wifeBank.id }, pid);

  // ── summary ──
  const summary = await reports.getSummary(uid, { projectId: pid, yearMonth: '2026-08' });
  ctx.check('8월 수입', summary.income, '3000000');
  ctx.check('8월 지출 (이체 수수료 1000 포함)', summary.expense, '291000');
  ctx.check('고정 지출 (공과금)', summary.fixedExpense, '200000');
  ctx.check('변동 지출 (외식 90000 + 수수료 1000)', summary.variableExpense, '91000');
  ctx.check('순액', summary.net, '2709000');

  const bySpouse = await reports.getSummary(uid, {
    projectId: pid, yearMonth: '2026-08', personId: younghee.id,
  });
  ctx.check('사람별 필터 (이영희 지출)', bySpouse.expense, '10000');

  // ── category-breakdown ──
  const rollup = await reports.getCategoryBreakdown(uid, {
    projectId: pid, yearMonth: '2026-08', type: 'expense',
  });
  const diningRow = rollup.find((r) => r.categoryId === dining.id)!;
  ctx.check('외식 롤업 (점심 50000 + 저녁 30000 + 커피 10000)', diningRow.amount, '90000');
  ctx.check('외식 건수', diningRow.count, 3);
  ctx.check('구성비 합계', Math.round(rollup.reduce((s, r) => s + r.ratio, 0)), 100);

  const flat = await reports.getCategoryBreakdown(uid, {
    projectId: pid, yearMonth: '2026-08', type: 'expense', rollup: false,
  });
  ctx.check('롤업 끄면 점심이 따로', flat.find((r) => r.categoryId === lunch.id)?.amount, '50000');

  // ── net-worth ──
  await ctx.prisma.assetValuation.create({
    data: { accountId: stock.id, date: aug(31), quantity: '10', price: '80000', marketValue: '800000' },
  });
  const nw = await reports.getNetWorth(uid, pid);
  // 보통예금: 100만 + 300만 - 20만 - 3만 - 1만(x, 이영희) = 아래에서 검증
  const bankBalance = (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance;
  const wifeBalance = (await ctx.prisma.account.findUniqueOrThrow({ where: { id: wifeBank.id } })).balance;
  ctx.check('현금성 합계', nw.cash, bankBalance.add(wifeBalance).toString());
  ctx.check('투자 평가액 (시가)', nw.investment, '800000');
  ctx.check('부채 (신용카드 사용액)', nw.liability, '-50000');
  ctx.check('미실현손익 (장부가 0)', nw.unrealizedGain, '800000');
  ctx.check('사람 수', nw.byPerson.length, 2);
  const chulsooNW = nw.byPerson.find((p) => p.personId === chulsoo.id)!;
  ctx.check('김철수 투자', chulsooNW.investment, '800000');

  // 자본 계정이 제외됐는지
  const allAccountsSum = await ctx.prisma.account.aggregate({
    _sum: { balance: true }, where: { projectId: pid },
  });
  ctx.check('자본 계정 포함 합계와 다른지 (제외 확인)',
    nw.cash !== allAccountsSum._sum.balance!.toString(), true);

  // ── trend ──
  const trend = await reports.getTrend(uid, {
    projectId: pid, target: 'category', targetId: dining.id, endMonth: '2026-08', months: 3,
  });
  ctx.check('시계열 길이', trend.length, 3);
  ctx.check('시계열 마지막 달', trend[2].yearMonth, '2026-08');
  ctx.check('8월 외식 (소분류 포함)', trend[2].amount, '90000');
  ctx.check('7월 외식 (점심 40000)', trend[1].amount, '40000');
  ctx.check('6월 (거래 없음, 0으로 채움)', trend[0].amount, '0');

  // ── payment-methods ──
  const methods = await reports.getPaymentMethods(uid, { projectId: pid, yearMonth: '2026-08' });
  // 거래가 없는 수단도 0원으로 내려온다: 보통예금·이영희 통장·삼성전자(투자) + 신용/체크카드
  ctx.check('결제수단 종류 수 (거래 없는 수단 포함)', methods.length, 5);
  ctx.check('거래 없는 투자 계좌는 0원',
    methods.find((m) => m.name === '삼성전자')?.amount, '0');
  ctx.check('신용카드 지출', methods.find((m) => m.kind === 'credit_card')?.amount, '50000');
  ctx.check('체크카드 지출', methods.find((m) => m.kind === 'debit_card')?.amount, '30000');
  const accountMethods = methods.filter((m) => m.kind === 'account');
  ctx.check('계좌 지출 합계 (전기요금 200000 + 커피 10000 + 이체수수료 1000)',
    accountMethods.reduce((s, m) => s + Number(m.amount), 0), 211000);
  ctx.check('결제수단 총합 = summary 지출',
    methods.reduce((s, m) => s + Number(m.amount), 0), Number(summary.expense));

  // ── 결제수단 상세: 계좌를 고르면 체크카드 사용이 섞이면 안 된다 ──
  //
  // 체크카드 결제는 연결 통장에서 바로 빠지므로 posting 하나에 accountId와 cardId가 함께 있다.
  // 계좌로만 필터하면 체크카드 사용까지 딸려온다.
  const accountEntries = await entries.getEntries(uid, {
    paymentAccountId: bank.id, kind: 'expense',
    startDate: aug(1), endDate: aug(31),
  }, pid);
  // 이체 두 건도 보내는 계좌에서 돈이 나간 것이므로 함께 나온다
  ctx.check('계좌 직접 결제만 (전기요금)', accountEntries.data.length, 1);
  ctx.check('계좌 직접 결제 내역', accountEntries.data[0].description, '전기요금');

  const withCard = await entries.getEntries(uid, {
    accountId: bank.id, kind: 'expense',
    startDate: aug(1), endDate: aug(31),
  }, pid);
  ctx.check('excludeCard 없으면 체크카드도 포함 (원장 관점)', withCard.data.length, 2);

  const debitEntries = await entries.getEntries(uid, {
    cardId: debit.id, kind: 'expense',
    startDate: aug(1), endDate: aug(31),
  }, pid);
  ctx.check('체크카드 내역', debitEntries.data.map((e) => e.description).join(','), '저녁');

  // ── 결제수단 그래프도 같은 기준이어야 한다 ──
  const accountTrend = await reports.getTrend(uid, {
    projectId: pid, target: 'account', targetId: bank.id, endMonth: '2026-08', months: 2,
  });
  // 전기요금 200000만. 급여 입금(+300만)과 상쇄되거나 체크카드 30000이 섞이면 안 된다.
  // 이체 금액 500000은 카테고리 다리가 없어 잡히지 않고, 수수료 1000만 더해진다
  ctx.check('계좌 그래프 (전기요금 200000 + 이체수수료 1000)', accountTrend[1].amount, '201000');

  const debitTrend = await reports.getTrend(uid, {
    projectId: pid, target: 'card', targetId: debit.id, endMonth: '2026-08', months: 2,
  });
  ctx.check('체크카드 그래프', debitTrend[1].amount, '30000');

  const creditTrend = await reports.getTrend(uid, {
    projectId: pid, target: 'card', targetId: credit.id, endMonth: '2026-08', months: 2,
  });
  ctx.check('신용카드 그래프', creditTrend[1].amount, '50000');

  // 그래프 합계 = 결제수단 집계 합계 (같은 규칙을 쓰는지 확인)
  const methodTotal = methods.reduce((sum, m) => sum + Number(m.amount), 0);
  const trendTotal =
    Number(accountTrend[1].amount) + Number(debitTrend[1].amount) + Number(creditTrend[1].amount);
  const wifeTrend = await reports.getTrend(uid, {
    projectId: pid, target: 'account', targetId: wifeBank.id, endMonth: '2026-08', months: 2,
  });
  ctx.check('그래프 합계 = 결제수단 집계', trendTotal + Number(wifeTrend[1].amount), methodTotal);

  // ── 수단별 상세: 목록 합계가 왼쪽 집계와 맞아야 한다 ──
  //
  // kind='expense'로 거르면 수수료 붙은 이체가 빠져서 집계와 어긋난다.
  // categoryType='expense'는 이체 수수료를 포함한다.
  const bankSpending = await entries.getEntries(uid, {
    paymentAccountId: bank.id, categoryType: 'expense',
    startDate: aug(1), endDate: aug(31),
  }, pid);
  ctx.check('수단별 목록에 이체 포함',
    bankSpending.data.map((e) => e.description).sort().join(','), '저축 이체,전기요금');

  // 서버가 준 값으로 화면과 같은 규칙(지출=지출액, 이체=수수료)으로 더한다
  const spendingSum = bankSpending.data.reduce(
    (sum, e) => sum + (e.kind === 'transfer' ? Number(e.feeAmount) : Number(e.amount)),
    0,
  );
  const bankMethod = methods.find((m) => m.kind === 'account' && m.id === bank.id)!;
  ctx.check('목록 합계 = 수단별 집계', spendingSum, Number(bankMethod.amount));

  // 수수료 없는 이체는 지출에 기여하지 않으므로 목록에 없어야 한다
  ctx.check('수수료 0인 이체는 지출 목록에서 제외',
    bankSpending.data.some((e) => e.description === '무료 이체'), false);

  // 받는 계좌에는 이 이체가 지출로 잡히면 안 된다
  const wifeSpending = await entries.getEntries(uid, {
    paymentAccountId: wifeBank.id, categoryType: 'expense',
    startDate: aug(1), endDate: aug(31),
  }, pid);
  ctx.check('받는 계좌에는 이체 지출이 없다',
    wifeSpending.data.some((e) => e.kind === 'transfer'), false);

  // ── 분류별 전체 지출 목록에도 이체가 나와야 한다 ──
  const allSpending = await entries.getEntries(uid, {
    categoryType: 'expense', startDate: aug(1), endDate: aug(31),
  }, pid);
  ctx.check('분류별 전체 지출에 이체 포함',
    allSpending.data.some((e) => e.kind === 'transfer'), true);
  const allSum = allSpending.data.reduce(
    (sum, e) => sum + (e.kind === 'transfer' ? Number(e.feeAmount) : Number(e.amount)),
    0,
  );
  ctx.check('분류별 목록 합계 = summary 지출', allSum, Number(summary.expense));

  // ── 이체 카드 표시에 필요한 값 ──
  const transferList = await entries.getEntries(uid, {
    kind: 'transfer', startDate: aug(1), endDate: aug(31),
  }, pid);
  const withFee = transferList.data.find((e) => e.description === '저축 이체')!;
  const noFee = transferList.data.find((e) => e.description === '무료 이체')!;
  ctx.check('이체 금액 (보낸 금액)', withFee.amount, '500000');
  ctx.check('이체 수수료', withFee.feeAmount, '1000');
  ctx.check('수수료 카테고리명', withFee.feeCategoryName, '수수료');
  ctx.check('보내는 계좌', withFee.accountName, '보통예금');
  ctx.check('받는 계좌', withFee.toAccountName, '이영희 통장');
  ctx.check('수수료 없는 이체는 0', noFee.feeAmount, '0');
  ctx.check('수수료 없으면 카테고리도 없음', noFee.feeCategoryName, null);
  ctx.check('지출은 feeAmount가 null', accountEntries.data.find((e) => e.kind === 'expense')?.feeAmount, null);

  // ── 분류별: 수수료가 카테고리 집계에 잡히는가 ──
  const feeRow = rollup.find((r) => r.categoryId === fee.id);
  ctx.check('분류별에 수수료 표시', feeRow?.amount, '1000');

  // ── 계좌 원장 ──
  const ledgerView = await accounts.getAccountPostings(bank.id, uid, { limit: 10 });
  ctx.check('원장 첫 행 잔액 = 현재 잔액', ledgerView.data[0].balanceAfter, bankBalance.toString());
  const oldest = ledgerView.data[ledgerView.data.length - 1];
  ctx.check('원장 마지막 행이 기초잔액', oldest.description.includes('기초잔액'), true);
});
