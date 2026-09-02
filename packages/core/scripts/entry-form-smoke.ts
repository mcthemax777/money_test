/**
 * 거래 입력 폼 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/entry-form-smoke.ts [덤프.json]
 *
 * 두 가지를 본다.
 *
 *   1. **검증.** 저장할 수 없는 값을 여기서 먼저 거른다. 오프라인에는 서버가 없고, 규칙에
 *      어긋난 명령을 큐에 넣으면 영영 나가지 못하는 독이 된다.
 *   2. **왕복이 거래를 바꾸지 않는가.** 이것이 이 검사의 핵심이다. 있는 거래를 폼으로 열고
 *      아무것도 고치지 않은 채 저장하면 **같은 거래여야 한다.** 폼이 필드를 하나 흘리면
 *      금액은 그대로인데 분류나 수단이 바뀌고, 사용자는 알아챌 방법이 없다.
 *      api 의 `sync-push-dump` 가 떠 둔 실제 거래로 그 왕복을 돌려 본다.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'fs';
import {
  type EntryDto,
  type EntryListItem,
  type SyncDto,
  setRandomBytes,
} from '@money/types';

import {
  accountValue,
  cardValue,
  checkEntryForm,
  emptyEntryForm,
  entryFormFromItem,
  entryFormToRequest,
  parseMethod,
  type EntryFormValues,
} from '../src/data/entry-form';
import { createLocalEntryWriter } from '../src/data/local-entry-writer';
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

let seed = 7;
setRandomBytes((count) => {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) bytes[i] = (seed = (seed * 1103515245 + 12345) % 256);
  return bytes;
});

const KST = 'Asia/Seoul';

/** 검증만 보는 최소 폼. 갈래마다 필요한 칸을 채워 둔다. */
const validExpense: EntryFormValues = {
  kind: 'expense',
  personId: 'p1',
  dateKey: '2026-08-20',
  timeKey: '12:00',
  description: '점심',
  amount: '9000',
  categoryId: 'c1',
  extraAmount: '',
  method: accountValue('a1'),
  toAccountId: '',
  installmentMonths: '',
  transferFee: '',
  transferFeeCategoryId: '',
};

const codeOf = (values: Partial<EntryFormValues>) =>
  checkEntryForm({ ...validExpense, ...values })?.code ?? null;

(async () => {
  // ── 1. 빈 폼 ──
  const empty = emptyEntryForm({ personId: 'p1', timeZone: KST, now: new Date('2026-08-20T03:00:00Z') });
  eq('빈 폼은 지출로 시작한다', empty.kind, 'expense');
  eq('기본 사람이 채워진다', empty.personId, 'p1');
  eq('프로젝트 타임존의 오늘', empty.dateKey, '2026-08-20');
  eq('그 타임존의 시각 (UTC 03시 = KST 12시)', empty.timeKey, '12:00');
  eq('과소비는 비어 있다 (분류 기본값을 따른다)', empty.extraAmount, '');

  // ── 2. 검증 ──
  eq('맞는 값은 통과', checkEntryForm(validExpense), null);
  eq('사람 없음', codeOf({ personId: '' }), 'PERSON_REQUIRED');
  eq('설명 없음', codeOf({ description: '  ' }), 'DESCRIPTION_REQUIRED');
  eq('금액 0', codeOf({ amount: '0' }), 'AMOUNT_INVALID');
  eq('금액 음수', codeOf({ amount: '-100' }), 'AMOUNT_INVALID');
  eq('금액이 숫자가 아니다', codeOf({ amount: '천원' }), 'AMOUNT_INVALID');
  eq('분류 없음', codeOf({ categoryId: '' }), 'CATEGORY_REQUIRED');
  eq('수단 없음', codeOf({ method: '' }), 'METHOD_REQUIRED');
  eq('수입은 통장이 필요하다',
    codeOf({ kind: 'income', method: cardValue('card1') }), 'ACCOUNT_REQUIRED');

  eq('날짜 모양', codeOf({ dateKey: '2026/08/20' }), 'DATE_INVALID');
  eq('없는 날 (2월 31일)', codeOf({ dateKey: '2026-02-31' }), 'DATE_INVALID');
  eq('윤년 2월 29일은 있다', codeOf({ dateKey: '2028-02-29' }), null);
  eq('평년 2월 29일은 없다', codeOf({ dateKey: '2026-02-29' }), 'DATE_INVALID');
  eq('시간 모양', codeOf({ timeKey: '25:00' }), 'TIME_INVALID');

  eq('과소비가 음수', codeOf({ extraAmount: '-1' }), 'EXTRA_INVALID');
  eq('과소비가 금액보다 크다', codeOf({ extraAmount: '9001' }), 'EXTRA_EXCEEDS_AMOUNT');
  eq('과소비 = 금액은 된다 (전액 과소비)', codeOf({ extraAmount: '9000' }), null);
  eq('과소비 0도 된다 (일반으로 세겠다는 뜻)', codeOf({ extraAmount: '0' }), null);

  const transfer: Partial<EntryFormValues> = {
    kind: 'transfer', categoryId: '', method: accountValue('a1'), toAccountId: 'a2',
  };
  eq('이체는 분류가 없어도 된다', codeOf(transfer), null);
  eq('받는 계좌 없음', codeOf({ ...transfer, toAccountId: '' }), 'TO_ACCOUNT_REQUIRED');
  eq('같은 계좌로 이체', codeOf({ ...transfer, toAccountId: 'a1' }), 'TRANSFER_SAME_ACCOUNT');
  eq('수수료만 있고 분류가 없다',
    codeOf({ ...transfer, transferFee: '1000' }), 'FEE_CATEGORY_REQUIRED');
  eq('수수료 0은 분류를 묻지 않는다', codeOf({ ...transfer, transferFee: '0' }), null);

  // ── 3. 폼 -> 요청 ──
  const request = entryFormToRequest(validExpense, KST);
  eq('KST 정오는 UTC 03시', request.date, '2026-08-20T03:00:00.000Z');
  eq('계좌가 실린다', request.accountId, 'a1');
  eq('카드는 실리지 않는다', request.cardId ?? null, null);
  eq('과소비를 정하지 않으면 키가 없다 (분류 기본값을 따른다)',
    'extraAmount' in request, false);
  eq('0을 적으면 실린다 (일반으로 세겠다는 선택)',
    entryFormToRequest({ ...validExpense, extraAmount: '0' }, KST).extraAmount, '0');

  const installment = entryFormToRequest(
    { ...validExpense, method: cardValue('card1'), installmentMonths: '3' },
    KST,
  );
  eq('할부가 실린다', installment.installmentMonths, 3);
  eq('통장 결제에는 할부가 없다',
    'installmentMonths' in entryFormToRequest({ ...validExpense, installmentMonths: '3' }, KST),
    false);

  const transferRequest = entryFormToRequest(
    { ...validExpense, ...transfer, transferFee: '1000', transferFeeCategoryId: 'c-fee' } as EntryFormValues,
    KST,
  );
  eq('이체는 두 계좌를 싣는다',
    `${transferRequest.accountId}->${transferRequest.toAccountId}`, 'a1->a2');
  eq('수수료와 분류가 함께 간다',
    `${transferRequest.transferFee}/${transferRequest.transferFeeCategoryId}`, '1000/c-fee');
  eq('수수료가 없으면 키가 없다',
    'transferFee' in entryFormToRequest({ ...validExpense, ...transfer } as EntryFormValues, KST),
    false);

  // ── 4. 왕복이 거래를 바꾸지 않는가 ──
  const dumpPath = process.argv[2] ?? '/tmp/sync-push-dump.json';
  if (!existsSync(dumpPath)) {
    console.log(`\n(건너뜀) 실제 거래 파일이 없다: ${dumpPath}`);
    console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
    process.exit(fail === 0 ? 0 : 1);
  }

  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as {
    base: SyncDto.PullResponse;
    server: { entries: EntryListItem[] };
  };

  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);
  const projectId = dump.base.projectId;
  await store.init(projectId, KST);
  await store.applyPull(dump.base, KST);
  await store.ensureClient(() => 'client-form-test');

  /*
   * 서버가 낸 거래를 사본에 넣는다.
   *
   * 덤프의 밑바탕(base)에는 명령을 돌리기 전 상태만 있어서, 왕복시킬 거래를 여기서 만든다.
   * 폼이 만든 요청으로 만드는 것이 아니라 서버가 낸 값을 그대로 재현해야 하므로, 각 거래의
   * 필드를 폼으로 되돌려 쓰는 것이 곧 이 검사다.
   */
  const writer = createLocalEntryWriter({ store, projectId, timeZone: KST });
  const port = createLocalHomePort(store, {
    fallback: Object.fromEntries(
      Object.keys(httpHomePort).map((name) => [
        name,
        async () => {
          throw new Error(`사본이 낼 수 있어야 한다: ${name}`);
        },
      ]),
    ) as unknown as typeof httpHomePort,
  });

  let checked = 0;
  let skipped = 0;
  let mismatch = 0;
  const compared = [
    'kind', 'description', 'amount', 'extraAmount', 'categoryId', 'accountId', 'toAccountId',
    'cardId', 'installmentMonths', 'feeAmount', 'feeCategoryId', 'personId', 'date',
  ] as const;

  for (const original of dump.server.entries) {
    const form = entryFormFromItem(original, KST);
    if (!form) {
      skipped += 1;
      continue;
    }

    // 폼을 그대로 저장한다. 아무것도 고치지 않았으니 같은 거래가 나와야 한다.
    const request = entryFormToRequest(form, KST) as EntryDto.CreateRequest;
    const { id } = await writer.createEntry({ ...request, id: `roundtrip-${original.id}` });

    const [rebuilt] = await port.getAllEntries(
      { startDate: '2000-01-01T00:00:00.000Z', endDate: '2100-01-01T00:00:00.000Z' },
      projectId,
    ).then((rows) => rows.filter((row) => row.id === id));

    if (!rebuilt) {
      mismatch += 1;
      console.log(`FAIL  왕복: 사본에 만들어지지 않았다 (${original.description})`);
      continue;
    }

    checked += 1;
    for (const field of compared) {
      const before = (original as Record<string, unknown>)[field];
      const after = (rebuilt as unknown as Record<string, unknown>)[field];
      if (String(before) !== String(after)) {
        mismatch += 1;
        console.log(`FAIL  왕복: ${original.description}.${field} (원래 ${before}, 저장 뒤 ${after})`);
      }
    }
  }

  eq('왕복을 돌린 거래가 있다', checked > 0, true);
  eq(`왕복: 필드 ${compared.length}개를 거래마다 대조`, mismatch, 0);

  /*
   * 분할 거래는 폼이 다루지 않는다.
   *
   * 폼은 분류 하나만 담으므로 되돌려 저장하면 나머지 줄이 사라진다. 그 손실을 막는 것이
   * splitCount 를 목록에 실은 이유다.
   */
  const split = dump.server.entries.find((row) => row.splitCount > 1);
  eq('덤프에 분할 거래가 있다', Boolean(split), true);
  eq('분할은 폼으로 열리지 않는다', split ? entryFormFromItem(split, KST) : 'no-sample', null);
  eq('건너뛴 거래가 있다 (분할)', skipped > 0, true);

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
void DatabaseSync;
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
