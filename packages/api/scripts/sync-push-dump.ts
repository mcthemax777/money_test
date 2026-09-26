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
import { billedAmountFromRate, encodeHlc, type Mutation } from '@money/types';
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
  const people = makePeople(ctx.prisma, access);
  const categories = makeCategories(ctx.prisma, access);
  const cards = makeCards(ctx.prisma, access, institutions);
  const tags = makeTags(ctx.prisma, access);
  const budgets = makeBudgets(ctx.prisma, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const sync = new SyncService(ctx.prisma as any, access as any);
  const cardLedger = makeCardLedger(ctx.prisma, access, ledger);
  const replay = new MutationReplayService(
    ctx.prisma as any,
    access as any,
    ledger as any,
    entries as any,
    people as any,
    accounts as any,
    cards as any,
    cardLedger as any,
    categories as any,
    tags as any,
    budgets as any,
  );

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const dining = await categories.createCategory(uid, { name: '외식', type: 'expense' }, pid);
  const salary = await categories.createCategory(uid, { name: '급여', type: 'income' }, pid);
  const fee = await categories.createCategory(uid, { name: '수수료', type: 'expense' }, pid);
  const luxury = await categories.createCategory(uid, { name: '사치', type: 'expense' }, pid);

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
  /** 열 번째 넘는 전표. 끝 칸이 열두 자리여야 UUID 로 받아 준다. */
  const idB = (n: number) => `019273bb-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

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

  /*
   * 줄 키. 화면이 만들어 편집 내내 들고 다니는 값이라 여기서도 고정해 둔다.
   *
   * 만들 때와 고칠 때 같은 값을 보내는 것이 요점이다. 새로 만들면 그 줄에 붙은 태그와
   * 차감이 수정 한 번에 끊긴다.
   */
  const line = (n: number) => `019273aa-0000-7000-8000-00000000line${String(n).padStart(2, '0')}`;

  const mutations: Mutation[] = [
    // 1. 가장 흔한 것 — 통장에서 나간 지출
    mutation(1, 'entry.create', id(1), {
      ...common, id: id(1), kind: 'expense', description: '점심',
      amount: '9000', categoryId: dining.id, accountId: bank.id, lineKey: line(1),
    }),
    // 2. 그 거래를 고친다 (통째 교체다)
    mutation(2, 'entry.replace', id(1), {
      ...common, id: id(1), kind: 'expense', description: '점심 (수정)',
      amount: '12000', categoryId: dining.id, accountId: bank.id, lineKey: line(1),
    }),
    // 3. 다른 분류로 적은 지출.
    mutation(3, 'entry.create', id(2), {
      ...common, id: id(2), kind: 'expense', description: '충동구매',
      amount: '50000', categoryId: luxury.id, accountId: bank.id, lineKey: line(2),
    }),
    // 4. 분할. 한 거래가 두 분류로 나뉜다.
    mutation(4, 'entry.create', id(3), {
      ...common, id: id(3), kind: 'expense', description: '장보기',
      accountId: bank.id,
      splits: [
        { categoryId: dining.id, amount: '30000', lineKey: line(3) },
        { categoryId: luxury.id, amount: '20000', lineKey: line(4) },
      ],
    }),
    // 5. 수입
    mutation(5, 'entry.create', id(4), {
      ...common, id: id(4), kind: 'income', description: '월급',
      amount: '3000000', categoryId: salary.id, accountId: bank.id, lineKey: line(5),
    }),
    // 6. 이체 + 수수료. 다리가 셋이 되는 갈래다.
    mutation(6, 'entry.create', id(5), {
      ...common, id: id(5), kind: 'transfer', description: '적금 이체',
      amount: '500000', accountId: bank.id, toAccountId: savings.id,
      transferFee: '1000', transferFeeCategoryId: fee.id, transferFeeLineKey: line(6),
    }),
    /*
     * 7. 신용카드 할부. 부채 계정에 쌓이고 할부 계획이 붙는다.
     *
     * 유이자로 둔다. 무이자가 기본값이라, 이 표가 명령에서 빠져도 무이자 쪽은 우연히
     * 같은 값이 나와 왕복 검사를 통과한다.
     */
    mutation(7, 'entry.create', id(6), {
      ...common, id: id(6), kind: 'expense', description: '노트북',
      amount: '300000', categoryId: dining.id, cardId: credit.id, installmentMonths: 3,
      installmentInterest: true, lineKey: line(7),
    }),
    /*
     * 8. 카드 대금 결제. 자산 화면의 "결제하기"가 오프라인에서 쌓는 명령이다.
     *
     * 설명을 비워 보낸다 -- 조립이 카드 이름으로 채우므로(defaultTransferDescription)
     * 기기가 만든 줄과 서버가 재생한 줄의 글자가 같아야 한다.
     */
    mutation(8, 'entry.create', id(8), {
      ...common, id: id(8), kind: 'card_payment', description: '',
      amount: '100000', accountId: bank.id, cardId: credit.id,
      cardTransferDirection: 'payment',
    }),
    // 9. 지우기. 사본에서도 사라져야 한다.
    mutation(9, 'entry.create', id(7), {
      ...common, id: id(7), kind: 'expense', description: '지울 거래',
      amount: '1000', categoryId: dining.id, accountId: bank.id, lineKey: line(8),
    }),
    mutation(10, 'entry.delete', id(7), { id: id(7) }),
    /*
     * 11~14. 원화 신용카드로 쓴 외화. 추정 환율로 적혔다가 명세서로 확정된다.
     *
     * 환율을 싣지 않는다. 사용자가 환율을 넣으면 조립이 추정이 아닌 것으로 본다
     * (`resolveConversion`) -- 그러면 미확정 목록에 오르지 않는다.
     *
     * 분할을 하나 넣는다. 청구액을 두 줄에 나누면 끝수가 한 줄로 몰리는데, **어느 줄로
     * 가는지가 기기와 서버에서 같아야 한다** -- 다리 id 가 양쪽에서 달라 차례로 고르면
     * 1원이 다른 줄에 앉는다. 70,001 을 30:20 으로 나누면 42,000.6 / 28,000.4 라 끝수 1이 생긴다.
     */
    mutation(11, 'entry.create', id(9), {
      ...common, id: id(9), kind: 'expense', description: '해외 장보기',
      cardId: credit.id, currency: 'USD',
      splits: [
        { categoryId: dining.id, amount: '30', lineKey: line(9) },
        { categoryId: luxury.id, amount: '20', lineKey: line(10) },
      ],
    }),
    // 확정하지 않고 남겨 둘 것. 미확정 목록이 기기와 서버에서 같은지 본다.
    mutation(12, 'entry.create', idB(1), {
      ...common, id: idB(1), kind: 'expense', description: '해외 구독',
      amount: '10', categoryId: dining.id, cardId: credit.id,
      currency: 'USD', lineKey: line(11),
    }),
    mutation(13, 'entry.create', idB(2), {
      ...common, id: idB(2), kind: 'expense', description: '해외 커피',
      amount: '7.77', categoryId: dining.id, cardId: credit.id,
      currency: 'USD', lineKey: line(12),
    }),
    /*
     * 한 명령에 둘을 담는다. 하나는 명세서의 금액 그대로, 하나는 적용 환율 한 줄로
     * 채운 값이다 -- 환율로 채워도 기기가 건마다 금액을 정해 싣는다.
     */
    {
      ...mutation(14, 'entry.restate', id(9), {
        cardId: credit.id,
        items: [
          { entryId: id(9), billedAmount: '70001' },
          {
            entryId: idB(2),
            billedAmount: billedAmountFromRate('7.77', '1391.5', 'KRW').toString(),
          },
        ],
      }),
      targets: [id(9), idB(2)],
    },
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
    // 재생 뒤의 미확정 목록. 확정하지 않은 한 건만 남아야 한다.
    pendingRates: await cardLedger.listPendingRates(credit.id, uid),
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
  ctx.check('남은 전표 (기초잔액 둘 + 만든 것 열, 지운 것 하나 제외)',
    wire.server.entries.length, 10);

  // 재생이 실제로 확정했는지. 이것이 빠지면 기기 쪽 대조가 "둘 다 확정 안 됨"으로 통과한다.
  const restated = wire.server.entries.find((row: { id: string }) => row.id === id(9));
  ctx.check('확정: 청구액이 적힌다', restated?.amount, '70001');
  ctx.check('확정: 미확정 표가 꺼진다', restated?.rateProvisional, false);
  ctx.check('확정: 끝수는 큰 줄로 간다',
    restated?.lines.map((one: { amount: string }) => one.amount).join(','), '42001,28000');
  ctx.check('확정: 환율로 채운 건', wire.server.entries.find(
    (row: { id: string }) => row.id === idB(2))?.amount, '10812');
  ctx.check('미확정 목록에는 남긴 한 건뿐',
    wire.server.pendingRates.items.map((row: { entryId: string }) => row.entryId).join(','),
    idB(1));
  console.log(`\n떠 둔 곳: ${target}`);
});
