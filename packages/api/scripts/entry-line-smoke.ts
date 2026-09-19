/**
 * 줄 단위 분할 검사.
 *
 * 한 결제를 여러 분류로 나눈 뒤, 그 줄들이 따로 살아 움직이는지를 본다.
 *
 *   1. 줄 키가 저장되고 **수정을 건너 이어진다.** 다리는 매번 지워지고 다시 만들어지므로
 *      이것이 무너지면 줄에 붙은 태그와 차감이 한 번의 수정으로 끊긴다.
 *   2. 태그가 줄에 붙는다. 분할된 두 줄이 서로 다른 태그를 갖는다.
 *   3. 분류·태그로 좁힌 목록은 **걸린 줄만** 보여 준다.
 *   4. 차감이 줄마다 따로다. 한 줄만 환불해도 다른 줄은 그대로다.
 *   5. 실적도 줄마다 따로다. 한 줄만 빼면 그 몫만 실적에서 빠진다.
 *   6. 0원이 되는 차감은 막는다.
 */
import { randomUUID } from 'node:crypto';
import { matchedAmountOf } from '@money/types';
import { Prisma } from '@prisma/client';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { ExchangeRatesService } from '@/modules/exchange-rates/exchange-rates.service';
import { ServerClockService } from '@/common/server-clock';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  lineTargets,
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeReports,
  makeTags,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

runSmoke('entry-line', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;

  const access = projectAccessStub(ctx.prisma, pid);
  const ledger = makeLedger(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const categories = makeCategories(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = makePeople(ctx.prisma, access);
  const tags = makeTags(ctx.prisma, access);
  const reports = makeReports(ctx.prisma, access);
  const cards = makeCards(ctx.prisma, access, institutions);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access as any, ledger as any);

  const person = await people.createPerson(uid, { name: '나' } as never, pid);
  const bankIssuer = await institutions.createInstitution(
    uid,
    { name: '신한은행', type: 'bank' } as never,
    pid,
  );
  const cardIssuer = await institutions.createInstitution(
    uid,
    { name: '신한카드', type: 'card_issuer' } as never,
    pid,
  );
  const bank = await accounts.createAccount(
    uid,
    {
      name: '월급통장',
      type: 'deposit',
      ownerId: person.id,
      institutionId: bankIssuer.id,
      initialBalance: '1000000',
    } as never,
    pid,
  );
  const card = await cards.createCard(
    uid,
    {
      name: '신한 신용',
      cardType: 'credit',
      issuerId: cardIssuer.id,
      paymentAccountId: bank.id,
      statementClosingDay: 15,
      paymentDueDay: 25,
    } as never,
    pid,
  );

  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' } as never, pid);
  const trip = await categories.createCategory(uid, { name: '여행경비', type: 'expense' } as never, pid);
  const tripTag = await tags.createTag(uid, { name: '여행' } as never, pid);
  const soloTag = await tags.createTag(uid, { name: '혼밥' } as never, pid);

  const foodLine = randomUUID();
  const tripLine = randomUUID();
  const date = new Date('2026-09-05T03:00:00.000Z').toISOString();

  // ── 1. 나눠 적는다. 줄마다 태그가 다르다 ──
  const split = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      date,
      description: '마트',
      accountId: bank.id,
      splits: [
        { categoryId: food.id, amount: '5000', lineKey: foodLine, tagIds: [soloTag.id] },
        { categoryId: trip.id, amount: '5000', lineKey: tripLine, tagIds: [tripTag.id] },
      ],
    } as never,
    pid,
  );

  ctx.check('줄이 둘이다', split.lines.length, 2);
  ctx.check('줄 키가 그대로 저장된다',
    split.lines.map((line) => line.lineKey).sort().join(','),
    [foodLine, tripLine].sort().join(','));
  ctx.check('식비 줄의 태그',
    split.lines.find((line) => line.categoryId === food.id)?.tags.map((tag) => tag.name).join(','),
    '혼밥');
  ctx.check('여행경비 줄의 태그',
    split.lines.find((line) => line.categoryId === trip.id)?.tags.map((tag) => tag.name).join(','),
    '여행');
  ctx.check('거래 자체에는 태그가 없다', split.tags.length, 0);

  // ── 2. 수정해도 줄 키가 이어진다 ──
  const edited = await entries.updateEntry(split.id, uid, {
    kind: 'expense',
    personId: person.id,
    date,
    description: '마트 (수정)',
    accountId: bank.id,
    splits: [
      { categoryId: food.id, amount: '6000', lineKey: foodLine, tagIds: [soloTag.id] },
      { categoryId: trip.id, amount: '5000', lineKey: tripLine, tagIds: [tripTag.id] },
    ],
  } as never);
  ctx.check('수정해도 줄 키가 같다',
    edited.lines.map((line) => line.lineKey).sort().join(','),
    [foodLine, tripLine].sort().join(','));
  ctx.check('줄의 태그도 그대로다',
    edited.lines.find((line) => line.lineKey === tripLine)?.tags.map((tag) => tag.name).join(','),
    '여행');

  // ── 3. 분류로 좁히면 걸린 줄만 ──
  const byCategory = await entries.getEntries(uid, { categoryIds: trip.id }, pid);
  ctx.check('거래는 한 건', byCategory.data.length, 1);
  ctx.check('걸린 줄만 보인다',
    byCategory.data[0]?.lines.filter((line) => line.matched).length, 1);
  ctx.check('그 줄이 여행경비다',
    byCategory.data[0]?.lines.find((line) => line.matched)?.categoryId, trip.id);

  const byTag = await entries.getEntries(uid, { tagIds: soloTag.id }, pid);
  ctx.check('태그로 좁혀도 걸린 줄만',
    byTag.data[0]?.lines.filter((line) => line.matched).map((line) => line.categoryId).join(','),
    food.id);

  // 조건이 없으면 두 줄 다 보인다.
  const all = await entries.getEntries(uid, {}, pid);
  const mine = all.data.find((row) => row.id === split.id);
  ctx.check('평소 목록은 두 줄 다', mine?.lines.filter((line) => line.matched).length, 2);

  /*
   * ── 3-2. 좁힌 화면의 소계도 걸린 줄만 ──
   *
   * 목록은 걸린 줄만 보여 주는데 날짜 줄과 수단 줄이 거래 전체를 더하면, 화면에
   * 5,000원 한 줄이 서 있고 그 옆에는 10,000원이 적힌다.
   */
  const rowsOfTrip = byCategory.data;
  ctx.check('좁힌 목록의 소계는 걸린 줄만',
    rowsOfTrip.reduce((sum, row) => sum + Number(matchedAmountOf(row)), 0), 5000);

  const methods = await reports.getPaymentMethods(uid, {
    projectId: pid, startDate: '2026-09-01', endDate: '2026-09-30', categoryIds: trip.id,
  } as never);
  const bankRow = methods.find((row) => row.id === bank.id);
  ctx.check('수단 줄도 걸린 줄만 센다', bankRow?.amount, '5000');

  // ── 4. 리포트도 걸린 줄만 더한다 ──
  const summary = await reports.getSummary(uid, {
    projectId: pid, startDate: '2026-09-01', endDate: '2026-09-30', tagIds: soloTag.id,
  } as never);
  ctx.check('태그로 좁힌 합계는 그 줄만', summary.expense, '6000');

  // ── 5. 차감은 줄마다 따로 ──
  const refunded = await entries.updateEntry(split.id, uid, {
    kind: 'expense',
    personId: person.id,
    date,
    description: '마트 (일부 환불)',
    accountId: bank.id,
    splits: [
      { categoryId: food.id, amount: '6000', lineKey: foodLine, tagIds: [soloTag.id] },
      {
        categoryId: trip.id, amount: '5000', lineKey: tripLine, tagIds: [tripTag.id],
        discountAmount: '2000',
      },
    ],
  } as never);
  const foodRow = refunded.lines.find((line) => line.lineKey === foodLine);
  const tripRow = refunded.lines.find((line) => line.lineKey === tripLine);
  ctx.check('환불한 줄만 깎인다', tripRow?.amount, '3000');
  ctx.check('다른 줄은 그대로다', foodRow?.amount, '6000');
  ctx.check('깎인 금액이 그 줄에 남는다', tripRow?.discountAmount, '2000');
  ctx.check('다른 줄에는 차감이 없다', foodRow?.discountAmount, null);
  ctx.check('거래 전체의 차감은 줄 합', refunded.discountAmount, '2000');

  /*
   * ── 6. 전액 환불 ──
   *
   * 환불로 순액이 0이 되는 것은 받는다. 1,000원을 결제하고 1,000원을 돌려받은 일은
   * 있었던 일이고, 카드 명세서에도 승인과 취소가 함께 남는다. 분할의 한 줄만 그렇게
   * 되는 것도 같다 -- 여행경비만 돌려받고 식비 줄은 그대로 남는다.
   */
  const oneZero = await entries.updateEntry(split.id, uid, {
    kind: 'expense',
    personId: person.id,
    date,
    description: '마트 (여행경비만 전액 환불)',
    accountId: bank.id,
    splits: [
      // 태그는 생략이 곧 "비운다"다. 뒤의 태그 검사가 딛고 설 값이라 함께 싣는다.
      { categoryId: food.id, amount: '6000', lineKey: foodLine, tagIds: [soloTag.id] },
      {
        categoryId: trip.id, amount: '5000', lineKey: tripLine, tagIds: [tripTag.id],
        discountAmount: '5000',
      },
    ],
  } as never);
  ctx.check('전액 환불된 줄은 0원으로 남는다',
    oneZero.lines.find((line) => line.lineKey === tripLine)?.amount, '0');
  ctx.check('그 줄의 차감은 그대로 남는다',
    oneZero.lines.find((line) => line.lineKey === tripLine)?.discountAmount, '5000');
  ctx.check('형제 줄은 그대로다',
    oneZero.lines.find((line) => line.lineKey === foodLine)?.amount, '6000');

  // 거래 전체가 0원이 되는 전액 환불.
  const wholeLine = randomUUID();
  const whole = await entries.createEntry(
    uid,
    {
      kind: 'expense', personId: person.id, date, description: '전액 취소',
      amount: '1000', discountAmount: '1000', categoryId: food.id, accountId: bank.id,
      lineKey: wholeLine,
    } as never,
    pid,
  );
  ctx.check('거래 전체가 0원으로 남는다', whole.amount, '0');
  ctx.check('깎인 금액으로 정가를 되살린다', whole.discountAmount, '1000');

  // 정가보다 크면 지출이 아니라 입금이다. 그것은 막는다.
  await ctx.expectReject('정가보다 큰 차감은 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, date, description: '넘는 차감',
        amount: '1000', discountAmount: '1001', categoryId: food.id, accountId: bank.id,
        lineKey: randomUUID(),
      } as never,
      pid,
    ),
  );

  /*
   * ── 7. 줄 키 없이 오면 거부 ──
   *
   * 스모크 뼈대의 `makeEntries` 는 키를 대신 채워 준다(스크립트마다 같은 줄을 흩지 않으려고).
   * 여기서는 그 채우기를 비켜 원래 서비스에 곧바로 보낸다.
   */
  const rawEntries = new EntriesService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    new ExchangeRatesService(ctx.prisma as any),
    new ServerClockService(),
  );
  await ctx.expectReject('줄 키가 없으면 거부', () =>
    rawEntries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, date, description: '키 없음',
        amount: '1000', categoryId: food.id, accountId: bank.id,
      } as never,
      pid,
    ),
  );

  // ── 8. 실적도 줄마다 따로 ──
  const cardFood = randomUUID();
  const cardGift = randomUUID();
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      date,
      description: '카드 결제',
      cardId: card.id,
      splits: [
        { categoryId: food.id, amount: '70000', lineKey: cardFood },
        // 한 줄만 환불받는다. 깎인 금액은 줄에 적힌다.
        { categoryId: trip.id, amount: '30000', lineKey: cardGift, discountAmount: '10000' },
      ],
      /*
       * 실적 두 칸은 **분할해도 하나다.** 카드사가 보는 것은 승인 한 건이라, 분류로
       * 나눴다고 절반만 실적에 드는 일은 없다. 여기서는 깎인 금액을 실적에서 빼지
       * 않기로 해, 청구액과 실적이 갈리는 것을 본다.
       */
      discountCountsPerformance: false,
    } as never,
    pid,
  );

  const usage = await cardLedger.getUsage(card.id, uid, 12);
  // 이 결제가 든 주기를 찾는다. 마감일이 15일이라 9/5 결제는 8/16~9/15 주기다.
  const current = usage.periods.find(
    (period) => period.periodStart <= '2026-09-05' && '2026-09-05' <= period.periodEnd,
  );
  ctx.check('청구액은 깎인 뒤 금액', current?.billed, '90000');
  ctx.check('실적은 줄들의 차감을 되살린 정가', current?.usage, '100000');

  // 실적에서 뺀 거래는 분할이어도 통째로 빠진다.
  const excludedA = randomUUID();
  const excludedB = randomUUID();
  await entries.createEntry(
    uid,
    {
      kind: 'expense', personId: person.id, date, description: '상품권',
      cardId: card.id,
      splits: [
        { categoryId: food.id, amount: '20000', lineKey: excludedA },
        { categoryId: trip.id, amount: '20000', lineKey: excludedB },
      ],
      countsPerformance: false,
    } as never,
    pid,
  );
  const afterExcluded = await cardLedger.getUsage(card.id, uid, 12);
  const period = afterExcluded.periods.find(
    (one) => one.periodStart <= '2026-09-05' && '2026-09-05' <= one.periodEnd,
  );
  ctx.check('청구액에는 든다', period?.billed, '130000');
  ctx.check('실적에는 들지 않는다', period?.usage, '100000');

  // ── 9. 태그 바꾸기도 줄 단위 ──
  const targets = await lineTargets(ctx.prisma, [split.id]);
  const onlyFood = targets.filter((target) => target.lineKey === foodLine);
  const changed = await entries.changeTags(uid, { targets: onlyFood, addTagIds: [tripTag.id] }, pid);
  ctx.check('한 줄에만 붙는다', changed.added, 1);

  const after = await entries.getEntryById(split.id, uid);
  ctx.check('그 줄에 둘',
    after.lines.find((line) => line.lineKey === foodLine)?.tags.length, 2);
  ctx.check('다른 줄은 그대로',
    after.lines.find((line) => line.lineKey === tripLine)?.tags.length, 1);

  // 사라진 줄을 가리키면 적용하지 않고 돌려준다.
  const ghost = await entries.changeTags(
    uid,
    { targets: [{ entryId: split.id, lineKey: 'no-such-line' }], addTagIds: [tripTag.id] },
    pid,
  );
  ctx.check('사라진 줄은 건너뛴다', ghost.skipped.length, 1);
  ctx.check('건너뛴 것은 적용되지 않는다', ghost.added, 0);

  void Prisma;
});
