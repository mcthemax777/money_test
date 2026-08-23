import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CurrencyCode,
  ExchangeRateInfo,
  SUPPORTED_CURRENCIES,
  currencyDecimals,
  isCurrencyCode,
} from '@money/types';
import { PrismaService } from '@/config/prisma.service';

/**
 * 저장 통화로 된 값을 표시 통화로 바꾼다.
 *
 * 저장값을 고치지 않고 읽을 때만 적용하는 것이 이 타입의 존재 이유다.
 * 예전에는 표시 통화를 바꿀 때 Posting.baseAmount 를 전부 다시 계산해 덮어썼고,
 * 그래서 KRW -> USD -> KRW 왕복에 반올림 손실이 남았다.
 */
export interface DisplayConverter {
  currency: CurrencyCode;
  /** 1 저장통화 = rate 표시통화 */
  rate: Prisma.Decimal;
  /** 두 통화가 같아 환산이 필요 없는 경우 */
  isIdentity: boolean;
  convert(value: Prisma.Decimal): Prisma.Decimal;
  toString(value: Prisma.Decimal): string;
}

/**
 * 기본 환율.
 *
 * 아직 외부 API 연동이 없어서 서버가 들고 있는 고정값이다. `ExchangeRate` 테이블에
 * 행이 있으면 그쪽이 우선하므로, 나중에 주기적으로 가져오는 작업이 붙으면 이 값은
 * 자동으로 쓰이지 않게 된다. 지우지 않고 두는 이유는 조회에 실패하거나 아직 한 번도
 * 가져오지 못한 통화쌍에서 화면이 멈추지 않게 하기 위해서다.
 *
 * 값의 뜻은 "1 <from> = rate <to>"다.
 */
const FALLBACK_RATES: Record<string, string> = {
  'USD:KRW': '1380',
  'JPY:KRW': '9.2',
  'USD:JPY': '150',
};

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 지원 통화인지 확인하고 좁혀 준다. 화면·API 경계에서 쓴다. */
  assertCurrency(value: unknown, label = '통화'): CurrencyCode {
    if (!isCurrencyCode(value)) {
      throw new BadRequestException(
        `${label}: ${SUPPORTED_CURRENCIES.join(', ')} 중 하나여야 합니다.`,
      );
    }
    return value;
  }

  /**
   * 1 from = ? to.
   *
   * 같은 통화면 1이다. DB에 그 통화쌍의 최신 행이 있으면 그것을 쓰고, 없으면
   * 뒤집힌 쌍(to->from)의 역수를 본 뒤, 그래도 없으면 고정값으로 내려간다.
   */
  async getRate(
    projectId: string,
    from: CurrencyCode,
    to: CurrencyCode,
  ): Promise<ExchangeRateInfo> {
    if (from === to) {
      return { from, to, rate: '1', source: 'identity' };
    }

    const direct = await this.prisma.exchangeRate.findFirst({
      where: { projectId, baseCurrency: from, quoteCurrency: to },
      orderBy: { date: 'desc' },
    });
    if (direct) {
      return {
        from,
        to,
        rate: direct.rate.toString(),
        date: direct.date.toISOString().slice(0, 10),
        source: direct.source,
      };
    }

    // 반대 방향만 저장돼 있을 수 있다. 역수를 쓴다.
    const inverse = await this.prisma.exchangeRate.findFirst({
      where: { projectId, baseCurrency: to, quoteCurrency: from },
      orderBy: { date: 'desc' },
    });
    if (inverse && !inverse.rate.isZero()) {
      return {
        from,
        to,
        rate: new Prisma.Decimal(1).div(inverse.rate).toDecimalPlaces(8).toString(),
        date: inverse.date.toISOString().slice(0, 10),
        source: `${inverse.source} (역수)`,
      };
    }

    const fallback = this.fallbackRate(from, to);
    if (fallback) {
      this.logger.warn(
        `${from}->${to} 환율이 저장돼 있지 않아 고정값(${fallback})을 씁니다.`,
      );
      return { from, to, rate: fallback, source: 'fallback' };
    }

    throw new BadRequestException(
      `${from}에서 ${to}로 환산할 환율이 없습니다. 환율을 직접 입력해 주세요.`,
    );
  }

  /**
   * 저장 통화 -> 표시 통화 환산기.
   *
   * 리포트는 이것을 한 번 만들어 **합계에만** 곱한다. 행마다 곱하면 반올림이
   * 행 수만큼 쌓이고, 무엇보다 저장값을 건드리지 않는다는 점이 중요하다.
   * 표시 통화를 몇 번을 바꾸든 원본은 그대로이므로 왕복 오차가 원리적으로 없다.
   *
   * 두 통화가 같으면 곱셈 자체를 건너뛴다 (대부분의 프로젝트가 여기에 해당한다).
   */
  async getDisplayConverter(
    projectId: string,
    ledger: CurrencyCode,
    display: CurrencyCode,
  ): Promise<DisplayConverter> {
    const decimals = currencyDecimals(display);

    if (ledger === display) {
      return {
        currency: display,
        rate: new Prisma.Decimal(1),
        isIdentity: true,
        convert: (value) => value,
        toString: (value) => value.toString(),
      };
    }

    const rate = new Prisma.Decimal((await this.getRate(projectId, ledger, display)).rate);
    const convert = (value: Prisma.Decimal) =>
      value.mul(rate).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);

    return {
      currency: display,
      rate,
      isIdentity: false,
      convert,
      toString: (value) => convert(value).toString(),
    };
  }

  /** 화면이 통화를 고를 때 미리 채울 수 있도록 저장 통화 기준 전체 환율을 준다. */
  async listRatesFor(projectId: string, baseCurrency: CurrencyCode): Promise<ExchangeRateInfo[]> {
    const others = SUPPORTED_CURRENCIES.filter((code) => code !== baseCurrency);
    return Promise.all(others.map((code) => this.getRate(projectId, code, baseCurrency)));
  }

  /**
   * 프로젝트가 쓸 환율을 직접 정한다.
   *
   * 기본값(FALLBACK_RATES)이 실제와 다를 때 설정에서 고쳐 넣는 자리다. 거래 입력
   * 화면에서는 환율을 받지 않는다. 사용자가 아는 값은 환율이 아니라 실제로 빠진
   * 금액이고, 환율은 그 둘의 비로 유도되기 때문이다. 여기서 정하는 값은 아직
   * 금액을 모르는 거래(신용카드 결제)를 추정할 때와 표시 통화 환산에 쓰인다.
   *
   * 같은 날짜에 다시 넣으면 덮어쓴다. 날짜를 쪼개 이력을 남기는 것은 외부 API
   * 연동이 붙을 때 할 일이라 지금은 오늘 날짜 한 줄만 유지한다.
   */
  async setRate(
    projectId: string,
    from: CurrencyCode,
    to: CurrencyCode,
    rate: Prisma.Decimal,
    date: Date,
  ): Promise<ExchangeRateInfo> {
    if (from === to) {
      throw new BadRequestException('같은 통화끼리는 환율을 정할 수 없습니다.');
    }
    if (rate.lte(0)) {
      throw new BadRequestException('환율은 0보다 커야 합니다.');
    }

    const saved = await this.prisma.exchangeRate.upsert({
      where: {
        projectId_baseCurrency_quoteCurrency_date: {
          projectId,
          baseCurrency: from,
          quoteCurrency: to,
          date,
        },
      },
      create: {
        projectId,
        baseCurrency: from,
        quoteCurrency: to,
        rate,
        date,
        source: 'manual',
      },
      update: { rate, source: 'manual' },
    });

    return {
      from,
      to,
      rate: saved.rate.toString(),
      date: saved.date.toISOString().slice(0, 10),
      source: saved.source,
    };
  }

  /**
   * 직접 정한 환율을 지운다. 기본값으로 되돌아간다.
   *
   * 그 통화쌍의 행을 전부 지운다. 한 줄만 지우면 예전 날짜의 행이 남아 계속
   * 쓰이므로 "되돌렸는데 그대로"인 것처럼 보인다.
   */
  async clearRate(projectId: string, from: CurrencyCode, to: CurrencyCode): Promise<void> {
    await this.prisma.exchangeRate.deleteMany({
      where: { projectId, baseCurrency: from, quoteCurrency: to },
    });
  }

  /** 고정값 표에서 찾는다. 뒤집힌 쌍이면 역수를 만든다. */
  private fallbackRate(from: CurrencyCode, to: CurrencyCode): string | null {
    const direct = FALLBACK_RATES[`${from}:${to}`];
    if (direct) return direct;

    const inverse = FALLBACK_RATES[`${to}:${from}`];
    if (inverse) {
      return new Prisma.Decimal(1).div(inverse).toDecimalPlaces(8).toString();
    }
    return null;
  }
}
