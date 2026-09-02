import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, AccountType } from '@prisma/client';
import {
  type BuiltEntry,
  Dec,
  type EntryBuildRequest,
  buildEntry,
  LedgerBuildError,
  buildCardTransfer,
  buildExpense,
  buildIncome,
  buildTransfer,
  checkEntryDate,
  checkPostings,
  currencyDecimals,
  isErrorCode,
  ledgerOpeningDate,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { prismaLedgerLookup } from './prisma-lookup';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { badRequest, notFound } from '@/common/app-error';

const ZERO = new Prisma.Decimal(0);

/**
 * 기초잔액 전표의 날짜이자 원장 날짜의 하한.
 *
 * 어떤 거래보다 앞서야 "처음에 이만큼 있었다"는 뜻이 유지된다. 사용자가 기준일을
 * 고르게 하면 그 뒤에 과거 거래를 넣었을 때 순서가 뒤집힌다. 거래 입력 하한
 * (`LEDGER_MIN_ENTRY_DATE_KEY`)보다 1년 앞이라 타임존 변환 여유까지 확보된다.
 */
const OPENING_BALANCE_DATE = ledgerOpeningDate();

type Tx = Prisma.TransactionClient;

/**
 * 읽기에 쓸 수 있는 클라이언트. 트랜잭션 안에서는 반드시 그 트랜잭션의
 * 클라이언트를 써야 한다. 바깥의 prisma로 읽으면 같은 트랜잭션이 방금 만든
 * 행(예: 기초잔액용 자본 계정)이 보이지 않아 검증이 헛돈다.
 */
type Db = Tx | PrismaService;

/**
 * 전표의 개별 다리. accountId와 categoryId 중 정확히 하나만 채운다.
 *
 * 통화가 둘 있다는 점이 핵심이다.
 *   - `amount`/`currency`: 이 다리가 가리키는 대상의 통화로 본 금액.
 *     계좌 다리는 그 계좌의 통화, 카테고리 다리는 프로젝트 기준통화다.
 *   - `baseAmount`: 기준통화로 환산한 값. 전표의 균형은 이 값으로 판정한다.
 *     통화가 섞이면 `amount` 합계는 0이 될 수 없기 때문이다.
 *
 * baseAmount는 빌더가 반드시 채운다. 예전처럼 amount × rate로 그때그때 계산하면
 * 다리마다 반올림이 달라져 합계가 0에서 미세하게 벗어난다.
 */
export interface PostingInput {
  accountId?: string;
  categoryId?: string;
  amount: Prisma.Decimal;
  quantity?: Prisma.Decimal;
  currency: string;
  /** 1 currency = exchangeRate 기준통화 */
  exchangeRate: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  /** 카테고리 다리에서 과소비·추가 수입으로 센 금액 (기준통화). 생략하면 0 */
  extraAmount?: Prisma.Decimal;
  cardId?: string;
}

export interface EntryInput {
  /**
   * 기기가 만든 전표 식별자. 없으면 서버가 만든다.
   *
   * 형식 검사는 부르는 쪽(entries.service)이 이미 했다. 원장은 받은 값을 그대로 쓴다.
   */
  id?: string;
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
  postings: PostingInput[];
  /**
   * 원화 카드로 외화 결제를 했을 때의 원 통화 금액. 표시 전용이다.
   * 계좌 자체가 외화면 posting.currency 가 외화이므로 여기는 비운다.
   */
  originalCurrency?: string | null;
  originalAmount?: Prisma.Decimal | null;
  /**
   * 환산액이 서버 추정 환율로 만들어졌다는 표시. 명세서로 확정하면 false가 된다.
   * 빌더가 정하므로 호출자가 넘길 일은 없다.
   */
  rateProvisional?: boolean;
  /**
   * 이 편집의 하이브리드 논리 시계.
   *
   * 기기가 보낸 명령을 재생할 때만 실린다. 온라인 REST 경로는 비워 두는데, 그러면
   * 서버가 "지금"으로 채운다 -- 서버를 거친 편집도 순서에 자리를 잡아야 뒤에 도착한
   * 오프라인 편집과 견줄 수 있다.
   */
  updatedHlc?: string;
  /**
   * 할부 개월수. 신용카드 지출에만 의미가 있고 2 이상일 때 일정이 생긴다.
   *
   * 원금과 지출은 구매 시점에 전액 잡히므로 posting은 달라지지 않는다.
   * "언제 청구되는지"만 InstallmentPlan에 남고, 회차 금액과 귀속 주기는
   * 저장하지 않고 읽을 때 계산한다.
   */
  installmentMonths?: number;
}

/** 지출/수입에서 카테고리별로 금액을 쪼갤 때 쓰는 항목 */
export interface CategoryLine {
  categoryId: string;
  amount: Prisma.Decimal;
  /**
   * 이 줄에서 과소비(지출)·추가 수입(수입)으로 셀 금액. 입력 통화 기준이다.
   *
   * 생략하면 Category.defaultIsExtra를 따른다 (true면 전액, false면 0).
   * 0 이상 amount 이하여야 한다.
   */
  extraAmount?: Prisma.Decimal;
}

interface CommonInput {
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
  /**
   * 사용자가 금액을 입력한 통화. 생략하면 결제/입금 계좌의 통화로 본다.
   * 원화 카드로 달러를 결제한 경우처럼 계좌 통화와 다를 수 있다.
   */
  currency?: string;
  /**
   * 1 currency = exchangeRate 기준통화.
   *
   * 생략하면 서버가 들고 있는 환율을 쓴다. 카드사가 실제로 적용한 환율이
   * 명세서에 찍혀 나오면 그 값을 넣어 덮어쓴다.
   */
  exchangeRate?: Prisma.Decimal;
  /**
   * 기준통화로 실제 청구된(또는 입금된) 총액.
   *
   * 환율 대신 이것을 받는다. 사용자가 아는 값은 대개 환율이 아니라 통장에서
   * 빠진 금액이기 때문이다. 주면 환율은 무시하고 이 금액을 그대로 쓴다.
   * 곱셈이 없으므로 합계가 청구액에서 벗어나지 않는다.
   *
   * 기준통화 계좌로 외화를 결제한 경우에만 쓸 수 있다. 외화 계좌 거래는 계좌
   * 통화 금액이 이미 사실이라 따로 받을 것이 없다.
   */
  billedAmount?: Prisma.Decimal;
}

export interface ExpenseInput extends CommonInput {
  lines: CategoryLine[];
  /** accountId와 cardId 중 정확히 하나. 카드면 카드 종류에 따라 자금 출처가 결정된다. */
  accountId?: string;
  cardId?: string;
  /** 할부 개월수. 신용카드일 때만 쓴다. */
  installmentMonths?: number;
}

export interface IncomeInput extends CommonInput {
  lines: CategoryLine[];
  /** 수입이 들어오는 계좌 */
  accountId: string;
}

export interface TransferInput extends CommonInput {
  fromAccountId: string;
  toAccountId: string;
  amount: Prisma.Decimal;
  /**
   * 받는 계좌에 실제로 들어온 금액 (받는 계좌 통화).
   *
   * 통화가 다른 환전에서 쓴다. 보낸 $50과 받은 ₩67,500을 그대로 적으면
   * 실제 적용된 환율이 저절로 기록된다. 생략하면 서버 환율로 계산한다.
   */
  toAmount?: Prisma.Decimal;
  /** 이체 수수료. 보내는 계좌에서 함께 빠진다. */
  feeAmount?: Prisma.Decimal;
  feeCategoryId?: string;
  /** 수수료 중 과소비로 셀 금액. 생략하면 수수료 카테고리의 defaultIsExtra를 따른다. */
  feeExtraAmount?: Prisma.Decimal;
}

/**
 * 카드사와 통장 사이의 자금 이동.
 *
 * 두 방향이 있고 전표 모양은 부호만 다르다.
 *   payment 대금 결제  : 통장 -X, 부채 +X
 *   refund  환불 입금  : 통장 +X, 부채 -X
 *
 * 청구서에 붙이지 않는다. 결제 대상은 카드의 부채 총액 하나뿐이다.
 */
export type CardTransferDirection = 'payment' | 'refund';

export interface CardTransferInput extends CommonInput {
  cardId: string;
  /** 대금이 빠져나가거나 환불이 들어오는 통장 */
  accountId: string;
  amount: Prisma.Decimal;
  direction: CardTransferDirection;
}

/**
 * 원장 조립 레이어.
 *
 * 이 서비스 밖의 코드는 Posting을 직접 만들지 않는다. 화면이 다루는 개념
 * (지출, 수입, 이체, 카드대금 결제)을 받아 전표로 번역하는 것이 여기의 책임이다.
 *
 * 부호 규칙 (schema.prisma 상단과 동일)
 *   자산 계좌   : 증가 +, 감소 -
 *   부채 계좌   : 빚 증가 -, 상환 +
 *   지출 카테고리: 지출 발생 +
 *   수입 카테고리: 수입 발생 -
 * 따라서 한 전표 안의 amount 합계는 항상 0이다.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // ───────────────────────────────────────────
  // 원시 연산
  // ───────────────────────────────────────────

  /**
   * 전표 하나를 만든다. 검증과 잔액 반영을 모두 한 트랜잭션에서 처리한다.
   * 중간에 실패하면 잔액도 함께 롤백되므로 드리프트가 생기지 않는다.
   *
   * outerTx를 주면 새 트랜잭션을 열지 않고 그 안에서 실행한다. 읽고-고쳐-쓰는
   * 상위 연산(setBalanceTo)이 전체를 하나의 원자 단위로 묶기 위해 쓴다.
   */
  async createEntry(input: EntryInput, outerTx?: Tx) {
    this.assertBalanced(input.postings);
    this.assertDateInRange(input.date);
    await this.assertTargetsBelongToProject(outerTx ?? this.prisma, input);

    return this.runInTransaction(outerTx, async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          personId: input.personId,
          date: input.date,
          description: input.description,
          merchant: input.merchant ?? null,
          detailedNote: input.detailedNote ?? null,
          createdByUserId: input.createdByUserId ?? null,
          originalCurrency: input.originalCurrency ?? null,
          originalAmount: input.originalAmount ?? null,
          rateProvisional: input.rateProvisional ?? false,
          updatedHlc: input.updatedHlc ?? null,
          postings: { create: input.postings.map((p) => this.toPostingData(p)) },
        },
        include: { postings: true },
      });

      await this.applyBalanceDeltas(tx, input.postings);
      await this.saveInstallmentPlan(tx, entry.postings, input.installmentMonths);
      return entry;
    });
  }

  /**
   * 전표 내용을 통째로 갈아끼운다. id는 유지된다.
   *
   * posting을 하나씩 비교해 수정하는 대신 "옛 잔액을 되돌리고 새로 적용"하는 방식을 쓴다.
   * 다리 개수가 바뀌는 수정(수수료 추가, 분할 변경)까지 한 경로로 처리되고,
   * 되돌림과 재적용이 같은 트랜잭션 안에 있어 중간 상태가 남지 않는다.
   */
  async replaceEntry(entryId: string, input: EntryInput, outerTx?: Tx) {
    this.assertBalanced(input.postings);
    this.assertDateInRange(input.date);
    await this.assertTargetsBelongToProject(outerTx ?? this.prisma, input);

    return this.runInTransaction(outerTx, async (tx) => {
      // 옛 전표는 트랜잭션 안에서 읽는다. 밖에서 읽으면 그 사이 다른 요청이
      // 지운 전표를 되돌리려다 잔액만 어긋난다.
      const existing = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });
      if (!existing || existing.projectId !== input.projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }

      // 1) 옛 posting의 잔액 영향을 되돌린다
      await this.applyBalanceDeltas(
        tx,
        existing.postings.map((p) => ({
          accountId: p.accountId ?? undefined,
          amount: p.amount.neg(),
          quantity: p.quantity ? p.quantity.neg() : undefined,
        })),
      );

      // 2) 옛 posting을 지우고 새로 만든다
      await tx.posting.deleteMany({ where: { entryId } });

      const entry = await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          personId: input.personId,
          date: input.date,
          description: input.description,
          merchant: input.merchant ?? null,
          detailedNote: input.detailedNote ?? null,
          originalCurrency: input.originalCurrency ?? null,
          originalAmount: input.originalAmount ?? null,
          rateProvisional: input.rateProvisional ?? false,
          updatedHlc: input.updatedHlc ?? null,
          postings: { create: input.postings.map((p) => this.toPostingData(p)) },
        },
        include: { postings: true },
      });

      // 3) 새 posting의 잔액을 적용한다
      await this.applyBalanceDeltas(tx, input.postings);
      // posting을 새로 만들었으므로 할부 일정도 다시 붙인다 (옛 것은 cascade로 사라졌다)
      await this.saveInstallmentPlan(tx, entry.postings, input.installmentMonths);
      return entry;
    });
  }

  /**
   * 전표를 지운다. 잔액을 역방향으로 되돌린 뒤 삭제한다.
   * Posting은 onDelete: Cascade로 함께 사라진다.
   */
  async deleteEntry(entryId: string, projectId: string, outerTx?: Tx) {
    return this.runInTransaction(outerTx, async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });

      if (!entry || entry.projectId !== projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }

      const reversed = entry.postings.map((p) => ({
        accountId: p.accountId ?? undefined,
        amount: p.amount.neg(),
        quantity: p.quantity ? p.quantity.neg() : undefined,
      }));
      await this.applyBalanceDeltas(tx, reversed);
      return tx.journalEntry.delete({ where: { id: entryId } });
    });
  }

  /**
   * 원화 카드의 외화 결제를 실제 청구액으로 고쳐 적는다.
   *
   * 입력할 때는 청구액을 알 수 없다. 카드사가 결제일 환율에 수수료를 얹어
   * 정하기 때문이다. 그래서 추정으로 기록해 두고(rateProvisional = true),
   * 명세서가 나오면 이 메서드로 확정한다.
   *
   * posting을 지우고 다시 만들지 않고 금액만 고친다. 그래야 할부 일정이
   * 붙어 있는 posting 행이 살아남는다(지우면 cascade로 함께 사라진다).
   *
   * 원 통화 금액($50)은 사실이므로 건드리지 않는다. 바뀌는 것은 그것이 얼마로
   * 청구되었는가뿐이다. 적용 환율은 저장하지 않고 둘의 비로 유도한다
   * (entry-view의 deriveRate).
   */
  async restateForeignEntry(
    entryId: string,
    projectId: string,
    billedTotal: Prisma.Decimal,
    outerTx?: Tx,
  ) {
    if (billedTotal.lte(ZERO)) {
      throw new BadRequestException('청구액은 0보다 커야 합니다.');
    }

    return this.runInTransaction(outerTx, async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id: entryId },
        include: { postings: true },
      });
      if (!entry || entry.projectId !== projectId) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }
      if (!entry.originalCurrency || !entry.originalAmount) {
        throw new BadRequestException('원 통화 금액이 없는 거래는 청구액을 확정할 수 없습니다.');
      }

      /*
       * 이 경로는 모든 다리가 기준통화인 전표만 다룬다.
       *
       * 원화 카드의 외화 결제가 그렇다. 청구되는 돈이 원화라 카드 다리도 원화이고,
       * 외화라는 사실은 originalAmount 에만 남는다. 반대로 외화 계좌 거래는
       * 다리 자체가 외화라 금액이 이미 사실이고, 환율만 바뀌면 환산액도 함께
       * 움직여야 하므로 규칙이 다르다. 섞어서 처리하면 조용히 틀린다.
       */
      const base = await this.projectAccess.getProjectLedgerCurrency(projectId);
      if (entry.postings.some((p) => p.currency !== base)) {
        throw new BadRequestException(
          '외화 계좌 거래는 여기서 확정할 수 없습니다. 거래를 직접 수정해 주세요.',
        );
      }

      const positives = entry.postings.filter((p) => p.amount.gt(ZERO));
      const negatives = entry.postings.filter((p) => p.amount.lt(ZERO));
      const oldTotal = this.sum(positives.map((p) => p.amount));
      if (oldTotal.isZero()) {
        throw new BadRequestException('금액이 0인 거래는 청구액을 확정할 수 없습니다.');
      }

      // 양쪽에 같은 총액을 나눠 담으므로 합계는 정확히 0으로 남는다.
      const decimals = currencyDecimals(base);
      const shares = new Map<string, Prisma.Decimal>();
      for (const [i, share] of this.allocate(
        billedTotal,
        positives.map((p) => p.amount),
        decimals,
      ).entries()) {
        shares.set(positives[i].id, share);
      }
      for (const [i, share] of this.allocate(
        billedTotal,
        negatives.map((p) => p.amount.neg()),
        decimals,
      ).entries()) {
        shares.set(negatives[i].id, share.neg());
      }

      const deltas: Array<{ accountId?: string; amount: Prisma.Decimal }> = [];
      for (const posting of entry.postings) {
        const next = shares.get(posting.id) ?? ZERO;
        if (next.equals(posting.amount)) continue;

        await tx.posting.update({
          where: { id: posting.id },
          // 다리가 전부 기준통화라 환산액도 같은 값이다 (exchangeRate 는 1로 남는다).
          data: { amount: next, baseAmount: next },
        });
        deltas.push({
          accountId: posting.accountId ?? undefined,
          amount: next.sub(posting.amount),
        });
      }

      await this.applyBalanceDeltas(tx, deltas);

      return tx.journalEntry.update({
        where: { id: entryId },
        data: { rateProvisional: false },
        include: { postings: true },
      });
    });
  }

  /**
   * 총액을 가중치 비율로 나눈다. 끝수는 첫 항목에 몰아준다.
   *
   * 분할 지출을 확정할 때 줄마다 따로 반올림하면 합계가 총액에서 벗어나
   * 전표 균형이 깨진다. 그래서 나머지를 버린 뒤 남은 끝수를 한 곳에 몰아준다.
   * splitInstallment(card-ledger)와 같은 규칙이다.
   */
  private allocate(
    total: Prisma.Decimal,
    weights: Prisma.Decimal[],
    decimals: number,
  ): Prisma.Decimal[] {
    if (weights.length === 0) return [];
    if (weights.length === 1) return [total];

    const sum = this.sum(weights);
    const shares = weights.map((w) =>
      total.mul(w).div(sum).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_DOWN),
    );
    shares[0] = shares[0].add(total.sub(this.sum(shares)));
    return shares;
  }

  /**
   * 트랜잭션 안에서 실행한다. 이미 트랜잭션 안이면 그것을 그대로 쓴다.
   *
   * Prisma의 대화형 트랜잭션은 중첩할 수 없다. 상위 연산이 자기 트랜잭션을
   * 열어 둔 채 createEntry를 부르면 여기서 갈라진다.
   */
  private runInTransaction<T>(outerTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return outerTx ? fn(outerTx) : this.prisma.$transaction(fn);
  }

  // ───────────────────────────────────────────
  // 통화 환산
  // ───────────────────────────────────────────

  /**
   * 이 전표에서 쓸 통화 정보를 정리한다.
   *
   * 사용자가 입력한 통화(entered)를 기준통화로 바꾸는 환율 하나가 전표 전체의
   * 기준이 된다. 환율을 직접 넘기면 그것을 쓰고(카드사가 실제로 적용한 환율을
   * 명세서에서 보고 고쳐 넣는 경우), 없으면 서버가 들고 있는 값을 쓴다.
   */
  private async resolveConversion(
    projectId: string,
    enteredCurrency: string | undefined,
    accountCurrency: string,
    explicitRate?: Prisma.Decimal,
  ) {
    // 저장 통화다. 표시 통화가 아니다. 표시 통화는 언제든 바뀌므로 원장이
    // 그것을 기준으로 값을 만들면 나중에 저장값을 다시 계산해야 한다.
    const base = await this.projectAccess.getProjectLedgerCurrency(projectId);
    const entered = this.exchangeRates.assertCurrency(
      enteredCurrency ?? accountCurrency,
      '입력 통화',
    );

    if (explicitRate !== undefined && explicitRate.lte(ZERO)) {
      throw new BadRequestException('환율은 0보다 커야 합니다.');
    }

    const rate =
      explicitRate ??
      new Prisma.Decimal((await this.exchangeRates.getRate(projectId, entered, base)).rate);

    // 사용자가 환율을 넣지 않았다면 이 환산액은 서버 추정이다. 원화 카드의 외화
    // 결제라면 실제 청구액은 결제일에 정해지므로, 그 사실을 전표에 남겨야 한다.
    return { base, entered, rate, estimatedRate: explicitRate === undefined };
  }

  /** 기준통화 자릿수로 반올림. 원·엔은 소수를 쓰지 않는다. */
  private toBase(amount: Prisma.Decimal, rate: Prisma.Decimal, base: string): Prisma.Decimal {
    return amount.mul(rate).toDecimalPlaces(currencyDecimals(base), Prisma.Decimal.ROUND_HALF_UP);
  }

  /** 기준통화로 기록되는 다리 (카테고리, 자본 계정) */
  private baseLeg(
    target: {
      accountId?: string;
      categoryId?: string;
      cardId?: string;
      extraAmount?: Prisma.Decimal;
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

  // ───────────────────────────────────────────
  // 조립 헬퍼
  // ───────────────────────────────────────────

  /**
   * 전표 조립이 읽을 창구. 규칙은 `@money/types` 의 entry-build 가 갖는다.
   *
   * 게으르게 만드는 것은 생성자에서 프로젝트 접근 서비스가 아직 준비되지 않았을 수
   * 있어서가 아니라, 이 서비스가 트랜잭션마다 새로 만들어지지 않기 때문이다. 한 번
   * 만들어 두고 계속 쓴다.
   */
  private readonly lookup = prismaLedgerLookup(
    this.prisma,
    this.projectAccess,
    this.exchangeRates,
  );

  /**
   * 조립이 거절한 이유를 이 계층의 예외로 바꾼다.
   *
   * 규칙은 값(오류 객체)으로 오고, HTTP 상태로 바꾸는 일은 여기서 한다. 기기는 같은
   * 오류를 잡아 입력 화면의 문구로 쓴다 (ledger-rules 의 위반을 다루는 방식과 같다).
   */
  private async translate<T>(run: () => Promise<T>): Promise<T> {
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
  private buildCommon(input: CommonInput) {
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

  private toBuildLines(lines: CategoryLine[]) {
    return lines.map((line) => ({
      categoryId: line.categoryId,
      amount: line.amount,
      extraAmount: line.extraAmount,
    }));
  }

  /**
   * 조립 결과를 이 계층의 모양으로.
   *
   * 금액을 Dec 에서 Prisma.Decimal 로 되돌린다. Dec.toString() 은 정확하므로 값이 상하지
   * 않는다. `createdByUserId` 처럼 조립이 모르는 값은 원래 입력에서 가져온다.
   */
  private toEntryInput(input: CommonInput, built: BuiltEntry): EntryInput {
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
      postings: built.postings.map((posting) => ({
        accountId: posting.accountId,
        categoryId: posting.categoryId,
        amount: new Prisma.Decimal(posting.amount.toString()),
        quantity: dec(posting.quantity),
        currency: posting.currency,
        exchangeRate: new Prisma.Decimal(posting.exchangeRate.toString()),
        baseAmount: new Prisma.Decimal(posting.baseAmount.toString()),
        extraAmount: dec(posting.extraAmount),
        cardId: posting.cardId,
      })),
    };
  }

  /**
   * 지출. 결제수단이 계좌든 체크카드든 신용카드든 카테고리측 posting은 동일하다.
   * "지출 = 지출 카테고리 posting의 합"이라는 정의가 결제수단과 분리되는 지점.
   */
  async createExpense(input: ExpenseInput) {
    return this.createEntry(await this.buildExpense(input));
  }

  /**
   * 지출.
   *
   * 사용자는 결제한 통화로 금액을 입력한다. 카테고리 다리는 언제나 기준통화로
   * 남는데, 그래야 "8월 식비"가 통화별로 쪼개지지 않는다.
   *
   * 자금이 빠지는 계좌 다리는 두 가지로 갈린다.
   *   - 계좌 통화 == 입력 통화 : 달러 통장에서 달러로 결제. 계좌 다리도 외화다.
   *   - 계좌 통화 == 기준통화  : 원화 카드로 달러 결제. 청구되는 돈은 원화이므로
   *     계좌 다리는 원화이고, "$50를 썼다"는 사실은 전표에 따로 적는다.
   */
  /**
   * 화면 개념(kind)을 그대로 받아 전표를 만든다.
   *
   * 갈래를 나누는 규칙도 공용 함수가 갖는다. 서버의 REST 경로와 기기의 명령 재생이
   * 같은 입구를 써야 "오프라인에서 만든 전표"와 "온라인에서 만든 전표"가 같아진다.
   */
  async buildFromRequest(
    request: EntryBuildRequest & { createdByUserId?: string | null },
  ): Promise<EntryInput> {
    return this.toEntryInput(request as CommonInput, await this.translate(() => buildEntry(request, this.lookup)));
  }

  async buildExpense(input: ExpenseInput): Promise<EntryInput> {
    return this.toEntryInput(
      input,
      await this.translate(() => buildExpense(
        {
          ...this.buildCommon(input),
          lines: this.toBuildLines(input.lines),
          accountId: input.accountId,
          cardId: input.cardId,
          installmentMonths: input.installmentMonths,
        },
        this.lookup,
      )),
    );
  }

  /** 수입. 수입 카테고리는 -, 입금 계좌는 +. */
  async createIncome(input: IncomeInput) {
    return this.createEntry(await this.buildIncome(input));
  }

  async buildIncome(input: IncomeInput): Promise<EntryInput> {
    return this.toEntryInput(
      input,
      await this.translate(() =>
        buildIncome(
          {
            ...this.buildCommon(input),
            lines: this.toBuildLines(input.lines),
            accountId: input.accountId,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 이체. 수수료가 있으면 3-leg 전표 하나로 만든다.
   * 기존 구조처럼 수수료를 별도 거래로 만들고 서로 참조시키지 않는다.
   *
   * 한쪽이 신용카드 부채 계정이면 카드사와의 자금 이동이 된다.
   *   통장 -> 카드  대금 결제
   *   카드 -> 통장  환불 입금
   * 전표 모양은 buildCardTransfer와 같으므로 카드 화면에서 기록하든 이체로
   * 기록하든 결과가 하나로 모인다.
   */
  async createTransfer(input: TransferInput) {
    return this.createEntry(await this.buildTransfer(input));
  }

  async buildTransfer(input: TransferInput): Promise<EntryInput> {
    return this.toEntryInput(
      input,
      await this.translate(() =>
        buildTransfer(
          {
            ...this.buildCommon(input),
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            amount: input.amount,
            toAmount: input.toAmount,
            feeAmount: input.feeAmount,
            feeCategoryId: input.feeCategoryId,
            feeExtraAmount: input.feeExtraAmount,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 카드사와 통장 사이의 자금 이동. 지출이 아니라 부채의 증감이므로 카테고리 posting이 없다.
   * 이것이 credit_usage/credit_payment 이중 계상 문제가 사라지는 이유다.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식(총액형)이 실제로 있기 때문이다. 그때 부채는 일시적으로
   * 양수가 되고, 뒤이은 환불 입금이 0으로 되돌린다. 부채의 부호는 상태일 뿐 오류가 아니다.
   */
  async createCardTransfer(input: CardTransferInput) {
    return this.createEntry(await this.buildCardTransfer(input));
  }

  async buildCardTransfer(input: CardTransferInput): Promise<EntryInput> {
    return this.toEntryInput(
      input,
      await this.translate(() =>
        buildCardTransfer(
          {
            ...this.buildCommon(input),
            cardId: input.cardId,
            accountId: input.accountId,
            amount: input.amount,
            direction: input.direction,
          },
          this.lookup,
        ),
      ),
    );
  }

  /**
   * 계좌 잔액을 목표값으로 맞춘다. 계좌 추가와 잔액 수정이 함께 쓰는 유일한 경로다.
   *
   * 조정 전표를 새로 쌓지 않는다. 그 계좌의 기초잔액 전표 하나만 다시 계산해 덮어쓴다.
   *   기초잔액 = 목표 잔액 - (기초잔액을 뺀 나머지 거래 합계)
   * 그래서 잔액을 몇 번 고쳐도 거래내역은 기초잔액 1건뿐이고, 그 뒤의 거래는 그대로 남는다.
   *
   * balance 컬럼을 직접 쓰지 않는 이유는 그대로다. 자본 계정을 상대편으로 하는
   * 2-leg 전표로 남겨 "잔액 = posting 합계" 불변식을 지킨다.
   *
   * 주의: opening_balance 계정은 자산이 아니므로 순자산 집계에서 제외해야 한다.
   */
  async setBalanceTo(input: {
    projectId: string;
    accountId: string;
    /** 목표 잔액. 그 계좌의 통화로 본 값이다. */
    targetBalance: Prisma.Decimal;
    /** 외화 계좌의 환산에 쓸 환율. 생략하면 서버 환율. */
    exchangeRate?: Prisma.Decimal;
    createdByUserId?: string | null;
  }) {
    const account = await this.getAccount(input.projectId, input.accountId);
    if (account.type === AccountType.opening_balance) {
      throw new BadRequestException('자본 계정에는 잔액을 직접 설정할 수 없습니다.');
    }
    if (!account.ownerId) {
      throw new BadRequestException('소유자가 없는 계좌에는 잔액을 설정할 수 없습니다.');
    }

    /*
     * 읽고-고쳐-쓰기 전체를 한 트랜잭션으로 묶는다.
     *
     * 나머지 거래의 합을 읽어 기초잔액을 역산하는 구조라, 읽기와 쓰기 사이에
     * 다른 요청이 끼어들면 두 번째 요청이 첫 번째의 결과를 덮어쓴다
     * (잔액 100만 설정과 50만 설정이 겹치면 어느 쪽도 아닌 값이 남는다).
     *
     * 자문 잠금은 프로젝트 단위로 잡는다. 계좌 단위로 잡으면 그 프로젝트의
     * 자본 계정을 처음 만드는 순간이 서로 겹쳐 자본 계정이 두 벌 생긴다.
     * 트랜잭션이 끝나면 커밋이든 롤백이든 자동으로 풀린다.
     */
    return this.prisma.$transaction(async (tx) => {
      // $queryRaw는 void 반환값을 역직렬화하지 못한다. 결과가 필요 없으므로
      // $executeRaw로 부른다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opening-balance:${input.projectId}`}))`;

      const existing = await this.findOpeningEntry(tx, input.projectId, input.accountId);

      // 기초잔액을 뺀 나머지 거래의 합. 이 위에 얹어서 목표 잔액을 만든다.
      const others = await tx.posting.aggregate({
        _sum: { amount: true },
        where: {
          accountId: input.accountId,
          ...(existing ? { entryId: { not: existing.id } } : {}),
        },
      });
      const openingAmount = input.targetBalance.sub(others._sum.amount ?? ZERO);

      // 기초잔액이 0이면 전표를 남기지 않는다. 0원 내역이 목록에 보일 이유가 없다.
      if (openingAmount.isZero()) {
        if (existing) await this.deleteEntry(existing.id, input.projectId, tx);
        return null;
      }

      const equity = await this.getOrCreateOpeningBalanceAccount(tx, input.projectId);

      // 외화 통장이면 기초잔액도 그 통화로 남고, 상대편 자본 계정은 기준통화다.
      const { base, rate } = await this.resolveConversion(
        input.projectId,
        account.currency,
        account.currency,
        input.exchangeRate,
      );
      const openingBase = this.toBase(openingAmount, rate, base);

      const entry: EntryInput = {
        projectId: input.projectId,
        personId: account.ownerId!,
        date: OPENING_BALANCE_DATE,
        description: `${account.name} 기초잔액`,
        createdByUserId: input.createdByUserId,
        postings: [
          {
            accountId: account.id,
            amount: openingAmount,
            currency: account.currency,
            exchangeRate: rate,
            baseAmount: openingBase,
          },
          this.baseLeg({ accountId: equity.id }, openingBase.neg(), base),
        ],
      };

      // replaceEntry는 옛 posting의 잔액 영향을 되돌린 뒤 새로 적용하므로
      // 금액만 바뀐 경우에도 balance 컬럼이 정확히 따라온다.
      return existing
        ? this.replaceEntry(existing.id, entry, tx)
        : this.createEntry(entry, tx);
    },
    // 잠금을 기다리는 시간이 더해질 수 있어 기본 5초보다 넉넉하게 둔다.
    { timeout: 15_000 });
  }

  /**
   * 그 계좌의 기초잔액 전표. 계좌 posting과 자본 계정 posting을 함께 가진 전표다.
   *
   * 계좌마다 하나만 유지되지만(이 서비스만 만든다) date 오름차순으로 맨 앞을 집어
   * 여러 건이 있어도 가장 앞선 것을 기준으로 삼는다.
   */
  private async findOpeningEntry(db: Db, projectId: string, accountId: string) {
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
  private async getOrCreateOpeningBalanceAccount(db: Db, projectId: string) {
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

  // ───────────────────────────────────────────
  // 내부 헬퍼
  // ───────────────────────────────────────────

  private toPostingData(p: PostingInput) {
    const extra = p.extraAmount ?? ZERO;

    return {
      accountId: p.accountId ?? null,
      categoryId: p.categoryId ?? null,
      amount: p.amount,
      quantity: p.quantity ?? null,
      currency: p.currency,
      exchangeRate: p.exchangeRate,
      // 빌더가 정한 값을 그대로 쓴다. 여기서 다시 곱하면 반올림이 어긋난다.
      baseAmount: p.baseAmount,
      extraAmount: extra,
      /*
       * 일반 몫은 남은 금액이다. 여기 한 곳에서만 채워 두 값이 어긋나지 않게 한다.
       *
       * 카테고리 다리에만 뜻이 있다. 계좌 다리에 금액을 넣으면 카테고리 조건을
       * 빠뜨린 조회에서 계좌 다리까지 "일반 지출"로 걸린다.
       */
      normalAmount: p.categoryId ? p.baseAmount.abs().sub(extra) : ZERO,
      cardId: p.cardId ?? null,
    };
  }

  private sum(amounts: Prisma.Decimal[]): Prisma.Decimal {
    return amounts.reduce((acc, a) => acc.add(a), ZERO);
  }

  /**
   * 전표 날짜가 원장 하한 안에 있는지 검증.
   *
   * 기초잔액 전표보다 앞선 거래가 들어오면 "처음에 이만큼 있었다"는 전제가 깨지고
   * 계좌 원장의 첫 줄이 기초잔액이 아니게 된다. 화면은 날짜 입력 min으로 막지만
   * API를 직접 부르는 경로가 있으므로 여기서도 막는다.
   *
   * 하한은 기초잔액 전표 날짜 자신이다(= 그 날짜는 허용). 그래서 기초잔액을 만드는
   * 이 서비스의 호출도 그대로 통과한다.
   */
  private assertDateInRange(date: Date) {
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
  private assertBalanced(postings: PostingInput[]) {
    const violation = checkPostings(postings);
    if (violation) throw new BadRequestException(violation.message);
  }

  /**
   * 전표가 참조하는 것이 모두 이 프로젝트 것인지 확인 (교차 프로젝트 오염 방지).
   *
   * 거래 주체(personId)도 함께 본다. 계좌와 카테고리만 검사하던 시절에는
   * 남의 프로젝트 Person id를 그대로 실어 보내면 저장이 됐고, 그 사람 이름이
   * 이쪽 거래 목록에 그대로 나왔다.
   */
  private async assertTargetsBelongToProject(db: Db, input: EntryInput) {
    const { projectId, postings } = input;
    const accountIds = [...new Set(postings.map((p) => p.accountId).filter(Boolean))] as string[];
    const categoryIds = [...new Set(postings.map((p) => p.categoryId).filter(Boolean))] as string[];

    if (!input.personId) {
      throw new BadRequestException('거래 주체를 지정해야 합니다.');
    }

    const person = await db.person.count({
      where: { id: input.personId, projectId },
    });
    if (person === 0) {
      throw notFound('NOT_PROJECT_MEMBER', '이 프로젝트의 구성원이 아닙니다.');
    }

    if (accountIds.length > 0) {
      const found = await db.account.count({
        where: { id: { in: accountIds }, projectId },
      });
      if (found !== accountIds.length) {
        throw new NotFoundException('이 프로젝트에 없는 계좌가 포함되어 있습니다.');
      }
    }

    if (categoryIds.length > 0) {
      const found = await db.category.count({
        where: { id: { in: categoryIds }, projectId },
      });
      if (found !== categoryIds.length) {
        throw new NotFoundException('이 프로젝트에 없는 카테고리가 포함되어 있습니다.');
      }
    }
  }

  /** 계좌 잔액과 투자 수량 캐시를 posting 합계만큼 움직인다. */
  /**
   * 할부 일정을 카드 부채 posting에 붙인다.
   *
   * 전표 수정은 posting을 지우고 새로 만들므로(replaceEntry) 일정도 cascade로 사라진다.
   * 그래서 생성과 수정 양쪽에서 같은 함수를 부른다.
   */
  private async saveInstallmentPlan(
    tx: Tx,
    postings: Array<{ id: string; cardId: string | null; amount: Prisma.Decimal }>,
    months?: number,
  ) {
    if (!months || months < 2) return;

    // 카드 부채 다리가 할부의 주인이다. 지출이면 음수 다리 하나뿐이다.
    const cardLeg = postings.find((p) => p.cardId && p.amount.lt(ZERO));
    if (!cardLeg) {
      throw badRequest('INSTALLMENT_CREDIT_ONLY', '할부는 신용카드 지출에만 설정할 수 있습니다.');
    }
    await tx.installmentPlan.create({
      data: { postingId: cardLeg.id, totalMonths: months },
    });
  }

  private async applyBalanceDeltas(
    tx: Tx,
    postings: Array<{ accountId?: string; amount: Prisma.Decimal; quantity?: Prisma.Decimal }>,
  ) {
    const balanceDeltas = new Map<string, Prisma.Decimal>();
    const quantityDeltas = new Map<string, Prisma.Decimal>();

    for (const p of postings) {
      if (!p.accountId) continue;
      balanceDeltas.set(p.accountId, (balanceDeltas.get(p.accountId) ?? ZERO).add(p.amount));
      if (p.quantity) {
        quantityDeltas.set(p.accountId, (quantityDeltas.get(p.accountId) ?? ZERO).add(p.quantity));
      }
    }

    for (const [accountId, delta] of balanceDeltas) {
      if (delta.isZero()) continue;
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });
    }

    for (const [accountId, delta] of quantityDeltas) {
      if (delta.isZero()) continue;
      await tx.investmentDetail.update({
        where: { accountId },
        data: { quantity: { increment: delta } },
      });
    }
  }

  /** 카테고리 유효성 확인 + 과소비 금액 기본값 채우기 */
  private async getAccount(projectId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.projectId !== projectId) {
      throw new NotFoundException('계좌를 찾을 수 없습니다.');
    }
    return account;
  }

  private async getCard(projectId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.projectId !== projectId) {
      throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
    }
    return card;
  }
}
