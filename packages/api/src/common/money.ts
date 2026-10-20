import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 와이어의 금액을 Decimal로 바꾼다.
 *
 * DTO가 클래스가 아니라 인터페이스라서 전역 ValidationPipe가 타입을 걸러 주지
 * 않는다. 검사 없이 `new Prisma.Decimal(...)`에 넘기면 `{"amount": {}}` 같은
 * 본문 하나로 500이 나고, 응답에는 내부 오류 메시지가 실린다. 사용자 입력이
 * 금액이 되는 지점은 전부 이 함수를 거쳐 400으로 떨어지게 한다.
 *
 * NaN/Infinity도 막는다. Decimal은 둘 다 받아 주지만 DB에 들어가면 그 계좌의
 * 잔액 합계가 통째로 망가진다.
 */
/** 받을 수 있는 가장 큰 금액(미만). 저장 칸 Decimal(19,4) 의 정수부가 15자리다. */
const MAX_MONEY = new Prisma.Decimal('1e15');

export function toMoney(value: unknown, label = '금액'): Prisma.Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`${label}: 금액을 입력해 주세요.`);
  }

  const text = String(value).trim();
  if (!text) {
    throw new BadRequestException(`${label}: 금액을 입력해 주세요.`);
  }

  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(text);
  } catch {
    throw new BadRequestException(`${label}: 올바른 숫자가 아닙니다.`);
  }

  if (!amount.isFinite()) {
    throw new BadRequestException(`${label}: 올바른 숫자가 아닙니다.`);
  }
  /*
   * 저장 칸(Decimal(19,4))에 들어가는 크기인가 (2026-10-16). 넘으면 쓰는 순간 500 이 나고, 지수가 아주 큰 값은
   * 그 전에 십진 셈이 서버를 몇 분씩 붙들었다. 정수부 15자리까지 받는다.
   */
  if (amount.abs().gte(MAX_MONEY)) {
    throw new BadRequestException(`${label}: 너무 큰 금액입니다.`);
  }

  return amount;
}

/** 생략할 수 있는 금액. 값이 없으면 null, 있으면 `toMoney`와 같은 검사를 거친다. */
export function toOptionalMoney(value: unknown, label = '금액'): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  return toMoney(value, label);
}
