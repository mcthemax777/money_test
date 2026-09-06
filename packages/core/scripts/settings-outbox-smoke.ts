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
import { rankForMove, setRandomBytes, type Mutation } from '@money/types';

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
  ]);

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

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
