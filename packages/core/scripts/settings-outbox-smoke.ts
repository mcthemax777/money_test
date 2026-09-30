/**
 * 설정 엔티티를 오프라인에서 만들고 고치기 (3단계) -- 자산·분류·태그.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/settings-outbox-smoke.ts
 *
 * 넷을 못 박는다.
 *
 *   1. **사본과 큐가 함께 간다.** 화면이 구성원을 더하면 사본에서 곧바로 보이고, 같은
 *      내용이 명령으로 큐에 쌓인다. 하나만 되면 사용자가 알아챌 방법이 없다.
 *   2. **고치기 명령에는 바꾼 필드만 담는다.** 통째로 담으면 건드리지도 않은 이름이
 *      남의 편집을 덮는다 (필드별 병합, D5).
 *   3. **시계가 앞의 값보다 뒤다.** 사본에 있는 그 줄의 시계를 보고 매기므로, 방금 만든
 *      것을 곧바로 고쳐도 순서가 뒤집히지 않는다.
 *   4. **신용카드는 행 둘.** 카드와 부채 계정 id 를 모두 기기가 만들어 함께 보낸다.
 */
import { Dec, newId, rankForMove, setRandomBytes, type Mutation } from '@money/types';

import { createLocalHomePort } from '../src/data/local-home-port';
import { createLocalSettingsWriter } from '../src/data/local-settings-writer';
import { LocalStore } from '../src/data/local-store';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 난수원을 고정한다. id 가 매번 달라지면 실패한 줄을 읽기 어렵다. */
let seed = 7;
setRandomBytes((count) => {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) bytes[i] = (seed = (seed * 1103515245 + 12345) % 256);
  return bytes;
});

const PROJECT = 'p-assets';

(async () => {
  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);
  await store.init(PROJECT, 'Asia/Seoul');
  await store.ensureClient(() => 'client-assets');

  const queued: Mutation[] = [];
  const writer = createLocalSettingsWriter({
    store,
    projectId: PROJECT,
    onQueued: (mutation) => queued.push(mutation),
  });

  // ── 1. 구성원 만들기 ──
  const { id: personId } = await writer.addPerson({ name: '김철수', relationship: '본인' } as never);

  const people = await store.people(PROJECT);
  eq('사본에 곧바로 보인다', people.find((row) => row.id === personId)?.name, '김철수');
  eq('큐에 명령이 하나', queued.length, 1);
  eq('명령의 종류', queued[0].kind, 'person.create');
  eq('대상은 그 구성원', queued[0].targets.join(','), personId);
  eq('짐에 이름이 담긴다',
    (queued[0].payload as { name: string }).name, '김철수');

  // ── 2. 고치기는 바꾼 필드만 ──
  await writer.updatePerson(personId, { name: '김철수(폰)' });

  eq('큐에 둘째 명령', queued.length, 2);
  eq('고치기 명령', queued[1].kind, 'person.update');
  eq('바꾼 필드만 담는다',
    Object.keys(queued[1].payload as object).sort().join(','), 'id,name');
  /*
   * 요점. 관계(relationship)는 담기지 않는다. 담으면 그 필드의 시계까지 올라가, 그 사이
   * 다른 기기가 관계를 고쳤어도 이 명령이 이겨 버린다.
   */
  eq('건드리지 않은 필드는 빠진다',
    'relationship' in (queued[1].payload as object), false);
  eq('사본에도 반영된다',
    (await store.people(PROJECT)).find((row) => row.id === personId)?.name, '김철수(폰)');

  // ── 3. 시계는 앞의 값보다 뒤 ──
  eq('둘째 명령의 시계가 더 늦다', queued[1].hlc > queued[0].hlc, true);
  eq('사본의 그 줄도 같은 시계', await store.assetClock('person', personId), queued[1].hlc);

  // ── 4. 통장과 카드 ──
  const { id: accountId } = await writer.addAccount({
    name: '국민은행 통장',
    type: 'deposit',
    ownerId: personId,
    currency: 'KRW',
    openingBalance: '50000',
  } as never);

  const accounts = await store.accounts(PROJECT);
  const account = accounts.find((row) => row.id === accountId);
  eq('통장이 사본에 선다', account?.name, '국민은행 통장');
  eq('기초 잔액을 그대로 적어 둔다 (pull 이 덮는다)', account?.balance, '50000');
  eq('통장 명령의 짐에 기초 잔액',
    (queued[2].payload as { initialBalance?: string }).initialBalance, '50000');

  const { id: cardId } = await writer.addCard({
    name: '신한 신용',
    cardType: 'credit',
    issuerId: 'fi-issuer',
    paymentAccountId: accountId,
    statementClosingDay: 14,
    paymentDueDay: 25,
  } as never);

  const cardCommand = queued[3];
  const liabilityId = (cardCommand.payload as { liabilityAccountId?: string }).liabilityAccountId;
  eq('카드 명령', cardCommand.kind, 'card.create');
  eq('부채 계정 id 도 기기가 만든다', typeof liabilityId, 'string');
  eq('두 대상을 함께 건다', cardCommand.targets.length, 2);
  eq('부채 계정도 사본에 선다',
    (await store.accountById(PROJECT, liabilityId!))?.type, 'credit_card');
  eq('부채 계정의 통화는 결제 통장을 따른다',
    (await store.accountById(PROJECT, liabilityId!))?.currency, 'KRW');

  const card = await store.cardById(PROJECT, cardId);
  eq('카드가 사본에 선다', card?.paymentAccountId, accountId);

  // ── 5. 숨기기도 같은 길이다 ──
  await writer.updateCard(cardId, { isActive: false });
  eq('숨기기는 update 명령', queued[4].kind, 'card.update');
  eq('짐은 isActive 하나', Object.keys(queued[4].payload as object).sort().join(','), 'id,isActive');

  // ── 6. 순서 바꾸기는 값 하나 ──
  //
  // 목록 전체를 보내지 않는다. 두 사람이 각자 다른 항목을 옮겨도 둘 다 남아야 한다.
  const { id: secondId } = await writer.addPerson({ name: '이영희' } as never);
  const before = await store.people(PROJECT);
  eq('새 구성원은 뒤에 붙는다', before.map((row) => row.id).join(',') , `${personId},${secondId}`);

  const moved = rankForMove(before, personId, 1);
  eq('뒤로 옮길 값을 만든다', typeof moved, 'string');
  eq('그 값은 뒤엣것보다 크다', (moved ?? '') > (before[1].sortRank ?? ''), true);

  await writer.updatePerson(personId, { sortRank: moved! });
  const moveCommand = queued[queued.length - 1];
  eq('순서 명령의 짐은 값 하나',
    Object.keys(moveCommand.payload as object).sort().join(','), 'id,sortRank');
  eq('사본에서도 자리가 바뀐다',
    (await store.people(PROJECT)).map((row) => row.id).join(','), `${secondId},${personId}`);
  eq('같은 자리로 옮기면 만들지 않는다',
    String(rankForMove([{ id: 'a', sortRank: 'V' }], 'a', 0)), 'null');

  // ── 7. 분류와 태그도 같은 길 ──
  const { id: parentId } = await writer.addCategory({
    name: '오프라인 분류',
    type: 'expense',
  } as never);
  const { id: childId } = await writer.addCategory({
    name: '소분류',
    type: 'expense',
    parentId,
  } as never);

  const tree = await store.categoryRows(PROJECT);
  eq('분류가 사본에 선다', tree.find((row) => row.id === parentId)?.name, '오프라인 분류');
  eq('소분류의 부모가 이어진다', tree.find((row) => row.id === childId)?.parentId, parentId);
  eq('분류 명령의 종류', queued[queued.length - 2].kind, 'category.create');

  const { id: tagId } = await writer.addTag({ name: '오프라인 태그', color: '#ef4444' } as never);
  eq('태그가 사본에 선다', (await store.tagRows(PROJECT)).find((row) => row.id === tagId)?.color,
    '#ef4444');

  await writer.updateTag(tagId, { name: '고친 태그' });
  eq('태그 고치기 명령은 바꾼 필드만',
    Object.keys(queued[queued.length - 1].payload as object).sort().join(','), 'id,name');

  // ── 8. 별칭: 서버가 다른 행을 채택했을 때 ──
  //
  // 두 사람이 같은 이름의 분류를 만든 경우다. 사본의 참조와 큐의 짐이 함께 옮겨져야 한다.
  await store.settleMutations([
    {
      mutationId: queued[queued.length - 3].mutationId,
      status: 'applied',
      alias: { from: parentId, to: 'server-category-1' },
    },
  ], newId);

  eq('옛 줄은 사본에서 사라진다',
    (await store.categoryRows(PROJECT)).some((row) => row.id === parentId), false);
  eq('자식의 부모가 서버 id 로 옮겨진다',
    (await store.categoryRows(PROJECT)).find((row) => row.id === childId)?.parentId,
    'server-category-1');
  eq('큐에 남은 짐도 함께 옮겨진다',
    JSON.stringify(await store.pendingMutations(PROJECT)).includes(parentId), false);
  eq('별칭을 기억한다', await store.aliasOf(parentId), 'server-category-1');

  const pending = await store.pendingMutations(PROJECT);
  // 번호는 기기 안에서 1씩 오른다. 서버는 (기기, 번호)로 같은 명령을 두 번 적지 않는다.
  // 별칭이 붙은 명령 하나는 판정이 끝나 큐에서 빠졌다. 나머지는 번호 순 그대로다.
  eq('큐가 번호 순으로 남는다',
    pending.map((row) => row.clientSeq).join(','), '1,2,3,4,5,6,7,8,10,11');

  /*
   * 지우기는 사본에서도 지우기다.
   *
   * 분류·태그에는 감춰진 상태가 없다. `isActive: false` 는 표에 담는 값이 아니라
   * "지워 달라"는 명령의 이름이라, 사본에서는 행을 걷어낸다. 남겨 두면 다음 동기화가
   * 올 때까지 지운 것이 목록과 거래에 그대로 보인다 -- 오프라인에서 지우면 그 사이가
   * 몇 시간이 되기도 한다.
   */
  const count = async (sql: string, id: string) =>
    (await driver.all<{ n: number }>(sql, [id]))[0]?.n ?? 0;

  await driver.run(`INSERT INTO entry_tag (entryId, lineKey, tagId) VALUES (?, NULL, ?)`, [
    'e-tagged',
    tagId,
  ]);
  eq('사본에 태그가 붙었다', await count(`SELECT count(*) AS n FROM entry_tag WHERE tagId = ?`, tagId), 1);

  await writer.updateTag(tagId, { isActive: false });
  eq('지우면 태그 행이 사라진다', await count(`SELECT count(*) AS n FROM tag WHERE id = ?`, tagId), 0);
  eq('붙어 있던 자리도 함께 간다', await count(`SELECT count(*) AS n FROM entry_tag WHERE tagId = ?`, tagId), 0);
  eq('명령은 그대로 쌓인다', queued[queued.length - 1].kind, 'tag.update');

  /* 분류도 같다. 소분류는 부모와 함께 간다 (서버도 cascade 로 지운다). */
  await writer.updateCategory(childId, { isActive: false });
  eq('소분류가 사본에서 사라진다',
    await count(`SELECT count(*) AS n FROM category WHERE id = ?`, childId), 0);

  // ── 합계 예산: 사본에는 센티널을 풀어 적는다 ──
  const { id: totalId } = await writer.setBudget({
    categoryId: 'BUDGET_TOTAL_EXPENSE',
    type: 'expense',
    monthlyAmount: '500000',
    yearMonth: '2026-09',
  });
  const totalCommand = queued[queued.length - 1];
  eq('명령에는 센티널 그대로 (서버가 푼다)',
    (totalCommand.payload as { categoryId?: string }).categoryId, 'BUDGET_TOTAL_EXPENSE');
  const totalRow = (await store.budgets(PROJECT, 2026, 9)).find((row) => row.id === totalId);
  eq('사본의 행은 분류 없음', totalRow?.categoryId ?? null, null);
  eq('사본의 행은 지출 합계', totalRow?.type, 'expense');
  const monthRows = await createLocalHomePort(store, {
    fallback: {} as never,
  }).getBudgetForMonth(2026, 9, PROJECT);
  const total = monthRows.find((row) => !row.categoryId && row.categoryType === 'expense');
  eq('오프라인에서 만든 합계 예산이 바로 보인다', total?.budgetId, totalId);
  eq('그 금액', total?.monthlyAmount, '500000');

  // 태그 예산은 유형을 두지 않는다 (서버도 버린다)
  const { id: tagBudgetId } = await writer.setBudget({
    tagId: 'tag-x',
    type: 'expense',
    monthlyAmount: '1000',
  });
  eq('태그 예산의 사본 행에는 유형이 없다',
    (await store.budgets(PROJECT, 2026, 9)).find((row) => row.id === tagBudgetId)?.type ?? null, null);

  // ── 월별 예산 목록 (사본이 푼다) ──
  const homePort = createLocalHomePort(store, { fallback: {} as never });
  const { id: foodBudgetId } = await writer.setBudget({
    categoryId: 'cat-food',
    type: 'expense',
    monthlyAmount: '300000',
    yearMonth: '2026-09',
  });
  const { id: overrideId } = await writer.setBudgetOverride({
    budgetId: foodBudgetId,
    year: 2026,
    month: 10,
    amount: '100000',
  });
  const schedule = async () =>
    (
      await homePort.getBudgetSchedule(
        { categoryId: 'cat-food', type: 'expense', startMonth: '2026-09', months: 3 },
        PROJECT,
      )
    ).map((row) => `${row.amount}${row.isOverridden ? '*' : ''}`).join(',');
  eq('월별 목록: 10월만 조정', await schedule(), '300000,100000*,300000');
  const totalSchedule = await homePort.getBudgetSchedule(
    { categoryId: 'BUDGET_TOTAL_EXPENSE', type: 'expense', startMonth: '2026-09', months: 1 },
    PROJECT,
  );
  eq('합계의 월별 목록은 합계 규칙만', totalSchedule[0]?.budgetId, totalId);

  // 조정 되돌리기: 사본에서 줄째 지운다 (0원 조정으로 남기지 않는다)
  await writer.setBudgetOverride({ id: overrideId, budgetId: foodBudgetId, year: 2026, month: 10, amount: null });
  eq('되돌리면 규칙 금액으로', await schedule(), '300000,300000,300000');
  eq('되돌리기 명령은 금액이 비어 간다',
    (queued[queued.length - 1].payload as { amount?: string | null }).amount ?? null, null);

  // 규칙 지우기 (모든 달 0원): 사본에서 곧바로 사라지고 명령이 쌓인다
  await writer.setBudgetOverride({ budgetId: foodBudgetId, year: 2026, month: 11, amount: '5000' });
  await writer.deleteBudget(foodBudgetId);
  eq('지우기 명령', queued[queued.length - 1].kind, 'budget.delete');
  eq('지우기 명령의 대상', queued[queued.length - 1].targets.join(','), foodBudgetId);
  eq('사본에서 규칙이 사라진다',
    (await store.budgetRules(PROJECT)).rules.some((row) => row.id === foodBudgetId), false);
  eq('딸린 조정도 함께 사라진다',
    (await store.budgetRules(PROJECT)).overrides.some((row) => row.budgetId === foodBudgetId), false);
  eq('월별 목록은 예산 없음', await schedule(), 'undefined,undefined,undefined');

  // ── 신용카드는 마감일·결제일이 있어야 만든다 (서버와 같은 검사) ──
  const cardError = await writer
    .addCard({ name: '빈 신용', cardType: 'credit', issuerId: 'fi-issuer', paymentAccountId: accountId } as never)
    .then(() => null, (error: { response?: { data?: { error?: { code?: string } } } }) => error.response?.data?.error?.code);
  eq('마감일·결제일 없는 신용카드는 막는다', cardError, 'CREDIT_CARD_DAYS_REQUIRED');
  const clearError = await writer
    .updateCard(cardId, { statementClosingDay: null } as never)
    .then(() => null, (error: { response?: { data?: { error?: { code?: string } } } }) => error.response?.data?.error?.code);
  eq('신용카드의 마감일을 비우는 것도 막는다', clearError, 'CREDIT_CARD_DAYS_REQUIRED');

  // ── 태그가 붙은 수 (끊겨 있을 때 사본에서) ──
  await driver.run(`INSERT INTO entry_tag (entryId, lineKey, tagId) VALUES ('e1', 'l1', 'tag-x'), ('e2', 'l2', 'tag-x')`, []);
  const usage = await homePort.getTagUsage('tag-x', PROJECT);
  eq('사본에서 센 거래 줄', usage.entries, 2);
  eq('반복 등록은 아직 없다', usage.rules, 0);

  // ── 예산 "고른 달부터" (사본에 곧바로 끊는다) ──
  const { id: ruleA } = await writer.setBudget({ categoryId: 'cat-b', type: 'expense', monthlyAmount: '200000', yearMonth: '2026-09' });
  await writer.setBudgetOverride({ budgetId: ruleA, year: 2026, month: 11, amount: '1' });
  const monthsB = async () =>
    (await homePort.getBudgetSchedule({ categoryId: 'cat-b', type: 'expense', startMonth: '2026-09', months: 4 }, PROJECT))
      .map((row) => (row.amount === undefined ? '-' : `${row.amount}${row.isOverridden ? '*' : ''}`)).join(',');
  eq('준비: 11월만 조정', await monthsB(), '200000,200000,1*,200000');
  await writer.setBudgetFrom({ budgetId: ruleA, categoryId: 'cat-b', type: 'expense', fromMonth: '2026-10', amount: '100000' });
  const fromCommand = queued[queued.length - 1];
  eq('명령 종류', fromCommand.kind, 'budget.setFrom');
  eq('뜻으로 보낸다 (대상과 달)',
    `${(fromCommand.payload as { categoryId: string }).categoryId} ${(fromCommand.payload as { fromMonth: string }).fromMonth}`, 'cat-b 2026-10');
  eq('10월부터 10만, 그 뒤 조정은 걷힌다', await monthsB(), '200000,100000,100000,100000');
  await writer.setBudgetFrom({ budgetId: ruleA, categoryId: 'cat-b', type: 'expense', fromMonth: '2026-11', amount: null });
  eq('11월부터 예산 없음', await monthsB(), '200000,100000,-,-');

  // ── 예산 전체 초기화: 보이는 규칙을 하나씩 지운다 ──
  const rulesBefore = (await store.budgetRules(PROJECT)).rules.length;
  const queuedBefore = queued.length;
  const deletedCount = await writer.resetBudgets(PROJECT);
  eq('지운 수는 보이던 규칙 수', deletedCount, rulesBefore);
  eq('규칙마다 지우기 명령', queued.slice(queuedBefore).every((row) => row.kind === 'budget.delete') && queued.length - queuedBefore === rulesBefore, true);
  eq('사본의 규칙이 비었다', (await store.budgetRules(PROJECT)).rules.length, 0);

  // ── 환율 (표에 붙지 않는 명령) ──
  await driver.run(
    `INSERT OR REPLACE INTO project (id, name, ledgerCurrency, displayCurrency, timezone) VALUES (?, '우리집', 'KRW', 'KRW', 'Asia/Seoul')`,
    [PROJECT],
  );
  await writer.setExchangeRate({ from: 'USD', to: 'KRW', rate: '1400' });
  eq('환율 명령', queued[queued.length - 1].kind, 'exchangeRate.set');
  eq('환율 명령은 시계 없이', queued[queued.length - 1].targets.join(','), 'USD:KRW');
  const usd = async () => (await homePort.getExchangeRates(PROJECT)).rates.find((row) => row.from === 'USD');
  eq('사본에 곧바로 선다', `${(await usd())?.rate} ${(await usd())?.source}`, '1400 manual');
  await writer.setExchangeRate({ from: 'USD', to: 'KRW', rate: '1450' });
  eq('같은 날 다시 넣으면 덮는다',
    (await driver.all(`SELECT count(*) AS n FROM exchange_rate WHERE baseCurrency = 'USD'`, []))[0].n, 1);
  await writer.clearExchangeRate({ from: 'USD', to: 'KRW' });
  eq('되돌리면 고정값', (await usd())?.source, 'fallback');

  // ── 가계부 이름 (고른 가계부만 명령으로) ──
  const projectRenamed = await writer.updateProject(PROJECT, { name: '새 이름', displayCurrency: 'USD' });
  eq('명령으로 쌓인다', projectRenamed.queued, true);
  eq('가계부 명령', queued[queued.length - 1].kind, 'project.update');
  eq('사본에도 곧바로', (await store.projectRow(PROJECT))?.displayCurrency, 'USD');

  // ── 2단계: 통합·삭제·잔액 맞추기 (사본에 곧바로, 명령은 뜻으로) ──
  const codeOf = (promise: Promise<unknown>) =>
    promise.then(() => null, (error: { response?: { data?: { error?: { code?: string } } } }) =>
      error.response?.data?.error?.code ?? 'no-code');
  const { id: pOwner } = await writer.addPerson({ name: '정리용' } as never);
  const { id: acc2 } = await writer.addAccount({ name: '정리 통장', type: 'deposit', ownerId: pOwner, currency: 'KRW' } as never);
  const { id: catFrom } = await writer.addCategory({ name: '없앨 분류', type: 'expense' } as never);
  const { id: catTo } = await writer.addCategory({ name: '받을 분류', type: 'expense' } as never);
  const { id: catIncome } = await writer.addCategory({ name: '수입 분류', type: 'income' } as never);
  const { id: tagFrom } = await writer.addTag({ name: '없앨 태그' } as never);
  const { id: tagTo } = await writer.addTag({ name: '받을 태그' } as never);
  const spendId = newId();
  await store.writeEntry(spendId, {
    projectId: PROJECT, personId: pOwner, date: new Date('2026-09-10T03:00:00.000Z'), description: '정리할 지출',
    postings: [
      { accountId: acc2, amount: Dec.of('-3000'), currency: 'KRW', exchangeRate: Dec.of(1), baseAmount: Dec.of('-3000') },
      { categoryId: catFrom, amount: Dec.of('3000'), currency: 'KRW', exchangeRate: Dec.of(1), baseAmount: Dec.of('3000'), lineKey: 'l-1', tagIds: [tagFrom] },
    ],
  }, { timeZone: 'Asia/Seoul', hlc: queued[queued.length - 1].hlc, makeId: newId });

  eq('유형이 다른 분류로는 막는다', await codeOf(writer.mergeCategories([{ fromId: catFrom, toId: catIncome }])), 'CATEGORY_MERGE_TYPE_MISMATCH');
  eq('거래가 있는데 옮길 곳이 없으면 막는다', await codeOf(writer.mergeCategories([{ fromId: catFrom }])), 'CATEGORY_MERGE_TARGET_REQUIRED');
  const mergeResult = await writer.mergeCategories([{ fromId: catFrom, toId: catTo }]);
  eq('분류 통합 명령', queued[queued.length - 1].kind, 'category.merge');
  eq('옮긴 다리 수', mergeResult.movedPostings, 1);
  eq('사본의 다리가 옮겨 간다',
    (await driver.all(`SELECT categoryId FROM posting WHERE entryId = ? AND categoryId IS NOT NULL`, [spendId]))[0].categoryId, catTo);
  eq('없앤 분류가 사본에서 사라진다', (await driver.all(`SELECT count(*) AS n FROM category WHERE id = ?`, [catFrom]))[0].n, 0);

  await writer.mergeTags(tagFrom, tagTo);
  eq('태그 통합 명령', queued[queued.length - 1].kind, 'tag.merge');
  eq('사본의 태그가 옮겨 간다', (await driver.all(`SELECT tagId FROM entry_tag WHERE entryId = ?`, [spendId]))[0].tagId, tagTo);

  // 잔액 맞추기 (서버를 거친 통장처럼 번호를 붙여 기초잔액 전표 길로 간다)
  await driver.run(`UPDATE account SET updatedVersion = 5, balance = '0' WHERE id = ?`, [acc2]);
  await driver.run(
    `INSERT INTO account (id, projectId, ownerId, type, name, currency, balance, isActive, sortRank, updatedVersion)
     VALUES ('equity-1', ?, NULL, 'opening_balance', '기초잔액', 'KRW', '0', 1, 'Z', 1)`,
    [PROJECT],
  );
  await writer.setAccountBalance(acc2, '100000');
  const balanceCommand = queued[queued.length - 1];
  eq('잔액 명령은 뜻으로', `${balanceCommand.kind} ${(balanceCommand.payload as { balance: string }).balance}`, 'account.balance 100000');
  const balanceOf = async () => (await store.accountBalances(PROJECT)).get(acc2);
  eq('사본의 잔액이 곧바로 목표값', await balanceOf(), '100000');
  eq('기초잔액 전표는 명령의 id',
    (await driver.all(`SELECT count(*) AS n FROM entry WHERE id = ?`, [(balanceCommand.payload as { openingEntryId: string }).openingEntryId]))[0].n, 1);
  await writer.setAccountBalance(acc2, '50000');
  eq('다시 맞추면 그 전표를 고친다', await balanceOf(), '50000');
  eq('기초잔액 전표는 하나', (await driver.all(`SELECT count(*) AS n FROM posting WHERE accountId = 'equity-1'`, []))[0].n, 1);

  // 삭제: 사본에서 같은 검사를 먼저 한다
  eq('잔액이 남은 통장은 막는다', await codeOf(writer.removeAccount(acc2)), 'ACCOUNT_HAS_BALANCE');
  eq('통장이 있는 구성원은 막는다', await codeOf(writer.removePerson(pOwner)), 'PERSON_HAS_ACCOUNTS');
  const { id: emptyPerson } = await writer.addPerson({ name: '빈 사람' } as never);
  await writer.removePerson(emptyPerson);
  eq('빈 구성원 지우기 명령', queued[queued.length - 1].kind, 'person.delete');
  eq('사본에서 사라진다', (await driver.all(`SELECT count(*) AS n FROM person WHERE id = ?`, [emptyPerson]))[0].n, 0);

  // ── 3단계: 반복 등록 (사본에 곧바로, 명령은 온라인 요청 모양 그대로) ──
  const { id: rTag } = await writer.addTag({ name: '월세' } as never);
  const ruleId = newId();
  const recurringBody = {
    id: ruleId,
    frequency: 'weekly' as const,
    weekdays: [3, 1],
    // 주별이 아닌 칸은 버린다 (서버 recurringScheduleFields 와 같다)
    dayOfMonth: 25,
    startDate: '2026-01-01',
    kind: 'expense' as const,
    amount: '500000',
    description: '  월세  ',
    cardId: 'card-r',
    categoryId: 'cat-r',
    tagIds: [rTag],
  };
  eq('이름이 비면 막는다',
    await codeOf(writer.createRecurringRule({ ...recurringBody, id: newId(), description: ' ' })),
    'RECURRING_DESCRIPTION_REQUIRED');
  eq('요일 없는 주별은 막는다',
    await codeOf(writer.createRecurringRule({ ...recurringBody, id: newId(), weekdays: [] })),
    'RECURRING_INVALID');
  eq('없는 태그는 막는다',
    await codeOf(writer.createRecurringRule({ ...recurringBody, id: newId(), tagIds: ['tag-none'] })),
    'TAG_NOT_IN_PROJECT');

  await writer.createRecurringRule(recurringBody);
  const created = queued[queued.length - 1];
  eq('만들기 명령', `${created.kind} ${created.targets.join(',')}`, `recurring.create ${ruleId}`);
  eq('짐은 요청 그대로', (created.payload as { description: string }).description, '  월세  ');

  const ruleOf = async () =>
    (await homePort.getRecurringRules(PROJECT)).find((rule) => rule.id === ruleId);
  const madeRule = await ruleOf();
  eq('사본의 목록에 곧바로 보인다', madeRule?.description, '월세');
  eq('요일은 차례로', madeRule?.weekdays.join(','), '1,3');
  eq('주별이 아닌 칸은 비운다', madeRule?.dayOfMonth ?? null, null);
  eq('태그', madeRule?.tagIds.join(','), rTag);
  eq('다음 예정일을 셈한다 (월·수)',
    madeRule?.nextRunOn != null && [1, 3].includes(new Date(`${madeRule.nextRunOn}T00:00:00Z`).getUTCDay()), true);
  eq('태그가 붙은 반복 등록 수', (await homePort.getTagUsage(rTag, PROJECT)).rules, 1);

  // 마지막으로 만든 날은 후보 열쇠에서 센다 (서버와 같은 규칙)
  await driver.run(
    `INSERT INTO entry_draft (id, projectId, source, recurringRuleId, dedupeKey) VALUES ('d-r1', ?, 'recurring', ?, ?)`,
    [PROJECT, ruleId, `r:${ruleId}:2026-09-28`],
  );
  eq('마지막으로 만든 날', (await ruleOf())?.lastMadeOn, '2026-09-28');

  // 고치기: 바꾼 칸만 싣고, 갈래를 이체로 바꾸면 카드·분류가 비워진다
  await writer.updateRecurringRule(ruleId, { kind: 'transfer', accountId: 'acc-a', toAccountId: 'acc-b' });
  const updated = queued[queued.length - 1];
  eq('고치기 명령', updated.kind, 'recurring.update');
  eq('바꾼 칸만 싣는다', Object.keys(updated.payload as object).sort().join(','), 'accountId,id,kind,toAccountId');
  const transferRule = await ruleOf();
  eq('이체로 바꾸면 카드가 빠진다', transferRule?.cardId ?? null, null);
  eq('이체로 바꾸면 분류가 빠진다', transferRule?.categoryId ?? null, null);
  eq('일정은 그대로', transferRule?.weekdays.join(','), '1,3');
  eq('같은 통장으로 이체는 막는다',
    await codeOf(writer.updateRecurringRule(ruleId, { toAccountId: 'acc-a' })), 'TRANSFER_SAME_ACCOUNT');
  eq('음수 수수료는 막는다',
    await codeOf(writer.updateRecurringRule(ruleId, { feeAmount: '-1' })), 'RECURRING_FEE_INVALID');

  await writer.updateRecurringRule(ruleId, { isActive: false });
  eq('꺼 두면 다음 예정일이 없다', (await ruleOf())?.nextRunOn ?? null, null);
  eq('없는 반복은 고치지 못한다',
    await codeOf(writer.updateRecurringRule('rule-none', { isActive: true })), 'RECURRING_NOT_FOUND');

  await writer.removeRecurringRule(ruleId);
  eq('지우기 명령', queued[queued.length - 1].kind, 'recurring.delete');
  eq('목록에서 사라진다', await ruleOf(), undefined);
  eq('만든 후보는 남고 연결만 풀린다',
    (await driver.all(`SELECT recurringRuleId FROM entry_draft WHERE id = 'd-r1'`, []))[0].recurringRuleId, null);

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
