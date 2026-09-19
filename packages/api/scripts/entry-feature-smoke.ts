import { randomUUID } from 'node:crypto';
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

/**
 * 거래 화면 검색의 **형태** 무리 (분할·할부).
 *
 * 둘은 저장된 값이 아니라 다리에서 유도된다. 분할은 **분류 다리가 둘 이상**인 것이고,
 * 할부는 **카드 다리에 할부 계획이 붙은** 것이다. 그래서 조건을 손으로 옮긴 자리마다
 * 갈릴 수 있고, 그 어긋남은 화면에서야 드러난다.
 *
 * 특히 분할이 위태롭다. Prisma 의 관계 조건은 some/every/none 뿐이라 "그런 다리가 둘
 * 이상"을 셀 수 없어, 서버는 세는 일만 따로 질의해 id 로 받는다(`splitEntryIds`).
 * 다리 하나만 보는 조건으로 대신하면 **분류 다리가 있는 거래가 전부** 걸린다.
 *
 * 검색이 목록에만 걸리고 합계에 걸리지 않는 일도 함께 막는다 -- 년월 줄에 적힌 금액과
 * 그것을 펴서 나온 거래의 합이 어긋나면 화면 안에서 숫자가 갈린다.
 */
runSmoke('entry-feature', async (ctx) => {
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
  const cards = makeCards(ctx.prisma, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const reports = makeReports(ctx.prisma, access);

  const me = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const utility = cats.find((c) => c.name === '공과금')!;
  const dining = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);

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

  const at = (day: number) => `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`;

  /*
   * 넷을 깐다. 네 갈래가 모두 있어야 조건이 서로를 대신하는지 드러난다.
   *
   *   보통 결제      분류 한 줄, 일시불   ← 어느 쪽에도 걸리면 안 된다
   *   분할 결제      분류 두 줄, 일시불
   *   할부 결제      분류 한 줄, 3개월
   *   분할한 할부    분류 두 줄, 3개월    ← 둘 다에 걸린다
   */
  const plain = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: me.id,
      date: at(5),
      description: '보통 결제',
      amount: '10000',
      categoryId: dining.id,
      accountId: bank.id,
    },
    pid,
  );
  const split = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: me.id,
      date: at(6),
      description: '나눠 적은 결제',
      amount: '20000',
      accountId: bank.id,
      splits: [
        { categoryId: dining.id, amount: '12000', lineKey: randomUUID() },
        { categoryId: utility.id, amount: '8000', lineKey: randomUUID() },
      ],
    },
    pid,
  );
  const installment = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: me.id,
      date: at(7),
      description: '3개월 할부',
      amount: '90000',
      categoryId: dining.id,
      cardId: credit.id,
      installmentMonths: 3,
    },
    pid,
  );
  const both = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: me.id,
      date: at(8),
      description: '나눠 적은 할부',
      amount: '60000',
      cardId: credit.id,
      installmentMonths: 6,
      splits: [
        { categoryId: dining.id, amount: '40000', lineKey: randomUUID() },
        { categoryId: utility.id, amount: '20000', lineKey: randomUUID() },
      ],
    },
    pid,
  );

  const idsOf = async (features?: string) =>
    (await entries.getEntries(uid, { features, limit: 200 }, pid)).data
      .map((row) => row.id)
      .sort()
      .join(',');
  const sorted = (...ids: string[]) => [...ids].sort().join(',');

  // ── 1. 무리 하나씩 ──
  ctx.check('분할만', await idsOf('split'), sorted(split.id, both.id));
  ctx.check('할부만', await idsOf('installment'), sorted(installment.id, both.id));

  /*
   * 일시불에 한 줄짜리인 거래는 어느 쪽에도 걸리지 않는다.
   *
   * 분할 조건을 "분류 다리가 있는 전표"로 적으면 여기서 드러난다 -- 그러면 보통 결제가
   * 함께 걸려 거르지 않은 목록이 걸러진 것처럼 보인다.
   */
  ctx.check(
    '보통 결제는 분할이 아니다',
    (await idsOf('split')).includes(plain.id),
    false,
  );
  ctx.check(
    '보통 결제는 할부가 아니다',
    (await idsOf('installment')).includes(plain.id),
    false,
  );

  // ── 2. 무리 안은 OR ──
  ctx.check(
    '분할 또는 할부',
    await idsOf('split,installment'),
    sorted(split.id, installment.id, both.id),
  );

  /*
   * 둘을 다 고른 것은 **고르지 않은 것과 다르다.**
   *
   * 유형은 다 고르면 전체와 같지만(한 거래가 한 갈래에만 든다), 형태는 겹쳐 붙는
   * 표시라 "분할도 할부도 아닌 거래"가 남는다. 그 거래가 빠지는 것이 맞다.
   */
  ctx.check(
    '형태를 다 골라도 보통 결제는 빠진다',
    (await idsOf('split,installment')).includes(plain.id),
    false,
  );
  ctx.check('형태를 고르지 않으면 보통 결제도 든다', (await idsOf()).includes(plain.id), true);

  // 빈 값은 "아무것도 고르지 않음"이다 (다른 무리와 같은 규칙).
  ctx.check('형태를 하나도 고르지 않으면 결과가 없다', await idsOf(''), '');

  // 아는 값이 아니면 무시한다. 남은 것이 없으면 빈 무리와 같다.
  ctx.check('모르는 형태는 버린다', await idsOf('split,없는것'), sorted(split.id, both.id));

  // ── 3. 무리끼리는 AND ──
  const withCategory = await entries.getEntries(
    uid,
    { features: 'split', categoryIds: utility.id, limit: 200 },
    pid,
  );
  ctx.check('분할 그리고 공과금', withCategory.data.map((row) => row.id).sort().join(','), sorted(split.id, both.id));

  const withCard = await entries.getEntries(
    uid,
    { features: 'installment', paymentCardIds: credit.id, limit: 200 },
    pid,
  );
  ctx.check(
    '할부 그리고 그 카드',
    withCard.data.map((row) => row.id).sort().join(','),
    sorted(installment.id, both.id),
  );

  const impossible = await entries.getEntries(
    uid,
    { features: 'installment', paymentAccountIds: bank.id, limit: 200 },
    pid,
  );
  /*
   * 할부는 신용카드에만 붙는다. 통장으로 낸 것과 AND 로 이으면 남는 것이 없다 --
   * 카드 대금 결제는 아직 없고, 할부 거래의 통장 다리도 없다.
   */
  ctx.check('할부 그리고 통장 (0건)', impossible.data.length, 0);

  /*
   * ── 4. 목록과 합계가 같은 조건을 본다 ──
   *
   * 검색이 목록에만 걸리면 년월 줄의 금액과 그것을 펴서 나온 거래의 합이 어긋난다.
   * 분할 2만 + 나눠 적은 할부 6만 = 8만.
   */
  const splitMonths = await reports.getEntryMonths(uid, { projectId: pid, features: 'split' });
  ctx.check('분할이 있는 달은 하나', splitMonths.length, 1);
  ctx.check('분할만 고른 8월 지출', splitMonths[0]?.expense, '80000');

  const installmentMonths = await reports.getEntryMonths(
    uid,
    { projectId: pid, features: 'installment' },
  );
  // 할부 9만 + 나눠 적은 할부 6만
  ctx.check('할부만 고른 8월 지출', installmentMonths[0]?.expense, '150000');

  const summary = await reports.getSummary(uid, { projectId: pid, yearMonth: '2026-08', features: 'split' });
  ctx.check('합계도 같은 조건을 본다', summary.expense, '80000');

  /*
   * 구성비도 마찬가지다. 분할 거래의 두 줄이 그대로 분류별로 갈린다.
   * 식비 12,000 + 40,000 = 52,000, 공과금 8,000 + 20,000 = 28,000.
   */
  const breakdown = await reports.getCategoryBreakdown(uid, {
    projectId: pid,
    yearMonth: '2026-08',
    type: 'expense',
    features: 'split',
  });
  ctx.check('분할 검색 뒤 구성비는 두 줄', breakdown.length, 2);
  ctx.check(
    '그중 식비',
    breakdown.find((row) => row.categoryName === '식비')?.amount,
    '52000',
  );
  ctx.check(
    '그중 공과금',
    breakdown.find((row) => row.categoryName === '공과금')?.amount,
    '28000',
  );
});
