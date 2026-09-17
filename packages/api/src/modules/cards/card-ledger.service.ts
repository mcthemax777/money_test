import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, ProjectRole } from '@prisma/client';
import {
  CardDto,
  type CardUsagePosting,
  type PerformanceShare,
  creditPerformanceShares,
  debitPerformanceShares,
  MAX_USAGE_PERIODS,
  closingMonthKey,
  closingMonthOf,
  creditUsagePeriods,
  periodForClosingMonth,
  currencyDecimals,
  debitUsagePeriods,
  performanceOf,
  shiftClosingMonth,
  usageSpan,
  zonedCurrentYearMonth,
  zonedMonthRange,
  zonedParts,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { toMoney } from '@/common/money';
import { LedgerService } from '../ledger/ledger.service';
import { notFound } from '@/common/app-error';

const ZERO = new Prisma.Decimal(0);

/**
 * 실적을 정가로 셀 때 되살릴 차감액.
 *
 * 차감액은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 둘이 갈리는 거래(원화
 * 카드로 한 외화 결제)에서는 그대로 더할 수 없다. 그때는 되살리지 않고 지금까지의
 * 규칙(차감이 실적도 깎는다)을 그대로 둔다 -- 폼도 그 거래에는 이 칸을 띄우지 않는다.
 */
function performanceDiscount(entry: {
  discountAmount: Prisma.Decimal | null;
  discountCountsPerformance: boolean;
  originalCurrency: string | null;
}): Pick<CardUsagePosting, 'discountAmount' | 'discountCountsPerformance'> {
  return {
    discountAmount: entry.originalCurrency ? null : entry.discountAmount,
    discountCountsPerformance: entry.discountCountsPerformance,
  };
}

/*
 * 주기를 만들고 할부를 나누는 규칙은 `@money/types` 의 card-usage 가 갖는다.
 * 기기도 오프라인에서 같은 값을 내야 해서 옮겼다. 여기 남은 것은 "무엇을 읽을지"다.
 */

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
    const span = usageSpan(months);

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
          /*
           * 사용만 센다. 대금 결제와 환불 입금은 분류 다리가 없어 여기서 빠진다.
           * 갚은 돈이 사용액을 깎으면 실적이 두 번 움직인다.
           */
          postings: { some: { categoryId: { not: null } } },
        },
      },
      /*
       * 실적에서 뺀 거래도 함께 읽는다. 거르지 않고 표를 실어 보낸다.
       *
       * 청구는 되지만 실적에서 빠지는 결제가 있어, 여기서 걸러 버리면 청구액 그래프가
       * 남은 대금과 어긋난다. 나누는 일은 집계(`creditUsagePeriods`)가 한다.
       */
      select: {
        amount: true,
        entry: {
          select: {
            date: true,
            countsPerformance: true,
            discountAmount: true,
            discountCountsPerformance: true,
            originalCurrency: true,
          },
        },
        installmentPlan: { select: { totalMonths: true } },
      },
    });

    const { periods, clipped } = creditUsagePeriods({
      postings: usages.map((usage) => ({
        amount: usage.amount,
        date: usage.entry.date,
        installmentMonths: usage.installmentPlan?.totalMonths ?? null,
        countsPerformance: usage.entry.countsPerformance,
        ...performanceDiscount(usage.entry),
      })),
      statementClosingDay: card.statementClosingDay!,
      paymentDueDay: card.paymentDueDay!,
      timeZone,
      span,
    });

    if (clipped) {
      // 잘못된 날짜의 거래가 섞여 있다. 주기를 그 달까지 만들면 응답이 수만 행이 된다.
      this.logger.warn(
        `카드 ${card.id}: 표시 범위를 넘는 청구 주기가 있어 잘라냈습니다. 거래 날짜를 확인하세요.`,
      );
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
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
    if (card.cardType === CardType.credit) return null;
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = usageSpan(months);
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    return {
      cardId: card.id,
      currency: paymentAccount.currency,
      // 체크카드는 결제 즉시 통장에서 빠진다. 갚을 대금이 남지 않는다.
      outstanding: '0',
      periods: debitUsagePeriods({
        postings: await this.debitPostings(card.id, timeZone, span),
        timeZone,
        span,
      }),
    };
  }

  /**
   * 체크카드로 쓴 다리. 보여 줄 달만큼만 읽는다.
   *
   * 체크카드 사용은 연결 통장의 posting 에 cardId 가 함께 찍힌다. 통장에서 직접 나간
   * 지출에는 cardId 가 없으므로 이 조건만으로 이 카드로 쓴 것만 걸린다.
   *
   * 예전에는 달마다 한 번씩 집계 질의를 보냈다. 나누는 규칙이 공용 함수로 옮겨간
   * 지금은 한 번 읽어 그쪽에서 달별로 나눈다.
   */
  private async debitPostings(
    cardId: string,
    timeZone: string,
    span: number,
  ): Promise<CardUsagePosting[]> {
    const [year, month] = zonedCurrentYearMonth(timeZone).split('-').map(Number);
    const earliest = new Date(Date.UTC(year, month - span, 1));
    const key = `${earliest.getUTCFullYear()}-${String(earliest.getUTCMonth() + 1).padStart(2, '0')}`;
    const { start } = zonedMonthRange(key, timeZone);

    const rows = await this.prisma.posting.findMany({
      // 실적에서 뺀 거래도 함께 읽는다. 나누는 일은 집계가 한다 (신용카드와 같은 규칙).
      where: { cardId, entry: { date: { gte: start } } },
      select: {
        amount: true,
        entry: {
          select: {
            date: true,
            countsPerformance: true,
            discountAmount: true,
            discountCountsPerformance: true,
            originalCurrency: true,
          },
        },
      },
    });
    return rows.map((row) => ({
      amount: row.amount,
      date: row.entry.date,
      countsPerformance: row.entry.countsPerformance,
      ...performanceDiscount(row.entry),
    }));
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
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
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
        usage: current.usage,
        previousPeriodStart: previous.periodStart,
        previousPeriodEnd: previous.periodEnd,
        previousUsage: previous.usage,
        target,
      });
    }

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    /*
     * 사용액은 사용 현황(getUsage)과 같은 규칙으로 낸다. 두 곳에서 따로 세면 카드
     * 화면의 "이번 달 사용액"과 실적 진행률이 다른 숫자가 된다.
     *
     * span=2 면 앞이 지난달, 뒤가 이번 달이다. 부호로 거르지 않고 그대로 더한다.
     * 지금은 지출만 카드를 가리킬 수 있어 전부 음수지만, 결제 취소가 양수로 들어오게
     * 되면 그때는 빼는 것이 맞다. 실적은 순사용액으로 판정하는 값이다.
     */
    const [previous, current] = debitUsagePeriods({
      postings: await this.debitPostings(card.id, timeZone, 2),
      timeZone,
      span: 2,
    });

    return performanceOf({
      cardId: card.id,
      currency: paymentAccount.currency,
      basis: 'month',
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      usage: current.usage,
      previousPeriodStart: previous.periodStart,
      previousPeriodEnd: previous.periodEnd,
      previousUsage: previous.usage,
      target,
    });
  }

  /**
   * 실적 원장. 주기마다 0에서 다시 쌓는 줄들.
   *
   * 카드 상세의 실적 탭이 그린다. 계좌 원장과 다른 것이 둘이다.
   *   - 잔액 자리에 **쌓인 실적**이 든다. 남은 대금은 결제대금 탭이 보여 준다.
   *   - 할부가 회차마다 한 줄이다. 주기 합계가 회차분만 세므로, 구매한 달에 전액을
   *     한 줄로 두면 줄의 합과 진행률 막대가 갈린다.
   *
   * 페이지를 줄이 아니라 주기로 나눈다. 누적은 주기 시작을 기준으로만 뜻이 있어,
   * 줄 단위로 끊으면 한 주기의 앞부분을 받지 못한 채 합계를 그리게 된다.
   */
  async getPerformanceLedger(
    cardId: string,
    userId: string,
    months?: number,
  ): Promise<CardDto.PerformanceLedgerResponse> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = usageSpan(months);

    return card.cardType === CardType.credit
      ? this.creditPerformanceLedger(cardId, userId, timeZone, span)
      : this.debitPerformanceLedger(card, timeZone, span);
  }

  /** 신용카드의 실적 원장. 주기는 마감일로 자른다. */
  private async creditPerformanceLedger(
    cardId: string,
    userId: string,
    timeZone: string,
    span: number,
  ): Promise<CardDto.PerformanceLedgerResponse> {
    const card = await this.loadCreditCard(cardId, userId);
    const closingDay = card.statementClosingDay!;
    const liabilityAccountId = card.liabilityAccountId!;

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: liabilityAccountId },
      select: { currency: true },
    });

    // 보여 줄 주기. 진행 중인 주기가 마지막이다 (할부가 걸린 미래 주기는 아직 쌓인 것이 없다).
    const current = closingMonthOf(new Date(), closingDay, timeZone);
    const shown: Array<{ key: string; period: CardDto.PerformanceLedgerPeriod }> = [];
    const todayMarker = todayUtcMarker(timeZone);
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const closing = shiftClosingMonth(current, -offset);
      const period = periodForClosingMonth(
        closing.year,
        closing.month,
        closingDay,
        card.paymentDueDay!,
      );
      shown.push({
        key: closingMonthKey(closing),
        period: {
          periodStart: period.periodStart.toISOString(),
          periodEnd: period.periodEnd.toISOString(),
          closed: period.periodEnd.getTime() < todayMarker,
          total: '0',
          rows: [],
        },
      });
    }
    const earliestStart = new Date(shown[0].period.periodStart);

    /*
     * 할부는 예전 구매가 지금 주기에 걸린다. 최장 할부 개월수만큼 앞에서부터 읽는다
     * (사용 현황 질의와 같은 규칙이다). 주기 경계보다 한 달 더 앞에서 자른다.
     */
    const longestPlan = await this.prisma.installmentPlan.aggregate({
      _max: { totalMonths: true },
      where: { posting: { accountId: liabilityAccountId } },
    });
    const since = new Date(earliestStart);
    since.setUTCMonth(since.getUTCMonth() - (longestPlan._max.totalMonths ?? 1) - 1);

    const usages = await this.prisma.posting.findMany({
      where: {
        accountId: liabilityAccountId,
        entry: {
          date: { gte: since },
          // 사용만 센다. 대금 결제는 분류 다리가 없어 여기서 빠진다 (사용 현황과 같은 조건).
          postings: { some: { categoryId: { not: null } } },
        },
      },
      select: {
        id: true,
        amount: true,
        entry: { select: performanceLedgerEntrySelect },
        installmentPlan: { select: { totalMonths: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    });

    // 보여 줄 주기만 칸을 만들어 둔다. 칸이 없는 주기의 몫은 그대로 버린다.
    const byPeriod = new Map(shown.map(({ key }) => [key, [] as CardDto.PerformanceLedgerRow[]]));
    for (const usage of usages) {
      const shares = creditPerformanceShares(
        {
          amount: usage.amount,
          date: usage.entry.date,
          installmentMonths: usage.installmentPlan?.totalMonths ?? null,
          countsPerformance: usage.entry.countsPerformance,
          ...performanceDiscount(usage.entry),
        },
        closingDay,
        timeZone,
      );

      for (const share of shares) {
        const rows = byPeriod.get(share.closingKey);
        if (!rows) continue;
        rows.push(this.performanceRow(usage.id, usage.entry, cardId, card.name, share));
      }
    }

    // 더 오래된 주기에 실적에 드는 거래가 남아 있는가.
    const older = await this.prisma.posting.findFirst({
      where: {
        accountId: liabilityAccountId,
        entry: {
          date: { lt: earliestStart },
          countsPerformance: true,
          postings: { some: { categoryId: { not: null } } },
        },
      },
      select: { id: true },
    });

    return {
      cardId,
      currency: liability.currency,
      basis: 'statement',
      target: card.performanceAmount?.toString() ?? null,
      periods: shown
        .map(({ key, period }) => fillPeriod(period, byPeriod.get(key) ?? []))
        .reverse(),
      hasMore: older !== null,
    };
  }

  /** 체크카드의 실적 원장. 자를 기준이 달력 월뿐이다. */
  private async debitPerformanceLedger(
    card: {
      id: string;
      name: string;
      paymentAccountId: string;
      performanceAmount: Prisma.Decimal | null;
    },
    timeZone: string,
    span: number,
  ): Promise<CardDto.PerformanceLedgerResponse> {
    const cardId = card.id;
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    const [thisYear, thisMonth] = zonedCurrentYearMonth(timeZone).split('-').map(Number);
    const shown: Array<{ key: string; period: CardDto.PerformanceLedgerPeriod }> = [];
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const cursor = new Date(Date.UTC(thisYear, thisMonth - 1 - offset, 1));
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      shown.push({
        key: `${year}-${String(month).padStart(2, '0')}`,
        period: {
          // 달력 날짜 표시자. 청구 주기 쪽과 같은 형태다 (그 달 1일 ~ 말일).
          periodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
          periodEnd: new Date(Date.UTC(year, month, 0)).toISOString(),
          closed: offset > 0,
          total: '0',
          rows: [],
        },
      });
    }

    const { start } = zonedMonthRange(shown[0].key, timeZone);
    const rows = await this.prisma.posting.findMany({
      where: { cardId, entry: { date: { gte: start } } },
      select: {
        id: true,
        amount: true,
        entry: { select: performanceLedgerEntrySelect },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    });

    const byPeriod = new Map(shown.map(({ key }) => [key, [] as CardDto.PerformanceLedgerRow[]]));
    for (const row of rows) {
      const shares = debitPerformanceShares(
        {
          amount: row.amount,
          date: row.entry.date,
          countsPerformance: row.entry.countsPerformance,
          ...performanceDiscount(row.entry),
        },
        timeZone,
      );
      for (const share of shares) {
        const into = byPeriod.get(share.closingKey);
        if (!into) continue;
        into.push(this.performanceRow(row.id, row.entry, cardId, card.name, share));
      }
    }

    const older = await this.prisma.posting.findFirst({
      where: { cardId, entry: { date: { lt: start }, countsPerformance: true } },
      select: { id: true },
    });

    return {
      cardId,
      currency: paymentAccount.currency,
      basis: 'month',
      target: card.performanceAmount?.toString() ?? null,
      periods: shown
        .map(({ key, period }) => fillPeriod(period, byPeriod.get(key) ?? []))
        .reverse(),
      hasMore: older !== null,
    };
  }

  /** 실적 원장 한 줄. 쌓인 값은 주기를 채울 때 붙인다. */
  private performanceRow(
    postingId: string,
    entry: PerformanceLedgerEntry,
    cardId: string,
    cardName: string | null,
    share: PerformanceShare,
  ): CardDto.PerformanceLedgerRow {
    const category = entry.postings.find((leg) => leg.categoryId !== null)?.category ?? null;

    return {
      // 할부는 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
      key: share.months > 1 ? `${postingId}:${share.index}` : postingId,
      entryId: entry.id,
      date: entry.date.toISOString(),
      description: entry.description,
      merchant: entry.merchant,
      // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
      amount: new Prisma.Decimal(share.amount).neg().toString(),
      performanceAfter: '0',
      cardId,
      cardName,
      categoryName: category?.name ?? null,
      parentCategoryName: category?.parent?.name ?? null,
      installmentIndex: share.index,
      installmentMonths: share.months,
    };
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
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
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

/** 실적 원장 한 줄이 전표에서 읽는 것. 분류는 형제 다리에 붙어 있다. */
const performanceLedgerEntrySelect = {
  id: true,
  date: true,
  description: true,
  merchant: true,
  countsPerformance: true,
  discountAmount: true,
  discountCountsPerformance: true,
  originalCurrency: true,
  postings: {
    select: {
      categoryId: true,
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.JournalEntrySelect;

type PerformanceLedgerEntry = Prisma.JournalEntryGetPayload<{
  select: typeof performanceLedgerEntrySelect;
}>;

/** 오늘을 달력 날짜로 찍은 표시자. 주기가 닫혔는지 보는 데 쓴다. */
function todayUtcMarker(timeZone: string): number {
  const today = zonedParts(new Date(), timeZone);
  return Date.UTC(today.year, today.month - 1, today.day);
}

/**
 * 한 주기를 줄로 채운다. 쌓인 실적은 **가장 오래된 줄부터** 더해 붙인다.
 *
 * 돌려줄 때는 최신이 앞이다. 목록은 언제나 최근 것부터 읽는데, 누적은 주기 시작에서만
 * 뜻이 있어 더하는 방향과 보여 주는 방향이 반대다.
 */
function fillPeriod(
  period: CardDto.PerformanceLedgerPeriod,
  rows: CardDto.PerformanceLedgerRow[],
): CardDto.PerformanceLedgerPeriod {
  let running = ZERO;
  const filled = rows.map((row) => {
    // 줄의 금액은 카드 관점이라 사용이 음수다. 쌓이는 실적은 그 반대 부호다.
    running = running.add(new Prisma.Decimal(row.amount).neg());
    return { ...row, performanceAfter: running.toString() };
  });

  return { ...period, total: running.toString(), rows: filled.reverse() };
}

function defaultDescription(cardName: string, direction: CardDto.TransferRequest['direction']) {
  return direction === 'refund' ? `${cardName} 환불 입금` : `${cardName} 대금 결제`;
}
