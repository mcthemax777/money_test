/**
 * 결제수단을 고르지 않은 거래를 기기 사본이 서버와 같게 다루는가.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/unassigned-mirror-smoke.ts
 *
 * 서버 쪽 짝은 `api/scripts/unassigned-account-smoke.ts` 다. 여기서는 사본이 손으로 옮긴
 * SQL(검색의 "자산 미선택", 사람 필터의 셋째 가지)과 조립 창구(미지정 계정 찾기)를 본다.
 */
import { NO_ACCOUNT, buildEntry, type SyncDto } from '@money/types';

import { httpHomePort } from '../src/data/home-port';
import { createLocalHomePort } from '../src/data/local-home-port';
import { localLedgerLookup } from '../src/data/local-lookup';
import { LocalStore } from '../src/data/local-store';
import { syncProject } from '../src/data/sync-engine';
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
    recurringRules: [],
  };
}

const account = (id: string, type: string, ownerId: string | null, name: string) => ({
  id, projectId: PID, ownerId, type, name, institutionId: null, accountNumber: null,
  currency: 'KRW', balance: '0', isActive: true, sortOrder: 0, updatedVersion: 1,
});

/** 지출 한 건. 분류 다리와 계좌 다리 둘이다. */
const expense = (id: string, personId: string, amount: string, accountId: string) => ({
  id, projectId: PID, personId, date: '2026-08-10T03:00:00.000Z', description: id,
  merchant: null, detailedNote: null, originalCurrency: null, originalAmount: null,
  rateProvisional: false, createdByUserId: null, updatedVersion: 2,
  tagLinks: [] as Array<{ lineKey: string | null; tagId: string }>,
  postings: [
    { id: `${id}-cat`, entryId: id, accountId: null, categoryId: 'c-dining', amount,
      quantity: null, currency: 'KRW', baseAmount: amount, exchangeRate: '1', cardId: null,
      lineKey: `${id}-line` },
    { id: `${id}-acc`, entryId: id, accountId, categoryId: null, amount: `-${amount}`,
      quantity: null, currency: 'KRW', baseAmount: `-${amount}`, exchangeRate: '1', cardId: null },
  ],
});

(async () => {
  const store = new LocalStore(nodeSqliteDriver());
  const pulled: SyncDto.PullResponse = {
    projectId: PID, since: 0, version: 2, hasMore: false, tombstones: [], tombstoneFloor: 0,
    changes: {
      ...emptyChanges(),
      project: {
        id: PID, name: '우리집', projectKey: null, description: null,
        ledgerCurrency: 'KRW', displayCurrency: 'KRW', timezone: KST, updatedVersion: 1,
      },
      people: [
        { id: 'p1', projectId: PID, name: '김철수', relationship: null, isActive: true, sortOrder: 0, updatedVersion: 1 },
        { id: 'p2', projectId: PID, name: '이영희', relationship: null, isActive: true, sortOrder: 1, updatedVersion: 1 },
      ],
      accounts: [
        account('a-bank', 'deposit', 'p1', '보통예금'),
        account('a-none', 'unassigned', null, '미지정'),
      ],
      categories: [
        { id: 'c-dining', projectId: PID, name: '외식', parentId: null, type: 'expense', icon: null,
          isDefault: false, isActive: true, sortOrder: 0, updatedVersion: 1 },
      ],
      entries: [
        expense('e-bank', 'p1', '30000', 'a-bank'),
        expense('e-none1', 'p1', '8000', 'a-none'),
        expense('e-none2', 'p2', '5000', 'a-none'),
      ],
    } as SyncDto.Changes,
  };
  await syncProject(store, async () => pulled, PID, KST);

  const offline = () => {
    throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  };
  const port = createLocalHomePort(store, {
    fallback: Object.fromEntries(
      Object.keys(httpHomePort).map((name) => [name, async () => offline()]),
    ) as unknown as typeof httpHomePort,
  });

  // ── 조립: 수단을 비우면 미지정 계정에 붙는다 ──
  const built = await buildEntry(
    { projectId: PID, kind: 'expense', personId: 'p1', date: '2026-08-11T03:00:00.000Z', description: '현금',
      amount: '1000', categoryId: 'c-dining', lineKey: 'l1' } as never,
    localLedgerLookup(store),
  );
  eq('조립: 계좌 다리가 미지정 계정', built.postings.find((p) => p.accountId)?.accountId, 'a-none');

  // ── 자산 목록에 서지 않는다 ──
  const accounts = await port.getAccountsV2(PID);
  eq('자산 목록에 미지정 없음', accounts.some((row) => row.id === 'a-none'), false);

  // ── 검색 ──
  const noAccount = await port.getAllEntries({ paymentAccountIds: NO_ACCOUNT, limit: 200 }, PID);
  eq('검색 자산 미선택', noAccount.map((row) => row.id).sort().join(','), 'e-none1,e-none2');
  const either = await port.getAllEntries(
    { paymentAccountIds: `${NO_ACCOUNT},a-bank`, limit: 200 }, PID);
  eq('검색 자산 미선택 또는 통장', either.length, 3);
  eq('목록: 미지정 거래의 accountId', noAccount[0]?.accountId, null);

  // ── 사람 필터: 주인이 없으면 거래를 낸 사람 ──
  const forChulsoo = await port.getAllEntries({ personIds: 'p1', limit: 200 }, PID);
  eq('사람 필터 철수', forChulsoo.map((row) => row.id).sort().join(','), 'e-bank,e-none1');
  const forYounghee = await port.getAllEntries({ personIds: 'p2', limit: 200 }, PID);
  eq('사람 필터 영희', forYounghee.map((row) => row.id).join(','), 'e-none2');

  // ── 수단별 ──
  const methods = await port.getPaymentMethods({ yearMonth: '2026-08' }, PID);
  const bucket = methods.find((row) => row.unassigned);
  eq('수단별 미지정 칸 id', bucket?.id, NO_ACCOUNT);
  eq('수단별 미지정 칸 지출', bucket?.amount, '13000');

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
