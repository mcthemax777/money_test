import { randomUUID } from 'node:crypto';
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, ProjectRole } from '@prisma/client';
import {
  CardDto,
  type CardUsagePosting,
  type PerformanceShare,
  billedShares,
  creditPerformanceShares,
  debitPerformanceShares,
  MAX_USAGE_PERIODS,
  closingMonthKey,
  closingMonthOf,
  creditUsagePeriods,
  periodForClosingMonth,
  pendingRateItems,
  billedAmountFromRate,
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
 * 깎인 금액은 **줄마다** 적히므로(`Posting.discountAmount`) 그 합을 쓴다. 그것을
 * 실적에서 뺄지는 카드사의 방침 하나라 전표에 있다.
 *
 * 차감액은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 둘이 갈리는 거래(원화
 * 카드로 한 외화 결제)에서는 그대로 더할 수 없다. 그때는 되살리지 않고 지금까지의
 * 규칙(차감이 실적도 깎는다)을 그대로 둔다 -- 폼도 그 거래에는 이 칸을 띄우지 않는다.
 */
function performanceDiscount(entry: {
  discountCountsPerformance: boolean;
  originalCurrency: string | null;
  postings: Array<{ categoryId: string | null; discountAmount: Prisma.Decimal | null }>;
}): Pick<CardUsagePosting, 'discountAmount' | 'discountCountsPerformance'> {
  if (entry.originalCurrency) {
    return { discountAmount: null, discountCountsPerformance: entry.discountCountsPerformance };
  }

  const total = entry.postings.reduce(
    (acc, leg) => (leg.categoryId !== null && leg.discountAmount ? acc.add(leg.discountAmount) : acc),
    ZERO,
  );
  return {
    discountAmount: total.isZero() ? null : total,
    discountCountsPerformance: entry.discountCountsPerformance,
  };
}

/** 깎인 금액을 더하려면 분류 다리를 함께 읽어야 한다. 카드 다리를 읽는 질의마다 붙인다. */
const USAGE_LEG_SELECT = {
  categoryId: true,
  discountAmount: true,
} satisfies Prisma.PostingSelect;

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
      // 비워 두면 조립이 카드 이름으로 채운다 (기기가 적은 것과 같은 글자가 된다).
      description: dto.description ?? '',
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
            discountCountsPerformance: true,
            originalCurrency: true,
            // 깎인 금액은 줄마다 적힌다. 그 합을 쓰려고 분류 다리를 함께 읽는다.
            postings: { select: USAGE_LEG_SELECT },
          },
        },
        installmentPlan: {
              select: { totalMonths: true, principalShares: true, interestShares: true },
            },
      },
    });

    const { periods, clipped } = creditUsagePeriods({
      postings: usages.map((usage) => ({
        amount: usage.amount,
        date: usage.entry.date,
        installmentMonths: usage.installmentPlan?.totalMonths ?? null,
        installmentShares: toShares(usage.installmentPlan?.principalShares),
        installmentInterestShares: toShares(usage.installmentPlan?.interestShares),
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
            discountCountsPerformance: true,
            originalCurrency: true,
            postings: { select: USAGE_LEG_SELECT },
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
   * **줄로 끊어 준다.** 다른 원장과 같은 수만큼 받아 같은 손짓으로 잇는다. 누적은
   * 주기 시작부터 세야 하므로 **주기는 통째로 만들어 두고 자르는 것은 보여 줄 줄뿐이다**
   * -- 그래서 한 주기의 뒷부분만 받아도 줄에 붙은 누적은 처음부터 센 값이다.
   *
   * 주기를 거슬러 오르며 `limit` 만큼 채운다. 거래가 없는 달이 이어져도 한 번의 요청이
   * 스물네 주기까지 훑으므로 빈 쪽이 계속 돌아오지 않는다.
   */
  async getPerformanceLedger(
    cardId: string,
    userId: string,
    options: CardDto.PeriodLedgerQuery = {},
  ): Promise<CardDto.PeriodLedgerResponse> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const cursor = parseLedgerCursor(options.cursor);
    /*
     * 주기 하나만 보는 조회. 그래프에서 막대를 눌렀을 때 온다.
     *
     * 날짜 구간이 아니라 주기 이름으로 받는다. 할부 회차는 산 날이 아니라 청구되는
     * 주기에 쌓이므로, 날짜로 자르면 그 주기에 쌓인 회차가 빠진다.
     */
    const only = parseClosingKey(options.closingKey);

    return card.cardType === CardType.credit
      ? this.creditPerformanceLedger(cardId, userId, timeZone, limit, cursor, only)
      : this.debitPerformanceLedger(card, timeZone, limit, cursor, only);
  }

  /** 신용카드의 실적 원장. 주기는 마감일로 자른다. */
  private async creditPerformanceLedger(
    cardId: string,
    userId: string,
    timeZone: string,
    limit: number,
    cursor: LedgerCursor | null,
    only: ClosingMonth | null,
  ): Promise<CardDto.PeriodLedgerResponse> {
    const card = await this.loadCreditCard(cardId, userId);
    const closingDay = card.statementClosingDay!;
    const liabilityAccountId = card.liabilityAccountId!;

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: liabilityAccountId },
      select: { currency: true },
    });

    /*
     * 할부는 예전 구매가 지금 주기에 걸린다. 주기마다 최장 할부 개월수만큼 앞에서부터
     * 읽어야 그 회차가 빠지지 않는다 (사용 현황 질의와 같은 규칙이다).
     */
    const longestPlan = await this.prisma.installmentPlan.aggregate({
      _max: { totalMonths: true },
      where: { posting: { accountId: liabilityAccountId } },
    });
    const lookback = (longestPlan._max.totalMonths ?? 1) + 1;

    const page = await this.walkPeriods({
      limit,
      cursor,
      only,
      // 커서가 없으면 고른 주기부터, 그것도 없으면 진행 중인 주기부터다.
      from: cursor?.closing ?? only ?? closingMonthOf(new Date(), closingDay, timeZone),
      timeZone,
      periodOf: (closing) => {
        const period = periodForClosingMonth(
          closing.year,
          closing.month,
          closingDay,
          card.paymentDueDay!,
        );
        return { start: period.periodStart, end: period.periodEnd };
      },
      rowsOf: async (closing, period) => {
        const since = new Date(period.start);
        since.setUTCMonth(since.getUTCMonth() - lookback);

        const usages = await this.prisma.posting.findMany({
          where: {
            accountId: liabilityAccountId,
            entry: {
              date: { gte: since, lte: period.end },
              // 사용만 센다. 대금 결제는 분류 다리가 없어 여기서 빠진다.
              postings: { some: { categoryId: { not: null } } },
            },
          },
          select: {
            id: true,
            amount: true,
            entry: { select: periodLedgerEntrySelect },
            installmentPlan: {
              select: { totalMonths: true, principalShares: true, interestShares: true },
            },
          },
          orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
        });

        const wanted = closingMonthKey(closing);
        const rows: CardDto.PeriodLedgerRow[] = [];
        for (const usage of usages) {
          const shares = creditPerformanceShares(
            {
              amount: usage.amount,
              date: usage.entry.date,
              installmentMonths: usage.installmentPlan?.totalMonths ?? null,
              // 실적은 이자를 뺀 결제액이다. 빼려면 회차 이자를 함께 넘겨야 한다.
              installmentInterestShares: toShares(usage.installmentPlan?.interestShares),
              countsPerformance: usage.entry.countsPerformance,
              ...performanceDiscount(usage.entry),
            },
            closingDay,
            timeZone,
          );
          for (const share of shares) {
            if (share.closingKey !== wanted) continue;
            rows.push(this.performanceRow(usage.id, usage.entry, cardId, card.name, share, period));
          }
        }
        return rows;
      },
      olderExists: (start) =>
        this.prisma.posting.findFirst({
          where: {
            accountId: liabilityAccountId,
            entry: {
              date: { lt: start },
              countsPerformance: true,
              postings: { some: { categoryId: { not: null } } },
            },
          },
          select: { id: true },
        }),
    });

    return {
      cardId,
      currency: liability.currency,
      basis: 'statement',
      target: card.performanceAmount?.toString() ?? null,
      ...page,
    };
  }

  /**
   * 청구 내역. 이 주기의 청구서에 무엇이 얼마씩 들었는가.
   *
   * 실적 원장과 같은 뼈대를 쓰지만 나누는 규칙이 다르다. **할부가 회차마다 한 줄이다.**
   * 24개월 할부로 산 차는 산 달에만 원장에 한 줄로 서고 그 뒤 스물세 주기에는 아무
   * 줄도 없는데, 대금은 매달 나간다 -- 그 달 청구서를 열면 막대는 큰데 목록이 비어
   * 있어, 왜 이만큼 나가는지 화면 어디에서도 알 수 없었다.
   *
   * 대금 결제와 환불 입금은 여기 들지 않는다. 청구서에 실리는 것은 사용이고, 갚은 돈은
   * 결제대금 탭의 계좌 원장이 보여 준다.
   *
   * 신용카드만이다. 체크카드는 쓰는 즉시 통장에서 빠져 청구라는 것이 없다.
   */
  async getBilledLedger(
    cardId: string,
    userId: string,
    options: CardDto.PeriodLedgerQuery = {},
  ): Promise<CardDto.PeriodLedgerResponse> {
    const card = await this.loadCreditCard(cardId, userId);
    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const cursor = parseLedgerCursor(options.cursor);
    const only = parseClosingKey(options.closingKey);

    const closingDay = card.statementClosingDay!;
    const liabilityAccountId = card.liabilityAccountId!;

    const liability = await this.prisma.account.findUniqueOrThrow({
      where: { id: liabilityAccountId },
      select: { currency: true },
    });

    /*
     * 할부는 예전 구매가 지금 주기에 걸린다. 주기마다 최장 할부 개월수만큼 앞에서부터
     * 읽어야 그 회차가 빠지지 않는다 (사용 현황 질의와 같은 규칙이다).
     */
    const longestPlan = await this.prisma.installmentPlan.aggregate({
      _max: { totalMonths: true },
      where: { posting: { accountId: liabilityAccountId } },
    });
    const lookback = (longestPlan._max.totalMonths ?? 1) + 1;

    const page = await this.walkPeriods({
      limit,
      cursor,
      only,
      from: cursor?.closing ?? only ?? closingMonthOf(new Date(), closingDay, timeZone),
      timeZone,
      periodOf: (closing) => {
        const period = periodForClosingMonth(
          closing.year,
          closing.month,
          closingDay,
          card.paymentDueDay!,
        );
        return { start: period.periodStart, end: period.periodEnd };
      },
      rowsOf: async (closing, period) => {
        const since = new Date(period.start);
        since.setUTCMonth(since.getUTCMonth() - lookback);

        const usages = await this.prisma.posting.findMany({
          where: {
            accountId: liabilityAccountId,
            entry: {
              date: { gte: since, lte: period.end },
              // 사용만 싣는다. 대금 결제와 환불 입금은 분류 다리가 없어 여기서 빠진다.
              postings: { some: { categoryId: { not: null } } },
            },
          },
          select: {
            id: true,
            amount: true,
            entry: { select: periodLedgerEntrySelect },
            installmentPlan: {
              select: { totalMonths: true, principalShares: true, interestShares: true },
            },
          },
          orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
        });

        const wanted = closingMonthKey(closing);
        const rows: CardDto.PeriodLedgerRow[] = [];
        for (const usage of usages) {
          /*
           * 실적에서 뺀 거래도 그대로 싣는다. 청구는 실적과 상관없이 되므로, 여기서
           * 거르면 줄의 합이 막대(`UsagePeriod.billed`)와 어긋난다.
           */
          const shares = billedShares(
            {
              amount: usage.amount,
              date: usage.entry.date,
              installmentMonths: usage.installmentPlan?.totalMonths ?? null,
              installmentShares: toShares(usage.installmentPlan?.principalShares),
              // 회차 청구액은 원금에 그 회차의 이자를 더한 값이다.
              installmentInterestShares: toShares(usage.installmentPlan?.interestShares),
            },
            closingDay,
            timeZone,
          );
          for (const share of shares) {
            if (share.closingKey !== wanted) continue;
            rows.push({
              // 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
              key: share.months > 1 ? `${usage.id}:${share.index}` : usage.id,
              entryId: usage.entry.id,
              date: usage.entry.date.toISOString(),
              description: usage.entry.description,
              merchant: usage.entry.merchant,
              // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
              amount: new Prisma.Decimal(share.amount).neg().toString(),
              runningTotal: '0',
              periodStart: period.start.toISOString(),
              cardId,
              cardName: card.name,
              categoryName: categoryOf(usage.entry)?.name ?? null,
              parentCategoryName: categoryOf(usage.entry)?.parent?.name ?? null,
              installmentIndex: share.index,
              installmentMonths: share.months,
            });
          }
        }
        return rows;
      },
      olderExists: (start) =>
        this.prisma.posting.findFirst({
          where: {
            accountId: liabilityAccountId,
            entry: {
              date: { lt: start },
              postings: { some: { categoryId: { not: null } } },
            },
          },
          select: { id: true },
        }),
    });

    return {
      cardId,
      currency: liability.currency,
      basis: 'statement',
      // 실적 기준액은 청구와 상관없는 값이다. 막대에 기준선을 긋지 않는다.
      target: null,
      ...page,
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
    limit: number,
    cursor: LedgerCursor | null,
    only: ClosingMonth | null,
  ): Promise<CardDto.PeriodLedgerResponse> {
    const cardId = card.id;
    const paymentAccount = await this.prisma.account.findUniqueOrThrow({
      where: { id: card.paymentAccountId },
      select: { currency: true },
    });

    const [thisYear, thisMonth] = zonedCurrentYearMonth(timeZone).split('-').map(Number);

    const page = await this.walkPeriods({
      limit,
      cursor,
      only,
      from: cursor?.closing ?? only ?? { year: thisYear, month: thisMonth },
      timeZone,
      // 달력 월 표시자. 청구 주기 쪽과 같은 형태다 (그 달 1일 ~ 말일).
      periodOf: (closing) => ({
        start: new Date(Date.UTC(closing.year, closing.month - 1, 1)),
        end: new Date(Date.UTC(closing.year, closing.month, 0)),
      }),
      rowsOf: async (closing, period) => {
        /*
         * 질의 경계는 그 달의 실제 인스턴트다(타임존을 본다). 위 periodOf 가 주는 것은
         * 화면에 적을 달력 날짜 표시자라, 둘을 섞으면 말일 거래가 시차만큼 빠진다.
         */
        const { start, end } = zonedMonthRange(closingMonthKey(closing), timeZone);

        const postings = await this.prisma.posting.findMany({
          where: { cardId, entry: { date: { gte: start, lt: end } } },
          select: {
            id: true,
            amount: true,
            entry: { select: periodLedgerEntrySelect },
          },
          orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
        });

        const rows: CardDto.PeriodLedgerRow[] = [];
        for (const posting of postings) {
          for (const share of debitPerformanceShares(
            {
              amount: posting.amount,
              date: posting.entry.date,
              countsPerformance: posting.entry.countsPerformance,
              ...performanceDiscount(posting.entry),
            },
            timeZone,
          )) {
            rows.push(
              this.performanceRow(posting.id, posting.entry, cardId, card.name, share, period),
            );
          }
        }
        return rows;
      },
      olderExists: (start) =>
        this.prisma.posting.findFirst({
          where: { cardId, entry: { date: { lt: start }, countsPerformance: true } },
          select: { id: true },
        }),
    });

    return {
      cardId,
      currency: paymentAccount.currency,
      basis: 'month',
      target: card.performanceAmount?.toString() ?? null,
      ...page,
    };
  }

  /**
   * 주기를 거슬러 오르며 줄을 `limit` 만큼 모은다. 신용·체크가 이 한 길을 쓴다.
   *
   * **주기는 통째로 만든다.** 누적은 주기 시작부터 세야 뜻이 있어, 뒷부분만 보여 줄
   * 때에도 앞부터 더한 값을 붙여야 한다. 자르는 것은 보여 줄 줄뿐이다.
   *
   * 한 번에 스물네 주기까지 훑는다. 그 안에서 채우지 못하면 더 오래된 줄이 있는지
   * 한 번 물어, 없으면 커서를 끊어 목록이 끝나게 한다 -- 끊지 않으면 빈 쪽을 부르는
   * 일이 되풀이된다.
   */
  private async walkPeriods(input: {
    limit: number;
    cursor: LedgerCursor | null;
    /**
     * 이 주기 하나만 본다. 더 오래된 주기로 내려가지 않는다.
     *
     * 그래프에서 막대를 눌러 한 주기로 좁힌 자리다. 그 주기 안에서 줄이 한 쪽을 넘으면
     * 이어 받을 수 있지만, 다 보고 나면 끝이다 -- 고르지 않은 주기를 이어 붙이면 화면이
     * 좁혀 놓은 것과 달라진다.
     */
    only?: ClosingMonth | null;
    from: ClosingMonth;
    timeZone: string;
    periodOf: (closing: ClosingMonth) => { start: Date; end: Date };
    rowsOf: (
      closing: ClosingMonth,
      period: { start: Date; end: Date },
    ) => Promise<CardDto.PeriodLedgerRow[]>;
    olderExists: (start: Date) => Promise<{ id: string } | null>;
  }): Promise<{
    periods: CardDto.PeriodLedgerPeriod[];
    rows: CardDto.PeriodLedgerRow[];
    nextCursor: string | null;
  }> {
    const todayMarker = todayUtcMarker(input.timeZone);
    const periods: CardDto.PeriodLedgerPeriod[] = [];
    const rows: CardDto.PeriodLedgerRow[] = [];

    let closing = input.from;
    let scanned = input.from;
    let leftover = false;

    for (let step = 0; step < MAX_USAGE_PERIODS && rows.length < input.limit; step += 1) {
      scanned = closing;
      const period = input.periodOf(closing);
      const built = fillPeriod(await input.rowsOf(closing, period));

      const key = closingMonthKey(closing);
      // 커서가 가리키는 주기에서는 그 줄 다음부터다. 더 오래된 주기는 통째로 잇는다.
      const rest =
        input.cursor && input.cursor.key && key === closingMonthKey(input.cursor.closing)
          ? built.rows.slice(built.rows.findIndex((row) => row.key === input.cursor!.key) + 1)
          : built.rows;

      if (rest.length > 0) {
        const room = input.limit - rows.length;
        rows.push(...rest.slice(0, room));
        leftover = rest.length > room;
        periods.push({
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          closed: period.end.getTime() < todayMarker,
          total: built.total,
        });
      }

      if (rows.length >= input.limit) break;
      // 한 주기만 보는 조회는 여기서 끝난다.
      if (input.only) break;
      closing = shiftClosingMonth(closing, -1);
    }

    /*
     * 다음 자리.
     *
     * 본 주기에 줄이 남았으면 마지막 줄이 그 자리다. 다 봤으면 더 오래된 줄이 있는지
     * 물어, 있으면 훑던 다음 주기부터 이어 가고 없으면 끊는다.
     */
    const last = rows[rows.length - 1];
    if (leftover && last) {
      return { periods, rows, nextCursor: `${closingMonthKey(scanned)}|${last.key}` };
    }

    // 한 주기만 보기로 했으면 더 오래된 줄을 묻지 않는다.
    if (input.only) return { periods, rows, nextCursor: null };

    const older = await input.olderExists(input.periodOf(scanned).start);
    return {
      periods,
      rows,
      nextCursor: older ? `${closingMonthKey(shiftClosingMonth(scanned, -1))}|` : null,
    };
  }

  /** 실적 원장 한 줄. 쌓인 값은 주기를 채울 때 붙인다. */
  private performanceRow(
    postingId: string,
    entry: PeriodLedgerEntry,
    cardId: string,
    cardName: string | null,
    share: PerformanceShare,
    period: { start: Date },
  ): CardDto.PeriodLedgerRow {
    const category = categoryOf(entry);

    return {
      key: postingId,
      entryId: entry.id,
      date: entry.date.toISOString(),
      description: entry.description,
      merchant: entry.merchant,
      // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
      amount: new Prisma.Decimal(share.amount).neg().toString(),
      runningTotal: '0',
      periodStart: period.start.toISOString(),
      cardId,
      cardName,
      categoryName: category?.name ?? null,
      parentCategoryName: category?.parent?.name ?? null,
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

    /*
     * 주기를 매기는 일은 기기와 같은 함수다 (`pendingRateItems`). 오프라인에서는 기기가
     * 사본으로 같은 목록을 만든다.
     */
    const items = pendingRateItems(
      postings.map(({ amount, entry }) => ({
        entryId: entry.id,
        date: entry.date,
        description: entry.description,
        merchant: entry.merchant,
        originalCurrency: entry.originalCurrency!,
        originalAmount: entry.originalAmount!.toString(),
        liabilityAmount: amount.toString(),
      })),
      { statementClosingDay: card.statementClosingDay!, paymentDueDay: card.paymentDueDay! },
      timeZone,
    );

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
    /**
     * 오프라인 명령의 재생. 시계는 명령의 것을 쓰고, **이미 확정된 거래도 다시 쓴다.**
     *
     * 온라인 요청은 미확정 목록에서만 오므로 확정된 거래를 막는다. 재생은 다르다 -- 두
     * 기기가 같은 명세서를 따로 확정했을 수 있고, 누가 이기는지는 시계가 정한다(늦은
     * 편집이 이긴다). 그 판정은 재생 서비스가 여기 오기 전에 한다.
     */
    replay?: { hlc: string },
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
      if (!entry.originalAmount || (!replay && !entry.rateProvisional)) {
        throw new BadRequestException('이미 확정된 거래입니다.');
      }

      const billed =
        rate === null
          ? toMoney(item.billedAmount, '청구액')
          : // 환율로 줬으면 카드 통화 자릿수로 반올림한다. 원화면 원 단위다. 기기가 칸을
            // 채울 때와 같은 함수다.
            new Prisma.Decimal(
              billedAmountFromRate(
                entry.originalAmount.toString(),
                rate.toString(),
                liability.currency,
              ).toString(),
            );

      return { entryId: item.entryId, billed };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const target of targets) {
        await this.ledger.restateForeignEntry(
          target.entryId,
          card.projectId,
          target.billed,
          tx,
          replay?.hlc,
        );
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
const periodLedgerEntrySelect = {
  id: true,
  date: true,
  description: true,
  merchant: true,
  countsPerformance: true,
  discountCountsPerformance: true,
  originalCurrency: true,
  postings: {
    select: {
      ...USAGE_LEG_SELECT,
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.JournalEntrySelect;

type PeriodLedgerEntry = Prisma.JournalEntryGetPayload<{
  select: typeof periodLedgerEntrySelect;
}>;

/** 줄에 적을 분류. 전표의 첫 분류 다리가 대표다 (분할이면 첫 줄). */
function categoryOf(entry: PeriodLedgerEntry) {
  return entry.postings.find((leg) => leg.categoryId !== null)?.category ?? null;
}

/**
 * 계획에 적힌 회차 원금을 문자열 배열로 가린다.
 *
 * JSON 칸이라 무엇이든 들어올 수 있다. 모양이 아니면 없는 것으로 보고 개월수로 나눈다
 * (`@money/types` 의 목록 뷰와 같은 규칙이다).
 */
function toShares(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((share) => String(share));
}

/** 오늘을 달력 날짜로 찍은 표시자. 주기가 닫혔는지 보는 데 쓴다. */
function todayUtcMarker(timeZone: string): number {
  const today = zonedParts(new Date(), timeZone);
  return Date.UTC(today.year, today.month - 1, today.day);
}

/** 마감 연월 하나. 체크카드는 달력 월이 그 자리에 든다. */
interface ClosingMonth {
  year: number;
  month: number;
}

/** 실적 원장의 다음 자리. "이 주기의 이 줄 다음부터"를 가리킨다. */
interface LedgerCursor {
  closing: ClosingMonth;
  /** 비어 있으면 그 주기의 첫 줄부터다 (거래가 없는 달을 건너뛴 자리). */
  key: string;
}

/** 'YYYY-MM' 을 마감 연월로. 모양이 아니면 null (전체를 본다). */
function parseClosingKey(value?: string): ClosingMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** 'YYYY-MM|줄키' 를 되돌린다. 모양이 아니면 처음부터 본다. */
function parseLedgerCursor(raw?: string): LedgerCursor | null {
  if (!raw) return null;

  const [month, ...rest] = raw.split('|');
  const matched = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!matched) return null;

  return {
    closing: { year: Number(matched[1]), month: Number(matched[2]) },
    key: rest.join('|'),
  };
}

/**
 * 한 주기의 줄에 쌓인 값을 붙인다. **가장 오래된 줄부터** 더한다.
 *
 * 돌려줄 때는 최신이 앞이다. 목록은 언제나 최근 것부터 읽는데, 누적은 주기 시작에서만
 * 뜻이 있어 더하는 방향과 보여 주는 방향이 반대다. 합계는 그 주기 전부의 값이라,
 * 뒷부분만 보여 줄 때에도 머리글의 숫자는 달라지지 않는다.
 */
function fillPeriod(rows: CardDto.PeriodLedgerRow[]): {
  rows: CardDto.PeriodLedgerRow[];
  total: string;
} {
  let running = ZERO;
  const filled = rows.map((row) => {
    // 줄의 금액은 카드 관점이라 사용이 음수다. 쌓이는 값은 그 반대 부호다.
    running = running.add(new Prisma.Decimal(row.amount).neg());
    return { ...row, runningTotal: running.toString() };
  });

  return { rows: filled.reverse(), total: running.toString() };
}
