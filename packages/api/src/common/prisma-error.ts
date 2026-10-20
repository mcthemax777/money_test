/**
 * Prisma 가 던진 오류를 가린다 (2026-10-16).
 *
 * Prisma 의 오류도 문자열 코드(P2002 따위)를 달고 와서, "코드가 있으면 규칙의 거절"로 읽는 자리(명령 재생,
 * 엑셀 가져오기)가 그 원문 -- 질의와 제약 이름 -- 을 사용자에게 그대로 보냈다. 두 자리가 이 판정을 함께 쓴다.
 */
import { Prisma } from '@prisma/client';

export function isPrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

/**
 * 다시 보내면 될 데이터베이스 오류인가. 연결(P1001·P1002·P1008·P1017), 연결 풀 시간 초과(P2024), 트랜잭션
 * 시간 초과·닫힘(P2028), 쓰기 충돌·교착(P2034), 그리고 처음 연결하지 못한 경우다.
 */
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034']);

export function isTransientDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_PRISMA_CODES.has(error.code)
  );
}
