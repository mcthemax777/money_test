/**
 * 페이백 조립 (PAYBACK_DESIGN.md 3단계).
 *
 * 실행: cd packages/api && node -r <tsconfig-paths 훅> -r ts-node/register/transpile-only \
 *       scripts/payback-smoke.ts
 *
 * 못 박는 것.
 *
 *   1. **다리 모양.** 계좌 +X, 원거래 줄의 지출 분류 −X. 링크 두 칸이 선다.
 *   2. **분류는 원거래 줄의 것이 이긴다.** 받은 분류가 달라도 그 줄의 분류로 선다.
 *   3. **카드로 들어오면 실적 제외가 기본이다** (카드 수입과 같다). 부채는 준다.
 *   4. **막는 것.** 줄 키 없는 링크, 분할, 수입 줄, 페이백의 페이백, 자기 자신, 페이백이
 *      걸린 거래를 페이백으로 바꾸기.
 *   5. **원거래가 없으면 링크를 비우고 들인다.** 온라인 요청과 명령 재생이 같다.
 *   6. **원거래를 지우면 걸린 환불·페이백도 함께 지운다** (7-6). 잔액도 되돌리고 자리표가 선다.
 *   7. **갈래를 바꾸면 링크가 빈다.** 수정은 전체 교체다.
 *   8. **목록과 필터** (4단계). 갈래는 다리로 정하고, 지출 필터에 페이백이 섞이지 않는다.
 *   9. **엑셀 왕복.** 페이백으로 나가고 페이백으로 돌아온다 (링크는 건너가지 않는다).
 *  14. **할부 환불 (7-9).** 남은 회차를 줄이고, 다 못 줄인 몫은 환불한 달에. 이자도 같은 비율로.
 */
import { randomUUID } from 'node:crypto';
import { encodeHlc, type Mutation } from '@money/types';
import { ServerClockService } from '@/common/server-clock';
import { EntryDraftsService } from '@/modules/entry-drafts/entry-drafts.service';
import { EntrySheetService } from '@/modules/entry-sheet/entry-sheet.service';
import { RecurringService } from '@/modules/entry-drafts/recurring.service';
import { ExchangeRatesService } from '@/modules/exchange-rates/exchange-rates.service';
import { HolidaysService } from '@/modules/holidays/holidays.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { MutationReplayService } from '@/modules/sync/mutation-replay.service';
import { SyncService } from '@/modules/sync/sync.service';
import {
  makeAccounts,
  makeBudgets,
  makeCardLedger,
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

const CLIENT = 'client-payback';
const RUN = Date.now().toString(36);

runSmoke('payback', async (ctx) => {
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
  const cards = makeCards(ctx.prisma, access, institutions);
  const tags = makeTags(ctx.prisma, access);
  const replay = new MutationReplayService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    entries as any,
    people as any,
    accounts as any,
    cards as any,
    makeCardLedger(ctx.prisma, access, ledger) as any,
    categories as any,
    tags as any,
    makeBudgets(ctx.prisma, access) as any,
    new ExchangeRatesService(ctx.prisma as any) as any,
    new ProjectsService(ctx.prisma as any, access as any, new ExchangeRatesService(ctx.prisma as any)) as any,
    new RecurringService(
      ctx.prisma as any,
      access as any,
      new EntryDraftsService(ctx.prisma as any, access as any) as any,
      new HolidaysService(ctx.prisma as any),
      new ServerClockService(),
    ) as any,
  );

  const person = await people.createPerson(uid, { name: '나' } as never, pid);
  const bankIssuer = await institutions.createInstitution(uid, { name: '신한은행', type: 'bank' } as never, pid);
  const cardIssuer = await institutions.createInstitution(uid, { name: '신한카드', type: 'card_issuer' } as never, pid);
  const bank = await accounts.createAccount(
    uid,
    { name: '월급통장', type: 'deposit', ownerId: person.id, institutionId: bankIssuer.id, initialBalance: '1000000' } as never,
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
  const salary = await categories.createCategory(uid, { name: '급여', type: 'income' } as never, pid);

  const balanceOf = async (accountId: string) =>
    (await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance.toString();
  const row = (id: string) =>
    ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id }, include: { postings: true } });

  // 원거래: 식비 10만 + 여행경비 5만을 카드로
  const foodLine = randomUUID();
  const tripLine = randomUUID();
  const original = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      date: '2026-09-05T03:00:00.000Z',
      description: '마트',
      cardId: card.id,
      splits: [
        { categoryId: food.id, amount: '100000', lineKey: foodLine },
        { categoryId: trip.id, amount: '50000', lineKey: tripLine },
      ],
    } as never,
    pid,
  );

  const paybackBody = (extra: object = {}) => ({
    kind: 'payback',
    personId: person.id,
    date: '2026-10-10T03:00:00.000Z',
    description: '캐시백',
    accountId: bank.id,
    categoryId: food.id,
    amount: '90000',
    lineKey: randomUUID(),
    paybackOfEntryId: original.id,
    paybackOfLineKey: foodLine,
    ...extra,
  });

  // ── 1. 다리 모양 ──
  const bankBefore = await balanceOf(bank.id);
  const payback = await entries.createEntry(uid, paybackBody() as never, pid);
  const stored = await row(payback.id);
  const categoryLeg = stored.postings.find((leg) => leg.categoryId);
  const accountLeg = stored.postings.find((leg) => leg.accountId);
  ctx.check('다리는 둘', stored.postings.length, 2);
  ctx.check('분류 다리는 원거래 줄의 분류, 음수', `${categoryLeg?.categoryId === food.id} ${categoryLeg?.baseAmount.toString()}`, 'true -90000');
  ctx.check('계좌 다리는 들어온 통장, 양수', `${accountLeg?.accountId === bank.id} ${accountLeg?.amount.toString()}`, 'true 90000');
  ctx.check('링크가 선다', `${stored.paybackOfEntryId === original.id} ${stored.paybackOfLineKey === foodLine}`, 'true true');
  ctx.check('통장 잔액이 는다', Number(await balanceOf(bank.id)) - Number(bankBefore), 90000);
  // 기기는 동기화로 링크를 받는다 (8단계). 응답의 전표 행에 두 칸이 실려야 한다.
  const pulled = (await new SyncService(ctx.prisma as any, access as any).pull(uid, { projectId: pid, since: 0 }))
    .changes.entries.find((row) => (row as { id: string }).id === payback.id) as
    | { paybackOfEntryId?: string; paybackOfLineKey?: string }
    | undefined;
  ctx.check('동기화 응답에 링크가 실린다', `${pulled?.paybackOfEntryId === original.id} ${pulled?.paybackOfLineKey === foodLine}`, 'true true');

  // ── 2. 분류는 원거래 줄의 것 ──
  const otherCategory = await entries.createEntry(uid, paybackBody({ categoryId: trip.id, amount: '1000' }) as never, pid);
  ctx.check('받은 분류가 달라도 그 줄의 분류로 선다',
    (await row(otherCategory.id)).postings.find((leg) => leg.categoryId)?.categoryId, food.id);

  // ── 3. 카드로 들어온 페이백 ──
  const liabilityBefore = await balanceOf(card.liabilityAccountId!);
  const cardPayback = await entries.createEntry(
    uid,
    paybackBody({ accountId: undefined, cardId: card.id, amount: '5000', paybackOfLineKey: tripLine, categoryId: trip.id }) as never,
    pid,
  );
  const cardRow = await row(cardPayback.id);
  ctx.check('카드 페이백은 실적 제외가 기본', cardRow.countsPerformance, false);
  ctx.check('카드 빚이 준다', Number(await balanceOf(card.liabilityAccountId!)) - Number(liabilityBefore), 5000);

  // ── 4. 막는 것 ──
  const income = await entries.createEntry(
    uid,
    { kind: 'income', personId: person.id, date: '2026-09-25T03:00:00.000Z', description: '월급', accountId: bank.id, categoryId: salary.id, amount: '3000000', lineKey: randomUUID() } as never,
    pid,
  );
  // 거부는 이유까지 본다. 앞선 검사에 먼저 걸려 통과로 보이면 뒤 규칙이 없어도 모른다.
  const reason = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return '거부되지 않음';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  ctx.check('줄 키 없는 링크는 거부',
    await reason(() => entries.createEntry(uid, paybackBody({ paybackOfLineKey: undefined }) as never, pid)),
    '페이백이 원거래의 어느 줄인지 알려 주세요.');
  ctx.check('나눠 적은 페이백은 거부',
    await reason(() => entries.createEntry(uid, paybackBody({ splits: [{ categoryId: food.id, amount: '1', lineKey: randomUUID() }] }) as never, pid)),
    '페이백은 나눠 적을 수 없습니다.');
  ctx.check('수입 줄에는 걸 수 없다',
    (await reason(() => entries.createEntry(uid, paybackBody({ paybackOfEntryId: income.id, paybackOfLineKey: income.lines[0].lineKey }) as never, pid))).includes('카테고리를 쓸 수 없습니다'),
    true);
  ctx.check('페이백의 페이백은 거부',
    await reason(() => entries.createEntry(uid, paybackBody({ paybackOfEntryId: payback.id, paybackOfLineKey: categoryLeg!.lineKey }) as never, pid)),
    '페이백에는 페이백을 걸 수 없습니다.');
  // 원장의 검사(자기 자신·사슬)는 조립 뒤에 돈다. 조립을 통과하는 대상(지출 전표)을 골라야
  // 조립의 "페이백의 페이백"에 먼저 걸리지 않고 원장의 검사까지 닿는다.
  const plain = await entries.createEntry(
    uid,
    { kind: 'expense', personId: person.id, date: '2026-09-06T03:00:00.000Z', description: '점심', accountId: bank.id, categoryId: food.id, amount: '8000', lineKey: randomUUID() } as never,
    pid,
  );
  ctx.check('자기 자신에게 거는 수정은 거부',
    await reason(() => entries.updateEntry(plain.id, uid, paybackBody({ amount: '100', paybackOfEntryId: plain.id, paybackOfLineKey: plain.lines[0].lineKey }) as never)),
    '거래 자신에게 페이백을 걸 수 없습니다.');
  ctx.check('페이백이 걸린 거래를 페이백으로 바꾸기는 거부',
    await reason(() => entries.updateEntry(original.id, uid, paybackBody({ amount: '100', paybackOfEntryId: plain.id, paybackOfLineKey: plain.lines[0].lineKey }) as never)),
    '페이백이 걸린 거래는 페이백이 될 수 없습니다.');

  // ── 5. 원거래가 없으면 링크를 비우고 들인다 ──
  const ghost = await entries.createEntry(uid, paybackBody({ paybackOfEntryId: randomUUID(), amount: '100' }) as never, pid);
  ctx.check('온라인: 없는 원거래면 링크가 빈다', (await row(ghost.id)).paybackOfEntryId, null);

  let seq = 0;
  const command = (payload: Record<string, unknown>): Mutation => ({
    mutationId: `${RUN}-payback-${(seq += 1)}`,
    clientId: CLIENT,
    clientSeq: seq,
    hlc: encodeHlc({ wall: Date.now(), counter: seq, node: 'device-a' }),
    kind: 'entry.create',
    projectId: pid,
    targets: [String(payload.id)],
    payload,
  });
  const replayedId = randomUUID();
  const replayed = await replay.push(uid, {
    projectId: pid,
    clientId: CLIENT,
    mutations: [command({ ...paybackBody({ amount: '200' }), id: replayedId, paybackOfEntryId: randomUUID() })],
  });
  ctx.check('재생: 없는 원거래여도 적용', replayed.results[0]?.status, 'applied');
  ctx.check('재생: 링크가 빈다', (await row(replayedId)).paybackOfEntryId, null);
  const linkedId = randomUUID();
  await replay.push(uid, {
    projectId: pid,
    clientId: CLIENT,
    mutations: [command({ ...paybackBody({ amount: '300' }), id: linkedId })],
  });
  ctx.check('재생: 원거래가 있으면 링크가 선다', (await row(linkedId)).paybackOfLineKey, foodLine);

  // ── 7. 갈래를 바꾸면 링크가 빈다 ──
  await entries.updateEntry(otherCategory.id, uid, {
    kind: 'income', personId: person.id, date: '2026-10-10T03:00:00.000Z', description: '수입으로',
    accountId: bank.id, categoryId: salary.id, amount: '1000', lineKey: randomUUID(),
  } as never);
  ctx.check('수입으로 바꾸면 링크가 빈다', (await row(otherCategory.id)).paybackOfEntryId, null);

  // ── 8. 목록 한 줄과 유형 필터 (4단계) ──
  const listed = (await entries.getEntries(uid, { limit: 200 }, pid)).data;
  const shown = listed.find((item) => item.id === payback.id)!;
  ctx.check('목록의 갈래는 payback', shown.kind, 'payback');
  ctx.check('금액은 양수, 계좌는 들어온 통장, 분류는 원거래 줄',
    `${shown.amount} ${shown.accountId === bank.id} ${shown.categoryId === food.id}`, '90000 true true');
  ctx.check('목록 한 줄에 링크가 실린다', `${shown.paybackOfEntryId === original.id} ${shown.paybackOfLineKey === foodLine}`, 'true true');
  ctx.check('링크 없는 페이백도 갈래는 payback', listed.find((item) => item.id === ghost.id)?.kind, 'payback');
  const ids = async (kinds: string) =>
    (await entries.getEntries(uid, { kinds, limit: 200 }, pid)).data.map((item) => item.id).sort().join(',');
  ctx.check('페이백 필터는 표시 갈래와 같다',
    await ids('payback'), listed.filter((item) => item.kind === 'payback').map((item) => item.id).sort().join(','));
  ctx.check('지출 필터에 페이백이 섞이지 않는다', (await ids('expense')).includes(payback.id), false);
  ctx.check('지출 필터에 원거래는 든다', (await ids('expense')).includes(original.id), true);

  // 카드 상세가 들어온 돈으로 묻는 조건 (웹 PaymentMethodTab 의 incomeQuery 와 같다).
  const cardInflow = (await entries.getEntries(uid, { cardId: card.id, kinds: 'income,payback', limit: 200 } as never, pid)).data;
  ctx.check('카드 상세의 들어온 돈에 카드 페이백이 든다', cardInflow.some((item) => item.id === cardPayback.id), true);
  ctx.check('카드 상세의 들어온 돈에 카드 결제는 없다', cardInflow.some((item) => item.id === original.id), false);

  // 원거래 상세의 "받은 페이백" (7단계). 그 원거래에 걸린 것만 온다.
  const linked = (await entries.getEntries(uid, { paybackOf: original.id, limit: 200 } as never, pid)).data;
  ctx.check('원거래에 걸린 페이백만 온다',
    linked.every((item) => item.paybackOfEntryId === original.id) && linked.some((item) => item.id === payback.id),
    true);
  ctx.check('링크 없는 페이백은 오지 않는다', linked.some((item) => item.id === ghost.id), false);

  // ── 8-2. 환불과 페이백 (7-3) ──
  //
  // 장부는 같고 종류만 다르다. 카드 실적의 기본값이 종류를 따르고, 직접 바꿀 수 있다.
  const cardBack = (extra: object) =>
    entries.createEntry(
      uid,
      paybackBody({ accountId: undefined, cardId: card.id, amount: '1000', paybackOfLineKey: tripLine, categoryId: trip.id, ...extra }) as never,
      pid,
    );
  const refund = await cardBack({ paybackType: 'refund' });
  ctx.check('카드 환불은 실적에서도 빼는 것이 기본', (await row(refund.id)).countsPerformance, true);
  ctx.check('종류가 저장된다', (await row(refund.id)).paybackType, 'refund');
  const keptRefund = await cardBack({ paybackType: 'refund', countsPerformance: false });
  ctx.check('환불도 실적을 그대로 둘 수 있다', (await row(keptRefund.id)).countsPerformance, false);
  const countedPayback = await cardBack({ paybackType: 'payback', countsPerformance: true });
  ctx.check('페이백도 실적에서 뺄 수 있다', (await row(countedPayback.id)).countsPerformance, true);
  ctx.check('종류를 적지 않으면 페이백', (await row(cardPayback.id)).paybackType, 'payback');
  ctx.check('목록 한 줄에 종류가 실린다',
    (await entries.getEntries(uid, { paybackOf: original.id, limit: 200 } as never, pid)).data.find((item) => item.id === refund.id)?.paybackType,
    'refund');
  ctx.check('모르는 종류는 거부',
    await reason(() => cardBack({ paybackType: 'gift' })),
    '알 수 없는 종류입니다: gift');

  // ── 9. 엑셀: 페이백으로 나가고 페이백으로 돌아온다 ──
  const sheet = new EntrySheetService(
    ctx.prisma as any,
    access as any,
    entries as any,
    people as any,
    accounts as any,
    cards as any,
    categories as any,
    tags as any,
    institutions as any,
  );
  const exported = await sheet.export(uid, {} as never, pid);
  const paybackRow = exported.find((sheetRow) => sheetRow.group === payback.id);
  ctx.check('내보낸 행의 구분은 페이백', paybackRow?.kind, '페이백');
  const target = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const targetAccess = projectAccessStub(ctx.prisma, target.id);
  const targetLedger = makeLedger(ctx.prisma, targetAccess);
  const targetInstitutions = new InstitutionsService(ctx.prisma as any, targetAccess);
  const targetSheet = new EntrySheetService(
    ctx.prisma as any,
    targetAccess as any,
    makeEntries(ctx.prisma, targetAccess, targetLedger) as any,
    makePeople(ctx.prisma, targetAccess) as any,
    makeAccounts(ctx.prisma, targetAccess, targetLedger, targetInstitutions) as any,
    makeCards(ctx.prisma, targetAccess, targetInstitutions) as any,
    makeCategories(ctx.prisma, targetAccess) as any,
    makeTags(ctx.prisma, targetAccess) as any,
    targetInstitutions as any,
  );
  const imported = await targetSheet.import(uid, { rows: [{ ...paybackRow!, row: 2 }] }, target.id);
  ctx.check('가져오기가 만든다', imported.created, 1);
  const back = await ctx.prisma.journalEntry.findFirstOrThrow({
    where: { projectId: target.id, description: '캐시백' },
    include: { postings: { include: { category: true } } },
  });
  const backLeg = back.postings.find((leg) => leg.category);
  ctx.check('돌아온 것도 지출 분류 음수 다리', `${backLeg?.category?.type} ${backLeg?.baseAmount.toString()}`, 'expense -90000');
  ctx.check('표로는 링크가 건너가지 않는다', back.paybackOfEntryId, null);
  const doubled = await targetSheet.import(
    uid,
    { rows: [{ ...paybackRow!, row: 2, group: 'g1' }, { ...paybackRow!, row: 3, group: 'g1' }] },
    target.id,
  );
  const refundRow = exported.find((sheetRow) => sheetRow.group === refund.id);
  ctx.check('환불은 환불로 나간다', refundRow?.kind, '환불');
  const refundBack = await targetSheet.import(uid, { rows: [{ ...refundRow!, row: 2, group: 'r1' }] }, target.id);
  ctx.check('환불을 가져온다', refundBack.created, 1);
  ctx.check('돌아온 것도 환불',
    (await ctx.prisma.journalEntry.findFirstOrThrow({ where: { projectId: target.id, paybackType: 'refund' } })).paybackType,
    'refund');
  ctx.check('두 행짜리 페이백은 건너뛴다', doubled.skipped[0]?.reason.startsWith('환불·페이백은 한 행이어야 합니다'), true);

  // ── 6. 원거래를 지우면 걸린 환불·페이백도 함께 지운다 (7-6) ──
  const attached = await ctx.prisma.journalEntry.findMany({
    where: { paybackOfEntryId: original.id },
    include: { postings: true },
  });
  // 통장으로 들어온 몫. 함께 지우면 그만큼 통장에서 빠진다 (원거래는 카드로 냈다).
  const bankIn = attached
    .flatMap((entry) => entry.postings)
    .filter((leg) => leg.accountId === bank.id)
    .reduce((sum, leg) => sum + Number(leg.amount), 0);
  ctx.check('지우기 전 걸린 것이 둘 이상', attached.length >= 2, true);
  const bankBeforeDelete = await balanceOf(bank.id);
  await entries.deleteEntry(original.id, uid);
  ctx.check('걸린 것이 모두 사라진다',
    await ctx.prisma.journalEntry.count({ where: { id: { in: attached.map((entry) => entry.id) } } }), 0);
  ctx.check('통장 잔액이 되돌아간다', Number(bankBeforeDelete) - Number(await balanceOf(bank.id)), bankIn);
  ctx.check('걸린 것마다 자리표가 선다 (기기가 지운다)',
    await ctx.prisma.tombstone.count({ where: { entityId: { in: attached.map((entry) => entry.id) } } }), attached.length);

  // ── 10. 집계 (5단계): 분석은 원거래의 달에 순액으로 센다 ──
  //
  // 숫자를 깨끗하게 보려고 가계부를 따로 둔다. 9월 5일 식비 10만, 10월 10일 그 페이백 9만,
  // 10월 12일 식비 2만, 10월 15일 링크 없는 페이백 1천.
  const p2 = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const a2 = projectAccessStub(ctx.prisma, p2.id);
  const l2 = makeLedger(ctx.prisma, a2);
  const e2 = makeEntries(ctx.prisma, a2, l2);
  const i2 = new InstitutionsService(ctx.prisma as any, a2);
  const r2 = makeReports(ctx.prisma, a2);
  const b2 = makeBudgets(ctx.prisma, a2);
  const me2 = await makePeople(ctx.prisma, a2).createPerson(uid, { name: '나' } as never, p2.id);
  const bank2 = await makeAccounts(ctx.prisma, a2, l2, i2).createAccount(
    uid,
    { name: '통장', type: 'deposit', ownerId: me2.id, institutionId: (await i2.createInstitution(uid, { name: '은행', type: 'bank' } as never, p2.id)).id, initialBalance: '1000000' } as never,
    p2.id,
  );
  const food2 = await makeCategories(ctx.prisma, a2).createCategory(uid, { name: '식비', type: 'expense' } as never, p2.id);
  const spentLine = randomUUID();
  const spent = await e2.createEntry(uid, {
    kind: 'expense', personId: me2.id, date: '2026-09-05T03:00:00.000Z', description: '회식',
    accountId: bank2.id, categoryId: food2.id, amount: '100000', lineKey: spentLine,
  } as never, p2.id);
  const back2 = await e2.createEntry(uid, {
    kind: 'payback', personId: me2.id, date: '2026-10-10T03:00:00.000Z', description: '회식 정산',
    accountId: bank2.id, categoryId: food2.id, amount: '90000', lineKey: randomUUID(),
    paybackOfEntryId: spent.id, paybackOfLineKey: spentLine,
  } as never, p2.id);
  await e2.createEntry(uid, {
    kind: 'expense', personId: me2.id, date: '2026-10-12T03:00:00.000Z', description: '점심',
    accountId: bank2.id, categoryId: food2.id, amount: '20000',
  } as never, p2.id);
  await e2.createEntry(uid, {
    kind: 'payback', personId: me2.id, date: '2026-10-15T03:00:00.000Z', description: '적립',
    accountId: bank2.id, categoryId: food2.id, amount: '1000',
  } as never, p2.id);

  const expenseOf = async (yearMonth: string, basis?: string) =>
    (await r2.getSummary(uid, { yearMonth, projectId: p2.id, ...(basis ? { basis } : {}) } as never)).expense;
  ctx.check('9월 지출은 순액 (10만 − 9만)', await expenseOf('2026-09'), '10000');
  ctx.check('10월 지출에 연결된 페이백은 없다 (2만 − 링크 없는 1천)', await expenseOf('2026-10'), '19000');
  ctx.check('회차 기준도 같다', await expenseOf('2026-09', 'installment'), '10000');
  const breakdown = await r2.getCategoryBreakdown(uid, { yearMonth: '2026-09', projectId: p2.id, type: 'expense' } as never);
  ctx.check('9월 분류별 식비', breakdown.find((row) => row.categoryId === food2.id)?.amount, '10000');
  const trend = await r2.getTrend(uid, { target: 'category', targetId: food2.id, endMonth: '2026-10', months: 2, projectId: p2.id } as never);
  ctx.check('식비 추이 (9월, 10월)', trend.map((point) => point.amount).join(','), '10000,19000');
  const daily = await r2.getDailyExpense(uid, { yearMonth: '2026-09', projectId: p2.id } as never);
  ctx.check('9월 5일 하루 지출도 순액', daily.find((point) => point.date === '2026-09-05')?.amount, '10000');

  await b2.createBudget(uid, { categoryId: food2.id, monthlyAmount: '50000', yearMonth: '2026-09' } as never, p2.id);
  const septBudget = await b2.getBudgetForMonth(uid, p2.id, 2026, 9);
  ctx.check('9월 식비 예산 사용액', septBudget.find((row) => row.categoryId === food2.id)?.usedAmount, '10000');

  const listIds = async (extra: object) =>
    (await e2.getEntries(uid, { categoryId: food2.id, startDate: '2026-09-01', endDate: '2026-09-30', limit: 200, ...extra } as never, p2.id)).data.map((row) => row.id);
  ctx.check('분석 기준 목록에는 9월 것의 페이백이 든다', (await listIds({ dateBasis: 'analysis' })).includes(back2.id), true);
  ctx.check('전표 날짜 기준 목록에는 없다', (await listIds({})).includes(back2.id), false);
  const analysisRow = (await e2.getEntries(uid, { categoryId: food2.id, startDate: '2026-09-01', endDate: '2026-09-30', dateBasis: 'analysis', limit: 200 } as never, p2.id)).data.find((row) => row.id === back2.id);
  ctx.check('목록 한 줄이 원거래 날짜를 싣는다', analysisRow?.paybackOfDate?.slice(0, 10), '2026-09-05');

  // ── 11. 자산 탭 (6단계): 들어온 날짜에, 그 수단으로 들어온 돈으로 선다 ──
  const methods = await r2.getPaymentMethods(uid, { yearMonth: '2026-10', projectId: p2.id } as never);
  const bankRow = methods.find((row) => row.id === bank2.id);
  ctx.check('10월 통장: 쓴 돈 2만, 들어온 돈 9만 + 1천', `${bankRow?.amount} ${bankRow?.income}`, '20000 91000');
  const septMethods = await r2.getPaymentMethods(uid, { yearMonth: '2026-09', projectId: p2.id } as never);
  ctx.check('9월 통장에는 페이백이 없다 (쓴 돈만)', `${septMethods.find((row) => row.id === bank2.id)?.income}`, '0');

  // 원거래를 지우면 걸린 페이백도 함께 간다 (7-6). 링크 없는 1천만 10월에 남는다.
  await e2.deleteEntry(spent.id, uid);
  ctx.check('원거래를 지우면 9월은 0', await expenseOf('2026-09'), '0');
  ctx.check('10월은 2만 − 링크 없는 1천', await expenseOf('2026-10'), '19000');

  // ── 13. 원거래를 고칠 때 (7-4): 걸린 환불·페이백과 어긋나지 않는다 ──
  const p3 = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const a3 = projectAccessStub(ctx.prisma, p3.id);
  const l3 = makeLedger(ctx.prisma, a3);
  const e3 = makeEntries(ctx.prisma, a3, l3);
  const i3 = new InstitutionsService(ctx.prisma as any, a3);
  const c3 = makeCategories(ctx.prisma, a3);
  const me3 = await makePeople(ctx.prisma, a3).createPerson(uid, { name: '나' } as never, p3.id);
  const bank3 = await makeAccounts(ctx.prisma, a3, l3, i3).createAccount(
    uid,
    { name: '통장', type: 'deposit', ownerId: me3.id, institutionId: (await i3.createInstitution(uid, { name: '은행', type: 'bank' } as never, p3.id)).id, initialBalance: '1000000' } as never,
    p3.id,
  );
  const food3 = await c3.createCategory(uid, { name: '식비', type: 'expense' } as never, p3.id);
  const life3 = await c3.createCategory(uid, { name: '생활', type: 'expense' } as never, p3.id);
  const etc3 = await c3.createCategory(uid, { name: '기타', type: 'expense' } as never, p3.id);
  const pay3 = await c3.createCategory(uid, { name: '급여', type: 'income' } as never, p3.id);
  const key3 = randomUUID();
  const base3 = { kind: 'expense', personId: me3.id, date: '2026-09-05T03:00:00.000Z', description: '회식', accountId: bank3.id };
  const orig3 = await e3.createEntry(uid, { ...base3, categoryId: food3.id, amount: '100000', lineKey: key3 } as never, p3.id);
  const back3 = await e3.createEntry(uid, {
    kind: 'payback', personId: me3.id, date: '2026-10-10T03:00:00.000Z', description: '정산', accountId: bank3.id,
    categoryId: food3.id, amount: '90000', lineKey: randomUUID(), paybackOfEntryId: orig3.id, paybackOfLineKey: key3,
  } as never, p3.id);
  const edit3 = (body: object) => e3.updateEntry(orig3.id, uid, { ...base3, ...body } as never);
  const backRow = () => ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: back3.id }, include: { postings: true } });
  const backCategory = async () => (await backRow()).postings.find((leg) => leg.categoryId)?.categoryId;
  const codeOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return '통과';
    } catch (error) {
      const body = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      return body?.code ?? (error instanceof Error ? error.message : String(error));
    }
  };

  ctx.check('금액을 돌려받은 것보다 작게 줄이면 거부',
    await codeOf(() => edit3({ categoryId: food3.id, amount: '80000', lineKey: key3 })), 'PAYBACK_EXCEEDS_LINE');
  ctx.check('할인으로 줄여도 거부',
    await codeOf(() => edit3({ categoryId: food3.id, amount: '100000', discountAmount: '20000', lineKey: key3 })), 'PAYBACK_EXCEEDS_LINE');
  ctx.check('거부되면 원거래는 그대로', (await ctx.prisma.posting.findFirstOrThrow({ where: { entryId: orig3.id, categoryId: { not: null } } })).baseAmount.toString(), '100000');

  const versionBefore = (await backRow()).updatedVersion;
  ctx.check('분류를 바꾸면 통과', await codeOf(() => edit3({ categoryId: life3.id, amount: '100000', lineKey: key3 })), '통과');
  ctx.check('환불·페이백의 분류도 따라간다', await backCategory(), life3.id);
  ctx.check('따라간 환불·페이백은 번호가 오른다', (await backRow()).updatedVersion > versionBefore, true);

  ctx.check('나눈 첫 줄이 돌려받은 것보다 작으면 거부',
    await codeOf(() => edit3({ amount: '100000', splits: [
      { categoryId: life3.id, amount: '60000', lineKey: key3 },
      { categoryId: etc3.id, amount: '40000', lineKey: randomUUID() },
    ] })), 'PAYBACK_EXCEEDS_LINE');
  const etcKey = randomUUID();
  ctx.check('충분히 남기고 나누면 통과',
    await codeOf(() => edit3({ amount: '100000', splits: [
      { categoryId: life3.id, amount: '95000', lineKey: key3 },
      { categoryId: etc3.id, amount: '5000', lineKey: etcKey },
    ] })), '통과');
  ctx.check('걸린 줄을 지우고 줄이 여럿이면 거부',
    await codeOf(() => edit3({ amount: '100000', splits: [
      { categoryId: etc3.id, amount: '5000', lineKey: etcKey },
      { categoryId: food3.id, amount: '95000', lineKey: randomUUID() },
    ] })), 'PAYBACK_LINE_GONE');
  const soleKey = randomUUID();
  ctx.check('나누기를 그만두고 한 줄로 돌아오면 통과', await codeOf(() => edit3({ categoryId: etc3.id, amount: '100000', lineKey: soleKey })), '통과');
  ctx.check('그 한 줄로 옮겨 간다', `${(await backRow()).paybackOfLineKey === soleKey} ${(await backCategory()) === etc3.id}`, 'true true');
  ctx.check('수입으로 바꾸면 거부',
    await codeOf(() => edit3({ kind: 'income', categoryId: pay3.id, amount: '100000', lineKey: soleKey })), 'PAYBACK_ORIGIN_NOT_EXPENSE');

  const more = (amount: string) => ({
    kind: 'payback', personId: me3.id, date: '2026-10-11T03:00:00.000Z', description: '추가 환불', accountId: bank3.id,
    categoryId: etc3.id, amount, lineKey: randomUUID(), paybackOfEntryId: orig3.id, paybackOfLineKey: soleKey,
  });
  ctx.check('새 환불·페이백도 줄 금액을 넘으면 거부', await codeOf(() => e3.createEntry(uid, more('20000') as never, p3.id)), 'PAYBACK_EXCEEDS_LINE');
  ctx.check('넘지 않으면 통과', await codeOf(() => e3.createEntry(uid, more('10000') as never, p3.id)), '통과');
  const replayed3 = await new MutationReplayService(
    ctx.prisma as any, a3 as any, l3 as any, e3 as any, makePeople(ctx.prisma, a3) as any,
    makeAccounts(ctx.prisma, a3, l3, i3) as any, makeCards(ctx.prisma, a3, i3) as any,
    makeCardLedger(ctx.prisma, a3, l3) as any, c3 as any, makeTags(ctx.prisma, a3) as any,
    makeBudgets(ctx.prisma, a3) as any, new ExchangeRatesService(ctx.prisma as any) as any,
    new ProjectsService(ctx.prisma as any, a3 as any, new ExchangeRatesService(ctx.prisma as any)) as any,
    new RecurringService(ctx.prisma as any, a3 as any, new EntryDraftsService(ctx.prisma as any, a3 as any) as any, new HolidaysService(ctx.prisma as any), new ServerClockService()) as any,
  ).push(uid, {
    projectId: p3.id,
    clientId: `${CLIENT}-3`,
    mutations: [{
      mutationId: `${RUN}-over-1`, clientId: `${CLIENT}-3`, clientSeq: 1,
      hlc: encodeHlc({ wall: Date.now(), counter: 0, node: 'device-b' }),
      kind: 'entry.create', projectId: p3.id, targets: ['x'],
      payload: { ...more('5000'), id: randomUUID() },
    }],
  });
  ctx.check('끊긴 기기가 따로 적은 것은 넘어도 받는다', replayed3.results[0]?.status, 'applied');

  {
  // ── 14. 할부 환불 (7-9): 남은 회차를 줄이고, 다 못 줄인 몫은 환불한 달에 ──
  //
  // 10월 5일 신용카드 12만 3개월(4만씩). 결제일 15일이라 청구 주기 = 달력 월과 같다.
  const p4 = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const a4 = projectAccessStub(ctx.prisma, p4.id);
  const l4 = makeLedger(ctx.prisma, a4);
  const e4 = makeEntries(ctx.prisma, a4, l4);
  const i4 = new InstitutionsService(ctx.prisma as any, a4);
  const r4 = makeReports(ctx.prisma, a4);
  const cl4 = makeCardLedger(ctx.prisma, a4, l4);
  const me4 = await makePeople(ctx.prisma, a4).createPerson(uid, { name: '나' } as never, p4.id);
  const bank4 = await makeAccounts(ctx.prisma, a4, l4, i4).createAccount(
    uid,
    { name: '통장', type: 'deposit', ownerId: me4.id, institutionId: (await i4.createInstitution(uid, { name: '은행', type: 'bank' } as never, p4.id)).id, initialBalance: '1000000' } as never,
    p4.id,
  );
  const card4 = await makeCards(ctx.prisma, a4, i4).createCard(
    uid,
    { name: '할부카드', cardType: 'credit', issuerId: (await i4.createInstitution(uid, { name: '카드사', type: 'card_issuer' } as never, p4.id)).id, paymentAccountId: bank4.id, statementClosingDay: 15, paymentDueDay: 25 } as never,
    p4.id,
  );
  const food4 = await makeCategories(ctx.prisma, a4).createCategory(uid, { name: '식비', type: 'expense' } as never, p4.id);
  const buyLine = randomUUID();
  const buy = (extra: object = {}) => e4.createEntry(uid, {
    kind: 'expense', personId: me4.id, date: '2026-10-05T03:00:00.000Z', description: '가전',
    cardId: card4.id, amount: '120000', categoryId: food4.id, lineKey: buyLine, installmentMonths: 3, ...extra,
  } as never, p4.id);
  const refundOf = (original: { id: string }, lineKey: string, amount: string, cut: string[] | undefined, extra: object = {}) =>
    e4.createEntry(uid, {
      kind: 'payback', paybackType: 'refund', personId: me4.id, date: '2026-11-10T03:00:00.000Z', description: '환불',
      cardId: card4.id, categoryId: food4.id, amount, lineKey: randomUUID(),
      paybackOfEntryId: original.id, paybackOfLineKey: lineKey, ...(cut ? { installmentCut: cut } : {}), ...extra,
    } as never, p4.id);
  const monthly = async () =>
    (await Promise.all(['2026-10', '2026-11', '2026-12'].map(async (yearMonth) =>
      (await r4.getSummary(uid, { yearMonth, projectId: p4.id, basis: 'installment' } as never)).expense))).join(' / ');
  const billed = async () => {
    const usage = await cl4.getUsage(card4.id, uid, 6);
    return ['2026-10', '2026-11', '2026-12']
      .map((key) => usage.periods.find((period) => period.closingKey === key)?.billed ?? '-')
      .join(' / ');
  };
  const codeOf4 = async (fn: () => Promise<unknown>) => {
    try { await fn(); return '통과'; } catch (error) {
      const body = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      return body?.code ?? (error instanceof Error ? error.message : String(error));
    }
  };

  const full = await buy();
  ctx.check('기본 할부: 회차 기준 10·11·12월', await monthly(), '40000 / 40000 / 40000');
  // 11월 환불 → 12월(3회차)부터 줄인다 (installmentCutStart). 전액 12만 중 4만은 3회차에서, 8만은 한꺼번에.
  const fullRefund = await refundOf(full, buyLine, '120000', ['0', '0', '40000']);
  const fullRow = await row(fullRefund.id);
  ctx.check('줄인 회차가 환불 전표에 남는다', JSON.stringify((fullRow.installmentAdjust as { principal: string[] }).principal), '["0","0","40000"]');
  ctx.check('회차 기준: 12월은 0, 이미 낸 8만은 11월에 돌아온다', await monthly(), '40000 / -40000 / 0');
  ctx.check('발생 기준: 산 달에 순액 0', (await r4.getSummary(uid, { yearMonth: '2026-10', projectId: p4.id } as never)).expense, '0');
  ctx.check('카드 청구: 12월 회차가 사라지고 11월에 8만을 돌려받는다', await billed(), '40000 / -40000 / 0');
  const listed = (await e4.getEntries(uid, { startDate: '2026-10-01', endDate: '2026-12-31', limit: 50 } as never, p4.id)).data;
  ctx.check('원거래 목록 한 줄에 줄인 회차가 실린다',
    JSON.stringify(listed.find((item) => item.id === full.id)?.installmentCuts?.map((cut) => cut.principal)), '[["0","0","40000"]]');
  ctx.check('환불 목록 한 줄에 자기가 줄인 것이 실린다', listed.find((item) => item.id === fullRefund.id)?.installmentAdjust?.principal.join(','), '0,0,40000');

  ctx.check('남은 회차보다 많이 줄이면 거부',
    await codeOf4(() => refundOf(full, buyLine, '50000', ['0', '0', '10000'])), 'INSTALLMENT_CUT_TOO_LARGE');
  await e4.deleteEntry(fullRefund.id, uid);
  ctx.check('환불을 지우면 원래 일정으로 돌아온다', await monthly(), '40000 / 40000 / 40000');

  // 부분 환불 3만: 3회차만 3만 줄인다. 다 줄였으니 한꺼번에 돌아오는 몫은 없다.
  const part = await refundOf(full, buyLine, '30000', ['0', '0', '30000']);
  ctx.check('부분 환불: 12월 회차만 1만으로', await monthly(), '40000 / 40000 / 10000');
  ctx.check('부분 환불의 카드 청구', await billed(), '40000 / 40000 / 10000');
  ctx.check('줄인 합이 환불보다 크면 거부',
    await codeOf4(() => refundOf(full, buyLine, '5000', ['0', '0', '6000'])), 'INSTALLMENT_CUT_OVER_AMOUNT');
  ctx.check('통장으로 받은 환불은 회차를 줄일 수 없다',
    await codeOf4(() => refundOf(full, buyLine, '5000', ['0', '0', '5000'], { cardId: undefined, accountId: bank4.id })), 'INSTALLMENT_CUT_NOT_ALLOWED');
  ctx.check('캐시백은 회차를 줄일 수 없다',
    await codeOf4(() => refundOf(full, buyLine, '5000', ['0', '0', '5000'], { paybackType: 'payback' })), 'INSTALLMENT_CUT_NOT_ALLOWED');
  const plain = await refundOf(full, buyLine, '5000', undefined);
  ctx.check('줄일 회차를 주지 않은 할부 환불은 0 으로 남는다 (환불한 달에 센다)',
    JSON.stringify((await row(plain.id)).installmentAdjust), '{"interest":["0","0","0"],"principal":["0","0","0"]}');
  ctx.check('줄이지 않은 환불은 환불한 달에 한꺼번에', await monthly(), '40000 / 35000 / 10000');

  const editBuy = (extra: object) => e4.updateEntry(full.id, uid, {
    kind: 'expense', personId: me4.id, date: '2026-10-05T03:00:00.000Z', description: '가전',
    cardId: card4.id, amount: '120000', categoryId: food4.id, lineKey: buyLine, installmentMonths: 3, ...extra,
  } as never);
  ctx.check('회차를 줄인 환불이 있으면 개월수를 바꿀 수 없다', await codeOf4(() => editBuy({ installmentMonths: 6 })), 'INSTALLMENT_REFUND_LOCKED');
  ctx.check('회차가 음수가 되게 줄이면 거부', await codeOf4(() => editBuy({ amount: '60000' })), 'INSTALLMENT_REFUND_LOCKED');
  ctx.check('설명만 고치면 통과', await codeOf4(() => editBuy({ description: '가전 (고침)' })), '통과');

  // 유이자: 회차 이자 1,200 / 800 / 400 (전표 12만 2,400). 11월 전액 환불 → 3회차 원금 4만과 이자 400 이 사라진다.
  const interestLine = randomUUID();
  const withInterest = await e4.createEntry(uid, {
    kind: 'expense', personId: me4.id, date: '2026-10-06T03:00:00.000Z', description: '유이자',
    cardId: card4.id, amount: '120000', categoryId: food4.id, lineKey: interestLine, installmentMonths: 3,
    installmentInterest: true, installmentInterestShares: ['1200', '800', '400'],
  } as never, p4.id);
  const debtBefore = await balanceOf((await ctx.prisma.card.findUniqueOrThrow({ where: { id: card4.id } })).liabilityAccountId!);
  const interestRefund = await refundOf(withInterest, interestLine, '120000', ['0', '0', '40000']);
  const interestRow = await row(interestRefund.id);
  ctx.check('사라진 이자도 줄인다', JSON.stringify((interestRow.installmentAdjust as { interest: string[] }).interest), '["0","0","400"]');
  ctx.check('환불 다리 = 돌려받은 돈 + 사라진 이자', interestRow.postings.find((leg) => leg.categoryId)?.baseAmount.toString(), '-120400');
  const debtAfter = await balanceOf((await ctx.prisma.card.findUniqueOrThrow({ where: { id: card4.id } })).liabilityAccountId!);
  ctx.check('카드 빚은 낸 이자(1,200 + 800)만 남는다', Number(debtAfter) - Number(debtBefore), 120400);

  // ── 15. 태그 손보기와 고른 것 지우기 (2026-10-08): 환불·페이백·할부가 흐트러지지 않는다 ──
  const tags4 = makeTags(ctx.prisma, a4);
  const fixed = await tags4.createTag(uid, { name: '고정비' } as never, p4.id);
  const before15 = await monthly();
  const plansOf = async (entryId: string) =>
    ctx.prisma.installmentPlan.count({ where: { posting: { entryId } } });
  const plansBefore = await plansOf(full.id);
  // 화면이 범위를 고를 때처럼 줄을 가리지 않고 보낸다 -- 서버가 그 전표의 분류 줄로 편다.
  await e4.changeTags(uid, { targets: [{ entryId: part.id }, { entryId: full.id }], addTagIds: [fixed.id] } as never, p4.id);
  const partRow = await ctx.prisma.journalEntry.findUniqueOrThrow({
    where: { id: part.id },
    include: { postings: true, tags: true },
  });
  ctx.check('환불의 분류 줄에 태그가 붙는다',
    partRow.tags.map((tag) => tag.lineKey).join(','), partRow.postings.find((leg) => leg.categoryId)?.lineKey);
  ctx.check('환불의 원거래 링크와 줄인 회차는 그대로',
    `${partRow.paybackOfEntryId === full.id} ${JSON.stringify((partRow.installmentAdjust as { principal: string[] }).principal)}`,
    'true ["0","0","30000"]');
  ctx.check('할부 원거래의 일정은 그대로', await plansOf(full.id), plansBefore);
  ctx.check('회차 기준 합계도 그대로', await monthly(), before15);
  await e4.changeTags(uid, { targets: [{ entryId: part.id }, { entryId: full.id }], removeTagIds: [fixed.id] } as never, p4.id);
  ctx.check('떼면 둘 다 빈다', await ctx.prisma.entryTag.count({ where: { entryId: { in: [part.id, full.id] } } }), 0);

  /*
   * 원거래와 걸린 환불을 함께 골라 지운다. 원거래를 지우면 환불도 함께 지워지므로(7-6), 화면이
   * 둘 다 보내면 늦게 닿은 쪽이 "없는 거래"가 된다. 화면(`deleteSelected`)은 원거래가 함께
   * 골라진 환불·페이백을 보내지 않는다 -- 여기서는 그 까닭을 못 박는다.
   */
  const attached15 = await ctx.prisma.journalEntry.findMany({ where: { paybackOfEntryId: full.id }, select: { id: true } });
  await e4.deleteEntry(full.id, uid);
  ctx.check('원거래를 지우면 걸린 환불이 모두 사라진다',
    await ctx.prisma.journalEntry.count({ where: { id: { in: attached15.map((entry) => entry.id) } } }), 0);
  ctx.check('그 뒤 환불을 또 지우면 없는 거래', await codeOf4(() => e4.deleteEntry(part.id, uid)), 'ENTRY_NOT_FOUND');
  }
});
