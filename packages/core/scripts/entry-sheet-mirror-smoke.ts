/**
 * 엑셀 가져오기·내보내기를 기기 사본에서 (끊겨 있어도 된다).
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/entry-sheet-mirror-smoke.ts
 *
 *   1. 없는 구성원·통장·분류·태그를 사본 창구로 만들고, 거래는 거래 창구로 넣는다 -- 모두
 *      손으로 만들 때와 같은 오프라인 명령이다.
 *   2. 새 카드의 카드사를 정하지 못하면(끊김, 받아 둔 목록 없음) 그 행만 건너뛴다.
 *   3. 내보내기는 서버와 같은 함수로 편다. 다시 가져오면 같은 행이 나온다.
 */
import { setRandomBytes, type EntrySheetRow, type Mutation } from '@money/types';

import { setEntryWritePort } from '../src/data/entry-write-port';
import { createLocalEntrySheet } from '../src/data/local-entry-sheet';
import { createLocalEntryWriter } from '../src/data/local-entry-writer';
import { createLocalSettingsWriter } from '../src/data/local-settings-writer';
import { LocalStore } from '../src/data/local-store';
import { setSettingsWritePort } from '../src/data/settings-write-port';
import { apiClient } from '../src/lib/api-client';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

let seed = 11;
setRandomBytes((count) => {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) bytes[i] = (seed = (seed * 1103515245 + 12345) % 256);
  return bytes;
});

/** 끊긴 상태. 서버에 묻는 것은 모두 응답 없이 실패한다. */
const offline = () => Promise.reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }));
Object.assign(apiClient, { getInstitutions: offline, createInstitution: offline });

const PROJECT = 'p-sheet';
const TZ = 'Asia/Seoul';

const ROWS: EntrySheetRow[] = [
  { row: 2, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '30000', parentCategory: '식비', category: '저녁', payment: '월급통장', tags: '장보기, 저녁', person: '나' },
  { row: 3, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '15000', discount: '2000', parentCategory: '생활', payment: '월급통장', person: '나' },
  { row: 4, date: '2026.09.10 오후 2:05', kind: '이체', amount: '100000', payment: '월급통장', toAsset: '비상금', toAssetType: '적금', fee: '500', person: '나' },
  { row: 5, date: '2026-09-25', kind: '수입', amount: '3,000,000원', payment: '월급통장', description: '월급', person: '나' },
  { row: 6, date: '2026-09-26', kind: '지출', amount: '9000', parentCategory: '식비', category: '저녁', person: '나' },
  // 새 카드: 카드사를 정하지 못한다
  { row: 7, date: '2026-09-27', kind: '지출', amount: '1000', payment: '새 신용', paymentType: '신용카드', parentCategory: '식비', person: '나' },
];

(async () => {
  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);
  await store.init(PROJECT, TZ);
  await store.ensureClient(() => 'client-sheet');
  // 서버가 가계부마다 만들어 두고 pull 로 내려오는 숨은 미지정 계정 (결제수단을 비운 거래가 붙는다)
  await driver.run(
    `INSERT INTO account (id, projectId, type, name, currency) VALUES ('unassigned-1', ?, 'unassigned', '미지정', 'KRW')`,
    [PROJECT],
  );

  const queued: Mutation[] = [];
  const onQueued = (mutation: Mutation) => queued.push(mutation);
  setSettingsWritePort(createLocalSettingsWriter({ store, projectId: PROJECT, onQueued }));
  setEntryWritePort(createLocalEntryWriter({ store, projectId: PROJECT, timeZone: TZ, onQueued }));
  const sheet = createLocalEntrySheet(store, () => TZ);

  // ── 1. 가져오기 ──
  const result = await sheet.importRows(ROWS, PROJECT);
  eq('만든 거래 (분할은 하나)', result.created, 4);
  eq('건너뛴 행', result.skipped.map((row) => row.rows.join('+')).join(','), '7');
  eq('건너뛴 까닭', result.skipped[0]?.reason.includes('카드사를 정하지 못했습니다'), true);
  eq('새 구성원', result.createdNames.people.join(','), '나');
  eq('새 통장', result.createdNames.accounts.join(','), '월급통장,비상금');
  eq('새 분류', result.createdNames.categories.join(','), '식비,식비 > 저녁,생활,수수료,기타수입');
  eq('새 태그', result.createdNames.tags.join(','), '장보기,저녁');
  eq('카드는 만들지 않았다', (await store.cardRows(PROJECT)).length, 0);
  eq('카드 행의 결제 통장도 남기지 않는다',
    (await store.accounts(PROJECT)).some((account) => account.name.includes('결제 통장')), false);

  const kinds = queued.map((mutation) => mutation.kind);
  eq('거래는 거래 명령으로', kinds.filter((kind) => kind === 'entry.create').length, 4);
  eq('만든 것도 명령으로 (구성원 1, 통장 2, 분류 5, 태그 2)',
    ['person.create', 'account.create', 'category.create', 'tag.create'].map((kind) => kinds.filter((k) => k === kind).length).join(','),
    '1,2,5,2');
  eq('명령은 만들고 나서 거래 (같은 순번 차례)',
    kinds.indexOf('entry.create') > kinds.indexOf('person.create'), true);

  // ── 2. 다시 가져오면 이름으로 맞춘다 (새로 만들지 않는다) ──
  const again = await sheet.importRows([ROWS[4]], PROJECT);
  eq('있는 이름은 그대로 쓴다', `${again.created} ${again.createdNames.categories.length} ${again.createdNames.people.length}`, '1 0 0');

  // ── 3. 내보내기 ──
  const exported = await sheet.exportRows({}, PROJECT);
  eq('내보낸 행 수 (분할은 줄마다)', exported.length, 6);
  eq('오래된 것부터, 행 번호는 2부터', `${exported[0]?.date} ${exported[0]?.row}`, '2026-09-02 2');
  const split = exported.filter((row) => row.group === exported[0].group);
  eq('금액은 정가, 할인은 따로', split.map((row) => `${row.amount}/${row.discount ?? '-'}`).join(','), '30000/-,15000/2000');
  eq('분류 줄의 태그', split[0]?.tags, '장보기, 저녁');
  const transfer = exported.find((row) => row.kind === '이체');
  eq('이체의 수수료·받는 자산 종류·시각', `${transfer?.fee} ${transfer?.toAssetType} ${transfer?.time}`, '500 적금 14:05');
  const unassigned = exported.filter((row) => row.amount === '9000');
  eq('결제수단을 비운 지출은 비어 나간다', `${unassigned.length} ${unassigned.every((row) => !row.payment)}`, '2 true');
  eq('기간으로 자르기', (await sheet.exportRows({ startDate: '2026-09-10', endDate: '2026-09-25' }, PROJECT)).map((row) => row.kind).join(','), '이체,수입');
  const bad = await sheet.exportRows({ startDate: '2026/09/10' }, PROJECT).then(
    () => null,
    (error: { message: string }) => error.message,
  );
  eq('날짜 모양이 틀리면 거절', bad, 'ENTRY_SHEET_INVALID');

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
