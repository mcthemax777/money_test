import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, CardType } from '@prisma/client';
import { CardDto, zonedParts } from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import {
  closingMonthKey,
  closingMonthOf,
  periodForClosingMonth,
  shiftClosingMonth,
} from '../ledger/statement-period';

const ZERO = new Prisma.Decimal(0);
/** 기본으로 보여 주는 과거 주기 수 (진행 중인 주기 포함) */
const DEFAULT_PERIODS = 6;
const MAX_PERIODS = 24;

/**
 * 카드의 원장 쪽 관심사. 대금 이동 기록과 주기별 사용액 계산.
 *
 * 청구서를 테이블로 저장하지 않는다. 주기는 카드의 현재 마감일 설정으로 읽을 때
 * 계산한다. 그래서 마감일을 바꾸면 과거 주기까지 곧바로 다시 그려지고,
 * 거래를 옮기거나 지워도 어긋날 저장물이 없다.
 */
@Injectable()
export class CardLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * 카드사와 통장 사이 자금 이동을 기록한다.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식이 실제로 있어서, 그 사이 부채는 양수로 남아야 한다.
   */
  async transfer(cardId: string, userId: string, dto: CardDto.TransferRequest) {
    const card = await this.loadCreditCard(cardId, userId);

    return this.ledger.createCardTransfer({
      projectId: card.projectId,
      personId: dto.personId,
      date: new Date(dto.date),
      description: dto.description || defaultDescription(card.name, dto.direction),
      createdByUserId: userId,
      cardId: card.id,
      accountId: dto.accountId,
      amount: new Prisma.Decimal(dto.amount),
      direction: dto.direction,
    });
  }

  /**
   * 남은 대금과 주기별 사용액.
   *
   * "사용"은 부호가 아니라 상대 다리로 가른다. 부채 계정의 음수 posting에는
   * 카드 사용뿐 아니라 환불 입금도 섞이기 때문이다. 지출 카테고리 다리를 함께
   * 가진 전표만 사용으로 센다.
   */
  async getUsage(cardId: string, userId: string, months?: number): Promise<CardDto.UsageResponse> {
    const card = await this.loadCreditCard(cardId, userId);
    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = Math.min(Math.max(Number(months) || DEFAULT_PERIODS, 1), MAX_PERIODS);

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.liabilityAccountId! },
      select: { balance: true },
    });

    const usages = await this.prisma.posting.findMany({
      where: {
        accountId: card.liabilityAccountId!,
        entry: { postings: { some: { categoryId: { not: null } } } },
      },
      select: {
        amount: true,
        entry: { select: { date: true } },
        installmentPlan: { select: { totalMonths: true } },
      },
    });

    // 마감 연월 -> 그 주기에 청구되는 금액
    const byMonth = new Map<string, Prisma.Decimal>();
    const add = (closing: { year: number; month: number }, amount: Prisma.Decimal) => {
      const key = closingMonthKey(closing);
      byMonth.set(key, (byMonth.get(key) ?? ZERO).add(amount));
    };

    for (const usage of usages) {
      // 부채 posting은 사용이 음수다. 표시용으로 뒤집는다.
      const total = usage.amount.neg();
      const purchase = closingMonthOf(usage.entry.date, card.statementClosingDay!, timeZone);

      for (const [offset, share] of splitInstallment(
        total,
        usage.installmentPlan?.totalMonths ?? 1,
      ).entries()) {
        add(shiftClosingMonth(purchase, offset), share);
      }
    }

    const today = zonedParts(new Date(), timeZone);
    const current = closingMonthOf(new Date(), card.statementClosingDay!, timeZone);
    const todayMarker = Date.UTC(today.year, today.month - 1, today.day);

    // 최근 span개 주기를 기본으로 하되, 할부 때문에 금액이 잡힌 미래 주기까지 넓힌다.
    const first = shiftClosingMonth(current, -(span - 1));
    let last = current;
    for (const key of byMonth.keys()) {
      const [year, month] = key.split('-').map(Number);
      if (key > closingMonthKey(last)) last = { year, month };
    }

    const periods: CardDto.UsagePeriod[] = [];
    for (
      let cursor = first;
      closingMonthKey(cursor) <= closingMonthKey(last);
      cursor = shiftClosingMonth(cursor, 1)
    ) {
      const period = periodForClosingMonth(
        cursor.year,
        cursor.month,
        card.statementClosingDay!,
        card.paymentDueDay!,
      );
      periods.push({
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        dueDate: period.dueDate.toISOString(),
        closed: period.periodEnd.getTime() < todayMarker,
        usage: (byMonth.get(closingMonthKey(cursor)) ?? ZERO).toString(),
      });
    }

    return {
      cardId: card.id,
      // 부채는 음수로 쌓인다. 남은 대금은 부호를 뒤집은 값이고, 음수면 환불 예정이다.
      outstanding: liability.balance.neg().toString(),
      periods,
    };
  }

  private async loadCreditCard(cardId: string, userId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    if (card.cardType !== CardType.credit || !card.liabilityAccountId) {
      throw new BadRequestException('신용카드만 대금 이동과 청구 주기를 다룹니다.');
    }
    if (card.statementClosingDay === null || card.paymentDueDay === null) {
      throw new BadRequestException('신용카드에 마감일과 결제일이 설정되어 있지 않습니다.');
    }
    return card;
  }
}

/**
 * 할부 회차 금액. 나누어떨어지지 않는 끝수는 첫 회차에 몰아준다.
 * 10,000원 3개월이면 3,334 / 3,333 / 3,333 이 된다.
 */
function splitInstallment(total: Prisma.Decimal, months: number): Prisma.Decimal[] {
  if (months <= 1) return [total];

  // 원 단위로 자른다. 소수 통화는 지금 다루지 않는다.
  const each = total.div(months).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const shares = Array.from({ length: months }, () => each);
  shares[0] = each.add(total.sub(each.mul(months)));
  return shares;
}

function defaultDescription(cardName: string, direction: CardDto.TransferRequest['direction']) {
  return direction === 'refund' ? `${cardName} 환불 입금` : `${cardName} 대금 결제`;
}
