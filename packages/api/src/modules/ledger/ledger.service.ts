import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, AccountType } from '@prisma/client';
import {
  DEFAULT_TIME_ZONE,
  LEDGER_OPENING_DATE_KEY,
  ledgerOpeningDate,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { resolveStatementPeriod } from './statement-period';

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

/** 전표의 개별 다리. accountId와 categoryId 중 정확히 하나만 채운다. */
export interface PostingInput {
  accountId?: string;
  categoryId?: string;
  amount: Prisma.Decimal;
  quantity?: Prisma.Decimal;
  currency?: string;
  exchangeRate?: Prisma.Decimal;
  isFixed?: boolean;
  cardId?: string;
  statementId?: string;
}

export interface EntryInput {
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
  postings: PostingInput[];
}

/** 지출/수입에서 카테고리별로 금액을 쪼갤 때 쓰는 항목 */
export interface CategoryLine {
  categoryId: string;
  amount: Prisma.Decimal;
  /** 생략하면 Category.defaultIsFixed를 따른다 */
  isFixed?: boolean;
}

interface CommonInput {
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
}

export interface ExpenseInput extends CommonInput {
  lines: CategoryLine[];
  /** accountId와 cardId 중 정확히 하나. 카드면 카드 종류에 따라 자금 출처가 결정된다. */
  accountId?: string;
  cardId?: string;
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
  /** 이체 수수료. 보내는 계좌에서 함께 빠진다. */
  feeAmount?: Prisma.Decimal;
  feeCategoryId?: string;
  /** 수수료의 고정 여부. 생략하면 수수료 카테고리의 defaultIsFixed를 따른다. */
  feeIsFixed?: boolean;
}

export interface CardPaymentInput extends CommonInput {
  cardId: string;
  /** 결제 대금이 빠져나가는 계좌 */
  accountId: string;
  amount: Prisma.Decimal;
  /** 어느 청구서를 갚는지. 생략하면 오래된 미결제 청구서부터 채운다. */
  statementId?: string;
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
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────
  // 원시 연산
  // ───────────────────────────────────────────

  /**
   * 전표 하나를 만든다. 검증과 잔액 반영을 모두 한 트랜잭션에서 처리한다.
   * 중간에 실패하면 잔액도 함께 롤백되므로 드리프트가 생기지 않는다.
   */
  async createEntry(input: EntryInput) {
    this.assertBalanced(input.postings);
    this.assertDateInRange(input.date);
    await this.assertTargetsBelongToProject(input.projectId, input.postings);

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          projectId: input.projectId,
          personId: input.personId,
          date: input.date,
          description: input.description,
          merchant: input.merchant ?? null,
          detailedNote: input.detailedNote ?? null,
          createdByUserId: input.createdByUserId ?? null,
          postings: { create: input.postings.map((p) => this.toPostingData(p)) },
        },
        include: { postings: true },
      });

      await this.applyBalanceDeltas(tx, input.postings);
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
  async replaceEntry(entryId: string, input: EntryInput) {
    this.assertBalanced(input.postings);
    this.assertDateInRange(input.date);
    await this.assertTargetsBelongToProject(input.projectId, input.postings);

    const existing = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { postings: true },
    });
    if (!existing || existing.projectId !== input.projectId) {
      throw new NotFoundException('거래를 찾을 수 없습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
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
          postings: { create: input.postings.map((p) => this.toPostingData(p)) },
        },
        include: { postings: true },
      });

      // 3) 새 posting의 잔액을 적용한다
      await this.applyBalanceDeltas(tx, input.postings);
      return entry;
    });
  }

  /**
   * 전표를 지운다. 잔액을 역방향으로 되돌린 뒤 삭제한다.
   * Posting은 onDelete: Cascade로 함께 사라진다.
   */
  async deleteEntry(entryId: string, projectId: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { postings: true },
    });

    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundException('거래를 찾을 수 없습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      const reversed = entry.postings.map((p) => ({
        accountId: p.accountId ?? undefined,
        amount: p.amount.neg(),
        quantity: p.quantity ? p.quantity.neg() : undefined,
      }));
      await this.applyBalanceDeltas(tx, reversed);
      return tx.journalEntry.delete({ where: { id: entryId } });
    });
  }

  // ───────────────────────────────────────────
  // 조립 헬퍼
  // ───────────────────────────────────────────

  /**
   * 지출. 결제수단이 계좌든 체크카드든 신용카드든 카테고리측 posting은 동일하다.
   * "지출 = 지출 카테고리 posting의 합"이라는 정의가 결제수단과 분리되는 지점.
   */
  async createExpense(input: ExpenseInput) {
    return this.createEntry(await this.buildExpense(input));
  }

  async buildExpense(input: ExpenseInput): Promise<EntryInput> {
    const lines = await this.resolveLines(input.projectId, input.lines, 'expense');
    const total = this.sum(lines.map((l) => l.amount));
    const source = await this.resolvePaymentSource(input.projectId, input.date, {
      accountId: input.accountId,
      cardId: input.cardId,
    });

    return {
      ...input,
      postings: [
        // 지출 발생 = +
        ...lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount, isFixed: l.isFixed })),
        // 자산 감소 또는 부채 증가 = -
        {
          accountId: source.accountId,
          amount: total.neg(),
          cardId: source.cardId,
          statementId: source.statementId,
        },
      ],
    };
  }

  /** 수입. 수입 카테고리는 -, 입금 계좌는 +. */
  async createIncome(input: IncomeInput) {
    return this.createEntry(await this.buildIncome(input));
  }

  async buildIncome(input: IncomeInput): Promise<EntryInput> {
    const lines = await this.resolveLines(input.projectId, input.lines, 'income');
    const total = this.sum(lines.map((l) => l.amount));
    await this.getAccount(input.projectId, input.accountId);

    return {
      ...input,
      postings: [
        ...lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount.neg() })),
        { accountId: input.accountId, amount: total },
      ],
    };
  }

  /**
   * 이체. 수수료가 있으면 3-leg 전표 하나로 만든다.
   * 기존 구조처럼 수수료를 별도 거래로 만들고 서로 참조시키지 않는다.
   */
  async createTransfer(input: TransferInput) {
    return this.createEntry(await this.buildTransfer(input));
  }

  async buildTransfer(input: TransferInput): Promise<EntryInput> {
    if (input.fromAccountId === input.toAccountId) {
      throw new BadRequestException('보내는 계좌와 받는 계좌가 같습니다.');
    }
    if (input.amount.lte(ZERO)) {
      throw new BadRequestException('이체 금액은 0보다 커야 합니다.');
    }

    const fee = input.feeAmount ?? ZERO;
    if (fee.gt(ZERO) && !input.feeCategoryId) {
      throw new BadRequestException('수수료를 입력하려면 수수료 카테고리가 필요합니다.');
    }

    await this.getAccount(input.projectId, input.fromAccountId);
    await this.getAccount(input.projectId, input.toAccountId);

    const postings: PostingInput[] = [
      { accountId: input.fromAccountId, amount: input.amount.add(fee).neg() },
      { accountId: input.toAccountId, amount: input.amount },
    ];
    if (fee.gt(ZERO)) {
      // 수수료도 지출 카테고리 다리다. 지출/수입과 같은 검증을 거쳐야
      // 다른 프로젝트의 카테고리나 수입 카테고리가 수수료 자리에 들어오지 않는다.
      // isFixed 기본값도 여기서 카테고리에서 가져온다.
      const [line] = await this.resolveLines(
        input.projectId,
        [{ categoryId: input.feeCategoryId!, amount: fee, isFixed: input.feeIsFixed }],
        'expense',
      );
      postings.push({ categoryId: line.categoryId, amount: line.amount, isFixed: line.isFixed });
    }

    return { ...input, postings };
  }

  /**
   * 카드대금 결제. 지출이 아니라 부채 상환이므로 카테고리 posting이 없다.
   * 이것이 credit_usage/credit_payment 이중 계상 문제가 사라지는 이유다.
   */
  async createCardPayment(input: CardPaymentInput) {
    return this.createEntry(await this.buildCardPayment(input));
  }

  async buildCardPayment(input: CardPaymentInput): Promise<EntryInput> {
    if (input.amount.lte(ZERO)) {
      throw new BadRequestException('결제 금액은 0보다 커야 합니다.');
    }

    const card = await this.getCard(input.projectId, input.cardId);
    if (card.cardType !== CardType.credit) {
      throw new BadRequestException('신용카드만 대금 결제 대상입니다.');
    }
    await this.getAccount(input.projectId, input.accountId);

    let statementId = input.statementId;
    if (statementId) {
      const statement = await this.prisma.cardStatement.findUnique({ where: { id: statementId } });
      if (!statement || statement.cardId !== input.cardId) {
        throw new NotFoundException('청구서를 찾을 수 없습니다.');
      }
    } else {
      // 지정하지 않으면 가장 오래된 미결제 청구서에 붙인다.
      // status 컬럼은 두지 않으므로 posting 합계가 0이 아닌 것을 미결제로 본다.
      const unpaid = await this.prisma.posting.groupBy({
        by: ['statementId'],
        where: { statement: { cardId: input.cardId } },
        _sum: { amount: true },
      });
      const outstandingIds = unpaid
        .filter((row) => row.statementId && !(row._sum.amount ?? ZERO).isZero())
        .map((row) => row.statementId as string);

      if (outstandingIds.length > 0) {
        const oldest = await this.prisma.cardStatement.findFirst({
          where: { id: { in: outstandingIds } },
          orderBy: { periodEnd: 'asc' },
        });
        statementId = oldest?.id;
      }
    }

    if (!card.liabilityAccountId) {
      throw new BadRequestException('신용카드에 부채 계정이 없습니다.');
    }

    return {
      ...input,
      postings: [
        { accountId: input.accountId, amount: input.amount.neg() }, // 통장 감소
        {
          accountId: card.liabilityAccountId,
          amount: input.amount, // 부채 상환 = +
          cardId: card.id,
          statementId,
        },
      ],
    };
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
    targetBalance: Prisma.Decimal;
    createdByUserId?: string | null;
  }) {
    const account = await this.getAccount(input.projectId, input.accountId);
    if (account.type === AccountType.opening_balance) {
      throw new BadRequestException('자본 계정에는 잔액을 직접 설정할 수 없습니다.');
    }
    if (!account.ownerId) {
      throw new BadRequestException('소유자가 없는 계좌에는 잔액을 설정할 수 없습니다.');
    }

    const existing = await this.findOpeningEntry(input.projectId, input.accountId);

    // 기초잔액을 뺀 나머지 거래의 합. 이 위에 얹어서 목표 잔액을 만든다.
    const others = await this.prisma.posting.aggregate({
      _sum: { amount: true },
      where: {
        accountId: input.accountId,
        ...(existing ? { entryId: { not: existing.id } } : {}),
      },
    });
    const openingAmount = input.targetBalance.sub(others._sum.amount ?? ZERO);

    // 기초잔액이 0이면 전표를 남기지 않는다. 0원 내역이 목록에 보일 이유가 없다.
    if (openingAmount.isZero()) {
      if (existing) await this.deleteEntry(existing.id, input.projectId);
      return null;
    }

    const equity = await this.getOrCreateOpeningBalanceAccount(input.projectId);
    const entry: EntryInput = {
      projectId: input.projectId,
      personId: account.ownerId,
      date: OPENING_BALANCE_DATE,
      description: `${account.name} 기초잔액`,
      createdByUserId: input.createdByUserId,
      postings: [
        { accountId: account.id, amount: openingAmount },
        { accountId: equity.id, amount: openingAmount.neg() },
      ],
    };

    // replaceEntry는 옛 posting의 잔액 영향을 되돌린 뒤 새로 적용하므로
    // 금액만 바뀐 경우에도 balance 컬럼이 정확히 따라온다.
    return existing
      ? this.replaceEntry(existing.id, entry)
      : this.createEntry(entry);
  }

  /**
   * 그 계좌의 기초잔액 전표. 계좌 posting과 자본 계정 posting을 함께 가진 전표다.
   *
   * 계좌마다 하나만 유지되지만(이 서비스만 만든다) date 오름차순으로 맨 앞을 집어
   * 여러 건이 있어도 가장 앞선 것을 기준으로 삼는다.
   */
  private async findOpeningEntry(projectId: string, accountId: string) {
    const equity = await this.prisma.account.findFirst({
      where: { projectId, type: AccountType.opening_balance },
      select: { id: true },
    });
    if (!equity) return null;

    return this.prisma.journalEntry.findFirst({
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
  private async getOrCreateOpeningBalanceAccount(projectId: string) {
    const existing = await this.prisma.account.findFirst({
      where: { projectId, type: AccountType.opening_balance },
    });
    if (existing) return existing;

    return this.prisma.account.create({
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
    const rate = p.exchangeRate ?? new Prisma.Decimal(1);
    return {
      accountId: p.accountId ?? null,
      categoryId: p.categoryId ?? null,
      amount: p.amount,
      quantity: p.quantity ?? null,
      currency: p.currency ?? 'KRW',
      exchangeRate: rate,
      baseAmount: p.amount.mul(rate),
      isFixed: p.isFixed ?? false,
      cardId: p.cardId ?? null,
      statementId: p.statementId ?? null,
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
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('거래 날짜가 올바르지 않습니다.');
    }
    if (date < OPENING_BALANCE_DATE) {
      throw new BadRequestException(
        `${LEDGER_OPENING_DATE_KEY} 이전 날짜의 거래는 기록할 수 없습니다.`,
      );
    }
  }

  /** 전표 균형과 posting 배타 조건 검증. DB CHECK 제약보다 먼저 걸러 메시지를 명확히 한다. */
  private assertBalanced(postings: PostingInput[]) {
    if (postings.length < 2) {
      throw new BadRequestException('전표에는 최소 2개의 posting이 필요합니다.');
    }

    for (const p of postings) {
      const hasAccount = Boolean(p.accountId);
      const hasCategory = Boolean(p.categoryId);
      if (hasAccount === hasCategory) {
        throw new BadRequestException(
          'posting은 계좌와 카테고리 중 정확히 하나만 가리켜야 합니다.',
        );
      }
      if (p.quantity && !hasAccount) {
        throw new BadRequestException('수량은 계좌 posting에만 기록할 수 있습니다.');
      }
      if (p.amount.isZero()) {
        throw new BadRequestException('금액이 0인 posting은 만들 수 없습니다.');
      }
    }

    const total = this.sum(postings.map((p) => p.amount));
    if (!total.isZero()) {
      throw new BadRequestException(`전표 차변과 대변이 맞지 않습니다. 차액: ${total.toString()}`);
    }
  }

  /** 참조하는 계좌/카테고리가 모두 이 프로젝트 것인지 확인 (교차 프로젝트 오염 방지) */
  private async assertTargetsBelongToProject(projectId: string, postings: PostingInput[]) {
    const accountIds = [...new Set(postings.map((p) => p.accountId).filter(Boolean))] as string[];
    const categoryIds = [...new Set(postings.map((p) => p.categoryId).filter(Boolean))] as string[];

    if (accountIds.length > 0) {
      const found = await this.prisma.account.count({
        where: { id: { in: accountIds }, projectId },
      });
      if (found !== accountIds.length) {
        throw new NotFoundException('이 프로젝트에 없는 계좌가 포함되어 있습니다.');
      }
    }

    if (categoryIds.length > 0) {
      const found = await this.prisma.category.count({
        where: { id: { in: categoryIds }, projectId },
      });
      if (found !== categoryIds.length) {
        throw new NotFoundException('이 프로젝트에 없는 카테고리가 포함되어 있습니다.');
      }
    }
  }

  /** 계좌 잔액과 투자 수량 캐시를 posting 합계만큼 움직인다. */
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

  /** 카테고리 유효성 확인 + isFixed 기본값 채우기 */
  private async resolveLines(
    projectId: string,
    lines: CategoryLine[],
    expectedType: 'income' | 'expense',
  ): Promise<Required<CategoryLine>[]> {
    if (lines.length === 0) {
      throw new BadRequestException('카테고리를 최소 하나 지정해야 합니다.');
    }

    const categories = await this.prisma.category.findMany({
      where: { id: { in: lines.map((l) => l.categoryId) }, projectId },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    return lines.map((line) => {
      const category = byId.get(line.categoryId);
      if (!category) {
        throw new NotFoundException(`카테고리를 찾을 수 없습니다: ${line.categoryId}`);
      }
      if (category.type !== expectedType) {
        throw new BadRequestException(
          `${expectedType === 'expense' ? '지출' : '수입'}에 ${category.type} 카테고리를 쓸 수 없습니다: ${category.name}`,
        );
      }
      if (line.amount.lte(ZERO)) {
        throw new BadRequestException('금액은 0보다 커야 합니다.');
      }
      return {
        categoryId: line.categoryId,
        amount: line.amount,
        isFixed: line.isFixed ?? category.defaultIsFixed,
      };
    });
  }

  /**
   * 결제수단을 실제 자금 출처 계좌로 번역한다.
   *   계좌 직접 지정 -> 그 계좌
   *   체크카드      -> 연결된 예금 계좌 (즉시 출금)
   *   신용카드      -> 카드의 부채 계좌 + 해당 시점 청구서
   */
  private async resolvePaymentSource(
    projectId: string,
    date: Date,
    source: { accountId?: string; cardId?: string },
  ): Promise<{ accountId: string; cardId?: string; statementId?: string }> {
    if (Boolean(source.accountId) === Boolean(source.cardId)) {
      throw new BadRequestException('결제수단으로 계좌와 카드 중 하나만 지정해야 합니다.');
    }

    if (source.accountId) {
      await this.getAccount(projectId, source.accountId);
      return { accountId: source.accountId };
    }

    const card = await this.getCard(projectId, source.cardId!);

    if (card.cardType === CardType.debit) {
      // 체크카드는 결제 즉시 연결 통장에서 빠진다. 빚도 청구서도 생기지 않는다.
      return { accountId: card.paymentAccountId, cardId: card.id };
    }

    // 신용카드는 통장이 아니라 부채 계정에 쌓인다. 통장에서는 결제일에 빠진다.
    if (!card.liabilityAccountId) {
      throw new BadRequestException('신용카드에 부채 계정이 없습니다.');
    }
    const statement = await this.findOrCreateStatement(card, date);
    return { accountId: card.liabilityAccountId, cardId: card.id, statementId: statement.id };
  }

  /** 거래일이 속한 청구서를 찾고, 없으면 연다. */
  private async findOrCreateStatement(
    card: {
      id: string;
      projectId: string;
      statementClosingDay: number | null;
      paymentDueDay: number | null;
    },
    date: Date,
  ) {
    if (card.statementClosingDay === null || card.paymentDueDay === null) {
      throw new BadRequestException('신용카드에 마감일과 결제일이 설정되어 있지 않습니다.');
    }

    // 마감일 경계는 프로젝트 타임존의 달력 날짜로 판단한다 (UTC로 읽으면 하루 밀린다).
    const timeZone = await this.projectTimeZone(card.projectId);
    const period = resolveStatementPeriod(
      date,
      card.statementClosingDay,
      card.paymentDueDay,
      timeZone,
    );

    return this.prisma.cardStatement.upsert({
      where: { cardId_periodEnd: { cardId: card.id, periodEnd: period.periodEnd } },
      create: {
        cardId: card.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
      },
      update: {},
    });
  }

  /** 프로젝트의 집계 기준 타임존 */
  private async projectTimeZone(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { timezone: true },
    });
    return project?.timezone || DEFAULT_TIME_ZONE;
  }

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
      throw new NotFoundException('카드를 찾을 수 없습니다.');
    }
    return card;
  }
}
