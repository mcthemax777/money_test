/**
 * 거래한 사람을 비운 거래(미지정)를 기기 사본이 받고, 적고, 검색하는가 (2026-10-10).
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/no-person-mirror-smoke.ts
 *
 * 사본의 entry.personId 는 36 판부터 NULL 을 받는다. 검색의 `NO_PERSON` 은 personId IS NULL 이다.
 */
import { NO_PERSON, buildEntry, type SyncDto } from '@money/types';

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

/** 지출 한 건. 분류 다리와 계좌 다리 둘이다. personId 가 null 이면 미지정이다. */
const expense = (id: string, personId: string | null, amount: string, accountId: string) => ({
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
        expense('e-p1', 'p1', '30000', 'a-bank'),
        expense('e-nobody', null, '8000', 'a-bank'),
        expense('e-nobody-cash', null, '5000', 'a-none'),
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

  // ── 받은 미지정 전표가 목록에 null 로 선다 ──
  const all = await port.getAllEntries({ limit: 200 }, PID);
  const nobody = all.find((row) => row.id === 'e-nobody');
  eq('받기: 미지정 전표 수', all.length, 3);
  eq('목록: personId null', nobody?.personId, null);
  eq('목록: personName 빈 글자', JSON.stringify(nobody?.personName), '""');

  // ── 조립: 사람을 비우면 null ──
  const built = await buildEntry(
    { projectId: PID, kind: 'expense', personId: null, date: '2026-08-11T03:00:00.000Z', description: '현금',
      amount: '1000', categoryId: 'c-dining', lineKey: 'l1', accountId: 'a-bank' } as never,
    localLedgerLookup(store),
  );
  eq('조립: personId null', built.personId, null);
  let seq = 0;
  await store.writeEntry('e-local', built, {
    timeZone: KST, hlc: '0000000000001-0000-dev', makeId: () => `id-${(seq += 1)}`,
  });
  const written = (await port.getAllEntries({ limit: 200 }, PID)).find((row) => row.id === 'e-local');
  eq('기기에서 적은 미지정 전표', written?.personId, null);

  // ── 검색: NO_PERSON 은 사람을 비운 것 ──
  const ids = async (entryPersonIds: string) =>
    (await port.getAllEntries({ entryPersonIds, limit: 200 } as never, PID)).map((row) => row.id).sort().join(',');
  eq('검색 미지정', await ids(NO_PERSON), 'e-local,e-nobody,e-nobody-cash');
  eq('검색 철수', await ids('p1'), 'e-p1');
  eq('검색 철수 또는 미지정', await ids(`p1,${NO_PERSON}`), 'e-local,e-nobody,e-nobody-cash,e-p1');

  // ── 자산주인 필터: 주인 있는 통장 다리면 통장 주인, 주인 없는 수단이면 사람이 없어 빠진다 ──
  const owner = (await port.getAllEntries({ personIds: 'p1', limit: 200 }, PID)).map((row) => row.id).sort().join(',');
  eq('자산주인 철수', owner, 'e-local,e-nobody,e-p1');

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
