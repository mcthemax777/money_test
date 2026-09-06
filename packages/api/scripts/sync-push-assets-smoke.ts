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
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { MutationReplayService } from '@/modules/sync/mutation-replay.service';
import { encodeHlc, rankBetween, type Mutation, type MutationResult } from '@money/types';
import {
  makeAccounts,
  makeBudgets,
  makeCards,
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
  const replay = new MutationReplayService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    entries as any,
    people as any,
    accounts as any,
    cards as any,
    categories as any,
    tags as any,
    budgets as any,
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

  const hidTag = await push([
    command('tag.update', tagId, { id: tagId, isActive: false }, T0 + 800_400),
  ]);
  ctx.check('태그 숨기기', hidTag.results[0]?.status, 'applied');
  ctx.check('숨긴 것이 반영된다',
    (await ctx.prisma.tag.findUniqueOrThrow({ where: { id: tagId } })).isActive, false);

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
