import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, ProjectRole } from '@prisma/client';
import {
  CardDto,
  currencyDecimals,
  zonedCurrentYearMonth,
  zonedMonthRange,
  zonedParts,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { toMoney } from '@/common/money';
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
 * 앞으로 몇 주기까지 벌려서 보여 줄지.
 *
 * 할부는 구매 시점 이후 주기로 넘어가므로 미래 주기를 만들어야 한다. 그런데
 * 상한이 없으면 잘못 입력된 먼 미래 거래 하나가 지금부터 그 달까지를 전부 만든다
 * (2926년 한 건에 주기 10,806개, 응답 1.5MB). 거래 날짜에 5년 상한을 걸었지만
 * 그 전에 들어온 데이터가 이미 있을 수 있으므로 여기서도 자른다.
 *
 * 60개월이면 실제로 쓰이는 최장 할부(보통 36개월)를 넉넉히 덮는다.
 */
const MAX_FUTURE_PERIODS = 60;

/**
 * 카드의 원장 쪽 관심사. 대금 이동 기록과 주기별 사용액 계산.
 *
 * 청구서를 테이블로 저장하지 않는다. 주기는 카드의 현재 마감일 설정으로 읽을 때
 * 계산한다. 그래서 마감일을 바꾸면 과거 주기까지 곧바로 다시 그려지고,
 * 거래를 옮기거나 지워도 어긋날 저장물이 없다.
 */
@Injectable()
export class CardLedgerService {
  private readonly logger = new Logger(CardLedgerService.name);

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
    const card = await this.loadCreditCard(cardId, userId, 'editor');

    return this.ledger.createCardTransfer({
      projectId: card.projectId,
      personId: dto.personId,
      date: new Date(dto.date),
      description: dto.description || defaultDescription(card.name, dto.direction),
      createdByUserId: userId,
      cardId: card.id,
      accountId: dto.accountId,
      amount: toMoney(dto.amount, '카드 대금'),
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
    const debit = await this.debitUsage(cardId, userId, months);
    if (debit) return debit;

    const card = await this.loadCreditCard(cardId, userId);
    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = Math.min(Math.max(Number(months) || DEFAULT_PERIODS, 1), MAX_PERIODS);

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.liabilityAccountId! },
      select: { balance: true, currency: true },
    });

    /*
     * 표시 구간에 걸릴 수 있는 사용만 읽는다.
     *
     * 예전에는 이 카드의 posting 전부를 매번 읽었다. 화면에는 최근 몇 주기만
     * 나오는데 몇 해치를 다 읽어 오므로 거래가 쌓일수록 그대로 느려졌다.
     *
     * 단순히 "구간 시작 이후"로 자를 수는 없다. 할부는 예전 구매가 지금 주기에
     * 청구되기 때문이다. 그래서 이 카드의 최장 할부 개월수만큼 앞에서부터 읽는다.
     */
    const longestPlan = await this.prisma.installmentPlan.aggregate({
      _max: { totalMonths: true },
      where: { posting: { accountId: card.liabilityAccountId! } },
    });
    const lookbackMonths = span + (longestPlan._max.totalMonths ?? 1);
    const windowStart = shiftClosingMonth(
      closingMonthOf(new Date(), card.statementClosingDay!, timeZone),
      -lookbackMonths,
    );
    // 주기 경계보다 넉넉히 한 달 더 앞에서 자른다 (마감일 clamp로 며칠 밀릴 수 있다).
    const since = new Date(Date.UTC(windowStart.year, windowStart.month - 2, 1));

    const usages = await this.prisma.posting.findMany({
      where: {
        accountId: card.liabilityAccountId!,
        entry: {
          date: { gte: since },
          postings: { some: { categoryId: { not: null } } },
        },
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
    const furthest = shiftClosingMonth(current, MAX_FUTURE_PERIODS);
    const furthestKey = closingMonthKey(furthest);

    let last = current;
    let clipped = false;
    for (const key of byMonth.keys()) {
      if (key > furthestKey) {
        // 잘못된 날짜의 거래가 섞여 있다. 주기를 그 달까지 만들면 응답이 수만 행이 된다.
        clipped = true;
        continue;
      }
      const [year, month] = key.split('-').map(Number);
      if (key > closingMonthKey(last)) last = { year, month };
    }
    if (clipped) {
      this.logger.warn(
        `카드 ${card.id}: 표시 범위(${furthestKey})를 넘는 청구 주기가 있어 잘라냈습니다. 거래 날짜를 확인하세요.`,
      );
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
      // 사용액과 남은 대금은 이 카드의 통화다 (기준통화 환산액이 아니다).
      currency: liability.currency,
      // 부채는 음수로 쌓인다. 남은 대금은 부호를 뒤집은 값이고, 음수면 환불 예정이다.
      outstanding: liability.balance.neg().toString(),
      periods,
    };
  }

  /**
   * 체크카드의 달별 사용액.
   *
   * 청구 주기도 갚을 대금도 없지만 "지난달에 얼마 썼나"는 신용카드와 똑같이
   * 알고 싶은 값이다. 자를 기준만 달력 월로 바꿔 같은 모양으로 돌려준다.
   *
   * 신용카드면 null을 주어 호출부가 원래 계산으로 넘어가게 한다.
   */
  private async debitUsage(
    cardId: string,
    userId: string,
    months?: number,
  ): Promise<CardDto.UsageResponse | null> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    if (card.cardType === CardType.credit) return null;
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = Math.min(Math.max(Number(months) || DEFAULT_PERIODS, 1), MAX_PERIODS);
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    /*
     * 체크카드 사용은 연결 통장의 posting에 cardId가 함께 찍힌다. 통장에서 직접
     * 나간 지출에는 cardId가 없으므로 이 조건만으로 이 카드로 쓴 것만 걸린다.
     * 실적 계산(getPerformance)과 같은 규칙이다.
     */
    const [thisYear, thisMonth] = zonedCurrentYearMonth(timeZone).split('-').map(Number);
    const periods: CardDto.UsagePeriod[] = [];

    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const cursor = new Date(Date.UTC(thisYear, thisMonth - 1 - offset, 1));
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const { start, end } = zonedMonthRange(key, timeZone);
      const spent = await this.prisma.posting.aggregate({
        _sum: { amount: true },
        where: { cardId: card.id, entry: { date: { gte: start, lt: end } } },
      });

      periods.push({
        // 달력 날짜 표시자. 청구 주기 쪽과 같은 형태로 맞춘다 (그 달 1일 ~ 말일).
        periodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
        periodEnd: new Date(Date.UTC(year, month, 0)).toISOString(),
        // 이번 달만 아직 늘어날 수 있다.
        closed: offset > 0,
        usage: (spent._sum.amount ?? ZERO).neg().toString(),
      });
    }

    return {
      cardId: card.id,
      currency: paymentAccount.currency,
      // 체크카드는 결제 즉시 통장에서 빠진다. 갚을 대금이 남지 않는다.
      outstanding: '0',
      periods,
    };
  }

  /**
   * 실적 진행 상황.
   *
   * 세는 구간이 카드 종류마다 다르다.
   *   - 신용카드: 마감일 기준 청구 주기. 마감일이 15일이면 8/16~9/15가 한 구간이다.
   *     카드사가 그 주기의 사용액으로 다음 달 혜택을 정하기 때문이다.
   *   - 체크카드: 달력 월. 청구 주기라는 것이 없어 자를 기준이 달력뿐이다.
   *
   * 신용카드 사용액은 getUsage의 계산을 그대로 쓴다. 카드 화면이 이미 그 값을
   * "이번 주기 사용액"으로 보여 주고 있어서, 여기서 따로 세면 같은 화면에 두 숫자가
   * 다르게 나온다. 할부를 회차로 나누는 규칙도 그쪽 정의를 따른다.
   */
  async getPerformance(cardId: string, userId: string): Promise<CardDto.PerformanceResponse> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const target = card.performanceAmount;

    if (card.cardType === CardType.credit) {
      // getUsage가 마감일·부채 계정 유무까지 확인해 준다 (loadCreditCard).
      const { currency, periods } = await this.getUsage(cardId, userId, 2);
      // span=2면 앞의 두 칸이 지난 주기와 진행 중인 주기다.
      // 그 뒤 칸들은 할부가 걸린 미래 주기다.
      const [previous, current] = periods;

      return performanceOf({
        cardId: card.id,
        currency,
        basis: 'statement',
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
        usage: new Prisma.Decimal(current.usage),
        previousPeriodStart: previous.periodStart,
        previousPeriodEnd: previous.periodEnd,
        previousUsage: new Prisma.Decimal(previous.usage),
        target,
      });
    }

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    const yearMonth = zonedCurrentYearMonth(timeZone);
    const [year, month] = yearMonth.split('-').map(Number);
    const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

    /*
     * 체크카드 사용은 연결 통장의 posting에 cardId가 함께 찍힌다. 통장에서 직접 나간
     * 지출에는 cardId가 없으므로 이 조건만으로 이 카드로 쓴 것만 걸린다.
     *
     * 부호로 거르지 않고 그대로 더한다. 지금은 지출만 카드를 가리킬 수 있어 전부
     * 음수지만, 결제 취소가 양수로 들어오게 되면 그때는 빼는 것이 맞다. 실적은
     * 순사용액으로 판정하는 값이라 취소한 결제는 빠져야 한다.
     */
    const spentIn = async (period: { year: number; month: number }) => {
      const key = `${period.year}-${String(period.month).padStart(2, '0')}`;
      const { start, end } = zonedMonthRange(key, timeZone);
      const spent = await this.prisma.posting.aggregate({
        _sum: { amount: true },
        where: { cardId: card.id, entry: { date: { gte: start, lt: end } } },
      });
      return (spent._sum.amount ?? ZERO).neg();
    };

    /** 달력 날짜 표시자. 청구 주기 쪽과 같은 형태로 맞춘다 (그 달 1일 ~ 말일). */
    const monthMarkers = (period: { year: number; month: number }) => ({
      start: new Date(Date.UTC(period.year, period.month - 1, 1)).toISOString(),
      end: new Date(Date.UTC(period.year, period.month, 0)).toISOString(),
    });

    const [usage, previousUsage] = await Promise.all([
      spentIn({ year, month }),
      spentIn(previousMonth),
    ]);
    const markers = monthMarkers({ year, month });
    const previousMarkers = monthMarkers(previousMonth);

    return performanceOf({
      cardId: card.id,
      currency: paymentAccount.currency,
      basis: 'month',
      periodStart: markers.start,
      periodEnd: markers.end,
      usage,
      previousPeriodStart: previousMarkers.start,
      previousPeriodEnd: previousMarkers.end,
      previousUsage,
      target,
    });
  }

  /**
   * 청구액이 아직 확정되지 않은 외화 결제 목록.
   *
   * 명세서 대조를 이 카드 한 장, 이 주기로 좁히기 위한 목록이다. 원화 거래는
   * 청구액이 이미 정확하므로 여기에 들어오지 않는다. 사용자가 거래를 하나씩
   * 열어 찾아다니지 않게 하는 것이 목적이다.
   */
  async listPendingRates(cardId: string, userId: string): Promise<CardDto.PendingRatesResponse> {
    const card = await this.loadCreditCard(cardId, userId);
    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.liabilityAccountId! },
      select: { currency: true },
    });

    const postings = await this.prisma.posting.findMany({
      where: {
        accountId: card.liabilityAccountId!,
        entry: { rateProvisional: true, originalCurrency: { not: null } },
      },
      select: {
        amount: true,
        entry: {
          select: {
            id: true,
            date: true,
            description: true,
            merchant: true,
            originalCurrency: true,
            originalAmount: true,
          },
        },
      },
      orderBy: { entry: { date: 'asc' } },
    });

    const items = postings.map(({ amount, entry }) => {
      // 할부는 첫 회차가 청구되는 주기로 묶는다. 확정은 원금 전체에 걸리므로
      // 주기를 하나만 고를 수 있고, 그 거래가 처음 청구서에 오르는 주기가 맞다.
      const closing = closingMonthOf(entry.date, card.statementClosingDay!, timeZone);
      const period = periodForClosingMonth(
        closing.year,
        closing.month,
        card.statementClosingDay!,
        card.paymentDueDay!,
      );

      return {
        entryId: entry.id,
        date: entry.date.toISOString(),
        description: entry.description,
        merchant: entry.merchant,
        originalCurrency: entry.originalCurrency!,
        originalAmount: entry.originalAmount!.toString(),
        // 부채는 음수로 쌓인다. 화면이 쓰는 청구액으로 부호를 뒤집는다.
        estimatedAmount: amount.neg().toString(),
        closingMonth: closingMonthKey(closing),
        dueDate: period.dueDate.toISOString(),
      };
    });

    return { cardId: card.id, currency: liability.currency, items };
  }

  /**
   * 추정 청구액을 실제 청구액으로 확정한다.
   *
   * 명세서가 건마다 금액을 찍어 주면 그 금액을 그대로 받고, 적용 환율만 한 줄로
   * 적혀 있으면 환율 하나로 전부 확정한다. 사용자가 명세서에서 읽는 값이 환율일
   * 때도 금액일 때도 있어서 둘 다 받는다.
   *
   * 전부 한 트랜잭션에서 처리한다. 절반만 확정되면 남은 대금이 어중간해져
   * 무엇을 더 맞춰야 하는지 알 수 없게 된다.
   */
  async settleRates(
    cardId: string,
    userId: string,
    dto: CardDto.SettleRatesRequest,
  ): Promise<CardDto.SettleRatesResponse> {
    const card = await this.loadCreditCard(cardId, userId, ProjectRole.editor);
    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.liabilityAccountId! },
      select: { currency: true },
    });

    const items = Array.isArray(dto?.items) ? dto.items : [];
    if (items.length === 0) {
      throw new BadRequestException('확정할 거래를 선택해 주세요.');
    }

    const rate = dto.rate === undefined ? null : toMoney(dto.rate, '환율');
    if (rate !== null && rate.lte(ZERO)) {
      throw new BadRequestException('환율은 0보다 커야 합니다.');
    }
    if (rate !== null && items.some((item) => item.billedAmount !== undefined)) {
      throw new BadRequestException('환율과 청구액은 함께 보낼 수 없습니다.');
    }

    // 다른 카드의 거래를 섞어 보내는 요청을 막는다. id만 바꾸면 남의 카드 거래까지
    // 고칠 수 있으므로 이 카드에 실제로 달린 전표인지 확인한다.
    const entryIds = items.map((item) => item.entryId);
    const owned = await this.prisma.posting.findMany({
      where: { accountId: card.liabilityAccountId!, entryId: { in: entryIds } },
      select: {
        entryId: true,
        entry: { select: { originalAmount: true, rateProvisional: true } },
      },
    });
    const byEntryId = new Map(owned.map((p) => [p.entryId, p.entry]));

    const targets = items.map((item) => {
      const entry = byEntryId.get(item.entryId);
      if (!entry) {
        throw new NotFoundException('이 카드의 거래가 아닙니다.');
      }
      if (!entry.rateProvisional || !entry.originalAmount) {
        throw new BadRequestException('이미 확정된 거래입니다.');
      }

      const billed =
        rate === null
          ? toMoney(item.billedAmount, '청구액')
          : // 환율로 줬으면 카드 통화 자릿수로 반올림한다. 원화면 원 단위다.
            entry.originalAmount
              .mul(rate)
              .toDecimalPlaces(currencyDecimals(liability.currency), Prisma.Decimal.ROUND_HALF_UP);

      return { entryId: item.entryId, billed };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const target of targets) {
        await this.ledger.restateForeignEntry(target.entryId, card.projectId, target.billed, tx);
      }
    });

    return { settled: targets.length };
  }

  private async loadCreditCard(
    cardId: string,
    userId: string,
    requiredRole: ProjectRole = 'viewer',
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId, requiredRole);

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
 * 실적 응답 조립. 기준액이 없으면 달성 여부와 남은 금액은 뜻이 없다.
 *
 * 사용액이 음수일 수 있다(그 구간에 취소가 더 많은 경우). 남은 금액은 기준액보다
 * 커지고, 그게 사실이므로 0으로 자르지 않는다. 반대로 이미 채웠으면 음수가 아니라
 * 0으로 적는다 - "0원 남았다"가 "-3만원 남았다"보다 읽기 쉽다.
 */
function performanceOf(input: {
  cardId: string;
  currency: string;
  basis: 'statement' | 'month';
  periodStart: string;
  periodEnd: string;
  usage: Prisma.Decimal;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousUsage: Prisma.Decimal;
  target: Prisma.Decimal | null;
}): CardDto.PerformanceResponse {
  const { target, usage } = input;
  const achieved = target !== null && usage.gte(target);

  return {
    cardId: input.cardId,
    currency: input.currency,
    basis: input.basis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    usage: usage.toString(),
    previousPeriodStart: input.previousPeriodStart,
    previousPeriodEnd: input.previousPeriodEnd,
    previousUsage: input.previousUsage.toString(),
    target: target?.toString() ?? null,
    achieved,
    remaining: target === null ? null : achieved ? '0' : target.sub(usage).toString(),
  };
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
