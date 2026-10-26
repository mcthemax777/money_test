/**
 * 환불·페이백 링크를 원장 잠금 아래에서 다시 보는 작업 (ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 조립은 잠그기 전에 읽으므로, 저장 직전에 원거래와 걸린 환불·페이백을 같은 트랜잭션으로 다시
 * 읽어 링크·상한·할부 회차를 확정한다. 모두 원장 잠금 뒤에 부른다.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  adjustTotals,
  checkInstallmentRefunds,
  effectiveLineSchedule,
  installmentLineSchedule,
  parseInstallmentAdjust,
  planPaybackRebind,
  rebindErrorMessage,
} from '@money/types';
import { badRequest } from '@/common/app-error';
import type { ProjectAccessService } from '@/common/project-access.guard';
import type { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { prismaLedgerLookup } from './prisma-lookup';
import type { EntryInput, PaybackLink, Tx } from './ledger-types';

/**
 * 저장할 페이백 링크. 원장 잠금 뒤에 부른다.
 *
 * 조립은 잠그기 전에 원거래를 읽었다. 그 사이 원거래가 지워졌으면 링크를 비운다 --
 * 조립이 원거래를 못 찾았을 때와 같은 결과다(D). 그대로 넣으면 외래 키가 500 으로 튄다.
 * 원거래 지우기도 같은 잠금을 잡으므로 여기서 본 것은 커밋까지 그대로다.
 *
 * 페이백이 걸린 거래를 페이백으로 바꾸는 것은 막는다. 링크가 사슬이 되면 분석이 날짜를
 * 어디까지 따라가야 하는지가 정해지지 않는다.
 */
export async function paybackLink(
  tx: Tx,
  input: EntryInput,
  selfId?: string,
): Promise<PaybackLink> {
  const none = { paybackOfEntryId: null, paybackOfLineKey: null };
  if (!input.paybackOfEntryId) return none;
  if (input.paybackOfEntryId === selfId) {
    throw new BadRequestException('거래 자신에게 페이백을 걸 수 없습니다.');
  }
  if (selfId && (await tx.journalEntry.count({ where: { paybackOfEntryId: selfId } })) > 0) {
    throw new BadRequestException('페이백이 걸린 거래는 페이백이 될 수 없습니다.');
  }
  const target = await tx.journalEntry.findUnique({
    where: { id: input.paybackOfEntryId },
    select: { projectId: true },
  });
  if (!target || target.projectId !== input.projectId) return none;
  return { paybackOfEntryId: input.paybackOfEntryId, paybackOfLineKey: input.paybackOfLineKey ?? null };
}

/**
 * 원거래를 고친 뒤, 걸린 환불·페이백을 새 줄에 맞춘다 (types 의 planPaybackRebind).
 *
 * 줄의 분류가 바뀌었으면 환불·페이백의 분류 다리도 따라 바꾸고, 사라진 줄에 걸려 있었는데
 * 남은 줄이 하나면 그 줄로 옮긴다. 줄을 지우거나(옮길 곳이 없다), 지출이 아니게 바꾸거나,
 * 돌려받은 합보다 줄 금액을 작게 하면 거절한다 -- 그대로 두면 그 분류의 지출이 음수가 된다.
 *
 * 옮긴 환불·페이백은 전표를 고쳐(`paybackOfLineKey`·`updatedAt`) 번호를 올린다. 기기가 받아 간다.
 */
export async function rebindPaybacks(tx: Tx, entryId: string, input: EntryInput): Promise<void> {
  const postings = input.postings;
  const paybacks = await tx.journalEntry.findMany({
    where: { paybackOfEntryId: entryId },
    select: {
      id: true,
      paybackOfLineKey: true,
      installmentAdjust: true,
      postings: { select: { id: true, categoryId: true, cardId: true, baseAmount: true } },
    },
  });
  if (paybacks.length === 0) return;
  const categoryLegOf = (row: (typeof paybacks)[number]) => row.postings.find((leg) => leg.categoryId);

  const legs = postings.filter((posting) => posting.categoryId && posting.lineKey);
  const types = new Map(
    (
      await tx.category.findMany({
        where: { id: { in: legs.map((leg) => leg.categoryId!) } },
        select: { id: true, type: true },
      })
    ).map((row) => [row.id, row.type as string]),
  );
  const plan = planPaybackRebind(
    legs.map((leg) => ({
      lineKey: leg.lineKey!,
      categoryId: leg.categoryId!,
      categoryType: types.get(leg.categoryId!) ?? '',
      baseAmount: leg.baseAmount.toString(),
    })),
    paybacks.map((row) => ({
      id: row.id,
      lineKey: row.paybackOfLineKey,
      categoryId: categoryLegOf(row)?.categoryId ?? null,
      baseAmount: (categoryLegOf(row)?.baseAmount ?? new Prisma.Decimal(0)).toString(),
    })),
  );
  if (plan.error) throw badRequest(plan.error.code, rebindErrorMessage(plan.error));

  /*
   * 회차를 줄인 할부 환불과 어긋나지 않는지 (installment-refund). 개월수·카드를 바꾸거나
   * 남는 회차가 음수가 되게 줄이면 거절한다 -- 줄인 금액이 가리키던 회차가 뜻을 잃는다.
   */
  const movedLine = new Map(plan.moves.map((move) => [move.paybackId, move.lineKey]));
  const cardLeg = postings.find((posting) => posting.cardId && posting.accountId);
  const locked = checkInstallmentRefunds({
    plan:
      input.installmentMonths && input.installmentMonths >= 2 && cardLeg
        ? {
            months: input.installmentMonths,
            cardId: cardLeg.cardId ?? null,
            entryAmount: cardLeg.baseAmount.abs().toString(),
            principals: input.installmentShares ?? null,
            interests: input.installmentInterestShares ?? null,
          }
        : null,
    lines: legs.map((leg) => ({ lineKey: leg.lineKey!, amount: leg.baseAmount.abs().toString() })),
    refunds: paybacks.map((row) => ({
      lineKey: movedLine.get(row.id) ?? row.paybackOfLineKey,
      cardId: row.postings.find((leg) => leg.cardId && !leg.categoryId)?.cardId ?? null,
      adjust: parseInstallmentAdjust(row.installmentAdjust),
    })),
  });
  if (locked) {
    throw badRequest(
      locked,
      '회차를 줄인 환불이 걸려 있어 할부 개월수·카드·금액을 이렇게 바꿀 수 없습니다. 환불을 먼저 고쳐 주세요.',
    );
  }

  for (const move of plan.moves) {
    await tx.posting.updateMany({
      where: { entryId: move.paybackId, categoryId: { not: null } },
      data: { categoryId: move.categoryId },
    });
    await tx.journalEntry.update({
      where: { id: move.paybackId },
      data: { paybackOfLineKey: move.lineKey, updatedAt: new Date() },
    });
  }
}

/**
 * 환불·페이백을 적을 때, 그 줄에 돌려받은 합이 줄 금액을 넘지 않는지 본다.
 *
 * 기기 명령의 재생은 건너뛴다(`allowOverPayback`) -- 그 까닭은 그 칸의 주석에 있다.
 */
export async function checkPaybackCap(
  tx: Tx,
  input: EntryInput,
  link: PaybackLink,
  selfId?: string,
): Promise<void> {
  if (!link.paybackOfEntryId || input.allowOverPayback) return;
  const self = input.postings.find((posting) => posting.categoryId);
  if (!self) return;

  const lines = await tx.posting.findMany({
    where: { entryId: link.paybackOfEntryId, categoryId: { not: null } },
    select: { lineKey: true, categoryId: true, baseAmount: true, category: { select: { type: true } } },
  });
  const others = await tx.journalEntry.findMany({
    where: { paybackOfEntryId: link.paybackOfEntryId, ...(selfId ? { id: { not: selfId } } : {}) },
    select: {
      id: true,
      paybackOfLineKey: true,
      postings: { where: { categoryId: { not: null } }, select: { categoryId: true, baseAmount: true } },
    },
  });
  const plan = planPaybackRebind(
    lines.map((line) => ({
      lineKey: line.lineKey ?? '',
      categoryId: line.categoryId!,
      categoryType: line.category?.type ?? '',
      baseAmount: line.baseAmount.toString(),
    })),
    [
      ...others.map((row) => ({
        id: row.id,
        lineKey: row.paybackOfLineKey,
        categoryId: row.postings[0]?.categoryId ?? null,
        baseAmount: (row.postings[0]?.baseAmount ?? new Prisma.Decimal(0)).toString(),
      })),
      { id: selfId ?? 'new', lineKey: link.paybackOfLineKey, categoryId: self.categoryId!, baseAmount: self.baseAmount.toString() },
    ],
  );
  // 줄이 사라진 옛 링크 같은 것은 조립이 이미 다뤘다. 여기서는 넘는 것만 막는다.
  if (plan.error?.code === 'PAYBACK_EXCEEDS_LINE') {
    throw badRequest(plan.error.code, rebindErrorMessage(plan.error));
  }
}

/**
 * 할부 환불이 줄인 회차를 잠금 아래에서 다시 본다 (2026-10-16).
 *
 * 조립(`installmentAdjustOf`)이 "그 회차에 남은 원금"을 보고 줄일 금액을 허락하지만, 조립은 트랜잭션 밖에서
 * 읽는다. 같은 원거래 줄에 두 환불이 동시에 들어오면 둘 다 옛 남은 원금을 보고 통과해 회차가 음수가 됐다.
 * 여기서는 원장 잠금 아래에서 원거래의 계획과 걸린 환불을 같은 트랜잭션으로 다시 읽어, 이 환불까지 더한 뒤
 * 음수가 되는 회차가 있으면 거절한다. 줄인 것이 없는(모두 0) 환불은 바꾸는 것이 없어 지나간다.
 *
 * 기기 명령의 재생은 건너뛴다(`allowOverPayback` 과 같은 까닭 -- 끊긴 두 기기가 따로 적은 돈의 기록을
 * 서버에서 버리지 않는다). 서버만 고친 축소안이라 기기 사본은 그대로다.
 */
export async function checkInstallmentCutUnderLock(
  tx: Tx,
  projectAccess: ProjectAccessService,
  exchangeRates: ExchangeRatesService,
  input: EntryInput,
  link: PaybackLink,
  selfId?: string,
): Promise<void> {
  const mine = input.installmentAdjust;
  if (!mine || !link.paybackOfEntryId || input.allowOverPayback) return;
  if (adjustTotals(mine).total.isZero()) return;

  const target = await prismaLedgerLookup(
    tx as never,
    projectAccess,
    exchangeRates,
  ).paybackTarget(input.projectId, link.paybackOfEntryId, link.paybackOfLineKey as string); // 조립과 같은 값을 넘긴다
  const plan = target?.installment;
  if (!plan || plan.lineAmount === null) return;

  const schedule = installmentLineSchedule({
    entryAmount: plan.entryAmount,
    lineAmount: plan.lineAmount,
    months: plan.months,
    principals: plan.principals,
    interests: plan.interests,
  });
  const others = plan.cuts
    .filter((cut) => cut.entryId !== selfId && cut.entryId !== input.id)
    .map((cut) => cut.adjust);
  const effective = effectiveLineSchedule(schedule, [...others, mine]);
  if (effective.some((share) => share.principal.isNegative() || share.interest.isNegative())) {
    throw badRequest('INSTALLMENT_CUT_TOO_LARGE', '줄일 금액이 그 회차에 남은 원금보다 큽니다.');
  }
}
