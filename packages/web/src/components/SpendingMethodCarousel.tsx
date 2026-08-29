'use client';

import { useDragScroll } from '@/hooks/useDragScroll';
import { cardPaletteOf } from '@/lib/card-color';
import { formatCurrency, toNumber } from '@/lib/money';

/** 카드 한 장이 지금 실적 구간에 얼마를 썼는지 */
export interface SpendingMethod {
  id: string;
  kind: 'credit_card' | 'debit_card';
  /** 카드에 고른 앞면 색(CardColor). 고르지 않았으면 종류의 기본색으로 그린다. */
  color?: string | null;
  name: string;
  ownerName: string | null;
  /** 사용액·기준액의 통화. 카드 결제 통장의 통화다. */
  currency: string;
  /** 지금 세고 있는 구간 표시 ("8/16 ~ 9/15") */
  periodLabel: string;
  usage: string;
  /** 직전 구간 표시와 사용액. 1일에 지난 구간을 확인하러 가지 않게 함께 적는다. */
  previousPeriodLabel: string;
  previousUsage: string;
  /** 실적 기준액. 조건이 없는 카드는 null */
  target: string | null;
}

/** 종류 이름. 카드 앞면 왼쪽 위에 적는다. */
const KIND_LABEL: Record<SpendingMethod['kind'], string> = {
  credit_card: '신용카드',
  debit_card: '체크카드',
};

/**
 * 실적 구간의 사용액을 카드 모양으로 훑어보는 줄.
 *
 * 카드마다 세는 구간이 다르다. 신용카드는 마감일 기준 청구 주기, 체크카드는 달력
 * 월이다. 그래서 카드마다 무슨 구간을 센 값인지 함께 적는다. 적지 않으면
 * "이번 달 얼마 썼더라"와 숫자가 달라 보인다.
 *
 * 통장은 여기 세우지 않는다. 실적이라는 것이 없어 이 줄에서 볼 것이 없다.
 */
export default function SpendingMethodCarousel({
  methods,
  onSelect,
}: {
  methods: SpendingMethod[];
  /** 카드를 누르면 호출한다. 넘기지 않으면 누를 수 없는 카드가 된다. */
  onSelect?: (method: SpendingMethod) => void;
}) {
  // 휠만 있는 마우스로도 끌어서 넘길 수 있게 한다 (useDragScroll 주석 참고).
  const scrollRef = useDragScroll<HTMLDivElement>();

  if (methods.length === 0) {
    return <p className="text-sm text-gray-600">보여줄 카드가 없습니다.</p>;
  }

  return (
    <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
      {methods.map((method) => (
        <MethodCard
          key={`${method.kind}-${method.id}`}
          method={method}
          onSelect={onSelect && (() => onSelect(method))}
        />
      ))}
    </div>
  );
}

function MethodCard({
  method,
  onSelect,
}: {
  method: SpendingMethod;
  onSelect?: () => void;
}) {
  /* 앞면 색과 그 위에서 읽히는 글씨 색은 lib/card-color가 짝으로 들고 있다. */
  const palette = cardPaletteOf(
    method.color,
    method.kind === 'credit_card' ? 'credit' : 'debit',
  );
  const usage = toNumber(method.usage);
  const target = method.target === null ? null : toNumber(method.target);
  /*
   * 실적 막대. 기준을 넘겨도 100%에서 멈춘다.
   *
   * 사용액이 음수일 수 있다(취소가 더 많은 구간). 음수 너비는 그려지지 않고
   * 레이아웃만 흔들어서 아래도 0에서 자른다. CardPerformancePanel과 같은 규칙이다.
   */
  const progress =
    target && target > 0 ? Math.min(Math.max((usage / target) * 100, 0), 100) : null;
  /*
   * 실적을 채우려면 남은 금액. 이미 넘겼으면 음수로 그대로 적는다.
   *
   * 넘긴 카드를 "0원 남음"으로 적으면 방금 채운 카드와 구별되지 않는다. 얼마나
   * 넘겼는지가 다음 결제를 이 카드로 할지 말지를 가른다.
   */
  const remaining = progress === null || target === null ? null : target - usage;
  /* 실적 막대와 남은 금액에 함께 쓰는 색. 둘 다 실적 기준이 있는 카드에만 그린다. */
  const tone = remaining !== null && remaining > 0 ? palette.positive : palette.negative;

  /*
   * 실제 카드(ISO/IEC 7810 ID-1, 85.6 × 53.98mm) 비율을 그대로 쓴다. 높이가 내용에
   * 딸려 늘어나지 않으므로 세 덩이를 justify-between으로 위·가운데·아래에 붙인다.
   *
   * 읽는 차례대로 놓는다. 위는 어느 카드인지(종류·주인·이름), 가운데는 어느 구간에
   * 얼마를 썼고 기준까지 얼마가 남았는지, 아래는 견줄 직전 구간이다. 금액은 구간
   * 표기 아래에 두어 "이 구간에 이만큼"으로 읽히게 한다.
   */
  /*
   * 누를 수 있으면 button으로 그린다. div에 onClick만 달면 키보드로 닿지 않는다.
   * 눌렀을 때 살짝 커지게 해서 누를 수 있는 카드임을 알린다.
   */
  const Tag = onSelect ? 'button' : 'div';

  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className={`snap-start shrink-0 w-80 aspect-[85.6/53.98] flex flex-col justify-between overflow-hidden rounded-2xl p-4 text-left shadow-sm ${palette.face} ${palette.ink} ${
        onSelect ? 'transition hover:brightness-105 active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs opacity-80 truncate">
            {KIND_LABEL[method.kind]}
            {method.ownerName && ` · ${method.ownerName}`}
          </p>
          <p className="font-semibold truncate">{method.name}</p>
        </div>
        {/* 카드 앞면의 IC칩 자리. 카드처럼 보이게 하는 최소한의 표시다. */}
        <span className="mt-1 h-6 w-8 shrink-0 rounded bg-amber-300/80" aria-hidden />
      </div>

      <div>
        <p className="text-xs opacity-80 truncate">{method.periodLabel}</p>
        <p className="flex items-baseline gap-1.5 leading-tight">
          <span className="text-2xl font-bold tabular-nums">
            {formatCurrency(method.usage, method.currency)}
          </span>
          {/* 기준액은 사용액 바로 뒤에 붙인다. "얼마 중 얼마"로 한눈에 읽힌다. */}
          {target !== null && (
            <span className="text-xs opacity-80 tabular-nums">
              / {formatCurrency(method.target, method.currency)}
            </span>
          )}
        </p>

        {progress !== null && (
          <div className="mt-2">
            <div className={`h-1.5 rounded-full overflow-hidden ${palette.track}`}>
              <div
                className={`h-full rounded-full ${tone.bar}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {/*
              * 막대 끝쪽에 붙여 "여기까지 얼마 남았다"로 읽히게 한다. 막대와 같은
              * 색이라 어느 막대의 남은 금액인지 눈으로 이어진다.
              */}
            <p className={`mt-1 text-right text-xs font-semibold tabular-nums ${tone.text}`}>
              남은 {formatCurrency(remaining, method.currency)}
            </p>
          </div>
        )}
      </div>

      <div className={`border-t pt-1.5 text-xs opacity-90 ${palette.divider}`}>
        <p className="flex items-baseline justify-between gap-2">
          <span className="truncate">{method.previousPeriodLabel}</span>
          <span className="tabular-nums">
            {formatCurrency(method.previousUsage, method.currency)}
          </span>
        </p>
      </div>
    </Tag>
  );
}
