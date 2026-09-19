/**
 * 사본에서 본 **형태** 검색 (분할·할부).
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/entry-feature-mirror-smoke.ts
 *
 * 조건을 만드는 일은 서버가 Prisma 로, 기기가 SQL 로 각자 한다. 두 벌이면 같은 검색이
 * 온라인과 오프라인에서 다른 목록을 낸다. 서버 쪽은 `api/scripts/entry-feature-smoke.ts`
 * 가 같은 네 갈래로 같은 것을 확인한다 -- 여기는 그 짝이다.
 *
 *   보통 결제      분류 한 줄, 일시불   ← 어느 쪽에도 걸리면 안 된다
 *   분할 결제      분류 두 줄, 일시불
 *   할부 결제      분류 한 줄, 3개월
 *   분할한 할부    분류 두 줄, 6개월    ← 둘 다에 걸린다
 */
import type { SyncDto } from '@money/types';

import { httpHomePort } from '../src/data/home-port';
import { createLocalHomePort } from '../src/data/local-home-port';
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

/** 분류 다리 하나. 분할이면 이것이 여럿이다. */
const line = (entryId: string, index: number, categoryId: string, amount: string) => ({
  id: `${entryId}-cat${index}`,
  entryId,
  accountId: null,
  categoryId,
  amount,
  quantity: null,
  currency: 'KRW',
  baseAmount: amount,
  exchangeRate: '1',
  cardId: null,
  lineKey: `${entryId}-line${index}`,
});

/** 돈이 나간 다리. 카드로 낸 것이면 cardId 가 붙는다. */
const paid = (entryId: string, accountId: string, amount: string, cardId: string | null) => ({
  id: `${entryId}-acc`,
  entryId,
  accountId,
  categoryId: null,
  amount: `-${amount}`,
  quantity: null,
  currency: 'KRW',
  baseAmount: `-${amount}`,
  exchangeRate: '1',
  cardId,
});

const entry = (
  id: string,
  description: string,
  day: number,
  postings: unknown[],
) => ({
  id,
  projectId: PID,
  personId: 'p1',
  date: `2026-08-${String(day).padStart(2, '0')}T03:00:00.000Z`,
  description,
  merchant: null,
  detailedNote: null,
  originalCurrency: null,
  originalAmount: null,
  rateProvisional: false,
  createdByUserId: null,
  updatedVersion: 1,
  tagLinks: [] as Array<{ lineKey: string | null; tagId: string }>,
  postings,
});

(async () => {
  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);
  await store.init(PID, KST);

  const response: SyncDto.PullResponse = {
    projectId: PID,
    since: 0,
    version: 1,
    hasMore: false,
    tombstones: [],
    tombstoneFloor: 0,
    changes: {
      project: {
        id: PID,
        name: '우리집',
        projectKey: null,
        description: null,
        ledgerCurrency: 'KRW',
        displayCurrency: 'KRW',
        timezone: KST,
        updatedVersion: 1,
      },
      members: [],
      people: [
        {
          id: 'p1', projectId: PID, name: '김철수', relationship: null,
          isActive: true, sortOrder: 0, updatedVersion: 1,
        },
      ],
      accounts: [
        {
          id: 'a1', projectId: PID, ownerId: 'p1', type: 'deposit', name: '보통예금',
          institutionId: null, accountNumber: null, currency: 'KRW', balance: '0',
          isActive: true, sortOrder: 0, updatedVersion: 1,
        },
        {
          id: 'a2', projectId: PID, ownerId: 'p1', type: 'credit_card', name: '신한 신용',
          institutionId: null, accountNumber: null, currency: 'KRW', balance: '0',
          isActive: true, sortOrder: 1, updatedVersion: 1,
        },
      ],
      categories: [
        {
          id: 'c-dining', projectId: PID, name: '식비', parentId: null, type: 'expense',
          icon: null, isDefault: false, isActive: true, sortOrder: 0, updatedVersion: 1,
        },
        {
          id: 'c-utility', projectId: PID, name: '공과금', parentId: null, type: 'expense',
          icon: null, isDefault: false, isActive: true, sortOrder: 1, updatedVersion: 1,
        },
      ],
      tags: [],
      cards: [
        {
          id: 'card-1', projectId: PID, paymentAccountId: 'a1', liabilityAccountId: 'a2',
          name: '신한 신용', cardType: 'credit', issuerId: null, cardNumber: null,
          statementClosingDay: 15, paymentDueDay: 25, color: null,
          isActive: true, sortOrder: 0, updatedVersion: 1,
        },
      ],
      entries: [
        entry('e-plain', '보통 결제', 5, [
          line('e-plain', 1, 'c-dining', '10000'),
          paid('e-plain', 'a1', '10000', null),
        ]),
        entry('e-split', '나눠 적은 결제', 6, [
          line('e-split', 1, 'c-dining', '12000'),
          line('e-split', 2, 'c-utility', '8000'),
          paid('e-split', 'a1', '20000', null),
        ]),
        entry('e-install', '3개월 할부', 7, [
          line('e-install', 1, 'c-dining', '90000'),
          paid('e-install', 'a2', '90000', 'card-1'),
        ]),
        entry('e-both', '나눠 적은 할부', 8, [
          line('e-both', 1, 'c-dining', '40000'),
          line('e-both', 2, 'c-utility', '20000'),
          paid('e-both', 'a2', '60000', 'card-1'),
        ]),
      ],
      budgets: [],
      budgetOverrides: [],
      exchangeRates: [],
      assetValuations: [],
      /*
       * 할부 계획은 **카드 다리에 붙는다.** 전표가 아니다 -- 그래서 조건도 다리를
       * 거쳐 전표를 찾는 모양이 된다.
       */
      installmentPlans: [
        { id: 'plan-1', postingId: 'e-install-acc', totalMonths: 3, feeAmount: null, updatedVersion: 1 },
        { id: 'plan-2', postingId: 'e-both-acc', totalMonths: 6, feeAmount: null, updatedVersion: 1 },
      ],
      entryDrafts: [],
    } as unknown as SyncDto.Changes,
  };

  await store.applyPull(response, KST);

  /*
   * 폴백의 모든 창구가 던진다. 서버에 한 번이라도 물어보면 검사가 넘어진다 --
   * 이 검사의 요지는 사본의 SQL 이 같은 목록을 낸다는 것이다.
   */
  const port = createLocalHomePort(store, {
    fallback: Object.fromEntries(
      Object.keys(httpHomePort).map((name) => [
        name,
        async () => {
          throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
        },
      ]),
    ) as unknown as typeof httpHomePort,
  });
  const idsOf = async (features?: string) =>
    (
      await port.getAllEntries(
        { startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-31T23:59:59.999Z', features },
        PID,
      )
    )
      .map((row) => row.id)
      .sort()
      .join(',');

  // ── 1. 무리 하나씩 ──
  eq('분할만', await idsOf('split'), 'e-both,e-split');
  eq('할부만', await idsOf('installment'), 'e-both,e-install');

  /*
   * 분할 조건을 "분류 다리가 있는 전표"로 적으면 여기서 드러난다 -- 그러면 보통 결제가
   * 함께 걸려, 거르지 않은 목록이 걸러진 것처럼 보인다.
   */
  eq('보통 결제는 분할이 아니다', (await idsOf('split')).includes('e-plain'), false);
  eq('보통 결제는 할부가 아니다', (await idsOf('installment')).includes('e-plain'), false);

  // ── 2. 무리 안은 OR ──
  eq('분할 또는 할부', await idsOf('split,installment'), 'e-both,e-install,e-split');
  eq('형태를 고르지 않으면 전부', await idsOf(), 'e-both,e-install,e-plain,e-split');
  // 빈 값은 "아무것도 고르지 않음"이다 (다른 무리와 같은 규칙).
  eq('형태를 하나도 고르지 않으면 결과가 없다', await idsOf(''), '');

  // ── 3. 무리끼리는 AND ──
  const withCategory = await port.getAllEntries(
    {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.999Z',
      features: 'split',
      categoryIds: 'c-utility',
    },
    PID,
  );
  eq('분할 그리고 공과금', withCategory.map((row) => row.id).sort().join(','), 'e-both,e-split');

  const withAccount = await port.getAllEntries(
    {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.999Z',
      features: 'installment',
      paymentAccountIds: 'a1',
    },
    PID,
  );
  eq('할부 그리고 통장 (0건)', withAccount.length, 0);

  driver.close();
  console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
