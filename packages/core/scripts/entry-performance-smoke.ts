/**
 * 앱에서 적은 거래가 실적 표를 들고 가는가.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/entry-performance-smoke.ts
 *
 * 앱은 서버가 아니라 **사본 창구**로 쓴다(`createLocalEntryWriter`). 그 길에서 표가
 * 하나 빠지면 화면의 체크가 아무 일도 하지 않는 것처럼 보이는데, 오류가 나지 않아
 * 저장은 성공한 것으로 보인다 -- 2026-09-17 에 `countsPerformance` 가 실제로 그랬다.
 *
 * 그래서 셋을 함께 본다.
 *   1. 사본의 전표에 표가 적힌다 (화면이 곧바로 읽는 값).
 *   2. 큐에 쌓인 명령의 짐에도 실린다 (서버가 재생할 때 같은 전표가 나와야 한다).
 *   3. 실적 질의가 그 표를 보고 값을 낸다 (차감을 되살리는 자리까지).
 */
import {
  creditUsagePeriods,
  setRandomBytes,
  type SyncDto,
} from '@money/types';

import { createLocalEntryWriter } from '../src/data/local-entry-writer';
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
const CLOSING_DAY = 15;

/** 검사가 같은 값을 다시 내도록 난수를 고정한다. */
let seed = 1;
setRandomBytes((size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    bytes[i] = seed % 256;
  }
  return bytes;
});

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

async function main() {
  const store = new LocalStore(nodeSqliteDriver());
  await store.init(PID, KST);

  // ── 밑바탕. 카드 한 장과 그 부채 계정, 분류 하나 ──
  await store.applyPull(
    {
      projectId: PID,
      since: 0,
      version: 1,
      hasMore: false,
      tombstones: [],
      tombstoneFloor: 0,
      changes: {
        ...emptyChanges(),
        project: {
          id: PID,
          name: '검사',
          timezone: KST,
          ledgerCurrency: 'KRW',
          displayCurrency: 'KRW',
        } as never,
        people: [{ id: 'p1', name: '김철수', isActive: true, updatedVersion: 1 }] as never,
        accounts: [
          {
            id: 'a-bank',
            type: 'deposit',
            name: '보통예금',
            currency: 'KRW',
            balance: '1000000',
            isActive: true,
            updatedVersion: 1,
          },
          {
            id: 'a-card',
            type: 'credit_card',
            name: '신한 신용',
            currency: 'KRW',
            balance: '0',
            isActive: true,
            updatedVersion: 1,
          },
        ] as never,
        categories: [
          { id: 'c-food', name: '식비', type: 'expense', isActive: true, updatedVersion: 1 },
        ] as never,
        cards: [
          {
            id: 'card-1',
            paymentAccountId: 'a-bank',
            liabilityAccountId: 'a-card',
            name: '신한 신용',
            cardType: 'credit',
            issuerId: 'fi_card_shinhan',
            statementClosingDay: CLOSING_DAY,
            paymentDueDay: 25,
            isActive: true,
            updatedVersion: 1,
          },
        ] as never,
      },
    },
    KST,
  );

  // 명령에는 기기 이름이 붙는다. 없으면 큐에 넣는 자리에서 막힌다.
  await store.ensureClient(() => 'client-under-test');

  const writer = createLocalEntryWriter({ store, projectId: PID, timeZone: KST });
  const today = new Date().toISOString();
  const base = {
    kind: 'expense' as const,
    personId: 'p1',
    date: today,
    categoryId: 'c-food',
    cardId: 'card-1',
  };

  // ── 1. 실적에서 뺀 거래 ──
  const excluded = await writer.createEntry({
    ...base,
    // 줄 키는 화면이 만든다. 없으면 조립이 거절한다.
    lineKey: 'line-tax',
    description: '세금',
    amount: '70000',
    countsPerformance: false,
  } as never);

  // ── 2. 차감을 실적에서 빼지 않는 거래 ──
  const kept = await writer.createEntry({
    ...base,
    lineKey: 'line-point',
    description: '포인트 결제',
    amount: '50000',
    discountAmount: '20000',
    discountCountsPerformance: false,
  } as never);

  // ── 3. 아무것도 고르지 않은 거래 ──
  await writer.createEntry({
    ...base,
    lineKey: 'line-plain',
    description: '그냥 결제',
    amount: '30000',
  } as never);

  // 사본이 들고 있는 값. 목록 한 줄을 펴는 자리(toListItem)가 이 값을 읽는다.
  const page = await store.viewEntriesPage(PID, {
    fromDateKey: '2000-01-01',
    toDateKey: '2999-12-31',
    limit: 10,
  });
  const byName = new Map(page.entries.map((entry) => [entry.description, entry]));
  /*
   * 실적 여부는 **전표**에 있다. 카드사가 보는 것은 승인 한 건이라, 분류로 나눴다고
   * 절반만 실적에 드는 일은 없다. 깎인 금액만 줄에 적힌다.
   */
  eq('실적 제외가 사본에 남는다', byName.get('세금')?.countsPerformance, false);
  eq('고르지 않으면 실적 포함', byName.get('그냥 결제')?.countsPerformance, true);
  eq(
    '차감 실적 제외가 사본에 남는다',
    byName.get('포인트 결제')?.discountCountsPerformance,
    false,
  );
  eq(
    '고르지 않으면 차감이 실적도 깎는다',
    byName.get('그냥 결제')?.discountCountsPerformance,
    true,
  );
  // 깎인 금액은 줄에 남는다. 분할의 한 줄만 환불되는 일이 있어서다.
  eq(
    '깎인 금액은 줄에 남는다',
    byName.get('포인트 결제')?.postings.find((posting) => posting.categoryId !== null)
      ?.discountAmount,
    '20000',
  );

  // 큐에 쌓인 명령. 서버가 이것으로 같은 전표를 다시 만든다.
  const queued = await store.pendingMutations(PID, 10);
  const payloadOf = (entryId: string) =>
    queued.find((mutation) => mutation.targets[0] === entryId)?.payload as Record<string, unknown>;
  eq('명령에도 실적 제외가 실린다', payloadOf(excluded.id)?.countsPerformance, false);
  eq('명령에도 차감 실적 제외가 실린다', payloadOf(kept.id)?.discountCountsPerformance, false);

  // 실적 집계. 사본의 질의가 표를 읽어 같은 값을 낸다.
  const postings = await store.creditCardPostings('a-card');
  const { periods } = creditUsagePeriods({
    postings,
    statementClosingDay: CLOSING_DAY,
    paymentDueDay: 25,
    timeZone: KST,
    span: 1,
  });
  const current = periods[periods.length - 1];
  // 실적 = 정가 50,000 + 30,000. 세금은 빠지고, 차감 20,000 은 되살렸다.
  eq('실적은 표를 보고 센다', current.usage, '80000');
  // 청구 = 70,000 + 순액 30,000 + 30,000. 차감은 어느 쪽이든 청구에서 빠진다.
  eq('청구액은 깎인 금액 그대로', current.billed, '130000');

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
