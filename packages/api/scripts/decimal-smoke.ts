/**
 * 십진 연산과 전표 규칙 검사.
 *
 * 실행: cd packages/api && npx ts-node scripts/decimal-smoke.ts
 *
 * 다른 스모크와 달리 `runSmoke` 를 쓰지 않는다. 그 뼈대는 테스트가 만든 행을
 * 지우기 위한 것이고, 여기서 보는 것은 데이터베이스에 닿지 않는 순수 함수다.
 * 출력 모양(PASS/FAIL)은 나머지 스모크와 같게 두어 한눈에 읽히게 한다.
 *
 * 무엇을 지키는 검사인가. 이 두 모듈은 서버와 기기가 함께 쓴다. 오프라인에서
 * 기기가 로컬에 담은 전표를 서버가 거절하면 그 전표는 어디에도 갈 수 없으므로,
 * 두 곳의 판단이 같아야 한다. 그리고 금액 합산이 double 로 새면 원 단위가
 * 어긋나므로, double 이 틀리는 자리를 콕 집어 함께 본다.
 */

import {
  Dec,
  checkEntryDate,
  checkPostings,
  dec,
  roundToCurrency,
  type PostingRuleInput,
} from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}
function throws(label: string, fn: () => unknown) {
  try { fn(); fail += 1; console.log(`FAIL  ${label} (던지지 않았다)`); }
  catch { console.log(`PASS  ${label} (던졌다)`); }
}

// 기본 파싱과 표기
eq('정수', dec('1200').toString(), '1200');
eq('뒤따르는 0 제거', dec('1.100').toString(), '1.1');
eq('음수', dec('-0.05').toString(), '-0.05');
eq('지수 표기', dec('1.5e3').toString(), '1500');
eq('작은 지수', dec('2e-7').toString(), '0.0000002');
eq('점으로 시작', dec('.25').toString(), '0.25');
eq('number 입력', dec(0.1).toString(), '0.1');
eq('bigint 입력', dec(9007199254740993n).toString(), '9007199254740993');
eq('음의 0', dec('-0').toString(), '0');

// double 이 틀리는 자리
eq('0.1 + 0.2', dec('0.1').plus('0.2').toString(), '0.3');
eq('0.1 * 0.2', dec('0.1').times('0.2').toString(), '0.02');
eq('원 단위 누적', Dec.sum(Array(3).fill('0.1')).toString(), '0.3');

// 큰 금액 (JS 안전 정수 범위 밖)
eq('19자리 합', dec('9999999999999.9999').plus('0.0001').toString(), '10000000000000');
eq('큰 곱', dec('12345678901234.5678').times('2').toString(), '24691357802469.1356');

// 나누기와 반올림
eq('1/3 4자리', dec('1').dividedBy('3', 4).toString(), '0.3333');
eq('2/3 4자리 half-up', dec('2').dividedBy('3', 4).toString(), '0.6667');
eq('0.5 올림', dec('0.5').round(0).toString(), '1');
eq('-0.5 올림(0에서 먼 쪽)', dec('-0.5').round(0).toString(), '-1');
eq('1.5 올림', dec('1.5').round(0).toString(), '2');
eq('2.5 올림(half-up)', dec('2.5').round(0).toString(), '3');
eq('버림', dec('1.9').round(0, 'down').toString(), '1');
eq('음수 버림', dec('-1.9').round(0, 'down').toString(), '-1');
eq('자릿수 늘리지 않음', dec('1.5').round(4).toString(), '1.5');
throws('0으로 나누기', () => dec('1').dividedBy('0', 2));

// 환율 환산 (원화 카드의 달러 결제)
const usd = dec('50');
const rate = dec('1385.20000000');
eq('50 USD * 1385.2', usd.times(rate).toString(), '69260');
eq('원 단위 반올림', roundToCurrency(dec('69260.4'), 'KRW').toString(), '69260');
eq('달러 2자리', roundToCurrency(dec('12.345'), 'USD').toString(), '12.35');
eq('엔 0자리', roundToCurrency(dec('1234.5'), 'JPY').toString(), '1235');
eq('모르는 통화는 2자리', roundToCurrency(dec('1.005'), 'EUR').toString(), '1.01');

// toFixed 는 채운다
eq('toFixed 채움', dec('1.5').toFixed(4), '1.5000');
eq('toFixed 줄임', dec('1.98765').toFixed(2), '1.99');
eq('toFixed 0자리', dec('1.5').toFixed(0), '2');
eq('toFixed 음수', dec('-1.005').toFixed(2), '-1.01');

// 비교
eq('1.10 == 1.1', dec('1.10').eq('1.1'), true);
eq('cmp', dec('1').cmp('1.0001'), -1);
eq('lte 숫자', dec('0').lte(0), true);

// 나쁜 입력은 조용히 0이 되지 않는다
throws('빈 문자열', () => dec(''));
throws('숫자 아님', () => dec('천원'));
throws('NaN', () => dec(NaN));
throws('Infinity', () => dec(Infinity));

// Prisma.Decimal 처럼 toString 만 있는 값
eq('toString 객체', dec({ toString: () => '123.4500' }).toString(), '123.45');

// 원장 규칙
const balanced: PostingRuleInput[] = [
  { categoryId: 'c1', amount: '50000', baseAmount: '50000', exchangeRate: '1' },
  { accountId: 'a1', amount: '-50000', baseAmount: '-50000', exchangeRate: '1' },
];
eq('균형 전표', checkPostings(balanced), null);
eq('다리 하나', checkPostings([balanced[0]])?.code, 'POSTING_TOO_FEW');
eq('불균형', checkPostings([balanced[0], { ...balanced[1], amount: '-40000', baseAmount: '-40000' }])?.code, 'ENTRY_NOT_BALANCED');
eq('둘 다 가리킴', checkPostings([{ ...balanced[0], accountId: 'a1' }, balanced[1]])?.code, 'POSTING_TARGET_NOT_EXCLUSIVE');
eq('금액 0', checkPostings([{ ...balanced[0], amount: '0', baseAmount: '0' }, balanced[1]])?.code, 'POSTING_ZERO_AMOUNT');
eq('환율 0', checkPostings([{ ...balanced[0], exchangeRate: '0' }, balanced[1]])?.code, 'POSTING_RATE_NOT_POSITIVE');
eq('부호 어긋남', checkPostings([{ ...balanced[0], baseAmount: '-50000' }, balanced[1]])?.code, 'POSTING_SIGN_MISMATCH');
eq('카테고리 다리에 수량', checkPostings([{ ...balanced[0], quantity: '1' }, balanced[1]])?.code, 'POSTING_QUANTITY_ON_CATEGORY');

// 통화가 섞인 전표: amount 합계는 0이 아니지만 baseAmount 합계는 0이다
eq('통화 섞인 전표', checkPostings([
  { categoryId: 'c1', amount: '69260', baseAmount: '69260', exchangeRate: '1' },
  { accountId: 'a1', amount: '-50', baseAmount: '-69260', exchangeRate: '1385.2' },
]), null);

// 날짜
eq('오늘', checkEntryDate(new Date()), null);
eq('1899 이전', checkEntryDate(new Date('1898-01-01T00:00:00Z'))?.code, 'ENTRY_DATE_TOO_EARLY');
eq('2926년', checkEntryDate(new Date('2926-01-01T00:00:00Z'))?.code, 'ENTRY_DATE_TOO_LATE');
eq('잘못된 날짜', checkEntryDate(new Date('아무거나'))?.code, 'ENTRY_DATE_INVALID');
eq('now 를 넘기면 그 기준', checkEntryDate(new Date('2030-06-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))?.code, 'ENTRY_DATE_TOO_LATE');

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
