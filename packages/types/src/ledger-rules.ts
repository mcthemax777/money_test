/**
 * 전표가 지켜야 하는 규칙.
 *
 * 지금까지 이 판단은 서버의 LedgerService 안에만 있었다. 오프라인에서는 기기가
 * 먼저 같은 판단을 해야 한다. 로컬에서 받아들인 전표를 서버가 영구히 거절하면
 * 그 전표는 큐에 남아 아무 데도 못 가는 독이 된다.
 *
 * 그래서 규칙만 여기로 옮긴다. 예외를 던지지 않고 위반을 값으로 돌려주는 것은
 * 부르는 쪽이 다르기 때문이다. 서버는 BadRequestException 으로 바꿔 던지고,
 * 기기는 입력 화면에 그대로 띄운다.
 */

import { Dec, type DecInput } from './decimal';
import { LEDGER_OPENING_DATE_KEY, ledgerOpeningDate, ledgerMaxEntryDate, LEDGER_MAX_ENTRY_YEARS_AHEAD } from './tz';

/**
 * 위반 하나.
 *
 * 이 `code` 는 규칙을 부르는 쪽이 분기할 때 쓰는 지역 이름이고, 서버가 응답으로
 * 내보내는 `ErrorCode` 계약과는 다르다. errors.ts 가 적어 둔 대로, 사용자가 손댈
 * 수 없는 불변식(다리 수, 부호 규칙)은 그 계약에 넣지 않는다. 서버는 지금까지처럼
 * 문장만 실어 400을 던지고, 기기는 이 코드로 자기 입력 화면의 문구를 고른다.
 */
export interface LedgerRuleViolation {
  code: string;
  message: string;
}

/**
 * 검증에 필요한 만큼만 본 posting.
 *
 * 금액을 DecInput 으로 받아 서버의 Prisma.Decimal 과 기기의 문자열을 함께
 * 받아들인다. Prisma.Decimal 의 toString() 은 정확하므로 값이 상하지 않는다.
 */
export interface PostingRuleInput {
  accountId?: string | null;
  categoryId?: string | null;
  amount: DecInput;
  baseAmount: DecInput;
  exchangeRate: DecInput;
  quantity?: DecInput | null;
}

/**
 * 전표의 다리들이 규칙에 맞는지 본다. 맞으면 null.
 *
 * 균형은 기준통화 환산액(baseAmount)으로 판정한다. 통화가 섞인 전표는 amount
 * 합계가 0이 될 수 없다. 달러와 원을 더하는 셈이기 때문이다.
 */
export function checkPostings(postings: readonly PostingRuleInput[]): LedgerRuleViolation | null {
  if (postings.length < 2) {
    return { code: 'POSTING_TOO_FEW', message: '전표에는 최소 2개의 posting이 필요합니다.' };
  }

  for (const p of postings) {
    const hasAccount = Boolean(p.accountId);
    const hasCategory = Boolean(p.categoryId);

    if (hasAccount === hasCategory) {
      return {
        code: 'POSTING_TARGET_NOT_EXCLUSIVE',
        message: 'posting은 계좌와 카테고리 중 정확히 하나만 가리켜야 합니다.',
      };
    }

    if (p.quantity !== null && p.quantity !== undefined && !hasAccount) {
      return {
        code: 'POSTING_QUANTITY_ON_CATEGORY',
        message: '수량은 계좌 posting에만 기록할 수 있습니다.',
      };
    }

    const amount = Dec.of(p.amount);
    if (amount.isZero()) {
      return { code: 'POSTING_ZERO_AMOUNT', message: '금액이 0인 posting은 만들 수 없습니다.' };
    }

    if (Dec.of(p.exchangeRate).lte(0)) {
      return { code: 'POSTING_RATE_NOT_POSITIVE', message: '환율은 0보다 커야 합니다.' };
    }

    // 부호가 어긋나면 어느 한쪽 계산이 잘못된 것이다. 그대로 저장하면
    // 잔액과 리포트가 반대 방향으로 움직인다.
    if (amount.isNegative() !== Dec.of(p.baseAmount).isNegative()) {
      return { code: 'POSTING_SIGN_MISMATCH', message: '금액과 환산액의 부호가 다릅니다.' };
    }
  }

  const total = Dec.sum(postings.map((p) => p.baseAmount));
  if (!total.isZero()) {
    return {
      code: 'ENTRY_NOT_BALANCED',
      message: `전표 차변과 대변이 맞지 않습니다. 환산액 차액: ${total.toString()}`,
    };
  }

  return null;
}

/**
 * 전표 날짜가 원장 범위 안에 있는지 본다. 맞으면 null.
 *
 * 하한은 기초잔액 전표 날짜 자신이다(그 날짜는 허용). 상한이 없으면 연도 오타
 * 하나가 순자산을 바꾸고 카드 청구 주기를 수만 개로 부풀린다.
 *
 * `now` 를 받는 것은 검사 시점을 부르는 쪽이 정할 수 있게 하기 위해서다.
 * 기기 시계가 앞서 있으면 로컬에서 통과한 전표가 서버에서 걸릴 수 있으므로,
 * 기기는 마지막으로 서버에서 본 시각을 넣어 같은 판단을 하게 할 수 있다.
 */
export function checkEntryDate(date: Date, now?: Date): LedgerRuleViolation | null {
  if (Number.isNaN(date.getTime())) {
    return { code: 'ENTRY_DATE_INVALID', message: '거래 날짜가 올바르지 않습니다.' };
  }

  if (date < ledgerOpeningDate()) {
    return {
      code: 'ENTRY_DATE_TOO_EARLY',
      message: `${LEDGER_OPENING_DATE_KEY} 이전 날짜의 거래는 기록할 수 없습니다.`,
    };
  }

  if (date > ledgerMaxEntryDate(now)) {
    return {
      code: 'ENTRY_DATE_TOO_LATE',
      message: `${LEDGER_MAX_ENTRY_YEARS_AHEAD}년 뒤보다 나중 날짜의 거래는 기록할 수 없습니다. 연도를 확인해 주세요.`,
    };
  }

  return null;
}
