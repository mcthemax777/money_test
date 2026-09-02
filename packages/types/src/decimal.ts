/**
 * 정확한 십진 연산.
 *
 * 왜 필요한가. 지금까지 금액 합산은 전부 서버가 했고, 화면은 표시 직전에만
 * 숫자로 바꿨다(`@money/core`의 money.ts). 오프라인 집계는 그 전제를 깬다.
 * 기기가 스스로 월 합계를 내야 하는데 double로 더하면 원 단위가 어긋난다.
 *
 * 왜 라이브러리가 아닌가. 새 의존성 없이 되고, 스키마가 쓰는 Decimal(19,4)와
 * Decimal(19,8)은 BigInt 하나로 정확히 담긴다. 서버의 Prisma.Decimal 값은
 * `toString()`이 정확하므로 그대로 받아 변환한다.
 *
 * 왜 @money/types 인가. 서버(@money/api)는 @money/core 를 의존할 수 없다.
 * axios·zustand·react 가 함께 딸려 오기 때문이다. 서버와 화면이 이미 함께
 * 의존하는 패키지는 여기 하나뿐이라, 양쪽이 같은 계산을 쓸 자리도 여기다.
 *
 * 표현 방식은 (부호 있는 정수, 소수 자릿수) 쌍이다. 1.25 는 (125, 2)다.
 * 더하기·빼기·곱하기는 자릿수를 맞추거나 더하기만 하므로 반올림이 없다.
 * 나누기만 자릿수를 지정해야 하고, 그 자리에서만 반올림이 일어난다.
 */

import { currencyDecimals } from './currency';

/** 십진값으로 받아들일 수 있는 것. Prisma.Decimal 은 마지막 갈래로 들어온다. */
export type DecInput = Dec | string | number | bigint | { toString(): string };

/**
 * 반올림 방식.
 *
 * 'half-up' 은 0.5 를 0에서 먼 쪽으로 올린다(-0.5 -> -1). Postgres의 numeric과
 * decimal.js 기본값이 같은 규칙이라, 서버가 반올림한 값과 기기가 반올림한 값이
 * 어긋나지 않는다.
 * 'down' 은 0쪽으로 버린다. 환율 곱셈에서 청구액을 넘기지 않아야 할 때 쓴다.
 */
export type RoundingMode = 'half-up' | 'down';

const DEC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** 자릿수를 맞춘 두 값의 정수부. 큰 자릿수 쪽으로 올려 맞춘다(정보를 잃지 않는다). */
function align(a: Dec, b: Dec): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.unscaled * pow10(scale - a.scale),
    right: b.unscaled * pow10(scale - b.scale),
    scale,
  };
}

/**
 * |numerator| / |denominator| 를 정수로 만든다. 부호는 부르는 쪽이 붙인다.
 *
 * half-up 을 (2N + D) / 2D 로 구하는 것은 나머지를 따로 보지 않아도 되기 때문이다.
 * N=1, D=2 이면 (2+2)/4 = 1 로 0.5가 올라가고, N=1, D=3 이면 (2+3)/6 = 0 이다.
 */
function divideAbs(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (mode === 'down') return numerator / denominator;
  return (2n * numerator + denominator) / (2n * denominator);
}

export class Dec {
  /**
   * 값은 unscaled / 10^scale 이다.
   *
   * 만들 때 뒤따르는 0을 떼어 같은 값이 언제나 같은 모양을 갖게 한다. 그래서
   * 1.10 과 1.1 이 같은 것으로 비교되고, JSON으로 나가는 문자열도 하나로 정해진다.
   * 표시용 자릿수는 `toFixed`가 그때 채운다.
   */
  private constructor(
    readonly unscaled: bigint,
    readonly scale: number,
  ) {}

  private static make(unscaled: bigint, scale: number): Dec {
    let u = unscaled;
    let s = scale;
    if (u === 0n) return new Dec(0n, 0);
    while (s > 0 && u % 10n === 0n) {
      u /= 10n;
      s -= 1;
    }
    return new Dec(u, s);
  }

  /**
   * 십진값으로 바꾼다.
   *
   * 빈 값과 NaN·Infinity 는 던진다. 0으로 대체하면 금액이 조용히 사라진다.
   * 표시 경로에서 "값이 없으면 0"이 필요하면 부르는 쪽이 그렇게 적는다.
   */
  static of(value: DecInput): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === 'bigint') return Dec.make(value, 0);

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new RangeError(`십진값으로 바꿀 수 없는 수입니다: ${value}`);
      }
      // Number 의 문자열 표현은 그 값으로 되돌아오는 가장 짧은 십진 표기다.
      // 0.1 은 "0.1" 이 되므로, 사용자가 뜻한 값이 그대로 남는다.
      return Dec.parse(String(value));
    }

    const text = typeof value === 'string' ? value : String(value);
    return Dec.parse(text);
  }

  private static parse(raw: string): Dec {
    const text = raw.trim();
    if (text === '' || !DEC_PATTERN.test(text)) {
      throw new RangeError(`십진값으로 읽을 수 없습니다: ${JSON.stringify(raw)}`);
    }

    const negative = text.startsWith('-');
    const body = text.replace(/^[+-]/, '');
    const [mantissa, exponentText] = body.split(/[eE]/);
    const [intPart, fracPart = ''] = mantissa.split('.');

    let digits = `${intPart}${fracPart}`;
    let scale = fracPart.length;

    if (exponentText) {
      scale -= Number(exponentText);
      if (scale < 0) {
        digits = `${digits}${'0'.repeat(-scale)}`;
        scale = 0;
      }
    }

    const unscaled = BigInt(digits === '' ? '0' : digits);
    return Dec.make(negative ? -unscaled : unscaled, scale);
  }

  /** 여럿을 더한다. 빈 목록은 0이다. */
  static sum(values: Iterable<DecInput>): Dec {
    let total = ZERO;
    for (const value of values) total = total.plus(value);
    return total;
  }

  plus(other: DecInput): Dec {
    const { left, right, scale } = align(this, Dec.of(other));
    return Dec.make(left + right, scale);
  }

  minus(other: DecInput): Dec {
    const { left, right, scale } = align(this, Dec.of(other));
    return Dec.make(left - right, scale);
  }

  /** 자릿수를 더하기만 하므로 반올림이 없다. 0.1 * 0.2 는 정확히 0.02 다. */
  times(other: DecInput): Dec {
    const b = Dec.of(other);
    return Dec.make(this.unscaled * b.unscaled, this.scale + b.scale);
  }

  /**
   * 나눗셈은 결과 자릿수를 반드시 받는다.
   *
   * 1/3 처럼 끝나지 않는 값이 있어 "정확한 몫"이라는 것이 없다. 자릿수를
   * 부르는 쪽이 정하게 하면, 환율 환산이 몇 자리에서 반올림되는지가 호출부에
   * 드러난다.
   */
  dividedBy(other: DecInput, decimals: number, mode: RoundingMode = 'half-up'): Dec {
    assertDecimals(decimals);
    const b = Dec.of(other);
    if (b.unscaled === 0n) {
      throw new RangeError('0으로 나눌 수 없습니다.');
    }

    const numerator = this.unscaled * pow10(b.scale + decimals);
    const denominator = b.unscaled * pow10(this.scale);
    const negative = numerator < 0n !== denominator < 0n;
    const quotient = divideAbs(abs(numerator), abs(denominator), mode);

    return Dec.make(negative ? -quotient : quotient, decimals);
  }

  negated(): Dec {
    return Dec.make(-this.unscaled, this.scale);
  }

  abs(): Dec {
    return this.unscaled < 0n ? this.negated() : this;
  }

  /** 소수 자릿수를 줄인다. 지금보다 자릿수가 많으면 그대로 둔다(0을 채우지 않는다). */
  round(decimals: number, mode: RoundingMode = 'half-up'): Dec {
    assertDecimals(decimals);
    if (decimals >= this.scale) return this;

    const divisor = pow10(this.scale - decimals);
    const quotient = divideAbs(abs(this.unscaled), divisor, mode);
    return Dec.make(this.unscaled < 0n ? -quotient : quotient, decimals);
  }

  /** -1, 0, 1 */
  cmp(other: DecInput): -1 | 0 | 1 {
    const { left, right } = align(this, Dec.of(other));
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  eq(other: DecInput): boolean {
    return this.cmp(other) === 0;
  }
  lt(other: DecInput): boolean {
    return this.cmp(other) < 0;
  }
  lte(other: DecInput): boolean {
    return this.cmp(other) <= 0;
  }
  gt(other: DecInput): boolean {
    return this.cmp(other) > 0;
  }
  gte(other: DecInput): boolean {
    return this.cmp(other) >= 0;
  }

  isZero(): boolean {
    return this.unscaled === 0n;
  }
  isNegative(): boolean {
    return this.unscaled < 0n;
  }
  isPositive(): boolean {
    return this.unscaled > 0n;
  }

  /** 뒤따르는 0이 없는 표준 표기. DB와 API에 보내는 값은 이것을 쓴다. */
  toString(): string {
    if (this.scale === 0) return this.unscaled.toString();

    const digits = abs(this.unscaled).toString().padStart(this.scale + 1, '0');
    const cut = digits.length - this.scale;
    const sign = this.unscaled < 0n ? '-' : '';
    return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
  }

  /** 자릿수를 고정한 표기. 모자라면 0을 채우고 넘치면 반올림한다. */
  toFixed(decimals: number, mode: RoundingMode = 'half-up'): string {
    assertDecimals(decimals);
    const rounded = this.round(decimals, mode);
    if (decimals === 0) return rounded.toString();

    const digits = abs(rounded.unscaled)
      .toString()
      .padStart(rounded.scale + 1, '0');
    const whole = digits.slice(0, digits.length - rounded.scale) || '0';
    const fraction = digits.slice(digits.length - rounded.scale).padEnd(decimals, '0');
    const sign = rounded.unscaled < 0n ? '-' : '';
    return `${sign}${whole}.${fraction}`;
  }

  /**
   * 표시와 비교용 숫자. 합산에 쓰지 말 것.
   *
   * 차트 좌표나 진행률처럼 정밀도가 필요 없는 자리에만 쓴다. 금액을 더하려면
   * `plus`와 `Dec.sum`이 있다.
   */
  toNumber(): number {
    return Number(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new RangeError(`소수 자릿수는 0 이상 30 이하의 정수여야 합니다: ${decimals}`);
  }
}

export const ZERO = Dec.of(0);

/** 짧게 부르는 이름. `dec('1.25').plus('0.75')` 처럼 쓴다. */
export function dec(value: DecInput): Dec {
  return Dec.of(value);
}

/**
 * 그 통화의 자릿수로 반올림한다. 원과 엔은 0자리, 달러는 2자리다.
 *
 * 환산액을 화면에 내보내기 전에 한 번 통과시키는 자리다. 모르는 통화는
 * `currencyDecimals`의 규칙대로 2자리로 본다.
 */
export function roundToCurrency(value: DecInput, currency: string): Dec {
  const decimals = currencyDecimals(currency);
  return Dec.of(value).round(decimals);
}
