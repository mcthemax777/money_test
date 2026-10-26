/**
 * 원장 계층의 순수 변환과 검증 (ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 데이터베이스를 읽지 않는다. 조립 결과를 이 계층의 모양으로 옮기고, 전표 행·다리 행에 쓸
 * 값을 만들고, 공용 규칙의 위반을 이 계층의 예외로 바꾸는 일만 한다.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type BuiltEntry,
  Dec,
  LedgerBuildError,
  checkEntryDate,
  checkPostings,
  currencyDecimals,
  isErrorCode,
} from '@money/types';
import { badRequest, notFound } from '@/common/app-error';
import type { CategoryLine, CommonInput, EntryInput, PaybackLink, PostingInput } from './ledger-types';

/** 할부 계획에 적어 둘 이자. 유이자 할부에만 채워진다. */
export interface InstallmentInterest {
  shares?: string[];
  monthlyPayment?: Prisma.Decimal;
  annualRate?: Prisma.Decimal;
}

/**
 * 전표 입력에서 이자 쪽만 골라낸다. 적을 것이 없으면 undefined.
 *
 * 세 값이 함께 움직인다 -- 입력(월 납입액 또는 연이율)이 회차 표를 만들고, 표는
 * 사용자가 고칠 수 있다. 무이자로 되돌리면 조립이 셋을 다 비워 보내므로 여기서
 * 가릴 것이 없다.
 */
export function interestOf(input: {
  installmentInterestShares?: string[];
  installmentMonthlyPayment?: string;
  installmentAnnualRate?: string;
}): InstallmentInterest | undefined {
  const { installmentInterestShares, installmentMonthlyPayment, installmentAnnualRate } = input;
  if (!installmentInterestShares && !installmentMonthlyPayment && !installmentAnnualRate) {
    return undefined;
  }
  return {
    shares: installmentInterestShares,
    monthlyPayment: installmentMonthlyPayment
      ? new Prisma.Decimal(installmentMonthlyPayment)
      : undefined,
    annualRate: installmentAnnualRate ? new Prisma.Decimal(installmentAnnualRate) : undefined,
  };
}

/** 다리 행에 쓸 값. */
export function toPostingData(p: PostingInput) {
  return {
    accountId: p.accountId ?? null,
    categoryId: p.categoryId ?? null,
    amount: p.amount,
    quantity: p.quantity ?? null,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    // 빌더가 정한 값을 그대로 쓴다. 여기서 다시 곱하면 반올림이 어긋난다.
    baseAmount: p.baseAmount,
    cardId: p.cardId ?? null,
    // 화면이 만든 줄 키를 그대로 써 넣는다. 짝짓기는 하지 않는다.
    lineKey: p.lineKey ?? null,
    discountAmount: p.discountAmount ?? null,
  };
}

/**
 * 전표 행에 쓸 값 가운데 만들기와 갈아끼우기가 함께 쓰는 것. 다리는 언제나 새로 만든다.
 *
 * 만들기만 쓰는 칸(id·projectId·createdByUserId)은 부르는 쪽이 얹는다.
 */
export function entryRowData(input: EntryInput, payback: PaybackLink, updatedHlc: string) {
  return {
    personId: input.personId,
    date: input.date,
    description: input.description,
    merchant: input.merchant ?? null,
    detailedNote: input.detailedNote ?? null,
    originalCurrency: input.originalCurrency ?? null,
    originalAmount: input.originalAmount ?? null,
    rateProvisional: input.rateProvisional ?? false,
    countsPerformance: input.countsPerformance ?? true,
    discountCountsPerformance: input.discountCountsPerformance ?? true,
    ...payback,
    paybackType: input.paybackType ?? null,
    installmentAdjust: input.installmentAdjust
      ? (input.installmentAdjust as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    updatedHlc,
    postings: { create: input.postings.map((p) => toPostingData(p)) },
  };
}

/** 옛 다리의 잔액 영향을 되돌릴 증감. 수정과 삭제가 함께 쓴다. */
export function reversedDeltas(
  postings: ReadonlyArray<{
    accountId: string | null;
    amount: Prisma.Decimal;
    quantity: Prisma.Decimal | null;
  }>,
) {
  return postings.map((p) => ({
    accountId: p.accountId ?? undefined,
    amount: p.amount.neg(),
    quantity: p.quantity ? p.quantity.neg() : undefined,
  }));
}

/**
 * 전표 날짜가 원장 하한 안에 있는지 검증.
 *
 * 기초잔액 전표보다 앞선 거래가 들어오면 "처음에 이만큼 있었다"는 전제가 깨지고
 * 계좌 원장의 첫 줄이 기초잔액이 아니게 된다. 화면은 날짜 입력 min으로 막지만
 * API를 직접 부르는 경로가 있으므로 여기서도 막는다.
 *
 * 하한은 기초잔액 전표 날짜 자신이다(= 그 날짜는 허용). 그래서 기초잔액을 만드는
 * 원장 서비스의 호출도 그대로 통과한다.
 */
export function assertDateInRange(date: Date) {
  const violation = checkEntryDate(date);
  if (violation) throw new BadRequestException(violation.message);
}

/**
 * 전표 균형과 posting 배타 조건 검증. DB CHECK 제약보다 먼저 걸러 메시지를 명확히 한다.
 *
 * 규칙 자체는 `@money/types`의 checkPostings 가 갖는다. 오프라인에서는 기기가
 * 로컬에 담기 전에 같은 검사를 해야 하고, 규칙이 두 벌이면 어느 한쪽만 통과하는
 * 전표가 생긴다. 여기서는 위반을 이 계층의 예외로 바꿔 던지는 일만 한다.
 */
export function assertBalanced(postings: PostingInput[]) {
  const violation = checkPostings(postings);
  if (violation) throw new BadRequestException(violation.message);
}

/** 기준통화 자릿수로 반올림. 원·엔은 소수를 쓰지 않는다. */
export function toBase(amount: Prisma.Decimal, rate: Prisma.Decimal, base: string): Prisma.Decimal {
  return amount.mul(rate).toDecimalPlaces(currencyDecimals(base), Prisma.Decimal.ROUND_HALF_UP);
}

/** 기준통화로 기록되는 다리 (카테고리, 자본 계정) */
export function baseLeg(
  target: {
    accountId?: string;
    categoryId?: string;
    cardId?: string;
  },
  amount: Prisma.Decimal,
  base: string,
): PostingInput {
  return {
    ...target,
    amount,
    currency: base,
    exchangeRate: new Prisma.Decimal(1),
    baseAmount: amount,
  };
}

/**
 * 조립이 거절한 이유를 이 계층의 예외로 바꾼다.
 *
 * 규칙은 값(오류 객체)으로 오고, HTTP 상태로 바꾸는 일은 여기서 한다. 기기는 같은
 * 오류를 잡아 입력 화면의 문구로 쓴다 (ledger-rules 의 위반을 다루는 방식과 같다).
 */
export async function translateBuildError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LedgerBuildError) {
      /*
       * 조립의 code 는 규칙의 지역 이름이라 응답 계약(ErrorCode)과 범위가 다르다.
       * 계약에 있는 것만 코드로 싣고, 나머지는 지금까지처럼 문장만 실어 보낸다
       * (ledger-rules.ts 머리말이 같은 구분을 적어 두었다).
       */
      if (isErrorCode(error.code)) {
        throw error.notFound
          ? notFound(error.code, error.message)
          : badRequest(error.code, error.message);
      }
      throw error.notFound
        ? new NotFoundException(error.message)
        : new BadRequestException(error.message);
    }
    throw error;
  }
}

/** 조립에 넘길 공통 입력. Date 와 Decimal 은 그대로 통과한다(Dec 가 받아들인다). */
export function buildCommon(input: CommonInput) {
  return {
    projectId: input.projectId,
    personId: input.personId,
    date: input.date,
    description: input.description,
    merchant: input.merchant,
    detailedNote: input.detailedNote,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    billedAmount: input.billedAmount,
  };
}

export function toBuildLines(lines: CategoryLine[]) {
  return lines.map((line) => ({
    categoryId: line.categoryId,
    amount: line.amount,
    lineKey: line.lineKey,
  }));
}

/**
 * 조립 결과를 이 계층의 모양으로.
 *
 * 금액을 Dec 에서 Prisma.Decimal 로 되돌린다. Dec.toString() 은 정확하므로 값이 상하지
 * 않는다. `createdByUserId` 처럼 조립이 모르는 값은 원래 입력에서 가져온다.
 */
export function toEntryInput(input: CommonInput, built: BuiltEntry): EntryInput {
  const dec = (value: Dec | undefined | null) =>
    value === undefined || value === null ? undefined : new Prisma.Decimal(value.toString());

  return {
    projectId: built.projectId,
    personId: built.personId,
    date: built.date,
    description: built.description,
    merchant: built.merchant,
    detailedNote: built.detailedNote,
    createdByUserId: input.createdByUserId,
    originalCurrency: built.originalCurrency,
    originalAmount: dec(built.originalAmount),
    rateProvisional: built.rateProvisional,
    installmentMonths: built.installmentMonths,
    installmentInterest: built.installmentInterest,
    installmentShares: built.installmentShares,
    installmentInterestShares: built.installmentInterestShares,
    installmentMonthlyPayment: built.installmentMonthlyPayment,
    installmentAnnualRate: built.installmentAnnualRate,
    countsPerformance: built.countsPerformance ?? true,
    discountCountsPerformance: built.discountCountsPerformance ?? true,
    ...(built.tagIds ? { tagIds: built.tagIds } : {}),
    paybackOfEntryId: built.paybackOfEntryId ?? null,
    paybackOfLineKey: built.paybackOfLineKey ?? null,
    paybackType: built.paybackType ?? null,
    installmentAdjust: built.installmentAdjust ?? null,
    postings: built.postings.map((posting) => ({
      accountId: posting.accountId,
      categoryId: posting.categoryId,
      amount: new Prisma.Decimal(posting.amount.toString()),
      quantity: dec(posting.quantity),
      currency: posting.currency,
      exchangeRate: new Prisma.Decimal(posting.exchangeRate.toString()),
      baseAmount: new Prisma.Decimal(posting.baseAmount.toString()),
      cardId: posting.cardId,
      lineKey: posting.lineKey,
      discountAmount: dec(posting.discountAmount) ?? null,
      tagIds: posting.tagIds,
    })),
  };
}
