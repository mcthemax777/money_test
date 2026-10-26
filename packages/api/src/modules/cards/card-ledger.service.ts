import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, CardType, ProjectRole } from '@prisma/client';
import {
  CardDto,
  type CardUsagePosting,
  billedShares,
  creditPerformanceShares,
  debitPerformanceShares,
  closingMonthKey,
  closingMonthOf,
  creditUsagePeriods,
  pendingRateItems,
  billedAmountFromRate,
  debitUsagePeriods,
  performanceOf,
  shiftClosingMonth,
  usageSpan,
  zonedCurrentYearMonth,
  zonedMonthRange,
} from '@money/types';
import { INSTALLMENT_REFUND_SELECT } from '@/common/installment-scope';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { toMoney } from '@/common/money';
import { LedgerService } from '../ledger/ledger.service';
import { notFound } from '@/common/app-error';
import { withBalancesAsOf } from '@/common/balance-as-of';
import {
  type ClosingMonth,
  type LedgerCursor,
  afterClosingDay,
  parseClosingKey,
  parseLedgerCursor,
  parseLedgerLimit,
  walkPeriods,
} from './card-period-walk';
import {
  INSTALLMENT_PLAN_SELECT,
  USAGE_LEG_SELECT,
  performanceDiscount,
  periodLedgerEntrySelect,
  periodLedgerRow,
  refundCutFields,
  statementPeriodOf,
  toShares,
} from './card-usage-rows';

const ZERO = new Prisma.Decimal(0);

/**
 * 카드의 원장 쪽 관심사. 대금 이동 기록과 주기별 사용액 계산.
 *
 * 청구서를 테이블로 저장하지 않는다. 주기는 카드의 현재 마감일 설정으로 읽을 때
 * 계산한다. 그래서 마감일을 바꾸면 과거 주기까지 곧바로 다시 그려지고,
 * 거래를 옮기거나 지워도 어긋날 저장물이 없다.
 *
 * 주기 원장을 한 쪽씩 모으는 뼈대는 card-period-walk.ts, 읽은 행을 옮기는 것은
 * card-usage-rows.ts 에 있다 (2026-10-26 나눔).
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

    // 남은 대금은 지금까지의 것이다. 미래 날짜로 적어 둔 사용·결제는 빼고 센다.
    const [liability] = await withBalancesAsOf(this.prisma, [
      await this.prisma.account.findUniqueOrThrow({
        where: { id: card.liabilityAccountId! },
        select: { id: true, balance: true, currency: true },
      }),
    ]);

    /*
     * 표시 구간에 걸릴 수 있는 사용만 읽는다.
     *
     * 예전에는 이 카드의 posting 전부를 매번 읽었다. 화면에는 최근 몇 주기만
     * 나오는데 몇 해치를 다 읽어 오므로 거래가 쌓일수록 그대로 느려졌다.
     *
     * 단순히 "구간 시작 이후"로 자를 수는 없다. 할부는 예전 구매가 지금 주기에
     * 청구되기 때문이다. 그래서 이 카드의 최장 할부 개월수만큼 앞에서부터 읽는다.
     */
    const lookbackMonths = span + (await this.longestPlanMonths(card.liabilityAccountId!));
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
            ...INSTALLMENT_REFUND_SELECT,
          },
        },
        installmentPlan: INSTALLMENT_PLAN_SELECT,
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
        ...refundCutFields(usage.entry, usage.installmentPlan?.totalMonths),
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
    // 신용카드는 권한을 보지 않고 넘긴다. 부르는 쪽(getUsage)이 loadCreditCard 로 다시 본다.
    if (card.cardType === CardType.credit) return null;
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const span = usageSpan(months);
    const currency = await this.accountCurrency(card.paymentAccountId);

    return {
      cardId: card.id,
      currency,
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
    const card = await this.loadCard(cardId, userId);
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
    const currency = await this.accountCurrency(card.paymentAccountId);

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
      currency,
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
    const card = await this.loadCard(cardId, userId);

    const timeZone = await this.projectAccess.getProjectTimeZone(card.projectId);
    const limit = parseLedgerLimit(options.limit);
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

    const currency = await this.accountCurrency(liabilityAccountId);

    /*
     * 할부는 예전 구매가 지금 주기에 걸린다. 주기마다 최장 할부 개월수만큼 앞에서부터
     * 읽어야 그 회차가 빠지지 않는다 (사용 현황 질의와 같은 규칙이다).
     */
    const lookback = (await this.longestPlanMonths(liabilityAccountId)) + 1;

    const page = await walkPeriods({
      limit,
      cursor,
      only,
      // 커서가 없으면 고른 주기부터, 그것도 없으면 진행 중인 주기부터다.
      from: cursor?.closing ?? only ?? closingMonthOf(new Date(), closingDay, timeZone),
      timeZone,
      periodOf: (closing) => statementPeriodOf(closing, closingDay, card.paymentDueDay!),
      rowsOf: async (closing, period) => {
        // 사용만 센다. 대금 결제는 분류 다리가 없어 여기서 빠진다.
        const usages = await this.creditUsagesUpTo(liabilityAccountId, period, lookback, timeZone);

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
              ...refundCutFields(usage.entry, usage.installmentPlan?.totalMonths),
            },
            closingDay,
            timeZone,
          );
          for (const share of shares) {
            if (share.closingKey !== wanted) continue;
            rows.push(
              periodLedgerRow({
                key: usage.id,
                entry: usage.entry,
                cardId,
                cardName: card.name,
                amount: share.amount,
                period,
                installmentMonths: share.months,
              }),
            );
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
      currency,
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
    const limit = parseLedgerLimit(options.limit);
    const cursor = parseLedgerCursor(options.cursor);
    const only = parseClosingKey(options.closingKey);

    const closingDay = card.statementClosingDay!;
    const liabilityAccountId = card.liabilityAccountId!;

    const currency = await this.accountCurrency(liabilityAccountId);

    // 할부 회차가 빠지지 않게 최장 할부 개월수만큼 앞에서부터 읽는다 (실적 원장과 같은 규칙).
    const lookback = (await this.longestPlanMonths(liabilityAccountId)) + 1;

    const page = await walkPeriods({
      limit,
      cursor,
      only,
      from: cursor?.closing ?? only ?? closingMonthOf(new Date(), closingDay, timeZone),
      timeZone,
      periodOf: (closing) => statementPeriodOf(closing, closingDay, card.paymentDueDay!),
      rowsOf: async (closing, period) => {
        // 사용만 싣는다. 대금 결제와 환불 입금은 분류 다리가 없어 여기서 빠진다.
        const usages = await this.creditUsagesUpTo(liabilityAccountId, period, lookback, timeZone);

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
              // 할부 환불이 줄인 회차와, 환불이 돌려받는 남은 몫 (installment-refund).
              ...refundCutFields(usage.entry, usage.installmentPlan?.totalMonths),
            },
            closingDay,
            timeZone,
          );
          for (const share of shares) {
            if (share.closingKey !== wanted) continue;
            rows.push(
              periodLedgerRow({
                // 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
                key: share.months > 1 ? `${usage.id}:${share.index}` : usage.id,
                entry: usage.entry,
                cardId,
                cardName: card.name,
                amount: share.amount,
                period,
                installmentIndex: share.index,
                installmentMonths: share.months,
              }),
            );
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
      currency,
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
    const currency = await this.accountCurrency(card.paymentAccountId);

    const [thisYear, thisMonth] = zonedCurrentYearMonth(timeZone).split('-').map(Number);

    const page = await walkPeriods({
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
              periodLedgerRow({
                key: posting.id,
                entry: posting.entry,
                cardId,
                cardName: card.name,
                amount: share.amount,
                period,
                installmentMonths: share.months,
              }),
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
      currency,
      basis: 'month',
      target: card.performanceAmount?.toString() ?? null,
      ...page,
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

    const currency = await this.accountCurrency(card.liabilityAccountId!);

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

    return { cardId: card.id, currency, items };
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
    const currency = await this.accountCurrency(card.liabilityAccountId!);

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
                currency,
              ).toString(),
            );

      return { entryId: item.entryId, billed };
    });

    /*
     * 명세서 한 장의 거래를 모두 한 트랜잭션에서 고치고, 원장 잠금을 기다리기도 한다. 기본 5초로는 건이 많은
     * 명세서가 "transaction closed" 로 끝날 수 있어 원장의 긴 작업과 같은 15초를 둔다 (2026-10-16).
     */
    await this.prisma.$transaction(
      async (tx) => {
        for (const target of targets) {
          await this.ledger.restateForeignEntry(
            target.entryId,
            card.projectId,
            target.billed,
            tx,
            replay?.hlc,
          );
        }
      },
      { timeout: 15_000 },
    );

    return { settled: targets.length };
  }

  /**
   * 신용카드의 사용 다리 가운데 이 주기의 마감일까지 온 것. 실적·청구 원장이 함께 읽는다.
   *
   * 할부는 예전 구매가 지금 주기에 걸리므로 주기 시작에서 `lookback` 개월 앞부터 읽는다.
   * 분류 다리가 없는 대금 결제와 환불 입금은 빠진다.
   */
  private creditUsagesUpTo(
    liabilityAccountId: string,
    period: { start: Date; end: Date },
    lookback: number,
    timeZone: string,
  ) {
    const since = new Date(period.start);
    since.setUTCMonth(since.getUTCMonth() - lookback);

    return this.prisma.posting.findMany({
      where: {
        accountId: liabilityAccountId,
        entry: {
          // 마감일 하루를 통째로 넣는다 (`afterClosingDay`).
          date: { gte: since, lt: afterClosingDay(period.end, timeZone) },
          postings: { some: { categoryId: { not: null } } },
        },
      },
      select: {
        id: true,
        amount: true,
        entry: { select: periodLedgerEntrySelect },
        installmentPlan: INSTALLMENT_PLAN_SELECT,
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    });
  }

  /** 이 부채 계정에 걸린 할부의 최장 개월수. 할부가 없으면 1 이다. */
  private async longestPlanMonths(liabilityAccountId: string): Promise<number> {
    const longestPlan = await this.prisma.installmentPlan.aggregate({
      _max: { totalMonths: true },
      where: { posting: { accountId: liabilityAccountId } },
    });
    return longestPlan._max.totalMonths ?? 1;
  }

  /** 계좌의 통화. 카드의 금액은 부채 계정(신용) 또는 결제 통장(체크)의 통화다. */
  private async accountCurrency(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { currency: true },
    });
    return account.currency;
  }

  /** 카드를 읽고 그 가계부의 권한을 본다. */
  private async loadCard(cardId: string, userId: string, requiredRole?: ProjectRole) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw notFound('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId, requiredRole);
    return card;
  }

  /** 신용카드만 다루는 조회·쓰기의 입구. 마감일·결제일·부채 계정까지 갖춘 카드여야 한다. */
  private async loadCreditCard(
    cardId: string,
    userId: string,
    requiredRole: ProjectRole = 'viewer',
  ) {
    const card = await this.loadCard(cardId, userId, requiredRole);

    if (card.cardType !== CardType.credit || !card.liabilityAccountId) {
      throw new BadRequestException('신용카드만 대금 이동과 청구 주기를 다룹니다.');
    }
    if (card.statementClosingDay === null || card.paymentDueDay === null) {
      throw new BadRequestException('신용카드에 마감일과 결제일이 설정되어 있지 않습니다.');
    }
    return card;
  }
}
