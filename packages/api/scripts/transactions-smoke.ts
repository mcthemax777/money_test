import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import {
  makeAccounts,
  makeEntries,
  makeLedger,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

/**
 * 거래 화면이 서는 두 가지를 확인한다.
 *
 *   1. **거래가 있는 달** (`/reports/entry-months`). 전체 기간이고, 거래가 없는 달은
 *      아예 빠진다. 최신 달이 먼저 온다.
 *   2. **검색** (분류 여럿 · 자산 여럿). 같은 무리 안은 OR, 무리끼리는 AND.
 *
 * 두 번째가 요지다. 무리 안까지 AND 로 묶으면 둘을 고르는 순간 결과가 언제나 비고,
 * 무리끼리 OR 로 묶으면 고를수록 결과가 늘어 좁히는 도구가 넓히는 도구가 된다. 그리고
 * 계좌와 카드는 화면에서 "자산" 한 덩이라 서로 OR 여야 한다 -- 통장과 카드를 함께 고른
 * 검색이 빈 목록을 내면 사용자는 그 화면을 다시 쓰지 않는다.
 *
 * 검색이 세 겹(년월·구성비·목록) 모두에 같이 걸리는지도 함께 본다. 년월 줄에 적힌
 * 금액과 그것을 펴서 나온 거래의 합이 어긋나면 화면 안에서 숫자가 갈린다.
 */
runSmoke('transactions', async (ctx) => {
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

  const me = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const utility = cats.find((c) => c.name === '공과금')!;
  const salary = cats.find((c) => c.name === '급여')!;

  /*
   * 대분류와 그 소분류를 손으로 만든다.
   *
   * 기본 카테고리는 전부 평평해서 롤업 규칙(대분류를 고르면 소분류까지)을 검사할 수
   * 없다. 그 규칙이 이 화면에서 실제로 걸린다 -- 분류별 목록의 줄이 롤업된 대분류라,
   * 줄에 적힌 금액과 눌러서 나온 거래의 합이 같으려면 소분류까지 들어야 한다.
   */
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
  const dining = await categories.createCategory(
    uid,
    { name: '바깥밥', type: 'expense', parentId: food.id },
    pid,
  );

  const bank = await accounts.createAccount(
    uid,
    {
      type: 'deposit',
      ownerId: me.id,
      name: '보통예금',
      institutionId: 'fi_bank_shinhan',
      openingBalance: '3000000',
    },
    pid,
  );
  const other = await accounts.createAccount(
    uid,
    { type: 'deposit', ownerId: me.id, name: '비상금', institutionId: 'fi_bank_kb' },
    pid,
  );
  const card = await cards.createCard(
    uid,
    {
      paymentAccountId: bank.id,
      name: '신한체크',
      cardType: 'debit',
      issuerId: 'fi_card_shinhan',
    },
    pid,
  );
  /*
   * 신용카드도 둔다. 카드정산(통장 -> 카드)을 만들려면 부채 계정이 있어야 한다.
   *
   * 유형 조건은 "계좌 다리가 둘 이상이고 그중 하나가 신용카드"로 카드정산을 가른다.
   * 신용카드가 없으면 그 갈래가 데이터에 없어 검사가 헛돈다 (실제로 처음엔 그랬다).
   */
  const credit = await cards.createCard(
    uid,
    {
      paymentAccountId: bank.id,
      name: '신한 신용',
      cardType: 'credit',
      issuerId: 'fi_card_shinhan',
      statementClosingDay: 15,
      paymentDueDay: 25,
    },
    pid,
  );

  const at = (yearMonth: string, day: number) =>
    `${yearMonth}-${String(day).padStart(2, '0')}T03:00:00.000Z`;

  /*
   * 데이터를 이렇게 깐다.
   *
   *   2026-06  외식 1만  (통장)
   *   2026-08  외식 3만  (카드)   ← 분류·수단 둘 다 걸리는 줄
   *   2026-08  공과금 5만 (통장)
   *   2026-08  급여 100만 (통장)  ← 수입
   *   2026-08  외식 2만  (비상금)
   *   2026-07 은 비운다            ← 목록에서 빠져야 한다
   */
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-06', 10), description: '6월 외식',
      amount: '10000', categoryId: dining.id, accountId: bank.id },
    pid,
  );
  const cardDining = await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-08', 5), description: '카드 외식',
      amount: '30000', categoryId: dining.id, cardId: card.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-08', 6), description: '전기요금',
      amount: '50000', categoryId: utility.id, accountId: bank.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'income', personId: me.id, date: at('2026-08', 25), description: '월급',
      amount: '1000000', categoryId: salary.id, accountId: bank.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-08', 7), description: '비상금 외식',
      amount: '20000', categoryId: dining.id, accountId: other.id },
    pid,
  );

  /*
   * 이체와 카드정산, 그리고 신용카드 사용.
   *
   * 셋을 함께 두는 이유가 있다. **신용카드 사용은 카드정산이 아니다** -- 계좌 다리가
   * 부채 계정 하나뿐이라 지출로 분류된다. 카드정산은 통장과 부채 계정 둘이 얽힌
   * 거래다. 그 둘이 데이터에 함께 있어야 조건이 갈라 내는지 확인된다.
   */
  await entries.createEntry(
    uid,
    { kind: 'transfer', personId: me.id, date: at('2026-08', 12), description: '비상금으로 옮김',
      amount: '100000', accountId: bank.id, toAccountId: other.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-08', 13), description: '신용카드 외식',
      amount: '40000', categoryId: dining.id, cardId: credit.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'card_payment', personId: me.id, date: at('2026-08', 25),
      description: '카드 대금', amount: '40000', accountId: bank.id, cardId: credit.id },
    pid,
  );
  /*
   * 수수료가 붙은 이체.
   *
   * 이 전표가 유형 정의의 시험대다. 표시 유형은 이체지만 수수료 1,000원은 **지출
   * 카테고리 다리**다. 지출 합계는 카테고리 기준이라 이 1,000원을 이미 세고 있으므로,
   * 지출 필터도 이 전표를 넣어야 "지출만 고른 달의 합계 = 전체 지출"이 유지된다.
   */
  await entries.createEntry(
    uid,
    { kind: 'transfer', personId: me.id, date: at('2026-08', 14), description: '수수료 있는 이체',
      amount: '50000', accountId: bank.id, toAccountId: other.id,
      transferFee: '1000', transferFeeCategoryId: utility.id },
    pid,
  );

  /*
   * 달 경계를 시험하는 거래.
   *
   *   11-30  30일로 끝나는 달의 마지막 날
   *   12-01  그 다음 달 초하루
   *   12-31 23:30 KST  달의 마지막 순간 (UTC 로는 12-31 14:30)
   *
   * 앞의 둘이 요지다. `new Date('2026-11-31')` 은 오류가 아니라 **12월 1일로 넘어간다**
   * (2월은 3월 3일까지). 그래서 달 구간을 `-01 ~ -31` 로 만들면 11월 조회가 12월
   * 초하루를 함께 담고, 그 달이 "일부 선택"으로 보인다.
   *
   * 셋째는 시차다. UTC 자정으로 자르면 한국의 그날 오전 9시 이후가 빠진다.
   */
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-11', 30), description: '11월 마지막날',
      amount: '1100', categoryId: utility.id, accountId: bank.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: at('2026-12', 1), description: '12월 초하루',
      amount: '1200', categoryId: utility.id, accountId: bank.id },
    pid,
  );
  await entries.createEntry(
    uid,
    { kind: 'expense', personId: me.id, date: '2026-12-31T14:30:00.000Z',
      description: '12월 마지막 순간', amount: '1300', categoryId: utility.id, accountId: bank.id },
    pid,
  );

  // ── 1. 거래가 있는 달 ──
  const months = await reports.getEntryMonths(uid, { projectId: pid });
  // 6월·8월·11월·12월
  ctx.check('거래가 있는 달만 온다', months.length, 4);
  ctx.check('최신 달이 먼저다', months[0]?.yearMonth, '2026-12');
  ctx.check('빈 달은 빠진다', months.some((m) => m.yearMonth === '2026-07'), false);
  /*
   * 기초잔액 전표의 달(1970년)도 빠진다.
   *
   * 계좌를 만들면 원장 맨 앞에 자본 전표가 쌓인다. 그것까지 달로 세면 거래 목록의 첫
   * 화면에 "1970년 1월"이 줄로 앉는다 (전표 시각으로 달을 만들기 시작하면서 실제로 그랬다).
   */
  ctx.check('기초잔액의 달은 빠진다', months.some((m) => m.yearMonth.startsWith('19')), false);
  const august = months.find((m) => m.yearMonth === '2026-08');
  // 8월 지출: 카드 외식 3만 + 전기요금 5만 + 비상금 외식 2만 + 신용카드 외식 4만 + 수수료 1천
  ctx.check('8월 지출', august?.expense, '141000');
  ctx.check('8월 수입', august?.income, '1000000');
  ctx.check('6월 지출', months.find((m) => m.yearMonth === '2026-06')?.expense, '10000');

  /*
   * ── 달 경계 ──
   *
   * 목록을 한 달로 좁힐 때는 **달 이름을 그대로** 넘긴다. 부르는 쪽이 구간을 만들면
   * 위 주석의 두 가지가 어긋난다.
   */
  const november = await entries.getEntries(uid, { yearMonth: '2026-11', limit: 200 }, pid);
  ctx.check('11월은 한 건', november.data.length, 1);
  ctx.check('그 한 건은 11월 마지막날', november.data[0]?.description, '11월 마지막날');
  ctx.check(
    '11월에 12월 초하루가 새지 않는다',
    november.data.some((row) => row.description === '12월 초하루'),
    false,
  );

  const december = await entries.getEntries(uid, { yearMonth: '2026-12', limit: 200 }, pid);
  ctx.check('12월은 두 건', december.data.length, 2);
  ctx.check(
    '한국 시간 12월 31일 밤도 12월이다',
    december.data.some((row) => row.description === '12월 마지막 순간'),
    true,
  );

  /*
   * 그리고 **월 합계와 그 달 목록이 같은 경계를 본다.**
   *
   * 이것이 어긋나면 년월 줄에 적힌 금액과 그 안을 펴서 나온 거래의 합이 달라진다.
   * 화면 안에서 숫자가 갈리는 종류의 어긋남이다.
   */
  const monthTotals = await reports.getEntryMonths(uid, { projectId: pid });
  const decemberTotal = monthTotals.find((m) => m.yearMonth === '2026-12')?.expense;
  const decemberSum = december.data.reduce((sum, row) => sum + Number(row.amount), 0);
  ctx.check('12월 합계 = 12월 목록의 합', String(decemberSum), decemberTotal);
  const novemberTotal = monthTotals.find((m) => m.yearMonth === '2026-11')?.expense;
  ctx.check('11월 합계 = 11월 목록의 합', String(Number(november.data[0]?.amount)), novemberTotal);

  // ── 2. 분류 하나로 검색 ──
  const diningOnly = await entries.getEntries(uid, { categoryIds: dining.id }, pid);
  ctx.check('외식만 (전체 기간 4건)', diningOnly.data.length, 4);

  // ── 3. 분류 둘. 무리 안은 OR 다 ──
  const twoCategories = await entries.getEntries(
    uid,
    { categoryIds: `${dining.id},${utility.id}` },
    pid,
  );
  // 수수료 이체도 공과금 다리를 가져 함께 든다.
  // 경계 검증 거래 셋도 공과금이라 함께 든다.
  ctx.check('외식 또는 공과금 (9건)', twoCategories.data.length, 9);

  /*
   * ── 4. 대분류를 고르면 소분류까지 ──
   *
   * 외식은 식비의 소분류다. 목록의 줄이 롤업된 대분류이므로, 그 줄의 금액과 눌러서
   * 나온 거래의 합이 같으려면 소분류까지 들어야 한다.
   */
  const parentCategory = await entries.getEntries(uid, { categoryIds: food.id }, pid);
  ctx.check('대분류(식비)로 고르면 소분류(외식)까지', parentCategory.data.length, 4);

  // ── 5. 자산 하나 ──
  const cardOnly = await entries.getEntries(uid, { paymentCardIds: card.id }, pid);
  ctx.check('카드로 쓴 것만 (1건)', cardOnly.data.length, 1);
  ctx.check('그 한 건이 카드 외식이다', cardOnly.data[0]?.id, cardDining.id);

  /*
   * ── 6. 계좌와 카드는 한 무리다 ──
   *
   * 둘을 AND 로 묶으면 여기서 0건이 된다. 한 전표가 통장 다리와 카드 다리를 함께
   * 갖는 일은 체크카드뿐이고, 그때도 통장 다리에는 카드가 붙어 결제수단 관점에서 빠진다.
   *
   * 넷이다. **수입과 개설잔액은 여기 들지 않는다** -- 결제수단 관점은 "그 수단에서 돈이
   * 나간 전표"이고 둘은 통장 다리가 양수다. 이 화면의 수단별 목록도 같은 규칙으로 금액을
   * 세므로, 줄에 적힌 사용액과 눌러서 나온 거래가 서로 맞는다.
   *   6월 외식(통장) · 카드 외식(체크) · 전기요금(통장) · 비상금 외식(비상금)
   *   · 비상금으로 옮김(통장에서 나감) · 카드 대금(통장에서 나감)
   */
  const accountsAndCards = await entries.getEntries(
    uid,
    { paymentAccountIds: `${bank.id},${other.id}`, paymentCardIds: card.id },
    pid,
  );
  ctx.check('통장 둘 또는 카드 하나 (10건)', accountsAndCards.data.length, 10);

  /*
   * ── 유형 필터 ──
   *
   * 유형은 저장된 값이 아니라 다리에서 유도된다(`classifyEntry`). 조건은 그것을 손으로
   * 질의로 옮긴 것이라 두 벌이 갈릴 수 있다. 그래서 **모든 전표를 분류해 두고** 필터가
   * 고른 것과 하나씩 대조한다. 이 대조가 없으면 어긋남이 화면에서야 드러난다.
   */
  const everyEntry = await entries.getEntries(uid, { limit: 200 }, pid);
  const byKind = new Map<string, string[]>();
  for (const row of everyEntry.data) {
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.id].sort());
  }

  /*
   * 이동 쪽 셋은 표시 유형과 정확히 같아야 한다.
   *
   * 조건을 손으로 SQL·Prisma 로 옮겼으므로 `classifyEntry` 와 갈릴 수 있다. 그 어긋남은
   * 화면에서야 드러나므로 여기서 모든 전표를 분류해 하나씩 대조한다.
   */
  for (const kind of ['transfer', 'card_payment', 'adjustment']) {
    const filtered = await entries.getEntries(uid, { kinds: kind, limit: 200 }, pid);
    ctx.check(
      `유형 ${kind}: 표시 유형과 같은 전표`,
      filtered.data.map((row) => row.id).sort().join(','),
      (byKind.get(kind) ?? []).join(','),
    );
  }

  /*
   * 지출·수입은 **카테고리 기준**이라 표시 유형과 다르다.
   *
   * 기대값을 다리에서 직접 만든다. 그래야 조건이 "그 유형의 카테고리 다리가 있는 전표"를
   * 정확히 고르는지 확인된다.
   */
  for (const type of ['expense', 'income'] as const) {
    const rows = await ctx.prisma.posting.findMany({
      where: { entry: { projectId: pid }, category: { type } },
      select: { entryId: true },
    });
    const expected = [...new Set(rows.map((row) => row.entryId))].sort();
    const filtered = await entries.getEntries(uid, { kinds: type, limit: 200 }, pid);
    ctx.check(
      `유형 ${type}: 그 카테고리 다리가 있는 전표`,
      filtered.data.map((row) => row.id).sort().join(','),
      expected.join(','),
    );
  }

  /*
   * 수수료가 붙은 이체는 **지출과 이체 양쪽에 든다.**
   *
   * 돈이 옮겨진 것도 사실이고 수수료를 쓴 것도 사실이다. 배타적으로 두면 지출만 보는
   * 사람에게서 그 수수료가 사라지는데, 합계에는 남아 있어 숫자가 갈린다.
   */
  const feeEntryId = everyEntry.data.find((row) => row.description === '수수료 있는 이체')?.id;
  const expenseIds = (await entries.getEntries(uid, { kinds: 'expense', limit: 200 }, pid)).data
    .map((row) => row.id);
  const transferIds = (await entries.getEntries(uid, { kinds: 'transfer', limit: 200 }, pid)).data
    .map((row) => row.id);
  ctx.check('수수료 있는 이체가 지출에 든다', expenseIds.includes(feeEntryId!), true);
  ctx.check('수수료 있는 이체가 이체에도 든다', transferIds.includes(feeEntryId!), true);

  // 수수료 없는 이체는 지출에 들지 않는다. 카테고리 다리가 없다.
  const plainTransferId = everyEntry.data.find((row) => row.description === '비상금으로 옮김')?.id;
  ctx.check('수수료 없는 이체는 지출이 아니다', expenseIds.includes(plainTransferId!), false);

  /*
   * 그래서 **지출만 고른 달의 합계가 전체 지출과 같다.**
   *
   * 이것이 카테고리 기준을 고른 까닭이다. 표시 유형으로 걸면 수수료가 빠져 이 두 값이
   * 어긋나고, 사용자는 필터를 켰다 껐다 하며 다른 숫자를 보게 된다.
   */
  const allMonths = await reports.getEntryMonths(uid, { projectId: pid });
  const onlyExpense = await reports.getEntryMonths(uid, { projectId: pid, kinds: 'expense' });
  ctx.check(
    '지출만 고른 달의 지출 = 전체 지출',
    onlyExpense.find((m) => m.yearMonth === '2026-08')?.expense,
    allMonths.find((m) => m.yearMonth === '2026-08')?.expense,
  );

  // 여럿 고르면 OR 다.
  const twoKinds = await entries.getEntries(
    uid,
    { kinds: 'transfer,card_payment', limit: 200 },
    pid,
  );
  ctx.check(
    '유형 둘은 OR',
    twoKinds.data.length,
    (byKind.get('transfer') ?? []).length + (byKind.get('card_payment') ?? []).length,
  );

  // 다 고른 것은 고르지 않은 것과 같다.
  const allKinds = await entries.getEntries(
    uid,
    { kinds: 'expense,income,transfer,card_payment,adjustment', limit: 200 },
    pid,
  );
  ctx.check('유형을 다 고르면 전부', allKinds.data.length, everyEntry.data.length);
  const noKind = await entries.getEntries(uid, { kinds: '', limit: 200 }, pid);
  ctx.check('유형을 하나도 고르지 않으면 결과가 없다', noKind.data.length, 0);

  // 유형은 다른 무리와 AND 다.
  const kindAndCategory = await entries.getEntries(
    uid,
    { kinds: 'expense', categoryIds: dining.id, limit: 200 },
    pid,
  );
  ctx.check('지출 그리고 외식', kindAndCategory.data.length, 4);
  const incomeAndDining = await entries.getEntries(
    uid,
    { kinds: 'income', categoryIds: dining.id, limit: 200 },
    pid,
  );
  ctx.check('수입 그리고 외식 (0건)', incomeAndDining.data.length, 0);

  /*
   * 유형이 기간 집계에도 걸린다.
   *
   * 이체와 카드정산은 카테고리 다리가 없어 금액이 0이다. 그래도 **달은 목록에 남아야**
   * 한다 -- 눌러서 그 거래를 볼 수 있어야 하기 때문이다. 지출만 고르면 수입이 0으로 빠진다.
   */
  /*
   * 이체와 카드정산은 카테고리 다리가 없다. 그래도 **달은 목록에 남아야 한다** --
   * 눌러서 그 거래를 볼 수 있어야 하기 때문이다. 금액은 0이 맞다.
   */
  const transferMonths = await reports.getEntryMonths(uid, { projectId: pid, kinds: 'transfer' });
  ctx.check('이체만 고른 달이 있다', transferMonths.length, 1);
  ctx.check('그 달은 8월', transferMonths[0]?.yearMonth, '2026-08');
  // 수수료만 지출로 센다. 옮긴 돈 자체는 소비가 아니다.
  ctx.check('이체는 수수료만 지출로 센다', transferMonths[0]?.expense, '1000');
  ctx.check('이체는 수입으로 세지 않는다', transferMonths[0]?.income, '0');

  const cardPaymentMonths = await reports.getEntryMonths(
    uid,
    { projectId: pid, kinds: 'card_payment' },
  );
  ctx.check('카드정산만 고른 달이 있다', cardPaymentMonths.length, 1);
  ctx.check('카드정산도 금액은 0', cardPaymentMonths[0]?.expense, '0');

  const expenseMonths = await reports.getEntryMonths(uid, { projectId: pid, kinds: 'expense' });
  ctx.check(
    '지출만 고른 달의 수입은 0',
    expenseMonths.find((m) => m.yearMonth === '2026-08')?.income,
    '0',
  );
  ctx.check(
    '지출만 고른 8월 지출',
    expenseMonths.find((m) => m.yearMonth === '2026-08')?.expense,
    '141000',
  );
  const incomeMonths = await reports.getEntryMonths(uid, { projectId: pid, kinds: 'income' });
  ctx.check('수입만 고른 달은 8월 하나', incomeMonths.length, 1);
  ctx.check('수입만 고른 8월 수입', incomeMonths[0]?.income, '1000000');
  ctx.check('수입만 고른 8월 지출은 0', incomeMonths[0]?.expense, '0');

  /*
   * 수입이 정말로 빠지는지 따로 못 박는다. 위 숫자가 왜 4인지가 여기 있다.
   * 월급은 통장에 들어온 것이라 "통장으로 쓴 것"에는 들지 않는다.
   */
  const hasSalary = accountsAndCards.data.some((row) => row.description === '월급');
  ctx.check('수입은 결제수단 관점에서 빠진다', hasSalary, false);

  // ── 7. 무리끼리는 AND ──
  const andAcross = await entries.getEntries(
    uid,
    { categoryIds: dining.id, paymentCardIds: card.id },
    pid,
  );
  ctx.check('외식 그리고 체크카드 (1건)', andAcross.data.length, 1);

  const noMatch = await entries.getEntries(
    uid,
    { categoryIds: utility.id, paymentCardIds: card.id },
    pid,
  );
  ctx.check('공과금 그리고 카드 (0건)', noMatch.data.length, 0);

  /*
   * ── 8. 빈 값은 "아무것도 고르지 않음"이다 ──
   *
   * 체크를 모두 푼 상태를 "전체"로 되돌리면 사용자가 고른 것과 반대로 보인다.
   * 사람·과소비 필터가 이미 쓰는 규칙이다.
   */
  const emptySelection = await entries.getEntries(uid, { categoryIds: '' }, pid);
  ctx.check('분류를 하나도 고르지 않으면 결과가 없다', emptySelection.data.length, 0);

  /*
   * 다만 카드만 고른 검색은 계좌 목록이 빈 채로 도착한다. 그것은 "자산을 하나도
   * 고르지 않았다"가 아니므로 결과가 있어야 한다. 파라미터마다 따로 보면 여기서 0건이 된다.
   */
  const cardsWithEmptyAccounts = await entries.getEntries(
    uid,
    { paymentAccountIds: '', paymentCardIds: card.id },
    pid,
  );
  ctx.check('카드만 고른 검색은 살아 있다', cardsWithEmptyAccounts.data.length, 1);

  // ── 9. 검색이 세 겹에 함께 걸린다 ──
  const diningMonths = await reports.getEntryMonths(uid, { projectId: pid, categoryIds: dining.id });
  ctx.check('외식이 있는 달만 (6월·8월)', diningMonths.length, 2);
  // 카드 외식 3만 + 비상금 외식 2만 + 신용카드 외식 4만
  ctx.check('외식 검색 뒤 8월 지출', diningMonths[0]?.expense, '90000');

  const utilityMonths = await reports.getEntryMonths(
    uid,
    { projectId: pid, categoryIds: utility.id },
  );
  // 8월(전기요금)·11월·12월
  ctx.check('공과금이 있는 달', utilityMonths.length, 3);

  /*
   * 구성비도 같은 조건을 본다. 8월에 카드로 쓴 것만 보면 외식 3만 하나가 남는다.
   * 조건이 다리 쪽에 걸리면 여기서 통장으로 쓴 외식까지 섞여 5만이 된다.
   */
  const breakdown = await reports.getCategoryBreakdown(uid, {
    projectId: pid,
    yearMonth: '2026-08',
    type: 'expense',
    paymentCardIds: card.id,
  });
  ctx.check('카드 검색 뒤 구성비는 한 줄', breakdown.length, 1);
  ctx.check('그 줄은 외식 3만', breakdown[0]?.amount, '30000');

  /*
   * 수단별도 마찬가지다. 외식으로 검색하면 외식을 쓴 수단만 금액을 갖는다.
   * 카드 줄은 3만, 비상금 줄은 2만, 보통예금 줄은 6월 것이라 8월에는 0이다.
   */
  const methods = await reports.getPaymentMethods(uid, {
    projectId: pid,
    yearMonth: '2026-08',
    categoryIds: dining.id,
  });
  const cardRow = methods.find((row) => row.id === card.id);
  const otherRow = methods.find((row) => row.id === other.id);
  const bankRow = methods.find((row) => row.id === bank.id);
  ctx.check('외식 검색 뒤 카드 사용액', cardRow?.amount, '30000');
  ctx.check('외식 검색 뒤 비상금 사용액', otherRow?.amount, '20000');
  ctx.check('8월 외식을 쓰지 않은 통장은 0', bankRow?.amount, '0');
});
