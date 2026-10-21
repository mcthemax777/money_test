import { BadRequestException } from '@nestjs/common';

/**
 * 요청 본문의 글자 칸을 읽는다. 없으면 undefined, 있으면 앞뒤 공백을 걷은 글자다 (2026-10-16).
 *
 * DTO 가 인터페이스라 형식 검사가 없어(main.ts 의 ValidationPipe 주석) 숫자나 객체가 그대로 들어온다. 서비스가
 * 곧바로 `.trim()` 을 부르면 그 자리에서 TypeError 로 500 이 났다. 글자가 아니면 400 으로 돌려준다.
 */
export function readText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label}: 글자로 적어 주세요.`);
  }
  return value.trim();
}

/**
 * 조회 질의의 개수 칸(limit). 정수로 자르고 1~max 사이에 둔다. 비었거나 읽을 수 없으면 fallback 이다 (2026-10-16).
 *
 * 질의 문자열이라 "1.5"·"-3"·같은 이름을 두 번 준 배열이 그대로 온다. 예전에는 Number() 만 거쳐 1.5 나 음수가
 * Prisma 의 take 로 가 500 이 났다. 여러 조회가 같은 규칙을 쓴다.
 */
export function readLimit(value: unknown, fallback: number, max: number): number {
  const number = Math.trunc(Number(Array.isArray(value) ? value[0] : value));
  if (!Number.isFinite(number) || number < 1) return Math.min(fallback, max);
  return Math.min(number, max);
}

/** 0 이상의 정수 칸(커서 번호 따위). 읽을 수 없으면 0 이다. */
export function readNonNegativeInt(value: unknown): number {
  const number = Math.trunc(Number(Array.isArray(value) ? value[0] : value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * 인스턴트(ISO 날짜·시각) 칸을 읽는다. 읽을 수 없으면 400 이다 (2026-10-16 entries 에서 옮김) -- 그대로 두면
 * Invalid Date 가 Prisma 까지 가서 500 이 났다. 글자가 아닌 값도 400 이다.
 */
export function readInstant(value: unknown, label = '날짜'): Date {
  const instant = typeof value === 'string' || value instanceof Date ? new Date(value) : new Date(NaN);
  if (Number.isNaN(instant.getTime())) {
    throw new BadRequestException(`${label}: 날짜를 읽을 수 없습니다.`);
  }
  return instant;
}

/**
 * 정해진 값 중 하나인 칸(유형·종류)을 읽는다. 없으면 undefined, 목록 밖의 값이면 400 이다.
 *
 * 값이 Prisma 의 enum 칸으로 그대로 가면 목록 밖의 값이 500 이 됐다(DTO 가 인터페이스라 검사가 없다).
 */
export function readEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`${label}: ${allowed.join(', ')} 중 하나여야 합니다.`);
}
