/**
 * 기초잔액 전표와 자본 계정 찾기 (ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 잔액 맞추기(`LedgerService.setBalanceTo`)만 쓴다. 그 트랜잭션 클라이언트로 읽어야
 * 같은 트랜잭션이 방금 만든 자본 계정이 보인다 (`Db` 머리말).
 */
import { AccountType } from '@prisma/client';
import { ledgerOpeningDate } from '@money/types';
import type { Db } from './ledger-types';

/**
 * 기초잔액 전표의 날짜이자 원장 날짜의 하한.
 *
 * 어떤 거래보다 앞서야 "처음에 이만큼 있었다"는 뜻이 유지된다. 사용자가 기준일을
 * 고르게 하면 그 뒤에 과거 거래를 넣었을 때 순서가 뒤집힌다. 거래 입력 하한
 * (`LEDGER_MIN_ENTRY_DATE_KEY`)보다 1년 앞이라 타임존 변환 여유까지 확보된다.
 */
export const OPENING_BALANCE_DATE = ledgerOpeningDate();

/**
 * 그 계좌의 기초잔액 전표. 계좌 posting과 자본 계정 posting을 함께 가진 전표다.
 *
 * 계좌마다 하나만 유지되지만(원장 서비스만 만든다) date 오름차순으로 맨 앞을 집어
 * 여러 건이 있어도 가장 앞선 것을 기준으로 삼는다.
 */
export async function findOpeningEntry(db: Db, projectId: string, accountId: string) {
  const equity = await db.account.findFirst({
    where: { projectId, type: AccountType.opening_balance },
    select: { id: true },
  });
  if (!equity) return null;

  return db.journalEntry.findFirst({
    where: {
      projectId,
      AND: [
        { postings: { some: { accountId } } },
        { postings: { some: { accountId: equity.id } } },
      ],
    },
    orderBy: { date: 'asc' },
    select: { id: true },
  });
}

/** 프로젝트마다 자본 계정 하나를 공유한다. */
export async function getOrCreateOpeningBalanceAccount(db: Db, projectId: string) {
  const existing = await db.account.findFirst({
    where: { projectId, type: AccountType.opening_balance },
  });
  if (existing) return existing;

  return db.account.create({
    data: {
      projectId,
      type: AccountType.opening_balance,
      name: '기초잔액',
      ownerId: null,
    },
  });
}
