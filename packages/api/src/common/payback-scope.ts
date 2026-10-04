/**
 * 분석이 페이백을 원거래의 날짜로 세게 하는 질의 조각 (PAYBACK_DESIGN.md).
 *
 * 페이백은 들어온 날짜의 전표이지만, 분석(분류별·추이·예산)은 그 금액을 **원거래의 달**에
 * 센다 -- 식비 10만을 쓰고 다음 달에 9만이 돌아왔으면 쓴 달의 식비가 1만이다. 그래서 두
 * 가지를 함께 한다.
 *
 *   1. **범위를 고친다.** 기간 질의는 전표 날짜로 거르므로, 다음 달에 들어온 페이백은 쓴
 *      달의 질의에 실려 오지 않는다. 연결된 페이백은 원거래 날짜로 고르고, 자기 날짜로는
 *      고르지 않는다 (그러지 않으면 들어온 달에도 한 번 더 세어진다).
 *   2. **날짜를 옮긴다.** 읽어 온 행의 날짜를 원거래 것으로 바꾼다 (`analysisDateOf`).
 *
 * 링크가 빈 페이백(원거래가 지워졌다)은 여느 전표처럼 자기 날짜로 센다.
 *
 * 자산 관점(결제수단 집계·결제수단 추이·잔액)은 이것을 쓰지 않는다. 돈이 실제로 들어온
 * 날짜가 그쪽의 사실이다.
 */
import type { Prisma } from '@prisma/client';
import { HAS_INSTALLMENT, andScope, widenScope } from './installment-scope';

/** 행에 함께 실어 올 원거래 날짜. 집계 select 의 `entry.select` 에 펼쳐 넣는다. */
export const PAYBACK_DATE_SELECT = {
  paybackOf: { select: { date: true } },
} as const;

/** 분석이 그 행을 세는 날짜. 연결된 페이백이면 원거래의 날짜다. */
export function analysisDateOf(entry: { date: Date; paybackOf?: { date: Date } | null }): Date {
  return entry.paybackOf?.date ?? entry.date;
}

/**
 * "분석의 날짜가 이 창 안"이라는 전표 조건. 연결된 페이백은 원거래 날짜로, 나머지는 자기 날짜로 본다.
 *
 * 최상위 `OR` 로 두지 않고 조건 하나로 돌려준다. 목록의 커서가 최상위 `OR` 을 쓰므로
 * (entries.service), 부르는 쪽이 `AND` 에 얹어야 서로 덮지 않는다.
 */
export function analysisDateCondition(
  date: Prisma.JournalEntryWhereInput['date'],
): Prisma.JournalEntryWhereInput {
  return { OR: [{ date, paybackOfEntryId: null }, { paybackOf: { date } }] };
}

/**
 * 기간 조건을 "분석의 날짜"로 고친다. 기간이 없으면(전체) 고칠 것이 없다.
 *
 * 기간 말고 다른 조건(사람·검색·자산주)은 페이백 자신에게 그대로 건다.
 */
export function paybackScope(scope: Prisma.JournalEntryWhereInput): Prisma.JournalEntryWhereInput {
  const { date, ...rest } = scope;
  if (!date) return scope;
  return andScope(rest, analysisDateCondition(date));
}

/**
 * 분석의 전표 조건. 발생 기준이면 `paybackScope` 하나다.
 *
 * 회차 기준이면 할부만 창을 앞으로 넓혀 따로 읽는다 (`installmentScope` 와 같은 두 벌).
 * 페이백에는 할부가 없어 할부 쪽은 그대로 두고, 할부가 아닌 쪽에만 페이백 범위를 건다.
 * 순서가 중요하다 -- 페이백 범위를 먼저 씌우면 기간이 OR 안으로 들어가 `widenScope` 가
 * 넓힐 창을 찾지 못한다.
 */
export function analysisScopes(
  scope: Prisma.JournalEntryWhereInput,
  installmentBasis: boolean,
): Prisma.JournalEntryWhereInput[] {
  if (!installmentBasis) return [paybackScope(scope)];
  return [
    paybackScope(andScope(scope, { NOT: HAS_INSTALLMENT })),
    { ...widenScope(scope), ...HAS_INSTALLMENT },
  ];
}
