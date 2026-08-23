import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeBudgets, makeEntries, makeLedger, makeReports, projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 자산 주인 / 고정·변동 필터가 목록과 리포트에 같이 걸리는지 확인한다.
 *
 * 필터 기준은 "거래를 입력한 사람"이 아니라 돈이 오간 계좌의 주인이다.
 * 이체는 보내는 계좌가 기준이고, 수입처럼 나간 다리가 없으면 들어온 계좌를 본다.
 * 아래 검사는 목록·합계·구성비·시계열·수단별이 모두 같은 기준을 쓰는지 본다.
 * 수단별 탭은 거래가 없는 계좌·카드도 0원으로 내려주는지 함께 본다.
 */
runSmoke('filters', async (ctx) => {
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
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const reports = makeReports(ctx.prisma, access);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  const younghee = await people.createPerson(uid, { name: '이영희' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const utility = cats.find((c) => c.name === '공과금')!;
  // 공과금은 고정지출로 표시한다
  await categories.updateCategory(utility.id, uid, { defaultIsFixed: true });

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: chulsoo.id, name: '보통예금', institutionId: 'fi_bank_shinhan',
    openingBalance: '1000000',
  }, pid);
  const wifeBank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: younghee.id, name: '이영희 통장', institutionId: 'fi_bank_kb',
    openingBalance: '500000',
  }, pid);
  // 이번 달에 한 번도 쓰지 않는 카드. 0원으로 목록에 나와야 한다.
  const unusedCard = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '안 쓴 카드', cardType: 'debit', issuerId: 'fi_card_shinhan',
  }, pid);

  const aug = (day: number) => `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`;

  // 김철수: 고정 20만(공과금) + 변동 3만(외식)
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(5),
    description: '전기요금', amount: '200000', categoryId: utility.id, accountId: bank.id }, pid);
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(6),
    description: '저녁', amount: '30000', categoryId: dining.id, accountId: bank.id }, pid);
  // 이영희: 변동 1만(외식)
  await entries.createEntry(uid, { kind: 'expense', personId: younghee.id, date: aug(7),
    description: '커피', amount: '10000', categoryId: dining.id, accountId: wifeBank.id }, pid);

  const month = { projectId: pid, yearMonth: '2026-08' };

  // ── 필터 없음 ──
  const all = await reports.getSummary(uid, month);
  ctx.check('전체 지출', all.expense, '240000');

  // ── 사람 필터 ──
  const onlyChulsoo = { ...month, personIds: chulsoo.id };
  ctx.check('사람 필터: 합계', (await reports.getSummary(uid, onlyChulsoo)).expense, '230000');

  const bothPeople = { ...month, personIds: `${chulsoo.id},${younghee.id}` };
  ctx.check('사람 둘 다 고르면 전체와 같다',
    (await reports.getSummary(uid, bothPeople)).expense, '240000');

  const listForChulsoo = await entries.getEntries(uid, {
    personIds: chulsoo.id, startDate: aug(1), endDate: aug(28), categoryType: 'expense',
  }, pid);
  ctx.check('사람 필터: 목록 건수', listForChulsoo.data.length, 2);
  const listSum = listForChulsoo.data.reduce((sum, e) => sum + Number(e.amount), 0);
  ctx.check('사람 필터: 목록 합계 = 리포트 합계', listSum, 230000);

  const breakdownForChulsoo = await reports.getCategoryBreakdown(uid, {
    ...onlyChulsoo, type: 'expense',
  });
  ctx.check('사람 필터: 구성비 합계',
    breakdownForChulsoo.reduce((sum, row) => sum + Number(row.amount), 0), 230000);

  const trendForChulsoo = await reports.getTrend(uid, {
    projectId: pid, target: 'total', type: 'expense', endMonth: '2026-08', months: 1,
    personIds: chulsoo.id,
  });
  ctx.check('사람 필터: 시계열', trendForChulsoo[0]?.amount, '230000');

  const methodsForYounghee = await reports.getPaymentMethods(uid, {
    ...month, personIds: younghee.id,
  });
  ctx.check('사람 필터: 수단별은 그 사람 것만',
    methodsForYounghee.map((m) => m.name).sort().join(','), '이영희 통장');


  // ── 고정/변동 필터 ──
  ctx.check('고정만: 합계',
    (await reports.getSummary(uid, { ...month, fixedTypes: 'fixed' })).expense, '200000');
  ctx.check('변동만: 합계',
    (await reports.getSummary(uid, { ...month, fixedTypes: 'variable' })).expense, '40000');
  ctx.check('둘 다 고르면 전체와 같다',
    (await reports.getSummary(uid, { ...month, fixedTypes: 'fixed,variable' })).expense, '240000');

  const fixedList = await entries.getEntries(uid, {
    fixedTypes: 'fixed', startDate: aug(1), endDate: aug(28),
  }, pid);
  ctx.check('고정만: 목록 건수', fixedList.data.length, 1);
  ctx.check('고정만: 목록 항목', fixedList.data[0]?.description, '전기요금');

  const variableList = await entries.getEntries(uid, {
    fixedTypes: 'variable', startDate: aug(1), endDate: aug(28),
  }, pid);
  // 계좌 다리는 isFixed가 항상 false다. 카테고리 다리만 봐야 2건이 나온다.
  ctx.check('변동만: 목록 건수 (기초잔액 전표가 섞이지 않는다)', variableList.data.length, 2);

  const fixedTrend = await reports.getTrend(uid, {
    projectId: pid, target: 'total', type: 'expense', endMonth: '2026-08', months: 1,
    fixedTypes: 'fixed',
  });
  ctx.check('고정만: 시계열', fixedTrend[0]?.amount, '200000');

  const fixedMethods = await reports.getPaymentMethods(uid, { ...month, fixedTypes: 'fixed' });
  ctx.check('고정만: 수단별 보통예금 금액',
    fixedMethods.find((m) => m.name === '보통예금')?.amount, '200000');

  // ── 수단별: 거래 없는 수단도 0원으로 ──
  const methods = await reports.getPaymentMethods(uid, month);
  const names = methods.map((m) => m.name).sort();
  ctx.check('수단별 목록', names.join(','), '보통예금,안 쓴 카드,이영희 통장');
  ctx.check('안 쓴 카드는 0원', methods.find((m) => m.id === unusedCard.id)?.amount, '0');
  ctx.check('안 쓴 카드는 건수 0', methods.find((m) => m.id === unusedCard.id)?.count, 0);
  ctx.check('금액 큰 순서', methods[0]?.name, '보통예금');

  // ── 아무것도 고르지 않으면 결과가 없어야 한다 ──
  // 빈 값과 "파라미터 없음"은 다르게 읽힌다. 체크를 모두 해제한 상태를 전체로
  // 되돌리면 사용자가 고른 것과 반대로 보인다.
  const noPeople = { ...month, personIds: '' };
  ctx.check('사람 0명: 지출 합계', (await reports.getSummary(uid, noPeople)).expense, '0');
  ctx.check('사람 0명: 수입 합계', (await reports.getSummary(uid, noPeople)).income, '0');
  ctx.check('사람 0명: 구성비 없음',
    (await reports.getCategoryBreakdown(uid, { ...noPeople, type: 'expense' })).length, 0);
  ctx.check('사람 0명: 수단별 없음', (await reports.getPaymentMethods(uid, noPeople)).length, 0);
  ctx.check('사람 0명: 목록 없음',
    (await entries.getEntries(uid, { personIds: '', startDate: aug(1), endDate: aug(28) }, pid))
      .data.length, 0);
  ctx.check('사람 0명: 시계열 0',
    (await reports.getTrend(uid, {
      projectId: pid, target: 'total', type: 'expense', endMonth: '2026-08', months: 1,
      personIds: '',
    }))[0]?.amount, '0');

  const noFixed = { ...month, fixedTypes: '' };
  ctx.check('고정/변동 0개: 지출 합계', (await reports.getSummary(uid, noFixed)).expense, '0');
  // 수단별 탭은 어떤 수단이 있는지 보여주는 화면이다. 금액만 0이 되고 목록은 남아야 한다.
  const methodsNoFixed = await reports.getPaymentMethods(uid, noFixed);
  ctx.check('고정/변동 0개: 수단 목록은 그대로', methodsNoFixed.length, 3);
  ctx.check('고정/변동 0개: 금액은 모두 0',
    methodsNoFixed.every((m) => m.amount === '0'), true);
  ctx.check('사람 0명: 수단별 없음 (자산 소유자가 없다)',
    (await reports.getPaymentMethods(uid, noPeople)).length, 0);
  ctx.check('고정/변동 0개: 목록 없음',
    (await entries.getEntries(uid, { fixedTypes: '', startDate: aug(1), endDate: aug(28) }, pid))
      .data.length, 0);

  // ── 기준은 거래 주체가 아니라 자산 주인이다 ──
  // 김철수가 이영희 통장으로 결제한 건. 거래 주체는 김철수지만 돈은 이영희 통장에서
  // 나갔으므로 이영희의 것으로 본다.
  // (앞선 금액 검사에 영향을 주지 않도록 다른 검사가 끝난 뒤에 넣는다)
  await entries.createEntry(uid, { kind: 'expense', personId: chulsoo.id, date: aug(9),
    description: '아내 통장으로 결제', amount: '5000',
    categoryId: dining.id, accountId: wifeBank.id }, pid);

  const chulsooOnly = { ...month, personIds: chulsoo.id };
  const youngheeOnly = { ...month, personIds: younghee.id };

  ctx.check('남의 통장으로 낸 지출은 입력자 쪽에 잡히지 않는다',
    (await reports.getSummary(uid, chulsooOnly)).expense, '230000');
  ctx.check('그 통장 주인 쪽에 잡힌다 (커피 10000 + 5000)',
    (await reports.getSummary(uid, youngheeOnly)).expense, '15000');
  ctx.check('목록도 같은 기준',
    (await entries.getEntries(uid, {
      personIds: younghee.id, startDate: aug(1), endDate: aug(28), categoryType: 'expense',
    }, pid)).data.map((e) => e.description).sort().join(','), '아내 통장으로 결제,커피');
  ctx.check('시계열도 같은 기준',
    (await reports.getTrend(uid, {
      projectId: pid, target: 'total', type: 'expense', endMonth: '2026-08', months: 1,
      personIds: younghee.id,
    }))[0]?.amount, '15000');

  const methodsForChulsoo = await reports.getPaymentMethods(uid, chulsooOnly);
  ctx.check('수단별: 감춘 사람의 통장은 목록에서 빠진다',
    methodsForChulsoo.some((m) => m.name === '이영희 통장'), false);
  ctx.check('수단별: 고른 사람의 통장·카드는 남는다',
    methodsForChulsoo.map((m) => m.name).sort().join(','), '보통예금,안 쓴 카드');
  ctx.check('수단별 합계 = 상단 합계 (같은 기준이므로 어긋나지 않는다)',
    methodsForChulsoo.reduce((sum, m) => sum + Number(m.amount), 0),
    Number((await reports.getSummary(uid, chulsooOnly)).expense));

  // ── 수입: 나간 다리가 없으면 들어온 계좌 주인을 본다 ──
  const salary = cats.find((c) => c.name === '급여')!;
  await entries.createEntry(uid, { kind: 'income', personId: chulsoo.id, date: aug(12),
    description: '아내 통장으로 입금', amount: '700000',
    categoryId: salary.id, accountId: wifeBank.id }, pid);
  ctx.check('수입은 받은 계좌 주인의 것',
    (await reports.getSummary(uid, youngheeOnly)).income, '700000');
  ctx.check('입력자 쪽에는 잡히지 않는다',
    (await reports.getSummary(uid, chulsooOnly)).income, '0');

  // ── 이체: 보내는 계좌 주인을 본다 ──
  await entries.createEntry(uid, { kind: 'transfer', personId: younghee.id, date: aug(13),
    description: '남편에게 이체', amount: '20000',
    accountId: bank.id, toAccountId: wifeBank.id }, pid);
  const transferList = async (personIds: string) =>
    (await entries.getEntries(uid, {
      personIds, kind: 'transfer', startDate: aug(1), endDate: aug(28),
    }, pid)).data.map((e) => e.description);
  ctx.check('이체는 보내는 계좌 주인에게 잡힌다',
    (await transferList(chulsoo.id)).join(','), '남편에게 이체');
  ctx.check('받는 계좌 주인에게는 잡히지 않는다', (await transferList(younghee.id)).length, 0);

  // ── 기초잔액 전표는 그 계좌 주인의 것 (자본 계정 다리에 걸려 사라지면 안 된다) ──
  //
  // 기초잔액은 사용자가 고른 기준일이 아니라 원장 맨 앞(1899-01-01)에 놓인다.
  // 예전에는 이 검사가 7~8월만 조회해서, 날짜가 1899년으로 바뀐 뒤로는 범위 밖이라
  // 늘 실패하고 있었다. 자산 주인 판정을 보는 검사이므로 날짜는 열어 둔다.
  const withOpening = await entries.getEntries(uid, {
    personIds: younghee.id, endDate: aug(28),
  }, pid);
  ctx.check('기초잔액도 계좌 주인 기준',
    withOpening.data.some((e) => e.description.includes('기초잔액')), true);
  ctx.check('남의 기초잔액은 섞이지 않는다',
    withOpening.data.some((e) => e.description.includes('보통예금 기초잔액')), false);

  // ── 예산 사용금액도 같은 필터를 탄다 ──
  // 왼쪽 예산 카드와 오른쪽 상세 통계가 다른 숫자를 보여주면 안 된다.
  const { BudgetsService } = await import('@/modules/budgets/budgets.service');
  const budgets = makeBudgets(ctx.prisma, access);
  const usedOf = async (filter: Record<string, string>) => {
    const rows = await budgets.getBudgetForMonth(uid, pid, 2026, 8, filter);
    const row = rows.find((r) => r.categoryId === dining.id);
    return Number(row?.usedAmount ?? 0);
  };

  // 외식: 김철수 30000(보통예금) + 이영희 10000 + 김철수가 아내 통장으로 5000
  ctx.check('예산 사용금액: 필터 없음', await usedOf({}), 45000);
  ctx.check('예산 사용금액: 자산주인 김철수', await usedOf({ personIds: chulsoo.id }), 30000);
  ctx.check('예산 사용금액: 자산주인 이영희', await usedOf({ personIds: younghee.id }), 15000);
  ctx.check('예산 사용금액: 고정만 (외식은 변동)', await usedOf({ fixedTypes: 'fixed' }), 0);
  ctx.check('예산 사용금액: 변동만', await usedOf({ fixedTypes: 'variable' }), 45000);
  ctx.check('예산 사용금액: 아무도 안 고르면 0', await usedOf({ personIds: '' }), 0);
});