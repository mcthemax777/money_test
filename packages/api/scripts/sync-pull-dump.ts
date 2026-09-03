/**
 * 실제 변경 피드 응답을 파일로 떠 놓는다.
 *
 * 실행: node -r <별칭 훅> -r ts-node/register/transpile-only scripts/sync-pull-dump.ts [경로]
 *
 * 왜 이런 것이 필요한가. 기기의 사본(`@money/core` 의 LocalStore)이 이 응답을 받아
 * 적는데, api 는 core 를 의존할 수 없고 core 는 데이터베이스를 볼 수 없다. 두 쪽을
 * 잇는 방법은 실제 응답을 사이에 두는 것이다. 이 스크립트가 그것을 떠 주고,
 * `packages/core/scripts/local-store-smoke.ts` 가 그 파일을 읽어 적어 본다.
 *
 * 손으로 만든 표본이면 컬럼 이름이나 직렬화가 어긋나도 알 수 없다. 그 어긋남은
 * 기기에서만 드러나고, 화면이 빈 목록을 보여 주는 것으로 나타난다.
 */
import { writeFileSync } from 'fs';
import { SyncService } from '@/modules/sync/sync.service';
import { CardsService } from '@/modules/cards/cards.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeBudgets, makeEntries, makeLedger, makeReports, projectAccessStub, runSmoke } from './smoke-harness';

const target = process.argv[2] ?? '/tmp/sync-pull-dump.json';

runSmoke('sync-pull-dump', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
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
  const budgets = makeBudgets(ctx.prisma, access);
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access as any, ledger as any);
  const sync = new SyncService(ctx.prisma as any, access as any);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const dining = await categories.createCategory(uid, { name: '외식', type: 'expense' }, pid);
  const lunch = await categories.createCategory(uid, {
    name: '점심', parentId: dining.id, type: 'expense',
  }, pid);
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);

  // 한국 시간 8/6 00:30. 달력 키가 타임존을 따르는지 사본에서 확인하는 거래다.
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-05T15:30:00.000Z',
    description: '치킨', amount: '30000', categoryId: lunch.id, accountId: bank.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-10T03:00:00.000Z',
    description: '장보기', amount: '50000', categoryId: dining.id, accountId: bank.id,
    extraAmount: '20000',
  }, pid);
  await budgets.createBudget(uid, { categoryId: dining.id, monthlyAmount: '300000' }, pid);

  /*
   * 투자 계좌와 평가액.
   *
   * 사본이 투자 계좌를 장부 잔액(50만)이 아니라 시가(80만)로 세는지 보려고 둘을
   * 다르게 잡는다. 미실현손익 30만이 그 차이다. 평가액이 변경 피드에 실리지 않으면
   * 이 세 숫자가 한꺼번에 틀린다.
   */
  const stock = await accounts.createAccount(uid, {
    type: 'investment', ownerId: person.id, name: '주식계좌', openingBalance: '500000',
  }, pid);
  await ctx.prisma.assetValuation.create({
    data: {
      accountId: stock.id, date: new Date('2026-08-31'),
      quantity: '10', price: '80000', marketValue: '800000',
    },
  });

  /*
   * 신용카드와 할부.
   *
   * 마감일이 15일이라 8/20 구매는 9월 마감분에 든다. 3개월 할부이므로 그 주기에는
   * 회차분(10만)만 청구되고 나머지는 뒤 주기로 넘어간다. 8/10 구매는 8월 마감분이다.
   * 사본이 할부 개월수를 받지 못하면 30만이 한 주기에 통째로 잡혀 실적이 틀린다.
   */
  const credit = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
    performanceAmount: '300000',
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-10T03:00:00.000Z',
    description: '카드 커피', amount: '50000', categoryId: dining.id, cardId: credit.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-20T03:00:00.000Z',
    description: '노트북', amount: '300000', categoryId: dining.id, cardId: credit.id,
    installmentMonths: 3,
  }, pid);

  /*
   * 수입·이체·카드정산.
   *
   * 유형 필터가 다섯 갈래를 모두 갈라 내는지 사본과 대조하려면 데이터에 그 갈래가
   * 있어야 한다. 없으면 검사가 "빈 목록 = 빈 목록"으로 헛돈다 (실제로 그랬다).
   *
   * **카드 사용과 카드정산은 다르다.** 위 '카드 커피'는 계좌 다리가 부채 계정 하나뿐이라
   * 지출이고, 아래 대금 결제는 통장과 부채 계정 둘이 얽혀 카드정산이다.
   */
  const salary = await categories.createCategory(uid, { name: '급여', type: 'income' }, pid);
  const spare = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '비상금',
  }, pid);
  await entries.createEntry(uid, {
    kind: 'income', personId: person.id, date: '2026-08-25T03:00:00.000Z',
    description: '월급', amount: '2000000', categoryId: salary.id, accountId: bank.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'transfer', personId: person.id, date: '2026-08-26T03:00:00.000Z',
    description: '비상금으로 옮김', amount: '100000',
    accountId: bank.id, toAccountId: spare.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'card_payment', personId: person.id, date: '2026-08-27T03:00:00.000Z',
    description: '카드 대금', amount: '50000', accountId: bank.id, cardId: credit.id,
  }, pid);

  /*
   * 달 경계.
   *
   *   11-30 KST      30일로 끝나는 달의 마지막 날
   *   12-01 KST      그 다음 달 초하루
   *   12-31 23:30 KST 달의 마지막 순간 (UTC 로는 12-31 14:30)
   *
   * 두 저장소가 달을 같은 자리에서 자르는지 보려고 둔다. 구간을 `-01 ~ -31` 로 만들면
   * `new Date('2026-11-31')` 이 12월 1일로 넘어가 11월 조회가 초하루를 함께 담고,
   * UTC 자정으로 자르면 한국의 마지막 밤이 빠진다.
   */
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-11-29T15:30:00.000Z',
    description: '11월 마지막날', amount: '1100', categoryId: dining.id, accountId: bank.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-11-30T15:30:00.000Z',
    description: '12월 초하루', amount: '1200', categoryId: dining.id, accountId: bank.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-12-31T14:30:00.000Z',
    description: '12월 마지막 순간', amount: '1300', categoryId: dining.id, accountId: bank.id,
  }, pid);

  const response = await sync.pull(uid, { projectId: pid, since: 0 });

  /*
   * 서버가 낸 홈 화면 값도 함께 떠 둔다.
   *
   * 사본 창구가 이 값과 **같은 숫자**를 내야 화면을 손대지 않고 오프라인으로 갈 수
   * 있다. 기대값을 손으로 적으면 코드와 기대가 같은 이유로 함께 틀릴 수 있어,
   * 서버가 낸 값을 그대로 두고 대조한다.
   */
  const reports = makeReports(ctx.prisma, access);
  const server = {
    summary: await reports.getSummary(uid, { projectId: pid, yearMonth: '2026-08' }),
    netWorth: await reports.getNetWorth(uid, pid),
    budgets: await budgets.getBudgetForMonth(uid, pid, 2026, 8),
    // 목록도 함께 떠 둔다. 사본이 만든 줄과 한 줄씩 견준다.
    entries: (
      await entries.getEntries(uid, {
        startDate: '2026-07-31T15:00:00.000Z',
        endDate: '2026-08-31T14:59:59.999Z',
        limit: 200,
      }, pid)
    ).data,
    // 첫 쪽만. 사본의 커서 페이지와 견준다.
    firstPage: await entries.getEntries(uid, {
      startDate: '2026-07-31T15:00:00.000Z',
      endDate: '2026-08-31T14:59:59.999Z',
      limit: 1,
    }, pid),
    paymentMethods: await reports.getPaymentMethods(uid, { projectId: pid, yearMonth: '2026-08' }),
    /*
     * 카드 실적은 "지금"을 기준으로 진행 중인 주기를 본다. 사본 쪽 검사가 이 파일을
     * 읽어 같은 계산을 하므로, 두 실행 사이에 마감일(매월 15일)이 지나가면 값이 달라진다.
     * 그때는 다시 떠서 돌리면 된다.
     */
    cardPerformance: await cardLedger.getPerformance(credit.id, uid),
    /*
     * 거래 화면이 쓰는 셋. 사본 창구가 같은 숫자를 내야 그 화면이 오프라인에서 돈다.
     *
     * 검색은 **한 무리에 하나씩** 골라 둔다. 그래야 무리끼리 AND 로 이어지는지가
     * 결과에 드러난다. 무리 하나만 채우면 잘못 이어도 같은 숫자가 나온다.
     */
    entryMonths: await reports.getEntryMonths(uid, { projectId: pid }),
    categoryBreakdown: await reports.getCategoryBreakdown(uid, {
      projectId: pid, yearMonth: '2026-08', type: 'expense',
    }),
    searchedMonths: await reports.getEntryMonths(uid, { projectId: pid, categoryIds: dining.id }),
    /*
     * 기간 검색. 8/10 부터 11/30 까지다.
     *
     * 이 구간은 세 가지를 한꺼번에 시험한다.
     *   ① 8월을 **반만** 덮는다 (8/6 치킨 30,000 이 빠진다).
     *   ② 11월은 통째로 덮는다 (그때는 달 이름을 그대로 쓰는 길로 간다).
     *   ③ 끝을 11/30 로 잡아 한국 시간 12/1 인 거래가 빠지는지 본다. 그 거래의 UTC
     *      시각은 11/30 이라, 경계를 UTC 로 자르면 11월에 함께 실린다.
     */
    rangedMonths: await reports.getEntryMonths(uid, {
      projectId: pid, startDate: '2026-08-10', endDate: '2026-11-30',
    }),
    rangedBreakdown: await reports.getCategoryBreakdown(uid, {
      projectId: pid, startDate: '2026-08-10', endDate: '2026-08-31', type: 'expense',
    }),
    rangedPaymentMethods: await reports.getPaymentMethods(uid, {
      projectId: pid, startDate: '2026-08-10', endDate: '2026-08-31',
    }),
    /*
     * 같은 구간의 목록. **여기서 이름이 같은 두 값의 뜻이 갈린다** -- 구간 조회는
     * 달력 날짜를 받고 목록은 인스턴트를 받는다. 한국 시간 8/10 0시와 8/31 24시다.
     */
    rangedEntries: (
      await entries.getEntries(uid, {
        startDate: '2026-08-09T15:00:00.000Z',
        endDate: '2026-08-31T14:59:59.999Z',
        limit: 200,
      }, pid)
    ).data,
    searchedEntries: (
      await entries.getEntries(uid, {
        categoryIds: dining.id,
        paymentCardIds: credit.id,
        limit: 200,
      }, pid)
    ).data,
    /*
     * 유형별로 고른 전표. 사본이 손으로 옮긴 SQL 로 같은 답을 내는지 견준다.
     *
     * 유형은 다리에서 유도되는 값이라 두 저장소가 각자 조건을 만든다. 갈리면 같은
     * 검색이 온라인과 오프라인에서 다른 목록을 낸다.
     */
    kindEntries: Object.fromEntries(
      await Promise.all(
        ['expense', 'income', 'transfer', 'card_payment', 'adjustment'].map(async (kind) => [
          kind,
          (await entries.getEntries(uid, { kinds: kind, limit: 200 }, pid)).data.map((row) => row.id),
        ]),
      ),
    ),
    /*
     * 달로 좁힌 목록. 사본이 같은 경계를 보는지 견준다.
     *
     * 11월과 12월을 함께 떠 둔다. 초하루가 앞 달로 새는지, 한국의 마지막 밤이 빠지는지가
     * 이 두 목록에서 드러난다.
     */
    monthEntries: Object.fromEntries(
      await Promise.all(
        ['2026-11', '2026-12', '2026-08'].map(async (yearMonth) => [
          yearMonth,
          (await entries.getEntries(uid, { yearMonth, limit: 200 }, pid)).data.map((row) => row.id),
        ]),
      ),
    ),
    searchCategoryId: dining.id,
    cardId: credit.id,
    stockAccountId: stock.id,
  };

  // 서비스를 직접 부르면 금액이 Decimal 객체, 날짜가 Date 로 온다. HTTP 로 나갈 때와
  // 같은 모양을 보려고 JSON 을 한 번 거친다.
  const wire = JSON.parse(JSON.stringify({ pull: response, server }));
  writeFileSync(target, JSON.stringify(wire, null, 2));

  ctx.check('응답을 떠 두었다', wire.pull.projectId, pid);
  ctx.check('평가액이 변경 피드에 담겼다', wire.pull.changes.assetValuations.length, 1);
  ctx.check('할부 계획도 담겼다', wire.pull.changes.installmentPlans.length, 1);
  ctx.check('할부 개월수', wire.pull.changes.installmentPlans[0].totalMonths, 3);
  /*
   * 기간 검색이 서버에서 맞는가. 사본과 대조하기 전에 서버 쪽부터 못 박는다.
   *
   * **핵심은 마지막 검사다.** 년월 줄에 적힌 금액과 그 안을 펴서 나온 거래의 합이
   * 같아야 한다. 달을 통째로 세면 줄에는 43만이 적히고 안에는 40만어치만 들어 있다.
   */
  ctx.check('기간에 걸친 달만 남는다',
    wire.server.rangedMonths.map((row: { yearMonth: string }) => row.yearMonth).join(','),
    '2026-11,2026-08');
  ctx.check('기간 밖의 거래는 달에서 빠진다 (한국 시간 12/1)',
    wire.server.rangedMonths.find((row: { yearMonth: string }) => row.yearMonth === '2026-11')?.expense,
    '1100');

  const rangedAugust = wire.server.rangedMonths.find(
    (row: { yearMonth: string }) => row.yearMonth === '2026-08',
  );
  const augustExpense = wire.server.rangedEntries
    .filter((row: { kind: string }) => row.kind === 'expense')
    .reduce((sum: number, row: { amount: string }) => sum + Number(row.amount), 0);
  ctx.check('걸친 달은 기간만큼만 센다', rangedAugust?.expense, '400000');
  ctx.check('줄에 적힌 금액이 그 안 거래의 합과 같다', String(augustExpense), rangedAugust?.expense);

  ctx.check('투자 계좌를 시가로 센다', wire.server.netWorth.investment, '800000');
  ctx.check('미실현손익 = 시가 - 장부가', wire.server.netWorth.unrealizedGain, '300000');
  console.log(`\n떠 둔 곳: ${target}`);
});
