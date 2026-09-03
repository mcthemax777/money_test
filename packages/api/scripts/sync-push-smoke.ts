/**
 * 명령 재생.
 *
 * 실행: cd packages/api && npx ts-node --transpile-only -r <별칭 훅> scripts/sync-push-smoke.ts
 *
 * 오프라인 입력이 이 하나에 얹힌다. 눈으로 읽어서는 맞는지 알 수 없는 종류의 코드라
 * 다섯 가지를 콕 집어 본다.
 *
 *   1. **멱등.** 같은 명령을 두 번, 세 번 보내도 금액이 한 번만 적힌다.
 *      응답을 못 받은 기기는 반드시 다시 보낸다.
 *   2. **순서.** 뒤섞어 보내도 clientSeq 순서로 적용된다.
 *   3. **의존.** 거절된 create 뒤의 replace 는 서버까지 가지 않는다.
 *      흘려보내면 없는 전표를 고치거나 다른 전표에 적용된다.
 *   4. **병합.** 더 늦은 편집이 있으면 진 쪽은 conflict 이고 서버 값이 남는다.
 *      삭제는 시계를 보지 않고 언제나 이긴다.
 *   5. **권한.** 재생 시점에 다시 본다. viewer 로 바뀐 뒤 도착한 명령은 거절된다.
 *   6. **선점.** 같은 명령이 동시에 두 번 도착해도 재생은 한 번만 일어난다.
 *      인스턴스를 여럿 두면 기기의 재전송이 서로 다른 프로세스에 동시에 닿는다.
 */
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { MutationReplayService } from '@/modules/sync/mutation-replay.service';
import { encodeHlc, type Mutation, type MutationResult } from '@money/types';
import {
  makeAccounts,
  makeEntries,
  makeLedger,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

/** 기기 시계를 흉내 낸다. 벽시계를 고정해 검사가 시간에 흔들리지 않게 한다. */
const hlcAt = (ms: number, node = 'device-a') =>
  encodeHlc({ wall: ms, counter: 0, node });

const T0 = Date.UTC(2026, 7, 20, 3, 0, 0);

/**
 * 이 실행의 표시.
 *
 * 명령 id 를 고정하면 두 번째 실행이 앞선 실행의 기록을 보고 "이미 적용했다"로 답한다.
 * MutationLog 는 프로젝트를 지워도 함께 사라지지 않기 때문이다(외래 키가 없다).
 * 그것이 이 표의 뜻이기도 하다 -- 기기가 다시 보낸 명령을 막는 것.
 */
const RUN = Date.now().toString(36);

runSmoke('sync-push', async (ctx) => {
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
  const replay = new MutationReplayService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    entries as any,
  );

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);

  let seq = 0;
  const CLIENT = 'client-a';

  /** 기기가 만드는 명령 하나. id 는 기기가 정한다(0단계에서 그렇게 바꿨다). */
  const expenseMutation = (
    entryId: string,
    amount: string,
    at: number,
    overrides: Partial<Mutation> = {},
  ): Mutation => ({
    mutationId: `${RUN}-m-${entryId}-${(seq += 1)}`,
    clientId: CLIENT,
    clientSeq: seq,
    hlc: hlcAt(at),
    kind: 'entry.create',
    projectId: pid,
    targets: [entryId],
    payload: {
      id: entryId,
      kind: 'expense',
      personId: person.id,
      date: new Date(T0).toISOString(),
      description: '점심',
      amount,
      categoryId: food.id,
      accountId: bank.id,
    },
    ...overrides,
  });

  const push = (mutations: Mutation[]) =>
    replay.push(uid, { projectId: pid, clientId: CLIENT, mutations });

  const statusOf = (results: MutationResult[], mutationId: string) =>
    results.find((row) => row.mutationId === mutationId)?.status;

  const balance = async () =>
    (await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).balance.toString();

  const entryCount = async () => ctx.prisma.journalEntry.count({ where: { projectId: pid } });

  // ── 1. 명령이 온라인 쓰기와 같은 결과를 만든다 ──
  const lunchId = '019273aa-0000-7000-8000-000000000001';
  const created = await push([expenseMutation(lunchId, '9000', T0)]);
  ctx.check('명령이 적용된다', created.results[0]?.status, 'applied');
  ctx.check('전표가 생겼다', await ctx.prisma.journalEntry.count({ where: { id: lunchId } }), 1);
  ctx.check('잔액이 반영된다', await balance(), '991000');
  ctx.check('번호가 실려 온다', (created.results[0]?.appliedVersion ?? 0) > 0, true);

  const stamped = await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: lunchId } });
  ctx.check('시계가 전표에 남는다', stamped.updatedHlc, hlcAt(T0));

  // ── 2. 같은 명령을 다시 보내도 한 번만 적힌다 ──
  const again = await push([expenseMutation(lunchId, '9000', T0, {
    // 첫 명령과 같은 id 다. 재전송이 어떻게 다뤄지는지 보는 자리다.
    mutationId: `${RUN}-m-${lunchId}-1`, clientSeq: 1,
  })]);
  ctx.check('재전송은 duplicate', again.results[0]?.status, 'duplicate');
  ctx.check('잔액이 그대로다 (두 번 적히지 않았다)', await balance(), '991000');

  // 명령 id 가 다르면 로그로는 못 막지만 전표 id 로 막는다 (로그가 지워진 뒤의 재전송)
  await ctx.prisma.mutationLog.deleteMany({ where: { projectId: pid } });
  const resent = await push([expenseMutation(lunchId, '9000', T0)]);
  ctx.check('로그가 없어도 전표 id 로 막는다', resent.results[0]?.status, 'duplicate');
  ctx.check('그래도 잔액은 그대로', await balance(), '991000');

  // ── 3. 수정은 통째 교체다 ──
  const replaceMutation = (at: number, amount: string): Mutation => ({
    mutationId: `${RUN}-m-replace-${(seq += 1)}`,
    clientId: CLIENT,
    clientSeq: seq,
    hlc: hlcAt(at),
    kind: 'entry.replace',
    projectId: pid,
    targets: [lunchId],
    payload: {
      id: lunchId,
      kind: 'expense',
      personId: person.id,
      date: new Date(T0).toISOString(),
      description: '점심 (수정)',
      amount,
      categoryId: food.id,
      accountId: bank.id,
    },
  });

  const replaced = await push([replaceMutation(T0 + 60_000, '12000')]);
  ctx.check('수정이 적용된다', replaced.results[0]?.status, 'applied');
  ctx.check('잔액이 다시 계산된다', await balance(), '988000');

  // ── 4. 더 늦은 편집이 있으면 진 쪽은 충돌이다 ──
  //
  // 서버 쪽 전표가 이미 T0+5분의 시계를 달고 있는데 T0+2분짜리 명령이 뒤늦게 도착한 상황.
  await ctx.prisma.journalEntry.update({
    where: { id: lunchId },
    data: { updatedHlc: hlcAt(T0 + 300_000, 'device-b') },
  });
  const late = await push([replaceMutation(T0 + 120_000, '99000')]);
  ctx.check('진 편집은 conflict', late.results[0]?.status, 'conflict');
  ctx.check('서버 값이 남는다 (잔액 그대로)', await balance(), '988000');

  // 충돌한 뒤에도 더 늦은 편집은 이긴다. 충돌은 뒤를 막지 않는다.
  const newer = await push([replaceMutation(T0 + 600_000, '15000')]);
  ctx.check('더 늦은 편집은 이긴다', newer.results[0]?.status, 'applied');
  ctx.check('그 값이 반영된다', await balance(), '985000');

  // ── 5. 거절된 명령은 같은 대상의 뒤 명령을 막는다 ──
  const ghostId = '019273aa-0000-7000-8000-000000000002';
  const badCreate: Mutation = {
    mutationId: `${RUN}-m-bad-create`,
    clientId: CLIENT,
    clientSeq: (seq += 1),
    hlc: hlcAt(T0 + 700_000),
    kind: 'entry.create',
    projectId: pid,
    targets: [ghostId],
    payload: {
      id: ghostId,
      kind: 'expense',
      personId: person.id,
      date: new Date(T0).toISOString(),
      description: '없는 카테고리',
      amount: '5000',
      // 이 프로젝트에 없는 카테고리다. 서버가 거절해야 한다.
      categoryId: 'no-such-category',
      accountId: bank.id,
    },
  };
  const ghostEdit: Mutation = {
    mutationId: `${RUN}-m-ghost-edit`,
    clientId: CLIENT,
    clientSeq: (seq += 1),
    hlc: hlcAt(T0 + 800_000),
    kind: 'entry.replace',
    projectId: pid,
    targets: [ghostId],
    payload: { ...(badCreate.payload as object), categoryId: food.id, description: '고침' },
  };
  const unrelated = expenseMutation('019273aa-0000-7000-8000-000000000003', '3000', T0 + 900_000);

  const dependent = await push([badCreate, ghostEdit, unrelated]);
  ctx.check('잘못된 명령은 거절된다', statusOf(dependent.results, `${RUN}-m-bad-create`), 'rejected');
  ctx.check('같은 대상의 뒤 명령은 보류된다', statusOf(dependent.results, `${RUN}-m-ghost-edit`), 'blocked');
  ctx.check(
    '관계없는 명령은 그대로 적용된다',
    statusOf(dependent.results, unrelated.mutationId),
    'applied',
  );
  ctx.check('유령 전표가 생기지 않았다',
    await ctx.prisma.journalEntry.count({ where: { id: ghostId } }), 0);

  // ── 6. 뒤섞어 보내도 clientSeq 순서로 적용된다 ──
  //
  // 만들고 고치는 두 명령을 거꾸로 담아 보낸다. 순서를 지키지 않으면 수정이 먼저 와서
  // 없는 전표를 고치려다 거절되고, 그 뒤 생성만 남아 옛 값이 살아남는다.
  const orderedId = '019273aa-0000-7000-8000-000000000004';
  const makeIt = expenseMutation(orderedId, '7000', T0 + 1_000_000);
  const fixIt: Mutation = {
    mutationId: `${RUN}-m-ordered-fix`,
    clientId: CLIENT,
    clientSeq: (seq += 1),
    hlc: hlcAt(T0 + 1_100_000),
    kind: 'entry.replace',
    projectId: pid,
    targets: [orderedId],
    payload: { ...(makeIt.payload as object), amount: '8000', description: '고친 값' },
  };
  const shuffled = await push([fixIt, makeIt]);
  ctx.check('생성이 적용된다', statusOf(shuffled.results, makeIt.mutationId), 'applied');
  ctx.check('수정도 적용된다', statusOf(shuffled.results, `${RUN}-m-ordered-fix`), 'applied');
  const ordered = await ctx.prisma.journalEntry.findUniqueOrThrow({ where: { id: orderedId } });
  ctx.check('나중 명령의 값이 남는다', ordered.description, '고친 값');

  // ── 7. 삭제는 시계를 보지 않는다 ──
  await ctx.prisma.journalEntry.update({
    where: { id: orderedId },
    data: { updatedHlc: hlcAt(T0 + 9_000_000, 'device-b') },
  });
  const removed = await push([{
    mutationId: `${RUN}-m-delete`,
    clientId: CLIENT,
    clientSeq: (seq += 1),
    // 서버의 시계보다 한참 이르다. 그래도 삭제가 이겨야 한다.
    hlc: hlcAt(T0 + 1_200_000),
    kind: 'entry.delete',
    projectId: pid,
    targets: [orderedId],
    payload: { id: orderedId },
  }]);
  ctx.check('삭제는 언제나 이긴다', removed.results[0]?.status, 'applied');
  ctx.check('전표가 사라졌다',
    await ctx.prisma.journalEntry.count({ where: { id: orderedId } }), 0);
  ctx.check('자리표가 남는다',
    await ctx.prisma.tombstone.count({ where: { entity: 'JournalEntry', entityId: orderedId } }), 1);

  // 이미 지워진 것을 다시 지워도 오류가 아니다
  const removedAgain = await push([{
    mutationId: `${RUN}-m-delete-2`,
    clientId: CLIENT,
    clientSeq: (seq += 1),
    hlc: hlcAt(T0 + 1_300_000),
    kind: 'entry.delete',
    projectId: pid,
    targets: [orderedId],
    payload: { id: orderedId },
  }]);
  ctx.check('이미 없으면 할 일이 끝난 것이다', removedAgain.results[0]?.status, 'duplicate');

  // ── 8. 권한은 재생 시점에 다시 본다 ──
  const before = await entryCount();
  const viewerAccess = projectAccessStub(ctx.prisma, pid, 'viewer');
  const viewerReplay = new MutationReplayService(
    ctx.prisma as any,
    viewerAccess as any,
    ledger as any,
    entries as any,
  );
  await ctx.expectReject('viewer 로 바뀐 뒤 도착한 명령은 거절된다', () =>
    viewerReplay.push(uid, {
      projectId: pid,
      clientId: CLIENT,
      mutations: [expenseMutation('019273aa-0000-7000-8000-000000000005', '1000', T0 + 2_000_000)],
    }),
  );
  ctx.check('전표가 늘지 않았다', await entryCount(), before);
  // ── 9. 선점: 같은 명령이 동시에 두 번 도착해도 재생은 한 번만 ──
  //
  // 인스턴스를 여럿 두면 기기의 재전송이 서로 다른 프로세스에 동시에 닿는다. 예전에는
  // 둘 다 "본 적 없다"로 읽고 둘 다 재생했다. 전표는 기본 키가 막아 주었지만, 막힌 쪽이
  // rejected 로 기록되어 **실제로는 적용된 거래가 기기에서 거절로 보였다.**
  const raceId = '019273aa-0000-7000-8000-000000000010';
  const raceMutation = expenseMutation(raceId, '5000', T0 + 3_000_000);
  const [first, second] = await Promise.all([push([raceMutation]), push([raceMutation])]);
  const raceStatuses = [
    statusOf(first.results, raceMutation.mutationId),
    statusOf(second.results, raceMutation.mutationId),
  ];
  ctx.check(
    '동시에 도착해도 거절이 없다',
    raceStatuses.filter((status) => status === 'rejected').length,
    0,
  );
  ctx.check(
    '한쪽만 적용된다',
    raceStatuses.filter((status) => status === 'applied').length,
    1,
  );
  ctx.check('전표는 하나만 생긴다',
    await ctx.prisma.journalEntry.count({ where: { id: raceId } }), 1);

  // 재생 중인 명령은 판정을 미룬다. 큐에 그대로 두었다가 다음에 다시 물어야 한다.
  const runningId = '019273aa-0000-7000-8000-000000000011';
  const runningMutation = expenseMutation(runningId, '7000', T0 + 3_100_000);
  await ctx.prisma.mutationLog.create({
    data: {
      mutationId: runningMutation.mutationId,
      projectId: pid,
      clientId: CLIENT,
      clientSeq: runningMutation.clientSeq,
      kind: runningMutation.kind,
      status: 'running',
      claimedAt: new Date(),
    },
  });
  const deferred = await push([runningMutation]);
  ctx.check('재생 중이면 판정을 미룬다',
    statusOf(deferred.results, runningMutation.mutationId), 'deferred');
  ctx.check('미룬 명령은 적용되지 않는다',
    await ctx.prisma.journalEntry.count({ where: { id: runningId } }), 0);

  // 같은 대상을 건드리는 뒤 명령도 함께 미룬다. 앞의 결과를 모르는 채로 고칠 수 없다.
  const followUp: Mutation = {
    ...expenseMutation(runningId, '8000', T0 + 3_200_000),
    kind: 'entry.replace',
  };
  const chained = await push([runningMutation, followUp]);
  ctx.check('미룬 대상의 뒤 명령도 미룬다',
    statusOf(chained.results, followUp.mutationId), 'deferred');

  // 잡은 프로세스가 죽으면 넘겨받는다. 죽은 잠금이 명령을 영영 묶어 두면 안 된다.
  await ctx.prisma.mutationLog.update({
    where: { mutationId: runningMutation.mutationId },
    data: { claimedAt: new Date(Date.now() - 5 * 60_000) },
  });
  const takenOver = await push([runningMutation]);
  ctx.check('멈춘 명령은 넘겨받아 재생한다',
    statusOf(takenOver.results, runningMutation.mutationId), 'applied');
  ctx.check('그때 전표가 생긴다',
    await ctx.prisma.journalEntry.count({ where: { id: runningId } }), 1);

  // 같은 (기기, 순번)을 다른 명령 id 가 쓰면 적용하지 않는다. 결과를 적을 자리가 없어
  // 멱등이 깨지기 때문이다 -- 다시 보낼 때마다 또 적힌다.
  const seqTakenId = '019273aa-0000-7000-8000-000000000012';
  const seqTaken: Mutation = {
    ...expenseMutation(seqTakenId, '3000', T0 + 3_300_000),
    mutationId: `${RUN}-m-seq-clash`,
    clientSeq: runningMutation.clientSeq,
  };
  const clashed = await push([seqTaken]);
  ctx.check('순번이 겹치면 거절한다', statusOf(clashed.results, seqTaken.mutationId), 'rejected');
  ctx.check('그 명령은 적용되지 않는다',
    await ctx.prisma.journalEntry.count({ where: { id: seqTakenId } }), 0);
});
