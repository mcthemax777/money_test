/**
 * 유이자 할부의 회차 표.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/installment-schedule-smoke.ts
 *
 * 보는 것은 셋이다. 고정형이 앞 회차에 이자를 많이 물리는가, 변동형이 남은 원금만큼만
 * 이자를 매기는가, 그리고 **원금 합이 언제나 결제 금액과 같은가**. 합이 어긋나면
 * 저장이 막히므로 화면이 채워 주는 기본값은 그대로 저장될 수 있어야 한다.
 */
import type { EntryListItem } from '@money/types';
import {
  Dec,
  annualRateSchedule,
  fixedPaymentSchedule,
  freeSchedule,
  installmentLineShares,
  installmentEntryViews,
  installmentMonthShares,
  originalEntry,
  zonedDateKey,
  zonedMonthRange,
} from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

function sum(values: Dec[]): string {
  return values.reduce((acc, value) => acc.plus(value), Dec.of(0)).toString();
}

console.log('\n== 고정형: 10,000원 3개월, 매달 4,000원 ==');
const fixed = fixedPaymentSchedule(10000, 3, 4000);
if (!fixed) {
  fail += 1;
  console.log('FAIL  표가 만들어지지 않았다');
} else {
  console.log(
    fixed.principals
      .map((p, i) => `${i + 1}회차 원금 ${p} 이자 ${fixed.interests[i]}`)
      .join(' | '),
  );
  eq('원금 합은 결제 금액', sum(fixed.principals), '10000');
  eq('이자는 앞이 크다', fixed.interests[0].gt(fixed.interests[2]), true);
  eq('원금은 뒤가 크다', fixed.principals[2].gt(fixed.principals[0]), true);
  eq(
    '매달 내는 돈은 적은 값 그대로',
    fixed.principals[0].plus(fixed.interests[0]).toString(),
    '4000',
  );
}

console.log('\n== 고정형: 낼 돈의 합이 산 값에 못 미치면 표가 없다 ==');
eq('3,000원씩 3개월', fixedPaymentSchedule(10000, 3, 3000), null);
eq('합이 꼭 같으면 무이자와 같다', sum(fixedPaymentSchedule(9999, 3, 3333)!.interests), '0');

console.log('\n== 변동형: 1,200,000원 12개월, 연 12% ==');
const variable = annualRateSchedule(1200000, 12, 12);
if (!variable) {
  fail += 1;
  console.log('FAIL  표가 만들어지지 않았다');
} else {
  eq('원금은 고르게 나뉜다', variable.principals[0].toString(), '100000');
  eq('원금 합은 결제 금액', sum(variable.principals), '1200000');
  // 첫 회차는 원금 120만원에 월 1%, 마지막 회차는 10만원만 남았다.
  eq('1회차 이자', variable.interests[0].toString(), '12000');
  eq('12회차 이자', variable.interests[11].toString(), '1000');
}

console.log('\n== 변동형: 적어 둔 회차 원금을 딛는다 ==');
const edited = annualRateSchedule(1000, 3, 12, ['334', '334', '332']);
eq('적은 원금이 그대로', edited!.principals.map(String).join('/'), '334/334/332');
eq('2회차 이자는 남은 666원 기준', edited!.interests[1].toString(), '7');

console.log('\n== 무이자 ==');
const free = freeSchedule(10000, 3);
eq('이자는 전부 0', sum(free.interests), '0');
eq('원금은 끝수를 첫 회차에', free.principals.map(String).join('/'), '3334/3333/3333');

/*
 * 총액은 **이자를 품은 금액**이다. 전표 금액이 곧 카드에 갚을 돈이라, 회차 원금은
 * 여기서 이자 합(2,100)을 뺀 300,000을 나눈 값이어야 한다.
 */
console.log('\n== 달력 월로 펴기: 3월 1일 302,100원(원금 300,000 + 이자 2,100) 3개월 ==');
const spread = installmentMonthShares({
  date: '2026-03-01T03:00:00.000Z',
  total: 302100,
  months: 3,
  interests: ['1000', '700', '400'],
  timeZone: 'Asia/Seoul',
});
eq('1회차는 산 달', spread[0].yearMonth, '2026-03');
eq('3회차는 두 달 뒤', spread[2].yearMonth, '2026-05');
eq('회차 원금', spread.map((s) => s.principal).join('/'), '100000/100000/100000');
eq('회차 이자', spread.map((s) => s.interest).join('/'), '1000/700/400');
eq('회차 몫은 원금 + 이자', spread.map((s) => s.amount).join('/'), '101000/100700/100400');
eq(
  '회차 몫의 합은 전표 금액',
  spread.reduce((acc, s) => acc + Number(s.amount), 0),
  302100,
);

console.log('\n== 해를 넘긴다 ==');
eq(
  '11월에 산 3개월',
  installmentMonthShares({
    date: '2026-11-20T03:00:00.000Z',
    total: 30000,
    months: 3,
    timeZone: 'Asia/Seoul',
  })
    .map((s) => s.yearMonth)
    .join('/'),
  '2026-11/2026-12/2027-01',
);
eq(
  '이자를 적지 않았으면 0',
  installmentMonthShares({ date: '2026-03-01', total: 1000, months: 2, timeZone: 'Asia/Seoul' })
    .map((s) => s.interest)
    .join('/'),
  '0/0',
);

console.log('\n== 회차로 옮긴 거래 ==');
/*
 * 목록에 서는 것은 그 달의 회차 몫이지만, 눌러서 여는 것은 **사용자가 적은 거래**여야
 * 한다. 1회차를 눌렀는데 폼이 1회차 금액을 들면 그대로 저장하는 순간 할부가 한 달치
 * 금액으로 바뀐다.
 */
const item = {
  id: 'e1', kind: 'expense', date: '2026-03-01T03:00:00.000Z', description: '냉장고',
  merchant: null, tags: [], detailedNote: null, personId: 'p1', personName: '김',
  amount: '306000', discountAmount: null, splitCount: 1,
  lines: [{ lineKey: 'l1', categoryId: 'c1', categoryName: '가전', parentCategoryId: null,
    parentCategoryName: null, amount: '306000', discountAmount: null, tags: [], matched: true }],
  countsPerformance: true, discountCountsPerformance: true,
  categoryId: 'c1', categoryName: '가전', parentCategoryId: null, parentCategoryName: null,
  accountId: null, accountName: null, toAccountId: null, toAccountName: null,
  cardId: 'card1', cardName: '신한',
  installmentMonths: 3, installmentInterest: true, installmentShares: null,
  installmentInterestShares: ['3000', '2000', '1000'],
  installmentMonthlyPayment: null, installmentAnnualRate: null,
  feeAmount: null, feeCategoryId: null, feeCategoryName: null, cardTransferDirection: null,
  originalCurrency: null, originalAmount: null, exchangeRate: null, rateProvisional: false,
  updatedHlc: null,
} as unknown as EntryListItem;

/** 구간은 프로젝트 타임존의 달 경계다. 화면도 그 값을 넘긴다(`windowOf`). */
const monthWindow = (yearMonth: string) => {
  const { start, end } = zonedMonthRange(yearMonth, 'Asia/Seoul');
  return { timeZone: 'Asia/Seoul', from: start, to: end };
};

const firstMonth = installmentEntryViews([item], monthWindow('2026-03'))[0];
eq('1회차 몫은 원금 + 이자', firstMonth?.amount, '103000');
eq('줄 금액도 그 회차 몫', firstMonth?.lines[0]?.amount, '103000');
eq('회차 번호가 붙는다', `${firstMonth?.installment?.index}/${firstMonth?.installment?.months}`, '1/3');
eq('여는 것은 사용자가 적은 거래', originalEntry(firstMonth!).amount, '306000');
eq('그 줄 금액도 적은 그대로', originalEntry(firstMonth!).lines[0]?.amount, '306000');

const secondMonth = installmentEntryViews([item], monthWindow('2026-04'))[0];
eq('2회차는 그 달 몫', secondMonth?.amount, '102000');
// 날짜는 그 달의 같은 날로 옮겨진다. 견주는 자리는 프로젝트 타임존의 날짜 키다.
eq(
  '2회차의 날짜는 그 달 1일',
  zonedDateKey(new Date(secondMonth!.date), 'Asia/Seoul'),
  '2026-04-01',
);
eq('2회차를 열어도 적은 거래', originalEntry(secondMonth!).amount, '306000');

console.log('\n== 분할 거래의 줄 몫 ==');
const lineShares = installmentLineShares(10000, ['3334', '3333', '3333']);
eq('줄 합은 줄 금액', sum(lineShares), '10000');
eq('회차 비율대로', lineShares.map(String).join('/'), '3334/3333/3333');
const odd = installmentLineShares(1, ['3334', '3333', '3333']);
eq('1원짜리 줄도 합이 1원', sum(odd), '1');

console.log(fail === 0 ? '\n모두 통과' : `\n${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
