/**
 * 거래내역 엑셀 가져오기·내보내기 (서버). 행을 거래로 옮기는 규칙은 `@money/types` 의
 * `entry-sheet-io` 이고, 기기 사본도 같은 함수를 쓴다.
 *
 *   1. 없는 구성원·결제수단·분류·태그를 만들고, 넣지 못할 행은 까닭과 함께 건너뛴다.
 *   2. 건너뛴 행은 아무것도 남기지 않는다 (먼저 전부 읽고 그다음에 만든다).
 *   3. 왕복: 가져오기 → 내보내기 → 다른 가계부에 가져오기 → 내보내기가 같다.
 *
 * 실행 (memory 의 api_smoke_scripts):
 *   cd packages/api && node -r <tsconfig-paths>/register.js -r ts-node/register/transpile-only \
 *     scripts/entry-sheet-smoke.ts
 */
import type { EntrySheetRow } from '@money/types';
import { EntrySheetService } from '@/modules/entry-sheet/entry-sheet.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeTags,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const ROWS: EntrySheetRow[] = [
  // 분할 지출 (거래ID 로 묶음), 새 신용카드·분류·태그
  { row: 2, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '30000', parentCategory: '식비', category: '저녁', payment: '신한 딥드림', paymentType: '신용카드', tags: '장보기, 저녁', person: '나' },
  { row: 3, group: 'a', date: '2026-09-02', time: '19:10', kind: '지출', amount: '15000', discount: '2000', parentCategory: '생활', payment: '신한 딥드림', person: '나' },
  // 외화 한 줄
  { row: 4, date: '2026-09-07', kind: '지출', amount: '49.99', currency: 'USD', billedAmount: '68900', parentCategory: '구독', payment: '신한 딥드림', merchant: 'Netflix', person: '나' },
  // 이체 + 수수료
  { row: 5, date: '2026.09.10 오후 2:05', kind: '이체', amount: '100000', payment: '월급통장', paymentType: '통장', toAsset: '비상금', toAssetType: '적금', fee: '500', person: '나' },
  // 카드대금
  { row: 6, date: '2026-09-14', kind: '카드대금', amount: '45000', payment: '월급통장', toAsset: '신한 딥드림', person: '나' },
  // 수입, 분류 비움 -> 기타수입
  { row: 7, date: '2026-09-25', kind: '수입', amount: '3,000,000원', payment: '월급통장', description: '월급', person: '나' },
  // 할부 신용카드
  { row: 8, date: '2026-09-26', kind: '지출', amount: '600000', parentCategory: '가전', payment: '신한 딥드림', installmentMonths: '3개월', person: '나' },
  // 건너뛸 것들
  { row: 9, date: '2026-09-27', kind: '잔액조정', amount: '1000', payment: '월급통장' },
  { row: 10, date: '2026-02-30', kind: '지출', amount: '1000', payment: '월급통장' },
  { row: 11, date: '2026-09-28', kind: '지출', amount: '1000', payment: '새 체크', paymentType: '체크카드', installmentMonths: '2', parentCategory: '남으면 안 되는 분류' },
];

runSmoke('entry-sheet', async (ctx) => {
  const user = await ctx.createUser();
  const uid = user.id;

  const serviceFor = (pid: string) => {
    const access = projectAccessStub(ctx.prisma, pid);
    const ledger = makeLedger(ctx.prisma, access);
    const institutions = new InstitutionsService(ctx.prisma as any, access);
    return new EntrySheetService(
      ctx.prisma as any,
      access as any,
      makeEntries(ctx.prisma, access, ledger) as any,
      makePeople(ctx.prisma, access) as any,
      makeAccounts(ctx.prisma, access, ledger, institutions) as any,
      makeCards(ctx.prisma, access, institutions) as any,
      makeCategories(ctx.prisma, access) as any,
      makeTags(ctx.prisma, access) as any,
      institutions as any,
    );
  };

  const first = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const sheet = serviceFor(first.id);
  const result = await sheet.import(uid, { rows: ROWS }, first.id);

  // ── 1. 만든 것과 건너뛴 것 ──
  ctx.check('만든 거래 (분할은 하나)', result.created, 6);
  ctx.check('건너뛴 묶음', result.skipped.map((row) => row.rows.join('+')).join(','), '9,10,11');
  ctx.check('잔액 조정은 가져오지 않는다', result.skipped[0]?.reason, '잔액 조정은 가져오지 않습니다.');
  ctx.check('달력에 없는 날', result.skipped[1]?.reason.includes('달력에 없는 날'), true);
  ctx.check('할부는 신용카드에만', result.skipped[2]?.reason, '할부는 신용카드 지출에만 적을 수 있습니다.');
  ctx.check('새 구성원', result.createdNames.people.join(','), '나');
  ctx.check('새 카드', result.createdNames.cards.join(','), '신한 딥드림');
  ctx.check('새 통장 (카드 결제 통장이 먼저)', result.createdNames.accounts.join(','), '신한 딥드림 결제 통장,월급통장,비상금');
  ctx.check('새 태그', result.createdNames.tags.join(','), '장보기,저녁');
  ctx.check('새 분류', result.createdNames.categories.join(','), '식비,식비 > 저녁,생활,구독,수수료,기타수입,가전');

  // ── 2. 건너뛴 행은 아무것도 남기지 않는다 ──
  ctx.check('할부 행의 체크카드는 만들지 않는다',
    await ctx.prisma.card.count({ where: { projectId: first.id, name: '새 체크' } }), 0);
  ctx.check('할부 행의 분류도 만들지 않는다',
    await ctx.prisma.category.count({ where: { projectId: first.id, name: '남으면 안 되는 분류' } }), 0);
  const credit = await ctx.prisma.card.findFirstOrThrow({ where: { projectId: first.id, name: '신한 딥드림' } });
  ctx.check('새 신용카드의 마감일·결제일', `${credit.statementClosingDay}/${credit.paymentDueDay}`, '31/14');

  // ── 3. 왕복 ──
  const exported = await sheet.export(uid, {}, first.id);
  const shape = (rows: EntrySheetRow[]) =>
    rows.map(({ group: _group, row: _row, ...rest }) => JSON.stringify(rest)).join('\n');
  ctx.check('내보낸 행 수 (분할은 줄마다)', exported.length, 7);
  ctx.check('행 번호는 머리글 다음부터', exported[0]?.row, 2);
  const split = exported.filter((row) => row.group === exported[0].group);
  ctx.check('분할은 같은 거래ID', split.length, 2);
  ctx.check('금액은 정가, 할인은 따로', split.map((row) => `${row.amount}/${row.discount ?? '-'}`).join(','), '30000/-,15000/2000');
  const foreign = exported.find((row) => row.currency === 'USD');
  ctx.check('외화는 원래 통화와 청구액', `${foreign?.amount} ${foreign?.billedAmount}`, '49.99 68900');
  const transfer = exported.find((row) => row.kind === '이체');
  ctx.check('이체의 수수료와 받는 자산 종류', `${transfer?.fee} ${transfer?.toAssetType}`, '500 적금');
  ctx.check('이체 시각 (오후 2:05)', transfer?.time, '14:05');
  ctx.check('할부 개월', exported.find((row) => row.parentCategory === '가전')?.installmentMonths, '3');

  const second = await ctx.createProject({ ledgerCurrency: 'KRW', timezone: 'Asia/Seoul' });
  const again = serviceFor(second.id);
  const reimported = await again.import(uid, { rows: exported }, second.id);
  ctx.check('다른 가계부에 다시 가져오면 전부 들어간다', `${reimported.created} ${reimported.skipped.length}`, '6 0');
  ctx.check('왕복 뒤 내보내기가 같다', shape(await again.export(uid, {}, second.id)), shape(exported));

  // 기간으로 자르기
  const september10 = await sheet.export(uid, { startDate: '2026-09-10', endDate: '2026-09-14' }, first.id);
  ctx.check('기간으로 자른 내보내기', september10.map((row) => row.kind).join(','), '이체,카드대금');
});
