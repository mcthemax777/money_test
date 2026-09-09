/**
 * 보관함 사본 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/inbox-mirror-smoke.ts
 *
 * 무엇을 지키는 검사인가. 보관함의 후보는 전표가 아니라 아웃박스(명령 재생)를 지나지
 * 않는다. 그 대신 "사본에 먼저 적고 서버에 알린다"는 작은 큐 하나에 기대는데, 그
 * 큐에서 틀리면 **같은 거래가 두 번 적힌다.** 그 자리를 여기서 본다.
 *
 *   1. 변경 피드로 온 후보가 사본에 담기고, 자리표를 받으면 사라진다.
 *   2. 오프라인에서 등록 표시를 남기면 사본에서 곧바로 빠지고 큐에 남는다.
 *   3. **그 뒤에 온 델타가 그 후보를 대기로 되살리지 않는다.** (가장 중요한 자리)
 *   4. 큐를 비우면 그때부터는 델타가 그 후보를 다시 담을 수 있다.
 */
import type { SyncDto } from '@money/types';

import { LocalStore } from '../src/data/local-store';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const KST = 'Asia/Seoul';
const PID = 'project-1';

function emptyChanges(): SyncDto.Changes {
  return {
    project: null,
    members: [],
    people: [],
    accounts: [],
    categories: [],
    tags: [],
    cards: [],
    entries: [],
    budgets: [],
    budgetOverrides: [],
    exchangeRates: [],
    assetValuations: [],
    installmentPlans: [],
    entryDrafts: [],
  };
}

/** 서버가 보내는 후보 한 줄. sync.service 가 내보내는 모양 그대로다. */
function draftRow(
  id: string,
  options: {
    status?: string;
    source?: string;
    amount?: string | null;
    version?: number;
    dedupeKey?: string;
  } = {},
) {
  return {
    id,
    projectId: PID,
    source: options.source ?? 'notification',
    status: options.status ?? 'pending',
    rawText: `[국민카드] ${options.amount ?? '12000'}원 승인 스타벅스`,
    appPackage: 'com.kbcard.cxh.appcard',
    appTitle: 'KB국민카드',
    kind: 'expense',
    amount: options.amount ?? '12000',
    currency: 'KRW',
    occurredAt: '2026-09-08T05:00:00.000Z',
    merchant: '스타벅스',
    description: '스타벅스',
    installmentMonths: null,
    personId: null,
    categoryId: null,
    accountId: null,
    cardId: null,
    confidence: 80,
    parser: 'app:kbcard',
    dedupeKey: options.dedupeKey ?? `n:${id}`,
    registeredEntryId: null,
    createdAt: '2026-09-08T05:00:01.000Z',
    updatedAt: '2026-09-08T05:00:01.000Z',
    updatedVersion: options.version ?? 1,
  };
}

function pull(
  version: number,
  changes: Partial<SyncDto.Changes>,
  tombstones: SyncDto.Tombstone[] = [],
): SyncDto.PullResponse {
  return {
    projectId: PID,
    since: 0,
    version,
    hasMore: false,
    changes: { ...emptyChanges(), ...changes },
    tombstones,
    tombstoneFloor: 0,
  };
}

async function main() {
  const store = new LocalStore(nodeSqliteDriver(':memory:'));
  await store.init(PID, KST);

  console.log('── 델타로 온 후보 ──');
  await store.applyPull(pull(1, { entryDrafts: [draftRow('d1'), draftRow('d2')] }), KST);
  {
    const rows = await store.draftRows(PID, { status: 'pending' });
    eq('사본에 담긴다', rows.length, 2);
    eq('금액이 그대로다', rows[0]?.amount, '12000');
    eq('원문이 그대로다', Boolean(rows[0]?.rawText), true);
    eq('열쇠로 이미 담은 것을 안다', await store.draftExists(PID, 'n:d1'), true);
    eq('없는 열쇠는 모른다', await store.draftExists(PID, 'n:없음'), false);
  }

  console.log('\n── 자리표 ──');
  await store.applyPull(
    pull(2, {}, [{ entity: 'EntryDraft', entityId: 'd2', deletedVersion: 2 }]),
    KST,
  );
  {
    const rows = await store.draftRows(PID, { status: 'pending' });
    eq('지워진 후보는 사본에서도 사라진다', rows.length, 1);
    eq('남은 것은 다른 후보다', rows[0]?.id, 'd1');
  }

  console.log('\n── 오프라인에서 등록 표시 ──');
  await store.markDraft(PID, 'd1', 'registered', 'entry-1');
  {
    const pending = await store.draftRows(PID, { status: 'pending' });
    eq('목록에서 빠진다', pending.length, 0);

    const registered = await store.draftRows(PID, { status: 'registered' });
    eq('등록됨으로 남는다', registered.length, 1);
    eq('만든 거래를 가리킨다', registered[0]?.registeredEntryId, 'entry-1');

    const ops = await store.pendingDraftOps(PID);
    eq('서버에 알릴 일이 큐에 남는다', ops.length, 1);
    eq('무슨 일인지 적혀 있다', ops[0]?.op, 'registered');
    eq('어느 거래인지 적혀 있다', ops[0]?.entryId, 'entry-1');
  }

  console.log('\n── 큐가 남아 있는 동안의 델타 ──');
  /*
   * 서버는 아직 등록 표시를 받지 못했으므로 그 후보를 pending 으로 다시 보낸다.
   * 이것을 그대로 덮어쓰면 사용자는 같은 후보를 다시 보고 거래를 한 건 더 적는다.
   */
  await store.applyPull(pull(3, { entryDrafts: [draftRow('d1', { version: 3 })] }), KST);
  {
    const pending = await store.draftRows(PID, { status: 'pending' });
    eq('되살아나지 않는다', pending.length, 0);
    const registered = await store.draftRows(PID, { status: 'registered' });
    eq('등록됨이 그대로다', registered.length, 1);
  }

  console.log('\n── 큐를 비운 뒤 ──');
  await store.forgetDraftOp('d1');
  eq('큐가 비었다', (await store.pendingDraftOps(PID)).length, 0);

  /*
   * 이제는 서버가 참이다. 다른 기기에서 그 후보를 대기로 되돌렸다면(무시를 풀었거나
   * 등록한 거래를 지웠거나) 그 값이 사본에 그대로 와야 한다.
   */
  await store.applyPull(pull(4, { entryDrafts: [draftRow('d1', { version: 4 })] }), KST);
  {
    const pending = await store.draftRows(PID, { status: 'pending' });
    eq('큐가 없으면 서버 값이 이긴다', pending.length, 1);
  }

  console.log('\n── 지우기 ──');
  await store.markDraft(PID, 'd1', 'deleted');
  {
    const all = await store.draftRows(PID);
    eq('사본에서 행째로 사라진다', all.length, 0);
    const ops = await store.pendingDraftOps(PID);
    eq('지우기도 큐에 남는다', ops[0]?.op, 'deleted');
  }

  console.log('\n── 지운 후보와 같은 열쇠로 새 후보가 올 때 ──');
  /*
   * 사본이 서버가 보낸 것을 거절해서는 안 된다.
   *
   * 후보를 지우고 같은 캡처를 다시 올리면 **같은 열쇠에 다른 id** 인 행이 생긴다.
   * 델타에는 새 행이 먼저 오고 자리표(옛 행 삭제)가 뒤에 오므로, 그 사이에는 두 행이
   * 같은 열쇠를 갖는다. 사본에 유일 색인을 걸어 두었을 때 여기서 동기화가 멈췄다.
   */
  await store.applyPull(pull(6, { entryDrafts: [draftRow('d5', { dedupeKey: 'n:같은열쇠' })] }), KST);
  await store.applyPull(
    pull(
      7,
      { entryDrafts: [draftRow('d6', { dedupeKey: 'n:같은열쇠', version: 7 })] },
      [{ entity: 'EntryDraft', entityId: 'd5', deletedVersion: 7 }],
    ),
    KST,
  );
  {
    const rows = await store.draftRows(PID, { status: 'pending' });
    eq('새 후보가 담긴다', rows.some((row) => row.id === 'd6'), true);
    eq('지워진 옛 후보는 사라진다', rows.some((row) => row.id === 'd5'), false);
  }

  // 다음 검사가 셀 수 있게 이 후보도 걷어낸다.
  await store.applyPull(
    pull(8, {}, [{ entity: 'EntryDraft', entityId: 'd6', deletedVersion: 8 }]),
    KST,
  );

  console.log('\n── 탭으로 고르기 ──');
  await store.forgetDraftOp('d1');
  await store.applyPull(
    pull(5, {
      entryDrafts: [
        draftRow('d3', { source: 'notification', dedupeKey: 'n:d3' }),
        draftRow('d4', { source: 'capture', dedupeKey: 'c:d4' }),
      ],
    }),
    KST,
  );
  {
    const notification = await store.draftRows(PID, { source: 'notification', status: 'pending' });
    const capture = await store.draftRows(PID, { source: 'capture', status: 'pending' });
    eq('알림 탭', notification.length, 1);
    eq('캡처 탭', capture.length, 1);
  }

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
