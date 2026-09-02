/**
 * 명령을 재생한 뒤의 서버 상태를 파일로 떠 놓는다.
 *
 * 실행: node -r <별칭 훅> -r ts-node/register/transpile-only scripts/sync-push-dump.ts [경로]
 *
 * 2단계에서 가장 중요한 약속은 이것이다. **기기가 오프라인에서 만든 전표와 서버가 그
 * 명령을 재생해 만든 전표가 같아야 한다.** 다르면 화면이 보여 준 금액과 서버에 남는
 * 금액이 갈리고, 사용자는 동기화가 끝난 뒤에야 그것을 본다.
 *
 * 두 쪽을 잇는 방법은 실제 값을 사이에 두는 것이다(변경 피드 때와 같다). 여기서
 * 밑바탕 상태와 명령 묶음, 그리고 재생 뒤 서버가 낸 목록을 함께 떠 주고,
 * `packages/core/scripts/outbox-smoke.ts` 가 같은 명령을 사본에 돌려 한 줄씩 견준다.
 */
import { writeFileSync } from 'fs';
import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { SyncService } from '@/modules/sync/sync.service';
import { MutationReplayService } from '@/modules/sync/mutation-replay.service';
import { encodeHlc, type Mutation } from '@money/types';
import {
  makeAccounts,
  makeEntries,
  makeLedger,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const target = process.argv[2] ?? '/tmp/sync-push-dump.json';

/** 기기 시계를 흉내 낸다. 벽시계를 고정해 떠 둔 값이 흔들리지 않게 한다. */
const hlcAt = (ms: number) => encodeHlc({ wall: ms, counter: 0, node: 'device-a' });
const T0 = Date.UTC(2026, 7, 20, 3, 0, 0);

/**
 * 이 실행의 표시.
 *
 * 명령 id 를 고정하면 두 번째 실행이 앞선 실행의 기록을 보고 "이미 적용했다"로 답한다.
 * 그러면 전표가 하나도 생기지 않은 덤프를 떠 두게 된다 (실제로 그렇게 한 번 틀렸다).
 */
const RUN = Date.now().toString(36);

runSmoke('sync-push-dump', async (ctx) => {
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
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const sync = new SyncService(ctx.prisma as any, access as any);
  const replay = new MutationReplayService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    entries as any,
  );

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const dining = await categories.createCategory(uid, { name: '외식', type: 'expense' }, pid);
  const salary = await categories.createCategory(uid, { name: '급여', type: 'income' }, pid);
  const fee = await categories.createCategory(uid, { name: '수수료', type: 'expense' }, pid);
  // 기본이 과소비인 분류. 기기가 그 기본값을 서버와 같이 읽는지 본다.
  const luxury = await categories.createCategory(
    uid,
    { name: '사치', type: 'expense', defaultIsExtra: true },
    pid,
  );

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  const savings = await accounts.createAccount(uid, {
    type: 'savings', ownerId: person.id, name: '적금',
    institutionId: 'fi_bank_shinhan', openingBalance: '0',
  }, pid);
  const credit = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);

  /*
   * 명령을 만들기 전의 상태를 떠 둔다.
   *
   * 기기 쪽 검사가 이것을 사본에 적어 밑바탕을 만든 뒤, 아래 명령을 그 위에서 돌린다.
   * 그래야 두 쪽이 같은 계좌·카테고리를 보고 조립한다.
   */
  const base = await sync.pull(uid, { projectId: pid, since: 0 });

  const at = (index: number) => hlcAt(T0 + index * 60_000);
  const id = (n: number) => `019273bb-0000-7000-8000-00000000000${n}`;

  const mutation = (
    index: number,
    kind: Mutation['kind'],
    entryId: string,
    payload: Record<string, unknown>,
  ): Mutation => ({
    mutationId: `${RUN}-m-${index}`,
    clientId: 'device-a',
    clientSeq: index,
    hlc: at(index),
    kind,
    projectId: pid,
    targets: [entryId],
    payload,
  });

  const common = { personId: person.id, date: new Date(T0).toISOString() };

  const mutations: Mutation[] = [
    // 1. 가장 흔한 것 — 통장에서 나간 지출
    mutation(1, 'entry.create', id(1), {
      ...common, id: id(1), kind: 'expense', description: '점심',
      amount: '9000', categoryId: dining.id, accountId: bank.id,
    }),
    // 2. 그 거래를 고친다 (통째 교체다)
    mutation(2, 'entry.replace', id(1), {
      ...common, id: id(1), kind: 'expense', description: '점심 (수정)',
      amount: '12000', categoryId: dining.id, accountId: bank.id,
    }),
    // 3. 과소비 기본값이 있는 분류. 값을 보내지 않으면 전액이 과소비여야 한다.
    mutation(3, 'entry.create', id(2), {
      ...common, id: id(2), kind: 'expense', description: '충동구매',
      amount: '50000', categoryId: luxury.id, accountId: bank.id,
    }),
    // 4. 분할. 한 거래가 두 분류로 나뉘고 한쪽에만 과소비가 붙는다.
    mutation(4, 'entry.create', id(3), {
      ...common, id: id(3), kind: 'expense', description: '장보기',
      accountId: bank.id,
      splits: [
        { categoryId: dining.id, amount: '30000' },
        { categoryId: luxury.id, amount: '20000', extraAmount: '15000' },
      ],
    }),
    // 5. 수입
    mutation(5, 'entry.create', id(4), {
      ...common, id: id(4), kind: 'income', description: '월급',
      amount: '3000000', categoryId: salary.id, accountId: bank.id,
    }),
    // 6. 이체 + 수수료. 다리가 셋이 되는 갈래다.
    mutation(6, 'entry.create', id(5), {
      ...common, id: id(5), kind: 'transfer', description: '적금 이체',
      amount: '500000', accountId: bank.id, toAccountId: savings.id,
      transferFee: '1000', transferFeeCategoryId: fee.id,
    }),
    // 7. 신용카드 할부. 부채 계정에 쌓이고 할부 계획이 붙는다.
    mutation(7, 'entry.create', id(6), {
      ...common, id: id(6), kind: 'expense', description: '노트북',
      amount: '300000', categoryId: dining.id, cardId: credit.id, installmentMonths: 3,
    }),
    // 8. 지우기. 사본에서도 사라져야 한다.
    mutation(8, 'entry.create', id(7), {
      ...common, id: id(7), kind: 'expense', description: '지울 거래',
      amount: '1000', categoryId: dining.id, accountId: bank.id,
    }),
    mutation(9, 'entry.delete', id(7), { id: id(7) }),
  ];

  const pushed = await replay.push(uid, { projectId: pid, clientId: 'device-a', mutations });

  const server = {
    results: pushed.results,
    // 재생 뒤의 목록. 사본이 만든 줄과 한 줄씩 견준다.
    entries: (
      await entries.getEntries(uid, {
        startDate: '2026-07-31T15:00:00.000Z',
        endDate: '2026-08-31T14:59:59.999Z',
        limit: 200,
      }, pid)
    ).data,
    projectId: pid,
    personId: person.id,
    accounts: { bank: bank.id, savings: savings.id },
    categories: { dining: dining.id, salary: salary.id, fee: fee.id, luxury: luxury.id },
    cardId: credit.id,
  };

  const wire = JSON.parse(JSON.stringify({ base, mutations, server }));
  writeFileSync(target, JSON.stringify(wire, null, 2));

  /*
   * 전부 applied 여야 한다. duplicate 를 넉넉히 받아 주면 안 된다.
   *
   * 앞선 실행의 기록이 남아 있으면 명령이 전부 duplicate 로 지나가고, 전표가 하나도
   * 없는 덤프를 떠 두게 된다. 그 덤프로 기기 쪽 검사를 돌리면 "서버에 없는 줄"이 잔뜩
   * 나와 엉뚱한 곳을 의심하게 된다 (실제로 그랬다).
   */
  ctx.check('명령이 전부 적용되었다',
    wire.server.results.filter((row: { status: string }) => row.status === 'applied').length,
    mutations.length);
  ctx.check('남은 전표 (기초잔액 둘 + 만든 것 여섯, 지운 것 하나 제외)',
    wire.server.entries.length, 6);
  console.log(`\n떠 둔 곳: ${target}`);
});
