/**
 * 설정 엔티티 명령 재생 (3단계) -- 자산·분류·태그.
 *
 * 실행: cd packages/api && npx ts-node --transpile-only -r <별칭 훅> scripts/sync-push-assets-smoke.ts
 *
 * 전표와 규칙이 다른 자리만 본다.
 *
 *   1. **만들기.** 기기가 만든 id 로 구성원·통장·카드가 서고, 다시 보내면 duplicate 다.
 *      신용카드는 부채 계정까지 두 행이 함께 선다 -- 그 id 도 기기가 만든다.
 *   2. **필드별 병합.** 서로 다른 필드를 고친 두 편집은 둘 다 남는다. 같은 필드를 고친
 *      옛 편집만 진다. 전표라면 통째로 졌을 자리다 (D5).
 *   3. **전부 밀리면 충돌.** 보낸 필드가 하나도 이기지 못하면 조용히 넘어가지 않는다.
 *      사용자가 고친 이름이 말없이 사라지면 되살릴 길이 없다 (D6).
 *   4. **숨기기의 선행조건.** 활성 통장이 있는 구성원은 숨길 수 없다. 오프라인에서 적은
 *      명령이라도 서버가 그 조건을 다시 본다 (D11).
 *   5. **순서 바꾸기는 한 줄이다.** 분수 색인이라 옮긴 항목의 값만 바뀐다. 두 사람이
 *      각자 다른 항목을 옮겨도 둘 다 남는다 -- 목록 전체를 보내던 방식이 못 하던 것이다.
 *   6. **같은 이름은 별칭으로 잇는다.** 두 사람이 오프라인에서 같은 분류를 만들면 서버가
 *      이미 있는 행을 채택하고 그 id 를 알려 준다. 오류로 두면 그 명령이 영영 막힌다.
 */
import { randomUUID } from 'node:crypto';
import { ServerClockService } from '@/common/server-clock';
import { RecurringService } from '@/modules/entry-drafts/recurring.service';
import { EntryDraftsService } from '@/modules/entry-drafts/entry-drafts.service';
import { HolidaysService } from '@/modules/holidays/holidays.service';
import { ExchangeRatesService } from '@/modules/exchange-rates/exchange-rates.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { PlansService } from '@/modules/plans/plans.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { MutationReplayService } from '@/modules/sync/mutation-replay.service';
import { SyncService } from '@/modules/sync/sync.service';
import { encodeHlc, rankBetween, type Mutation, type MutationResult } from '@money/types';
import {
  makeAccounts,
  makeBudgets,
  makeCards,
  makeCardLedger,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeTags,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

/** 기기 시계. 벽시계를 고정해 검사가 시간에 흔들리지 않게 한다. */
const hlcAt = (ms: number, node = 'device-a') => encodeHlc({ wall: ms, counter: 0, node });
const T0 = Date.UTC(2026, 8, 5, 3, 0, 0);

/** 실행마다 다른 명령 id. MutationLog 는 프로젝트를 지워도 남는다. */
const RUN = Date.now().toString(36);
const CLIENT = 'client-assets';

runSmoke('sync-push-assets', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = makePeople(ctx.prisma, access);
  const cards = makeCards(ctx.prisma, access, institutions);
  const tags = makeTags(ctx.prisma, access);
  const categories = makeCategories(ctx.prisma, access);
  const budgets = makeBudgets(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  // 반복 등록 재생. 후보를 곧바로 만드는 일까지 온라인과 같은 서비스다.
  const recurringReplay = new RecurringService(
    ctx.prisma as any,
    access as any,
    new EntryDraftsService(ctx.prisma as any, access as any) as any,
    new HolidaysService(ctx.prisma as any),
    new ServerClockService(),
  );
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
    budgets as any,
    new ExchangeRatesService(ctx.prisma as any) as any,
    new ProjectsService(ctx.prisma as any, access as any, new ExchangeRatesService(ctx.prisma as any), new PlansService(ctx.prisma as any)) as any,
    recurringReplay as any,
  );

  let seq = 0;
  const push = (mutations: Mutation[]) =>
    replay.push(uid, { projectId: pid, clientId: CLIENT, mutations });
  const statusOf = (results: MutationResult[], id: string) =>
    results.find((row) => row.mutationId === id)?.status;

  const command = (
    kind: Mutation['kind'],
    targetId: string,
    payload: object,
    at: number,
    label = '',
  ): Mutation => ({
    mutationId: `${RUN}-${kind}-${label || targetId}-${(seq += 1)}`,
    clientId: CLIENT,
    clientSeq: seq,
    hlc: hlcAt(at),
    kind,
    projectId: pid,
    targets: [targetId],
    payload,
  });

  // ── 1. 만들기 ──
  const personId = '019273cc-0000-7000-8000-000000000001';
  const created = await push([
    command('person.create', personId, { id: personId, name: '김철수', relationship: '본인' }, T0),
  ]);
  ctx.check('구성원 만들기', created.results[0]?.status, 'applied');

  const person = await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } });
  ctx.check('기기가 만든 id 그대로', person.id, personId);
  ctx.check('이름이 들어간다', person.name, '김철수');
  ctx.check('필드마다 시계가 붙는다',
    (person.fieldHlc as Record<string, string>)?.name, hlcAt(T0));

  const again = await push([
    { ...command('person.create', personId, { id: personId, name: '김철수' }, T0),
      mutationId: `${RUN}-person-dup` },
  ]);
  ctx.check('같은 id 로 다시 만들면 duplicate', again.results[0]?.status, 'duplicate');
  ctx.check('구성원이 하나뿐이다',
    await ctx.prisma.person.count({ where: { projectId: pid } }), 1);

  const accountId = '019273cc-0000-7000-8000-000000000002';
  const madeAccount = await push([
    command('account.create', accountId, {
      id: accountId,
      name: '국민은행 통장',
      type: 'deposit',
      ownerId: personId,
      currency: 'KRW',
    }, T0 + 1_000),
  ]);
  ctx.check('통장 만들기', madeAccount.results[0]?.status, 'applied');

  const cardId = '019273cc-0000-7000-8000-000000000003';
  const liabilityId = '019273cc-0000-7000-8000-000000000004';
  const issuer = await ctx.prisma.financialInstitution.findFirstOrThrow({
    where: { type: 'card_issuer' },
  });
  const madeCard = await push([
    command('card.create', cardId, {
      id: cardId,
      liabilityAccountId: liabilityId,
      name: '신한 신용',
      cardType: 'credit',
      issuerId: issuer.id,
      paymentAccountId: accountId,
      statementClosingDay: 14,
      paymentDueDay: 25,
    }, T0 + 2_000),
  ]);
  ctx.check('카드 만들기', madeCard.results[0]?.status, 'applied');
  /*
   * 신용카드는 행 둘이다. 부채 계정 id 도 기기가 만들어 보내야 한다 -- 서버가 정하면
   * 오프라인에서 그 카드로 적은 거래가 어느 계정을 가리킬지 알 수 없다.
   */
  ctx.check('부채 계정도 기기 id 로 선다',
    await ctx.prisma.account.count({ where: { id: liabilityId } }), 1);

  // ── 2. 필드별 병합 ──
  //
  // 서버 쪽 이름이 T0+5분에 고쳐진 상태에서, T0+2분짜리 명령이 뒤늦게 도착한다.
  // 이름은 지고 관계는 이긴다. 전표라면 통째로 졌을 자리다.
  await people.updatePerson(personId, uid, { name: '김철수(웹)' }, hlcAt(T0 + 300_000, 'device-b'));

  const mixed = await push([
    command('person.update', personId, {
      id: personId,
      name: '김철수(폰)',
      relationship: '배우자',
    }, T0 + 120_000, 'mixed'),
  ]);
  ctx.check('일부가 이기면 적용이다', mixed.results[0]?.status, 'applied');

  const merged = await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } });
  ctx.check('진 필드는 서버 값 그대로', merged.name, '김철수(웹)');
  ctx.check('이긴 필드는 기기 값', merged.relationship, '배우자');
  ctx.check('시계도 필드마다 따로',
    (merged.fieldHlc as Record<string, string>)?.name, hlcAt(T0 + 300_000, 'device-b'));
  ctx.check('이긴 필드의 시계는 그 명령의 것',
    (merged.fieldHlc as Record<string, string>)?.relationship, hlcAt(T0 + 120_000));

  // ── 3. 보낸 필드가 전부 밀리면 충돌 ──
  const lost = await push([
    command('person.update', personId, { id: personId, name: '더 옛날 이름' }, T0 + 60_000, 'lost'),
  ]);
  ctx.check('전부 밀리면 충돌', lost.results[0]?.status, 'conflict');
  ctx.check('이유에 어느 필드인지 적는다',
    lost.results[0]?.error?.includes('name'), true);
  ctx.check('서버 값은 그대로',
    (await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } })).name, '김철수(웹)');

  // ── 4. 숨기기는 선행조건을 다시 본다 ──
  const blockedHide = await push([
    command('person.update', personId, { id: personId, isActive: false }, T0 + 400_000, 'hide'),
  ]);
  ctx.check('활성 통장이 있는 구성원은 숨길 수 없다', blockedHide.results[0]?.status, 'rejected');
  ctx.check('그래도 구성원은 살아 있다',
    (await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } })).isActive, true);

  // 통장을 숨기면(카드가 없어야 한다) 구성원도 숨길 수 있다.
  await cards.deactivateCard(cardId, uid);
  const hideAccount = await push([
    command('account.update', accountId, { id: accountId, isActive: false }, T0 + 410_000, 'hideA'),
  ]);
  ctx.check('통장 숨기기', hideAccount.results[0]?.status, 'applied');

  const hidePerson = await push([
    command('person.update', personId, { id: personId, isActive: false }, T0 + 420_000, 'hideP'),
  ]);
  ctx.check('그다음에는 구성원도 숨는다', hidePerson.results[0]?.status, 'applied');
  ctx.check('숨긴 것이 반영된다',
    (await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } })).isActive, false);

  /*
   * ── 4-2. 순번이 겹치면 어긋난 정도를 알려 준다 ──
   *
   * 기기의 번호가 뒤로 물러나면(사본이 마지막 커밋 몇 개를 잃는 경우가 있다) 이미 쓴
   * 번호로 다시 온다. 그냥 거절만 하면 기기는 1씩 올려 보며 부딪히는 수밖에 없고, 그동안
   * 그 기기의 모든 변경이 조용히 서버에 닿지 않는다. 마지막 번호를 함께 돌려주어 기기가
   * 한 번에 앞당길 수 있게 한다 (사본 쪽 처리는 core 의 outbox-smoke 가 본다).
   */
  const usedSeq = seq;
  const reused = await push([
    {
      mutationId: `${RUN}-seq-collision`,
      clientId: CLIENT,
      clientSeq: 1,
      hlc: hlcAt(T0 + 600_000),
      kind: 'person.update',
      projectId: pid,
      targets: [personId],
      payload: { id: personId, name: '순번 겹침' },
    },
  ]);
  ctx.check('이미 쓴 순번은 거절', reused.results[0]?.status, 'rejected');
  ctx.check('이유에 코드가 붙는다', reused.results[0]?.code, 'CLIENT_SEQ_TAKEN');
  ctx.check('서버가 아는 마지막 순번을 함께 준다', reused.results[0]?.lastClientSeq, usedSeq);
  ctx.check('이름은 바뀌지 않는다',
    (await ctx.prisma.person.findUniqueOrThrow({ where: { id: personId } })).name, '김철수(웹)');

  // ── 5. 없는 대상을 고치면 거절 ──
  const ghost = await push([
    command('card.update', 'no-such-card', { id: 'no-such-card', name: 'x' }, T0 + 500_000),
  ]);
  ctx.check('없는 카드를 고치면 거절', ghost.results[0]?.status, 'rejected');
  ctx.check('이유에 코드가 붙는다', ghost.results[0]?.code, 'TARGET_NOT_FOUND');

  // ── 5-2. 순서 바꾸기 ──
  //
  // 구성원 셋을 만들어 놓고, 두 기기가 **각자 다른 사람을** 옮긴다. 정수 순번이었다면
  // 나중에 도착한 목록이 앞의 이동을 지웠다.
  const ids = ['a', 'b', 'c'].map((suffix) => `019273cc-0000-7000-8000-00000000001${suffix}`);
  for (const [index, id] of ids.entries()) {
    await push([
      command('person.create', id, { id, name: `순서${index}` }, T0 + 600_000 + index),
    ]);
  }
  const rankOf = async (id: string) =>
    (await ctx.prisma.person.findUniqueOrThrow({ where: { id } })).sortRank;
  const orderNow = async () =>
    (
      await ctx.prisma.person.findMany({
        where: { projectId: pid, id: { in: ids } },
        orderBy: [{ sortRank: 'asc' }],
        select: { id: true },
      })
    ).map((row) => ids.indexOf(row.id));
  ctx.check('만든 차례대로 선다', (await orderNow()).join(','), '0,1,2');

  // 기기 A: 셋째를 맨 앞으로. 기기 B: 첫째를 둘째 뒤로. 둘 다 자기 한 줄만 건드린다.
  const rank0 = await rankOf(ids[0]);
  const rank1 = await rankOf(ids[1]);
  const toFront = rankBetween(null, rank0);
  const afterSecond = rankBetween(rank1, await rankOf(ids[2]));

  await push([
    command('person.update', ids[2], { id: ids[2], sortRank: toFront }, T0 + 700_000, 'moveC'),
  ]);
  await push([
    command('person.update', ids[0], { id: ids[0], sortRank: afterSecond }, T0 + 700_001, 'moveA'),
  ]);

  ctx.check('두 이동이 모두 남는다', (await orderNow()).join(','), '2,1,0');
  ctx.check('옮기지 않은 사람의 값은 그대로', await rankOf(ids[1]), rank1);

  // ── 5-3. 분류와 태그도 같은 길이다 ──
  const categoryId = '019273cc-0000-7000-8000-000000000020';
  const madeCategory = await push([
    command('category.create', categoryId, {
      id: categoryId,
      name: '오프라인 분류',
      type: 'expense',
    }, T0 + 800_000),
  ]);
  ctx.check('분류 만들기', madeCategory.results[0]?.status, 'applied');

  const childId = '019273cc-0000-7000-8000-000000000021';
  const madeChild = await push([
    command('category.create', childId, {
      id: childId,
      name: '소분류 하나',
      type: 'expense',
      parentId: categoryId,
    }, T0 + 800_100),
  ]);
  ctx.check('소분류도 만든다', madeChild.results[0]?.status, 'applied');
  ctx.check('부모가 이어진다',
    (await ctx.prisma.category.findUniqueOrThrow({ where: { id: childId } })).parentId, categoryId);

  const renamed = await push([
    command('category.update', categoryId, { id: categoryId, name: '이름 고침' }, T0 + 800_200),
  ]);
  ctx.check('분류 고치기', renamed.results[0]?.status, 'applied');
  ctx.check('이름이 바뀐다',
    (await ctx.prisma.category.findUniqueOrThrow({ where: { id: categoryId } })).name, '이름 고침');

  const tagId = '019273cc-0000-7000-8000-000000000022';
  const madeTag = await push([
    command('tag.create', tagId, { id: tagId, name: '오프라인 태그', color: '#ef4444' }, T0 + 800_300),
  ]);
  ctx.check('태그 만들기', madeTag.results[0]?.status, 'applied');
  ctx.check('색도 함께 담긴다',
    (await ctx.prisma.tag.findUniqueOrThrow({ where: { id: tagId } })).color, '#ef4444');

  // ── 6-1. 같은 이름을 두 기기가 만들면 ──
  //
  // 다른 기기가 만든 셈 치고 다른 id 로 같은 이름을 보낸다. 서버는 이미 있는 행을
  // 채택하고 별칭을 돌려준다 -- 기기는 그것으로 자기 사본과 큐의 참조를 옮긴다.
  const twinId = '019273cc-0000-7000-8000-000000000023';
  const twin = await push([
    command('category.create', twinId, { id: twinId, name: '이름 고침', type: 'expense' }, T0 + 900_000),
  ]);
  ctx.check('같은 이름은 거절하지 않는다', twin.results[0]?.status, 'applied');
  ctx.check('이미 있는 행을 채택한다', twin.results[0]?.alias?.to, categoryId);
  ctx.check('기기가 만든 id 를 알려 준다', twin.results[0]?.alias?.from, twinId);
  ctx.check('행이 늘지 않는다',
    await ctx.prisma.category.count({ where: { projectId: pid, name: '이름 고침' } }), 1);

  const twinTagId = '019273cc-0000-7000-8000-000000000024';
  const twinTag = await push([
    command('tag.create', twinTagId, { id: twinTagId, name: '오프라인 태그' }, T0 + 900_100),
  ]);
  ctx.check('태그도 같은 규칙', twinTag.results[0]?.alias?.to, tagId);

  /*
   * 태그 지우기. 감춰 두는 자리가 없어져(20260919150000_no_hidden_rows) `isActive: false`
   * 는 "지워 달라"는 표식으로 남았다 -- 행은 사라지고 자리표만 남는다.
   *
   * 같은 이름을 채택하는 6-1 뒤에 둔다. 먼저 지우면 채택할 행이 없어 그 검사가 뜻을 잃는다.
   */
  const goneTag = await push([
    command('tag.update', tagId, { id: tagId, isActive: false }, T0 + 950_000),
  ]);
  ctx.check('태그 지우기', goneTag.results[0]?.status, 'applied');
  ctx.check('행이 사라진다', await ctx.prisma.tag.count({ where: { id: tagId } }), 0);
  ctx.check('지운 자리에 자리표가 남는다',
    await ctx.prisma.tombstone.count({ where: { entity: 'Tag', entityId: tagId } }), 1);

  // ── 5-4. 예산: 행은 필드별, 월 조정은 키별 ──
  const budgetId = '019273cc-0000-7000-8000-000000000030';
  const madeBudget = await push([
    command('budget.set', budgetId, {
      id: budgetId,
      categoryId,
      monthlyAmount: '200000',
    }, T0 + 1_000_000),
  ]);
  ctx.check('예산 만들기', madeBudget.results[0]?.status, 'applied');
  ctx.check('금액이 들어간다',
    (await ctx.prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).monthlyAmount.toString(),
    '200000');

  const raised = await push([
    command('budget.set', budgetId, {
      id: budgetId,
      categoryId,
      monthlyAmount: '300000',
    }, T0 + 1_000_100, 'raise'),
  ]);
  ctx.check('금액 바꾸기', raised.results[0]?.status, 'applied');

  const stale = await push([
    command('budget.set', budgetId, {
      id: budgetId,
      categoryId,
      monthlyAmount: '999',
    }, T0, 'staleBudget'),
  ]);
  ctx.check('뒤늦게 온 옛 금액은 충돌', stale.results[0]?.status, 'conflict');
  ctx.check('나중 금액이 남는다',
    (await ctx.prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).monthlyAmount.toString(),
    '300000');

  // 다른 기기가 끊긴 채 같은 분류의 예산을 제 id 로 정했다. 서버는 있는 규칙과 시계를 견준다.
  const otherBudgetId = '019273cc-0000-7000-8000-000000000032';
  const staleOther = await push([
    command('budget.set', otherBudgetId, {
      id: otherBudgetId,
      categoryId,
      monthlyAmount: '111',
    }, T0 + 50, 'staleOther'),
  ]);
  ctx.check('다른 id 로 온 옛 금액도 충돌', staleOther.results[0]?.status, 'conflict');
  ctx.check('충돌에도 있는 규칙을 별칭으로 알린다', staleOther.results[0]?.alias?.to, budgetId);
  ctx.check('다른 id 로 규칙을 하나 더 만들지 않는다',
    await ctx.prisma.budget.count({ where: { id: otherBudgetId } }), 0);
  ctx.check('나중 금액이 그대로',
    (await ctx.prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).monthlyAmount.toString(),
    '300000');
  const newerOther = await push([
    command('budget.set', otherBudgetId, {
      id: otherBudgetId,
      categoryId,
      monthlyAmount: '400000',
    }, T0 + 1_000_150, 'newerOther'),
  ]);
  ctx.check('다른 id 로 온 새 금액은 적용', newerOther.results[0]?.status, 'applied');
  ctx.check('적용도 별칭을 알린다', newerOther.results[0]?.alias?.to, budgetId);
  ctx.check('있는 규칙의 금액이 바뀐다',
    (await ctx.prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).monthlyAmount.toString(),
    '400000');

  const overrideId = '019273cc-0000-7000-8000-000000000031';
  const madeOverride = await push([
    command('budget.override', overrideId, {
      id: overrideId,
      budgetId,
      year: 2026,
      month: 9,
      amount: '50000',
    }, T0 + 1_000_200),
  ]);
  ctx.check('그 달만 다른 금액', madeOverride.results[0]?.status, 'applied');
  ctx.check('조정이 남는다',
    (await ctx.prisma.budgetOverride.findFirstOrThrow({
      where: { budgetId, year: 2026, month: 9 },
    })).amount.toString(),
    '50000');

  /*
   * 다른 달을 고친 편집은 애초에 충돌이 아니다. 시계가 이르더라도 각자 자기 행이라
   * 그대로 들어간다 -- 이것이 "키별 병합"의 뜻이다.
   */
  const otherMonth = await push([
    command('budget.override', '019273cc-0000-7000-8000-000000000032', {
      id: '019273cc-0000-7000-8000-000000000032',
      budgetId,
      year: 2026,
      month: 10,
      amount: '10000',
    }, T0 + 1, 'otherMonth'),
  ]);
  ctx.check('다른 달은 다투지 않는다', otherMonth.results[0]?.status, 'applied');
  ctx.check('두 달이 함께 남는다',
    await ctx.prisma.budgetOverride.count({ where: { budgetId } }), 2);

  const cleared = await push([
    command('budget.override', overrideId, {
      id: overrideId,
      budgetId,
      year: 2026,
      month: 9,
      amount: null,
    }, T0 + 1_000_300, 'clear'),
  ]);
  ctx.check('금액을 비우면 그 달의 조정을 지운다', cleared.results[0]?.status, 'applied');
  ctx.check('그 달만 사라진다',
    await ctx.prisma.budgetOverride.count({ where: { budgetId } }), 1);

  // 규칙 지우기 (모든 달 0원). 달별 조정도 함께 가고, 다시 보내도 그대로 끝난다.
  const deleted = await push([
    command('budget.delete', budgetId, { id: budgetId }, T0 + 1_000_400, 'deleteBudget'),
  ]);
  ctx.check('예산 지우기', deleted.results[0]?.status, 'applied');
  ctx.check('규칙이 사라진다', await ctx.prisma.budget.count({ where: { id: budgetId } }), 0);
  ctx.check('달별 조정도 함께 사라진다',
    await ctx.prisma.budgetOverride.count({ where: { budgetId } }), 0);
  const deletedAgain = await push([
    command('budget.delete', budgetId, { id: budgetId }, T0 + 1_000_500, 'deleteAgain'),
  ]);
  ctx.check('이미 없는 예산을 지우는 명령도 끝난 것으로 본다', deletedAgain.results[0]?.status, 'applied');

  // ── 예산 "고른 달부터": 대상과 달로 보낸다 (규칙 id 가 아니라) ──
  const ruleA = '019273cc-0000-7000-8000-000000000040';
  await push([command('budget.set', ruleA, { id: ruleA, categoryId, type: 'expense', monthlyAmount: '200000' }, T0 + 1_000_410, 'ruleA')]);
  const monthsOf = async () =>
    (await budgets.getBudgetSchedule(uid, { projectId: pid, categoryId, type: 'expense', startMonth: '2026-09', months: 4 }))
      .map((row) => (row.amount === undefined ? '-' : String(Number(row.amount)))).join(',');
  ctx.check('준비: 모든 달 20만', await monthsOf(), '200000,200000,200000,200000');
  const ruleB = '019273cc-0000-7000-8000-000000000041';
  const fromOct = await push([
    command('budget.setFrom', `${categoryId}||expense`, {
      id: `${categoryId}||expense`, categoryId, tagId: null, type: 'expense', fromMonth: '2026-10', amount: '100000', ruleId: ruleB,
    }, T0 + 1_000_420, 'fromOct'),
  ]);
  ctx.check('고른 달부터 바꾸기', fromOct.results[0]?.status, 'applied');
  ctx.check('9월은 그대로, 10월부터 10만', await monthsOf(), '200000,100000,100000,100000');
  ctx.check('새 규칙은 기기가 정한 id', (await ctx.prisma.budget.findUnique({ where: { id: ruleB } }))?.effectiveFrom, '2026-10');
  const noneFromNov = await push([
    command('budget.setFrom', `${categoryId}||expense`, {
      id: `${categoryId}||expense`, categoryId, tagId: null, type: 'expense', fromMonth: '2026-11', amount: null, ruleId: '019273cc-0000-7000-8000-000000000042',
    }, T0 + 1_000_430, 'noneFromNov'),
  ]);
  ctx.check('고른 달부터 지우기', noneFromNov.results[0]?.status, 'applied');
  ctx.check('11월부터 예산 없음', await monthsOf(), '200000,100000,-,-');
  await ctx.prisma.budget.deleteMany({ where: { projectId: pid, categoryId } });

  // ── 환율: 표에 붙지 않는 설정 명령. 재생하는 날의 줄로 적는다 ──
  const rateSet = await push([
    command('exchangeRate.set', 'USD:KRW', { id: 'USD:KRW', from: 'USD', to: 'KRW', rate: '1400' }, T0 + 1_000_600, 'rate'),
  ]);
  ctx.check('환율 정하기', rateSet.results[0]?.status, 'applied');
  ctx.check('환율이 적힌다',
    (await ctx.prisma.exchangeRate.findFirstOrThrow({ where: { projectId: pid, baseCurrency: 'USD', quoteCurrency: 'KRW' } })).rate.toString(),
    '1400');
  const rateAgain = await push([
    command('exchangeRate.set', 'USD:KRW', { id: 'USD:KRW', from: 'USD', to: 'KRW', rate: '1450' }, T0 + 1_000_700, 'rate2'),
  ]);
  ctx.check('같은 날 다시 정하면 덮는다', rateAgain.results[0]?.status, 'applied');
  ctx.check('줄은 하나',
    await ctx.prisma.exchangeRate.count({ where: { projectId: pid, baseCurrency: 'USD', quoteCurrency: 'KRW' } }), 1);
  const rateBad = await push([
    command('exchangeRate.set', 'XXX:KRW', { id: 'XXX:KRW', from: 'XXX', to: 'KRW', rate: '1' }, T0 + 1_000_800, 'badRate'),
  ]);
  ctx.check('모르는 통화는 거절', rateBad.results[0]?.status, 'rejected');
  const rateCleared = await push([
    command('exchangeRate.clear', 'USD:KRW', { id: 'USD:KRW', from: 'USD', to: 'KRW' }, T0 + 1_000_900, 'clearRate'),
  ]);
  ctx.check('환율 되돌리기', rateCleared.results[0]?.status, 'applied');
  ctx.check('그 쌍의 줄이 사라진다',
    await ctx.prisma.exchangeRate.count({ where: { projectId: pid, baseCurrency: 'USD', quoteCurrency: 'KRW' } }), 0);

  // ── 가계부 이름·표시 통화: 주인만 (이 스모크의 사용자는 구성원 표에 없다 → 거절) ──
  const projectRenamed = await push([
    command('project.update', pid, { id: pid, name: '새 이름' }, T0 + 1_001_000, 'rename'),
  ]);
  ctx.check('주인이 아니면 가계부 수정은 거절', projectRenamed.results[0]?.status, 'rejected');
  await ctx.prisma.projectMember.create({ data: { projectId: pid, userId: uid, role: 'owner' } });
  const projectRenamed2 = await push([
    command('project.update', pid, { id: pid, name: '새 이름', displayCurrency: 'USD' }, T0 + 1_001_100, 'rename2'),
  ]);
  ctx.check('주인이면 가계부 수정', projectRenamed2.results[0]?.status, 'applied');
  const projectAfter = await ctx.prisma.project.findUniqueOrThrow({ where: { id: pid } });
  ctx.check('이름과 표시 통화가 바뀐다', `${projectAfter.name} ${projectAfter.displayCurrency}`, '새 이름 USD');
  ctx.check('타임존은 그대로', projectAfter.timezone, 'Asia/Seoul');
  const foreignProject = await push([
    command('project.update', 'someone-else', { id: 'someone-else', name: 'x' }, T0 + 1_001_200, 'foreign'),
  ]);
  ctx.check('다른 가계부를 가리키는 명령은 거절', foreignProject.results[0]?.status, 'rejected');
  await ctx.prisma.project.update({ where: { id: pid }, data: { displayCurrency: 'KRW' } });

  // ── 2단계: 통합·삭제·잔액 맞추기 (표에 붙지 않는 명령) ──
  const s2Id2 = (n: number) => `019273cc-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;
  await push([
    command('person.create', s2Id2(1), { id: s2Id2(1), name: '정리용' }, T0 + 2_000_000, 'p2'),
    command('account.create', s2Id2(2), { id: s2Id2(2), name: '정리 통장', type: 'deposit', ownerId: s2Id2(1), currency: 'KRW' }, T0 + 2_000_001, 'a2'),
    command('category.create', s2Id2(3), { id: s2Id2(3), name: '없앨 분류', type: 'expense' }, T0 + 2_000_002, 'c3'),
    command('category.create', s2Id2(4), { id: s2Id2(4), name: '받을 분류', type: 'expense' }, T0 + 2_000_003, 'c4'),
    command('category.create', s2Id2(5), { id: s2Id2(5), name: '수입 분류', type: 'income' }, T0 + 2_000_004, 'c5'),
    command('tag.create', s2Id2(6), { id: s2Id2(6), name: '없앨 태그' }, T0 + 2_000_005, 't6'),
    command('tag.create', s2Id2(7), { id: s2Id2(7), name: '받을 태그' }, T0 + 2_000_006, 't7'),
  ]);
  const s2Spend = await entries.createEntry(uid, {
    kind: 'expense', personId: s2Id2(1), date: '2026-09-10T03:00:00.000Z', description: '정리할 지출',
    splits: [{ categoryId: s2Id2(3), amount: '3000', lineKey: randomUUID(), tagIds: [s2Id2(6)] }],
    accountId: s2Id2(2),
  } as never, pid);

  // 통합은 다리·태그 연결만 옮긴다. 그 전표의 번호가 올라야 다른 기기가 받아 간다.
  const versionOf = async (id: string) =>
    (await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id } })).updatedVersion;
  const s2VersionBefore = await versionOf(s2Spend.id);

  const s2TypeMismatch = await push([
    command('category.merge', s2Id2(3), { id: s2Id2(3), moves: [{ fromId: s2Id2(3), toId: s2Id2(5) }] }, T0 + 2_000_010, 'mergeBad'),
  ]);
  ctx.check('유형이 다른 분류로 통합은 거절', s2TypeMismatch.results[0]?.code ?? s2TypeMismatch.results[0]?.status, 'CATEGORY_MERGE_TYPE_MISMATCH');
  const s2Merged = await push([
    command('category.merge', s2Id2(3), { id: s2Id2(3), moves: [{ fromId: s2Id2(3), toId: s2Id2(4) }] }, T0 + 2_000_011, 'merge'),
  ]);
  ctx.check('분류 통합', s2Merged.results[0]?.status, 'applied');
  ctx.check('다리가 옮겨 간다',
    (await ctx.prisma.posting.findFirstOrThrow({ where: { entryId: s2Spend.id, categoryId: { not: null } } })).categoryId, s2Id2(4));
  ctx.check('없앤 분류는 사라진다', await ctx.prisma.category.count({ where: { id: s2Id2(3) } }), 0);
  const s2VersionMerged = await versionOf(s2Spend.id);
  ctx.check('분류 통합이 전표 번호를 올린다', s2VersionMerged > s2VersionBefore, true);
  const s2MergedAgain = await push([
    command('category.merge', s2Id2(3), { id: s2Id2(3), moves: [{ fromId: s2Id2(3), toId: s2Id2(4) }] }, T0 + 2_000_012, 'mergeAgain'),
  ]);
  ctx.check('이미 끝난 통합을 다시 보내도 끝난 것', s2MergedAgain.results[0]?.status, 'applied');

  const s2TagMerged = await push([
    command('tag.merge', s2Id2(6), { id: s2Id2(6), toId: s2Id2(7) }, T0 + 2_000_020, 'tagMerge'),
  ]);
  ctx.check('태그 통합', s2TagMerged.results[0]?.status, 'applied');
  ctx.check('태그가 옮겨 간다',
    (await ctx.prisma.entryTag.findFirstOrThrow({ where: { entryId: s2Spend.id } })).tagId, s2Id2(7));
  ctx.check('없앤 태그는 사라진다', await ctx.prisma.tag.count({ where: { id: s2Id2(6) } }), 0);
  ctx.check('태그 통합이 전표 번호를 올린다', (await versionOf(s2Spend.id)) > s2VersionMerged, true);

  // 잔액 맞추기: 기초잔액 전표가 없으면 기기가 정한 id 로 세운다
  const s2OpeningEntryId = s2Id2(8);
  const s2Balanced = await push([
    command('account.balance', s2Id2(2), { id: s2Id2(2), balance: '100000', openingEntryId: s2OpeningEntryId }, T0 + 2_000_030, 'balance'),
  ]);
  ctx.check('잔액 맞추기', s2Balanced.results[0]?.status, 'applied');
  ctx.check('잔액이 목표값', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: s2Id2(2) } })).balance.toString(), '100000');
  ctx.check('기초잔액 전표는 기기가 정한 id', await ctx.prisma.journalEntry.count({ where: { id: s2OpeningEntryId } }), 1);
  const s2Rebalanced = await push([
    command('account.balance', s2Id2(2), { id: s2Id2(2), balance: '50000', openingEntryId: s2Id2(9) }, T0 + 2_000_031, 'balance2'),
  ]);
  ctx.check('다시 맞추면 그 전표를 고친다', s2Rebalanced.results[0]?.status, 'applied');
  ctx.check('잔액이 새 목표값', (await ctx.prisma.account.findUniqueOrThrow({ where: { id: s2Id2(2) } })).balance.toString(), '50000');
  ctx.check('새 id 로 전표를 더 만들지 않는다', await ctx.prisma.journalEntry.count({ where: { id: s2Id2(9) } }), 0);

  // 삭제: 붙은 것이 있으면 같은 코드로 거절, 없으면 지운다
  const s2PersonBlocked = await push([command('person.delete', s2Id2(1), { id: s2Id2(1) }, T0 + 2_000_040, 'delP')]);
  ctx.check('거래가 있는 구성원은 거절', s2PersonBlocked.results[0]?.code ?? s2PersonBlocked.results[0]?.status, 'PERSON_HAS_ACCOUNTS');
  await push([command('category.create', s2Id2(10), { id: s2Id2(10), name: '빈 분류', type: 'expense' }, T0 + 2_000_041, 'c10')]);
  await push([
    command('person.create', s2Id2(11), { id: s2Id2(11), name: '빈 사람' }, T0 + 2_000_042, 'p11'),
    command('account.create', s2Id2(12), { id: s2Id2(12), name: '빈 통장', type: 'deposit', ownerId: s2Id2(11), currency: 'KRW' }, T0 + 2_000_043, 'a12'),
  ]);
  const s2AccountDeleted = await push([command('account.delete', s2Id2(12), { id: s2Id2(12) }, T0 + 2_000_044, 'delA')]);
  ctx.check('빈 통장 지우기', s2AccountDeleted.results[0]?.status, 'applied');
  const s2PersonDeleted = await push([command('person.delete', s2Id2(11), { id: s2Id2(11) }, T0 + 2_000_045, 'delP2')]);
  ctx.check('빈 구성원 지우기', s2PersonDeleted.results[0]?.status, 'applied');
  ctx.check('구성원이 사라진다', await ctx.prisma.person.count({ where: { id: s2Id2(11) } }), 0);
  const s2PersonAgain = await push([command('person.delete', s2Id2(11), { id: s2Id2(11) }, T0 + 2_000_046, 'delP3')]);
  ctx.check('이미 없는 구성원 지우기도 끝난 것', s2PersonAgain.results[0]?.status, 'applied');
  const s2BlockedAccount = await push([command('account.delete', s2Id2(2), { id: s2Id2(2) }, T0 + 2_000_047, 'delA2')]);
  ctx.check('잔액이 남은 통장은 거절', s2BlockedAccount.results[0]?.code ?? s2BlockedAccount.results[0]?.status, 'ACCOUNT_HAS_BALANCE');

  // ── 3단계: 반복 등록 (짐은 온라인 요청 그대로, 서버가 같은 검사를 다시 한다) ──
  const s3Id = (n: number) => `019273cc-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`;
  const sync = new SyncService(ctx.prisma as any, access as any);
  const s3Tag = await tags.createTag(uid, { name: '월세 태그' } as never, pid);
  const s3Before = (await sync.pull(uid, { projectId: pid, since: 0 })).version;
  const s3Created = await push([
    command('recurring.create', s3Id(1), {
      id: s3Id(1),
      frequency: 'monthly',
      dayOfMonth: 25,
      // 월별에 요일은 뜻이 없어 버린다
      weekdays: [1],
      startDate: '2099-01-01',
      kind: 'expense',
      amount: '500000',
      description: '  월세  ',
      tagIds: [s3Tag.id],
    }, T0 + 3_000_001, 'rc1'),
  ]);
  ctx.check('반복 만들기', s3Created.results[0]?.status, 'applied');
  const s3Row = await ctx.prisma.recurringRule.findUniqueOrThrow({ where: { id: s3Id(1) }, include: { tags: true } });
  ctx.check('이름은 다듬어 적는다', s3Row.description, '월세');
  ctx.check('월별의 요일은 비운다', s3Row.weekdays.length, 0);
  ctx.check('태그가 붙는다', s3Row.tags.map((row) => row.tagId).join(','), s3Tag.id);

  const s3Again = await push([
    command('recurring.create', s3Id(1), { id: s3Id(1), frequency: 'none', startDate: '2099-01-01', kind: 'expense', description: 'x' }, T0 + 3_000_002, 'rc1b'),
  ]);
  ctx.check('같은 id 로 다시 오면 겹친 것', s3Again.results[0]?.status, 'duplicate');
  ctx.check('다시 온 것은 덮지 않는다',
    (await ctx.prisma.recurringRule.findUniqueOrThrow({ where: { id: s3Id(1) } })).description, '월세');

  const s3Pulled = await sync.pull(uid, { projectId: pid, since: s3Before });
  const s3Wire = (s3Pulled.changes.recurringRules as Array<{ id: string; tagIds: string[]; amount: string }>)
    .find((row) => row.id === s3Id(1));
  ctx.check('pull 에 반복이 내려온다', Boolean(s3Wire), true);
  ctx.check('pull 의 태그 id', s3Wire?.tagIds.join(','), s3Tag.id);
  ctx.check('pull 의 금액은 글자', s3Wire?.amount, '500000');

  const s3Updated = await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), kind: 'transfer', accountId: s2Id2(2) }, T0 + 3_000_003, 'ru1'),
  ]);
  ctx.check('반복 고치기', s3Updated.results[0]?.status, 'applied');
  const s3Transfer = await ctx.prisma.recurringRule.findUniqueOrThrow({ where: { id: s3Id(1) } });
  ctx.check('준 칸만 바뀐다 (일정은 그대로)', `${s3Transfer.kind} ${s3Transfer.dayOfMonth}`, 'transfer 25');

  const s3Invalid = await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), frequency: 'weekly', weekdays: [] }, T0 + 3_000_004, 'ru2'),
  ]);
  ctx.check('틀린 일정은 같은 코드로 거절', s3Invalid.results[0]?.code ?? s3Invalid.results[0]?.status, 'RECURRING_INVALID');
  const s3Missing = await push([
    command('recurring.update', s3Id(9), { id: s3Id(9), isActive: false }, T0 + 3_000_005, 'ru3'),
  ]);
  ctx.check('없는 반복 고치기는 거절', s3Missing.results[0]?.status, 'rejected');

  // 필드별 시계: 늦은 편집이 이기고, 일정 칸들은 한 덩어리로 이기고 진다.
  const s3Rule = () => ctx.prisma.recurringRule.findUniqueOrThrow({ where: { id: s3Id(1) } });
  const s3Stale = await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), amount: '1' }, T0 + 3_000_000, 'ruStale'),
  ]);
  ctx.check('만들기보다 옛 반복 편집은 충돌', s3Stale.results[0]?.status, 'conflict');
  ctx.check('금액은 그대로', (await s3Rule()).amount?.toString(), '500000');
  await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), amount: '600000' }, T0 + 3_000_010, 'ruAmount'),
    command('recurring.update', s3Id(1), { id: s3Id(1), timeOfDay: '09:30' }, T0 + 3_000_020, 'ruTime'),
  ]);
  const s3OldDay = await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), dayOfMonth: 10 }, T0 + 3_000_015, 'ruDay'),
  ]);
  ctx.check('시각보다 옛 날짜 편집은 같은 일정이라 충돌', s3OldDay.results[0]?.status, 'conflict');
  const s3Mixed = await push([
    command('recurring.update', s3Id(1), { id: s3Id(1), amount: '700000', dayOfMonth: 5 }, T0 + 3_000_015, 'ruMixed'),
  ]);
  ctx.check('이긴 칸이 있으면 적용', s3Mixed.results[0]?.status, 'applied');
  const s3AfterMixed = await s3Rule();
  ctx.check('금액은 이기고 날짜는 진다',
    `${s3AfterMixed.amount?.toString()} ${s3AfterMixed.dayOfMonth} ${s3AfterMixed.timeOfDay}`, '700000 25 09:30');
  const s3WireClock = (await sync.pull(uid, { projectId: pid, since: 0 })).changes.recurringRules
    .find((row) => (row as { id: string }).id === s3Id(1)) as { fieldHlc?: Record<string, string> } | undefined;
  ctx.check('pull 에 시계가 실린다', s3WireClock?.fieldHlc?.schedule, hlcAt(T0 + 3_000_020));

  // 태그를 옮기면 그 태그가 붙은 반복도 다시 내려간다 (연결 표에는 번호가 없다).
  const s3OtherTag = await tags.createTag(uid, { name: '옮겨 받을 태그' } as never, pid);
  const s3VersionBefore = (await s3Rule()).updatedVersion;
  await tags.mergeTags(uid, { fromId: s3Tag.id, toId: s3OtherTag.id } as never, pid);
  ctx.check('태그 통합이 반복의 번호를 올린다', (await s3Rule()).updatedVersion > s3VersionBefore, true);

  const s3Deleted = await push([command('recurring.delete', s3Id(1), { id: s3Id(1) }, T0 + 3_000_006, 'rd1')]);
  ctx.check('반복 지우기', s3Deleted.results[0]?.status, 'applied');
  ctx.check('표에서 사라진다', await ctx.prisma.recurringRule.count({ where: { id: s3Id(1) } }), 0);
  const s3DeletedAgain = await push([command('recurring.delete', s3Id(1), { id: s3Id(1) }, T0 + 3_000_007, 'rd2')]);
  ctx.check('이미 없는 반복 지우기도 끝난 것', s3DeletedAgain.results[0]?.status, 'applied');
  const s3Tomb = await sync.pull(uid, { projectId: pid, since: s3Pulled.version });
  ctx.check('지운 반복은 자리표로 내려온다',
    s3Tomb.tombstones.some((row) => row.entity === 'RecurringRule' && row.entityId === s3Id(1)), true);

  // ── 6. 온라인 편집도 시계를 남긴다 ──
  //
  // 남기지 않으면 그 편집이 언제나 가장 이른 값이 되어, 뒤늦게 도착한 옛 명령이 이긴다.
  const onlineCard = await cards.updateCard(cardId, uid, { name: '신한 신용(웹)' });
  const cardRow = await ctx.prisma.card.findUniqueOrThrow({ where: { id: onlineCard.id } });
  ctx.check('온라인 편집에도 필드 시계가 있다',
    typeof (cardRow.fieldHlc as Record<string, string>)?.name, 'string');

  const staleCard = await push([
    command('card.update', cardId, { id: cardId, name: '폰에서 고친 이름' }, T0, 'staleCard'),
  ]);
  ctx.check('그 뒤에 온 옛 명령은 충돌', statusOf(staleCard.results, staleCard.results[0]!.mutationId), 'conflict');
  ctx.check('웹 이름이 남는다',
    (await ctx.prisma.card.findUniqueOrThrow({ where: { id: cardId } })).name, '신한 신용(웹)');
});
