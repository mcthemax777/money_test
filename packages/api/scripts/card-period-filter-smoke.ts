/**
 * 주기 하나로 좁혀 보는 카드 내역.
 *
 * 카드 상세의 그래프 아래에서 주기 한 줄을 누르면 아래 목록이 그 주기만 남는다.
 * 여기서 보는 것은 그 좁히기를 서버가 제대로 받아 주는가다.
 *
 *   1. 계좌 원장(신용카드 결제내역)을 구간으로 자른다. **잔액은 자르지 않는다** --
 *      구간만큼만 세면 그 줄의 잔액이 카드의 실제 남은 대금과 달라진다.
 *   2. 실적 원장을 주기 이름으로 자른다. 날짜가 아니라 주기 이름인 것은 할부 회차가
 *      산 날이 아니라 청구되는 주기에 쌓이기 때문이다.
 *   3. 좁히지 않으면 지금까지처럼 전부 나온다.
 */
import { randomUUID } from 'node:crypto';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

runSmoke('card-period-filter', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;

  const access = projectAccessStub(ctx.prisma, pid);
  const ledger = makeLedger(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const categories = makeCategories(ctx.prisma, access);
  const people = makePeople(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const cards = makeCards(ctx.prisma, access, institutions);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access as any, ledger as any);

  const person = await people.createPerson(uid, { name: '나' } as never, pid);
  const bankIssuer = await institutions.createInstitution(
    uid, { name: '신한은행', type: 'bank' } as never, pid,
  );
  const cardIssuer = await institutions.createInstitution(
    uid, { name: '신한카드', type: 'card_issuer' } as never, pid,
  );
  const bank = await accounts.createAccount(
    uid,
    {
      name: '월급통장', type: 'deposit', ownerId: person.id,
      institutionId: bankIssuer.id, initialBalance: '1000000',
    } as never,
    pid,
  );
  // 마감일 15일. 8/16~9/15 가 한 주기다.
  const card = await cards.createCard(
    uid,
    {
      name: '신한 신용', cardType: 'credit', issuerId: cardIssuer.id,
      paymentAccountId: bank.id, statementClosingDay: 15, paymentDueDay: 25,
    } as never,
    pid,
  );
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' } as never, pid);

  /** 그 날짜에 카드로 쓴 거래 하나. */
  const spend = (date: string, amount: string) =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, date, description: `결제 ${date.slice(0, 10)}`,
        amount, categoryId: food.id, cardId: card.id, lineKey: randomUUID(),
      } as never,
      pid,
    );

  // 8/16~9/15 주기에 둘, 그 앞 주기(7/16~8/15)에 하나.
  await spend('2026-08-20T03:00:00.000Z', '10000');
  await spend('2026-09-05T03:00:00.000Z', '20000');
  await spend('2026-08-01T03:00:00.000Z', '70000');

  // ── 1. 그래프가 주는 주기 ──
  const usage = await cardLedger.getUsage(card.id, uid, 12);
  const picked = usage.periods.find(
    (period) => period.periodStart <= '2026-09-05' && '2026-09-05' <= period.periodEnd,
  );
  ctx.check('주기에 이름이 붙는다', picked?.closingKey, '2026-09');
  ctx.check('그 주기의 청구액', picked?.billed, '30000');

  // ── 2. 결제내역을 그 구간으로 ──
  const all = await accounts.getAccountPostings(card.liabilityAccountId!, uid, {});
  ctx.check('좁히지 않으면 전부', all.data.length, 3);

  const inPeriod = await accounts.getAccountPostings(card.liabilityAccountId!, uid, {
    startDate: picked!.periodStart,
    endDate: picked!.periodEnd,
  });
  ctx.check('그 주기의 줄만', inPeriod.data.length, 2);
  ctx.check('앞 주기 거래는 빠진다',
    inPeriod.data.some((row) => row.description.includes('08-01')), false);

  /*
   * 잔액은 자르지 않는다.
   *
   * 가장 오래된 줄(8/20, 1만)의 잔액은 그 앞의 7만까지 센 -8만이어야 한다. 구간만큼만
   * 세면 -1만이 되어 카드의 남은 대금과 어긋난다.
   */
  ctx.check('잔액은 맨 앞부터 쌓은 값이다',
    inPeriod.data[inPeriod.data.length - 1]?.balanceAfter, '-80000');

  // ── 3. 실적 원장을 그 주기로 ──
  const wholeLedger = await cardLedger.getPerformanceLedger(card.id, uid, {});
  ctx.check('좁히지 않으면 전부', wholeLedger.rows.length, 3);

  const onePeriod = await cardLedger.getPerformanceLedger(card.id, uid, {
    closingKey: picked!.closingKey,
  });
  ctx.check('그 주기의 줄만', onePeriod.rows.length, 2);
  ctx.check('머리글도 그 주기 하나', onePeriod.periods.length, 1);
  ctx.check('그 주기의 실적 합계', onePeriod.periods[0]?.total, '30000');
  // 한 주기만 보기로 했으면 더 오래된 주기를 이어 붙이지 않는다.
  ctx.check('다음 쪽이 없다', onePeriod.nextCursor, null);

  // 모양이 아닌 이름은 좁히지 않는다 (전부 나온다).
  const ignored = await cardLedger.getPerformanceLedger(card.id, uid, { closingKey: '아무거나' });
  ctx.check('모양이 아니면 좁히지 않는다', ignored.rows.length, 3);
});
