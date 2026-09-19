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
  newSplitLine,
  parseMethod,
  type EntryFormValues,
} from '../src/data/entry-form';
import { createLocalEntryWriter } from '../src/data/local-entry-writer';
import { httpHomePort } from '../src/data/home-port';
import { installmentShareInputs } from '../src/lib/period-ledger';
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
  // 줄 키는 화면이 만든다. 검증만 보는 폼에도 있어야 저장 요청이 만들어진다.
  lineKey: 'line-1',
  personId: 'p1',
  dateKey: '2026-08-20',
  timeKey: '12:00',
  description: '점심',
  amount: '9000',
  categoryId: 'c1',
  method: accountValue('a1'),
  toAccountId: '',
  installmentMonths: '',
  installmentInterest: '',
  installmentShares: [],
  discountAmount: '',
  countsPerformance: true,
  discountCountsPerformance: true,
  transferFee: '',
  transferFeeCategoryId: '',
  splits: [],
  currency: '',
  exchangeRate: '',
  tagIds: [],
  // 새로 적는 폼과 같다. 딛고 선 판이 없다는 뜻이라, 저장은 수정이 아니라 생성으로 간다.
  baseHlc: null,
};

/** 신용카드 부채 계정. 이체 양쪽이 다 카드인지 가리는 검사가 이 목록을 본다. */
const CARD_LIABILITY = new Set(['k1', 'k2']);

const codeOf = (values: Partial<EntryFormValues>) =>
  checkEntryForm({ ...validExpense, ...values }, CARD_LIABILITY)?.code ?? null;

(async () => {
  // ── 1. 빈 폼 ──
  const empty = emptyEntryForm({ personId: 'p1', timeZone: KST, now: new Date('2026-08-20T03:00:00Z') });
  eq('빈 폼은 지출로 시작한다', empty.kind, 'expense');
  eq('기본 사람이 채워진다', empty.personId, 'p1');
  eq('프로젝트 타임존의 오늘', empty.dateKey, '2026-08-20');
  eq('그 타임존의 시각 (UTC 03시 = KST 12시)', empty.timeKey, '12:00');

  // ── 2. 검증 ──
  eq('맞는 값은 통과', checkEntryForm(validExpense, CARD_LIABILITY), null);
  eq('사람 없음', codeOf({ personId: '' }), 'PERSON_REQUIRED');
  /*
   * 설명은 묻지 않는다. 웹과 서버가 처음부터 빈 설명을 받아들였고 목록도 그때를
   * 대비해 그린다 (분류가 그 줄의 이름이 된다). 여기서만 막으면 같은 거래를 웹에서는
   * 적을 수 있고 앱에서는 적을 수 없다.
   */
  eq('설명은 비어도 통과', codeOf({ description: '  ' }), null);
  eq('금액 0', codeOf({ amount: '0' }), 'AMOUNT_INVALID');
  eq('금액 음수', codeOf({ amount: '-100' }), 'AMOUNT_INVALID');
  eq('금액이 숫자가 아니다', codeOf({ amount: '천원' }), 'AMOUNT_INVALID');
  eq('분류 없음', codeOf({ categoryId: '' }), 'CATEGORY_REQUIRED');
  eq('수단 없음', codeOf({ method: '' }), 'METHOD_REQUIRED');
  /*
   * 수입에도 카드를 고른다. 카드사가 되돌려 주는 돈은 통장을 거치지 않고 다음 청구에서
   * 빠지므로, 들어오는 자리가 통장이 아니라 그 카드의 빚이다.
   */
  eq('수입도 카드로 받을 수 있다',
    codeOf({ kind: 'income', method: cardValue('card1') }), null);

  // 차감·취소. 지출에만 붙는다.
  eq('차감이 0이면 막는다', codeOf({ discountAmount: '0' }), 'DISCOUNT_INVALID');
  eq('차감이 숫자가 아니다', codeOf({ discountAmount: '삼천' }), 'DISCOUNT_INVALID');
  eq('차감이 정가보다 크다', codeOf({ discountAmount: '9001' }), 'DISCOUNT_TOO_LARGE');
  // 전액을 깎으면 0원 거래로 남는다. 전액 취소와 전액 포인트 결제가 그 모양이다.
  eq('차감이 정가와 같아도 된다', codeOf({ discountAmount: '9000' }), null);

  eq('날짜 모양', codeOf({ dateKey: '2026/08/20' }), 'DATE_INVALID');
  eq('없는 날 (2월 31일)', codeOf({ dateKey: '2026-02-31' }), 'DATE_INVALID');
  eq('윤년 2월 29일은 있다', codeOf({ dateKey: '2028-02-29' }), null);
  eq('평년 2월 29일은 없다', codeOf({ dateKey: '2026-02-29' }), 'DATE_INVALID');
  eq('시간 모양', codeOf({ timeKey: '25:00' }), 'TIME_INVALID');

  const transfer: Partial<EntryFormValues> = {
    kind: 'transfer', categoryId: '', method: accountValue('a1'), toAccountId: 'a2',
  };
  eq('이체는 분류가 없어도 된다', codeOf(transfer), null);
  eq('보내는 계좌 없음', codeOf({ ...transfer, method: '' }), 'FROM_ACCOUNT_REQUIRED');
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
  const installment = entryFormToRequest(
    {
      ...validExpense,
      method: cardValue('card1'),
      installmentMonths: '3',
      installmentInterest: 'interest',
    },
    KST,
  );
  eq('할부가 실린다', installment.installmentMonths, 3);
  eq('유이자가 실린다', installment.installmentInterest, true);
  // 고른 값 그대로다. 무이자를 골랐으면 false 가 실려 서버가 계획에 적는다.
  eq(
    '무이자도 실린다',
    entryFormToRequest(
      { ...validExpense, method: cardValue('card1'), installmentMonths: '3', installmentInterest: 'free' },
      KST,
    ).installmentInterest,
    false,
  );
  // 할부를 골랐는데 종류를 고르지 않으면 저장이 막힌다.
  eq(
    '할부 종류를 고르지 않으면 막는다',
    checkEntryForm({
      ...validExpense,
      method: cardValue('card1'),
      installmentMonths: '3',
    })?.code,
    'INSTALLMENT_INTEREST_REQUIRED',
  );
  eq(
    '일시불에는 묻지 않는다',
    checkEntryForm({ ...validExpense, method: cardValue('card1') }),
    null,
  );

  /*
   * 회차 금액. 끝수를 어디에 붙이는지가 카드사마다 달라 사람이 고쳐 적는다.
   * 값 자체는 손대지 않고 개수와 합만 본다.
   */
  const withShares = (shares: string[]) => ({
    ...validExpense,
    amount: '1000',
    method: cardValue('card1'),
    installmentMonths: '3',
    installmentInterest: 'free' as const,
    installmentShares: shares,
  });
  eq('적어 둔 회차가 실린다',
    entryFormToRequest(withShares(['334', '334', '332']), KST).installmentShares?.join(','),
    '334,334,332');
  eq('비워 두면 싣지 않는다',
    'installmentShares' in entryFormToRequest(withShares([]), KST),
    false);
  eq('합이 다르면 막는다',
    checkEntryForm(withShares(['334', '334', '333']))?.code,
    'INSTALLMENT_SHARES_SUM');
  eq('개수가 다르면 막는다',
    checkEntryForm(withShares(['500', '500']))?.code,
    'INSTALLMENT_SHARES_COUNT');
  eq('맞으면 통과', checkEntryForm(withShares(['334', '334', '332'])), null);

  /*
   * 치는 중의 빈 칸. 한 칸을 지운 순간이 곧 이 모양이다.
   *
   * 예전에는 화면이 이 값을 십진값으로 읽으려다 넘어졌고(RangeError), 검증은 "0보다
   * 작을 수 없습니다"라는 엉뚱한 말을 냈다. 빈 칸은 0 으로 보고 합계로 막는다.
   */
  eq('빈 칸이 있어도 칸은 그대로 그린다',
    installmentShareInputs('1000', 3, ['334', '', '332']).join('|'), '334||332');
  eq('개수가 어긋나면 기본 분할을 보여 준다',
    installmentShareInputs('1000', 3, ['500', '500']).join('|'), '334|333|333');
  eq('한 칸을 비우면 합계로 막는다',
    checkEntryForm(withShares(['334', '', '332']))?.code, 'INSTALLMENT_SHARES_SUM');
  eq('비운 칸은 0 으로 실린다',
    entryFormToRequest(withShares(['334', '', '666']), KST).installmentShares?.join(','),
    '334,0,666');
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

  // ── 3-2. 분할·외화·카드사 대금 이동 ──
  //
  // 셋 다 예전에는 이 폼이 다루지 못해 "웹에서 고쳐 주세요"로 돌려보내던 갈래다.

  const splitForm = {
    ...validExpense,
    amount: '10000',
    splits: [
      newSplitLine({ categoryId: 'c-food', amount: '7000' }),
      newSplitLine({ categoryId: 'c-fun', amount: '3000' }),
    ],
  } as EntryFormValues;

  eq('합이 맞으면 통과', codeOf(splitForm), null);
  eq('합이 어긋나면 막는다',
    codeOf({ ...splitForm, amount: '9000' }), 'SPLIT_SUM_MISMATCH');
  eq('줄에 분류가 없다',
    codeOf({ ...splitForm, splits: [newSplitLine({ categoryId: '', amount: '10000' })] }),
    'SPLIT_CATEGORY_REQUIRED');
  eq('줄 금액이 0이다',
    codeOf({ ...splitForm, splits: [newSplitLine({ categoryId: 'c1', amount: '0' })] }),
    'SPLIT_AMOUNT_INVALID');

  const splitRequest = entryFormToRequest(splitForm, KST);
  eq('분할이 실린다', splitRequest.splits?.length, 2);
  eq('줄 금액이 그대로다',
    splitRequest.splits?.map((row) => row.amount).join(','), '7000,3000');
  eq('분할이면 대표 분류를 싣지 않는다', 'categoryId' in splitRequest, false);

  // 외화
  const foreign = { ...validExpense, currency: 'USD', exchangeRate: '1385.2' } as EntryFormValues;
  eq('통화를 골랐는데 환율이 없다',
    codeOf({ ...foreign, exchangeRate: '' }), 'RATE_INVALID');
  eq('환율이 0이면 막는다', codeOf({ ...foreign, exchangeRate: '0' }), 'RATE_INVALID');
  eq('통화와 환율이 있으면 통과', codeOf(foreign), null);

  const foreignRequest = entryFormToRequest(foreign, KST);
  eq('통화가 실린다', foreignRequest.currency, 'USD');
  eq('환율이 함께 간다', foreignRequest.exchangeRate, '1385.2');
  eq('기준통화면 통화 키가 없다', 'currency' in entryFormToRequest(validExpense, KST), false);

  /*
   * 카드대금 결제는 따로 된 갈래가 아니라 **이체**다.
   *
   * 이체의 계좌 목록에 신용카드의 부채 계정이 끼어 있고, 그리로 보내면 목록이 그 전표를
   * 카드대금으로 되읽는다(`classifyEntry`). 앱에만 있던 네 번째 탭을 걷어낸 자리다.
   */
  const cardTransfer: Partial<EntryFormValues> = {
    kind: 'transfer',
    categoryId: '',
    method: accountValue('a1'),
    toAccountId: 'k1',
  };
  eq('통장에서 카드로 보내면 통과', codeOf(cardTransfer), null);
  /*
   * 양쪽이 다 카드인 이동은 받지 않는다. 목록이 "어느 카드의 대금인가"를 하나로 정해야
   * 해서 어느 쪽을 골라도 반쪽만 보인다 (조립도 TRANSFER_BOTH_CARDS 로 막는다).
   */
  eq('양쪽이 다 카드면 막는다',
    codeOf({ ...cardTransfer, method: accountValue('k2') }), 'TRANSFER_BOTH_CARDS');

  const cardRequest = entryFormToRequest(
    { ...validExpense, ...cardTransfer } as EntryFormValues,
    KST,
  );
  eq('갈래는 이체로 나간다', cardRequest.kind, 'transfer');
  eq('두 계좌를 싣는다',
    `${cardRequest.accountId}->${cardRequest.toAccountId}`, 'a1->k1');
  eq('카드 키는 싣지 않는다', 'cardId' in cardRequest, false);

  // ── 3-3. 실적 표 둘 ──
  //
  // 카드로 냈고 **기본값과 다를 때만** 싣는다. 짐만 보고도 사용자가 손댄 자리가 드러난다.
  const cardExpense = { ...validExpense, method: cardValue('card1') } as EntryFormValues;
  eq('기본값이면 싣지 않는다',
    'countsPerformance' in entryFormToRequest(cardExpense, KST), false);
  eq('실적에서 빼면 실린다',
    entryFormToRequest({ ...cardExpense, countsPerformance: false }, KST).countsPerformance,
    false);
  eq('통장 결제에는 싣지 않는다',
    'countsPerformance' in entryFormToRequest({ ...validExpense, countsPerformance: false }, KST),
    false);

  /*
   * 차감 실적 제외는 **그 칸이 화면에 떠 있었을 때만** 싣는다 (`showDiscountPerformance`).
   * 보여 주지 않은 값을 실어 보내면 사용자가 볼 수 없는 값을 거래가 들고 다닌다.
   */
  const discounted = {
    ...cardExpense,
    discountAmount: '2000',
    discountCountsPerformance: false,
  } as EntryFormValues;
  eq('차감을 적고 끄면 실린다',
    entryFormToRequest(discounted, KST).discountCountsPerformance, false);
  eq('차감이 없으면 싣지 않는다',
    'discountCountsPerformance' in
      entryFormToRequest({ ...cardExpense, discountCountsPerformance: false }, KST),
    false);
  eq('거래를 실적에서 뺐으면 싣지 않는다',
    'discountCountsPerformance' in
      entryFormToRequest({ ...discounted, countsPerformance: false }, KST),
    false);
  // 외화는 집계가 차감을 되살릴 수 없다. 차감액의 통화가 카드 다리와 다르기 때문이다.
  eq('외화로 적었으면 싣지 않는다',
    'discountCountsPerformance' in
      entryFormToRequest({ ...discounted, currency: 'USD', exchangeRate: '1385.2' }, KST),
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
    'kind', 'description', 'amount', 'categoryId', 'accountId', 'toAccountId',
    'cardId', 'installmentMonths', 'installmentInterest', 'feeAmount', 'feeCategoryId',
    'personId', 'date',
    /*
     * 분류 다리 수. **이 한 줄이 분할 손실을 잡는다.**
     *
     * 나머지 필드는 대표 분류 하나만 보므로, 분할의 둘째 줄이 사라져도 전부 같게 나온다.
     * 금액은 그대로이고 분류별 합계만 어긋나는, 알아채기 어려운 손실이다.
     */
    'splitCount',
    // 외화. 원 통화 금액과 통화가 그대로 남는지 본다.
    'originalCurrency', 'originalAmount',
    /*
     * 차감과 실적 표 둘. 앱의 사본 창구가 이 값들을 짐에 담지 않아 조용히 사라진 적이
     * 있다 (2026-09-17 의 countsPerformance). 왕복에서 그 손실이 드러난다.
     */
    'discountAmount', 'countsPerformance', 'discountCountsPerformance',
    // 카드사 대금 이동의 방향. 놓치면 결제와 환불이 뒤집힌다.
    'cardTransferDirection',
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
      const before = (original as unknown as Record<string, unknown>)[field];
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
   * 분할 거래가 줄까지 그대로 되살아나는가.
   *
   * 위의 왕복 대조는 목록 한 줄의 필드만 본다. 분할은 그 줄에 대표 분류 하나만 실려서,
   * **나머지 줄이 사라져도 그 대조는 통과한다.** 그래서 줄 수와 줄마다의 금액을 따로 본다.
   */
  const split = dump.server.entries.find((row) => row.splitCount > 1);
  eq('덤프에 분할 거래가 있다', Boolean(split), true);

  const splitBack = split ? entryFormFromItem(split, KST) : null;
  eq('분할도 폼으로 열린다', Boolean(splitBack), true);
  eq('줄 수가 그대로다', splitBack?.splits.length, split?.splitCount);
  eq('줄 금액이 그대로다',
    splitBack?.splits.map((row) => row.amount).join(','),
    (split?.lines ?? []).map((row) => row.amount).join(','));
  eq('줄 키가 그대로 이어진다',
    splitBack?.splits.map((row) => row.lineKey).join(','),
    (split?.lines ?? []).map((row) => row.lineKey).join(','));
  eq('줄 합이 전체 금액과 같다', splitBack ? checkEntryForm(splitBack)?.code ?? null : 'no-sample', null);

  /*
   * 줄이 여럿인데 줄 목록이 덜 실려 오면 열지 않는다.
   *
   * 그때 대표 분류 하나로 열어 저장하면 나머지가 조용히 사라진다.
   */
  eq('줄이 여럿인데 줄 목록이 비면 열지 않는다',
    split ? entryFormFromItem({ ...split, lines: [] }, KST) : 'no-sample', null);

  eq('건너뛴 거래는 없다 (넷 다 다룬다)', skipped, 0);

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
