/**
 * 거래내역 엑셀 파일 읽기·쓰기 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/entry-sheet-smoke.ts
 */
import * as XLSX from 'xlsx';
import { entrySheetRowsOf, sheetAmountOf, type EntrySheetRow, type ViewEntry } from '@money/types';

import {
  chunkEntrySheetRows,
  countEntrySheetEntries,
  readEntrySheet,
  writeEntrySheet,
} from '../src/lib/entry-sheet';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)})`);
}

// 1. 쓰고 다시 읽으면 같다 -------------------------------------------------
const rows: EntrySheetRow[] = [
  { row: 2, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '30000', parentCategory: '식비', category: '저녁', payment: '신한 딥드림', paymentType: '신용카드', tags: '장보기, 저녁' },
  { row: 3, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '15000', discount: '2000', parentCategory: '생활', payment: '신한 딥드림' },
  { row: 4, group: 'b', date: '2026-09-07', kind: '지출', amount: '49.99', currency: 'USD', billedAmount: '68900', parentCategory: '구독', payment: '신한 딥드림', merchant: 'Netflix' },
];
const buffer = writeEntrySheet(rows, 'array');
const back = readEntrySheet(buffer);
eq('행 수', back.rows.length, 3);
eq('빠진 열 없음', back.missing, []);
eq('무시한 머리글 없음', back.ignoredHeaders, []);
eq('그대로 돌아옴', back.rows, rows);
eq('base64 로도 읽힘', readEntrySheet(writeEntrySheet(rows, 'base64')).rows, rows);

// 2. 금액 열은 숫자 칸 --------------------------------------------------------
const written = XLSX.read(buffer, { type: 'array' }).Sheets['거래내역'];
eq('금액 칸의 형', written.E2?.t, 'n');
eq('날짜 칸은 글자', written.B2?.t, 's');

// 3. 남이 만든 엑셀: 별칭 머리글 + 날짜 서식 칸 + 빈 줄 ------------------------
const foreign = XLSX.utils.aoa_to_sheet([
  ['일자', '적요', '이용금액', '카테고리', '비고란'],
  [new Date(Date.UTC(2026, 8, 30, 14, 5)), '스타벅스', 4500, '카페', 'x'],
  ['', '', '', '', ''],
  ['2026.09.29', '점심', '12,000', '식비', ''],
]);
// 날짜 칸에 날짜 서식을 준다(엑셀에서 저장한 파일처럼).
foreign.A2 = { t: 'n', v: 46295 + (14 * 60 + 5) / 1440, z: 'yyyy-mm-dd hh:mm' };
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, foreign, 'Sheet1');
const foreignRead = readEntrySheet(XLSX.write(book, { bookType: 'xlsx', type: 'array' }));
eq('별칭으로 알아본 열', foreignRead.columns, ['date', 'description', 'amount', 'parentCategory']);
eq('모르는 머리글', foreignRead.ignoredHeaders, ['비고란']);
eq('빈 줄 건너뜀', foreignRead.rows.length, 2);
eq('날짜 서식 칸 → 글자 (시간대 밀림 없음)', foreignRead.rows[0].date, '2026-09-30 14:05');
eq('글자 날짜는 그대로', foreignRead.rows[1].date, '2026.09.29');
eq('행 번호는 엑셀 번호', foreignRead.rows.map((row) => row.row), [2, 4]);

// 4. 빠진 필수 열 ------------------------------------------------------------
const noAmount = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(noAmount, XLSX.utils.aoa_to_sheet([['날짜', '내용'], ['2026-09-30', 'x']]), 'S');
eq('금액 열이 없음', readEntrySheet(XLSX.write(noAmount, { bookType: 'xlsx', type: 'array' })).missing, ['금액']);

// 5. 나눠 보내기는 분할 거래를 쪼개지 않는다 ------------------------------------
const many: EntrySheetRow[] = [];
for (let i = 0; i < 5; i += 1) many.push({ row: i + 2, amount: '1', date: '2026-09-01' });
many.push({ row: 7, group: 'g', amount: '1', date: '2026-09-01' }, { row: 8, group: 'g', amount: '1', date: '2026-09-01' });
many.push({ row: 9, amount: '1', date: '2026-09-01' }, { row: 10, group: 'g', amount: '1', date: '2026-09-01' });
const chunks = chunkEntrySheetRows(many, 6);
eq('묶음 크기', chunks.map((chunk) => chunk.length), [5, 4]);
eq('같은 거래ID 는 한 묶음', chunks[1].filter((row) => row.group === 'g').length, 3);
eq('거래 수 (분할은 하나)', countEntrySheetEntries(many), 7);

// 6. 외화 통장 거래는 그 통장 통화로 내보낸다 ----------------------------------------
// 원화 장부의 달러 통장에서 $50 (식비 $30 + 생활 $20, 생활에서 $2 차감)를 썼다. 분류 다리는 장부 통화(원)다.
const leg = (over: Partial<ViewEntry['postings'][number]>): ViewEntry['postings'][number] => ({
  id: Math.random().toString(36).slice(2),
  accountId: null,
  categoryId: null,
  amount: '0',
  currency: 'KRW',
  exchangeRate: '1',
  baseAmount: '0',
  cardId: null,
  lineKey: null,
  account: null,
  category: null,
  card: null,
  installmentPlan: null,
  ...over,
});
const usdEntry = {
  id: 'usd-1',
  date: '2026-09-10T03:00:00.000Z',
  description: '여행 경비',
  merchant: null,
  detailedNote: null,
  personId: null,
  person: null,
  originalCurrency: null,
  originalAmount: null,
  rateProvisional: false,
  countsPerformance: true,
  discountCountsPerformance: true,
  tags: [],
  postings: [
    leg({ accountId: 'usd', amount: '-48', currency: 'USD', exchangeRate: '1400', baseAmount: '-67200', account: { id: 'usd', name: '달러 통장', type: 'deposit' } }),
    leg({ categoryId: 'food', lineKey: 'l1', amount: '42000', baseAmount: '42000', category: { id: 'food', name: '식비', type: 'expense', parentId: null, parent: null } }),
    leg({ categoryId: 'life', lineKey: 'l2', amount: '25200', baseAmount: '25200', discountAmount: '2', category: { id: 'life', name: '생활', type: 'expense', parentId: null, parent: null } }),
  ],
} as unknown as ViewEntry;
const usdRows = entrySheetRowsOf(usdEntry, 'Asia/Seoul', new Map());
eq('외화 통장: 통장 통화로 적는다', usdRows.map((row) => row.currency), ['USD', 'USD']);
eq('외화 통장: 줄마다 그 통화 정가', usdRows.map((row) => row.amount), ['30', '20']);

// 6-2. 외화 통장에서 보낸 이체는 그 통화로 (금액과 수수료) ------------------------------------
// $50 를 원화 통장으로 보내며 수수료 $1. 나간 다리는 $51, 수수료 다리는 보낸 통화 그대로 적힌다.
const usdTransfer = {
  ...usdEntry,
  id: 'usd-transfer',
  postings: [
    leg({ accountId: 'usd', amount: '-51', currency: 'USD', exchangeRate: '1400', baseAmount: '-71400', account: { id: 'usd', name: '달러 통장', type: 'deposit' } }),
    leg({ accountId: 'krw', amount: '70000', currency: 'KRW', exchangeRate: '1', baseAmount: '70000', account: { id: 'krw', name: '원화 통장', type: 'deposit' } }),
    leg({ categoryId: 'fee', lineKey: 'f1', amount: '1', currency: 'USD', exchangeRate: '1400', baseAmount: '1400', category: { id: 'fee', name: '수수료', type: 'expense', parentId: null, parent: null } }),
  ],
} as unknown as ViewEntry;
const transferRow = entrySheetRowsOf(usdTransfer, 'Asia/Seoul', new Map())[0];
eq('외화 이체: 보낸 통화의 금액', `${transferRow.amount} ${transferRow.currency}`, '50 USD');
eq('외화 이체: 수수료도 그 통화', transferRow.fee, '1');

// 7. 금액 칸의 쉼표와 점 ---------------------------------------------------------
const amountOrError = (text: string) => {
  try {
    return sheetAmountOf(text);
  } catch {
    return 'error';
  }
};
eq('천 단위 쉼표', amountOrError('1,234,000원'), '1234000');
eq('쉼표와 소수점', amountOrError('1,234.56'), '1234.56');
eq('유럽식', amountOrError('1.234,56'), '1234.56');
eq('유럽식 천 단위', amountOrError('1.234.000'), '1234000');
eq('애매한 쉼표는 거절', amountOrError('1,5'), 'error');
eq('US$ 앞붙이', amountOrError('US$12'), '12');
eq('괄호 음수', amountOrError('(1,000)'), '1000');

console.log(fail === 0 ? '\n모두 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
