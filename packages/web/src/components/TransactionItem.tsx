'use client';

import type { EntryListItem } from '@money/types';
import { useTranslation, type MessageKey } from '@/lib/i18n';
import { formatCurrency, formatOriginal, toNumber } from '@/lib/money';
import { formatTime } from '@/lib/datetime';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@/store/project';

/**
 * 서버가 전표를 한 줄로 펴서 주는 형태.
 *
 * 예전에는 이 파일에 같은 모양을 한 번 더 적어 두었다. 서버가 필드를 추가해도
 * 화면 타입이 따라오지 않아 어긋났으므로 공용 계약을 그대로 다시 내보낸다.
 * 실제 정의는 packages/types entities.ts, 조립 규칙은 packages/api entry-view.ts 참고.
 */
export type { EntryListItem };

interface TransactionItemProps {
  entry: EntryListItem;
  onClick?: () => void;
  isSelected?: boolean;
}

/*
 * 금액 색이 곧 "합계에 들어가는가"다.
 * 수입은 초록, 지출은 빨강, 잔액 조정은 노랑.
 * 이체와 카드사 이체는 돈이 내 계좌 사이를 옮겨 다닌 것뿐이라 둘 다 회색이다.
 *
 * 예전에는 같은 뜻을 왼쪽 색 띠와 카드 배경색으로 한 번 더 칠했다. 한 줄에 색이
 * 셋이면 어느 것이 뜻을 담은 색인지 알기 어렵고, 목록이 알록달록해진다.
 */
const AMOUNT_COLOR_BY_KIND: Record<EntryListItem['kind'], string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  transfer: 'text-gray-500',
  card_payment: 'text-gray-500',
  adjustment: 'text-amber-600',
};

/** 부호는 합계를 움직이는 거래에만 붙는다 */
const SIGN_BY_KIND: Partial<Record<EntryListItem['kind'], string>> = {
  income: '+',
  expense: '-',
};

/** 계좌 사이를 오가는 거래는 "A → B"로 보여준다. */
const TWO_SIDED: Array<EntryListItem['kind']> = ['transfer', 'card_payment', 'adjustment'];

const TITLE_KEY_BY_KIND: Partial<Record<EntryListItem['kind'], MessageKey>> = {
  transfer: 'entry.transfer',
  adjustment: 'entry.adjustment',
};

/**
 * 이 거래가 합계에 들어가는지.
 *
 * 이체와 카드사 이체는 목록에 보이지만 수입에도 지출에도 잡히지 않는다.
 * 내 계좌 사이의 이동이고, 카드 사용액은 그을 때 이미 지출로 잡혔기 때문이다.
 * 수수료가 붙은 이체는 그 수수료만 지출이라 예외로 둔다.
 */
const NOT_COUNTED: Array<EntryListItem['kind']> = ['transfer', 'card_payment'];

/** 카드사 이체는 방향이 뜻을 바꾼다 */
function titleOf(t: ReturnType<typeof useTranslation>['t'], entry: EntryListItem): string {
  if (entry.kind === 'card_payment') {
    return t(entry.cardTransferDirection === 'refund' ? 'entry.cardRefund' : 'entry.cardPayment');
  }

  const key = TITLE_KEY_BY_KIND[entry.kind];
  return key ? t(key) : entry.description;
}

/** 배지 하나. 뜻을 담은 색은 금액이 쓰므로 배지는 회색으로 물러선다. */
/**
 * 한 줄에 붙는 작은 표시.
 *
 * `tone`은 그 표시가 돈을 어느 쪽으로 움직였는지다. 과소비는 지출과 같은 빨강,
 * 추가 수입은 수입과 같은 초록이라 위 금액 색과 같은 이야기를 한다.
 */
function Badge({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'expense' | 'income';
}) {
  const style =
    tone === 'expense'
      ? 'bg-red-50 text-red-600'
      : tone === 'income'
        ? 'bg-green-50 text-green-600'
        : 'bg-gray-100 text-gray-500';
  return (
    <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium ${style}`}>
      {children}
    </span>
  );
}

/**
 * 목록의 거래 한 줄.
 *
 * 휴대폰에서 한 화면에 여러 건이 들어와야 하므로 두 줄로 고정한다.
 *   1줄: 무슨 거래인가 + 얼마
 *   2줄: 분류·결제수단·시각 같은 부속 정보 + 외화 원금액
 * 긴 이름은 잘라 낸다. 줄이 늘어나면 카드마다 높이가 달라져 훑어보기 어렵다.
 */
export default function TransactionItem({ entry, onClick, isSelected }: TransactionItemProps) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  // 이체는 "얼마를 어디로 보냈는가"와 "수수료를 얼마 냈는가"가 서로 다른 정보다.
  // 수수료가 있으면 그 수수료만 지출이므로 금액이 아니라 수수료를 빨갛게 쓴다.
  const fee = entry.kind === 'transfer' ? toNumber(entry.feeAmount) : 0;
  const hasFee = fee > 0;

  const time = formatTime(entry.date, timeZone);
  const original = formatOriginal(entry);
  const showNotCounted = NOT_COUNTED.includes(entry.kind) && !hasFee;
  const hasExtra = toNumber(entry.extraAmount) > 0;

  // 카테고리는 "대분류 > 소분류"로 표시한다. 대분류만 지정한 거래는 앞부분만 나온다.
  const categoryLabel = entry.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry.categoryName;

  // 설명을 비워 둔 거래도 있다. 그때는 분류가 그 거래의 이름 노릇을 한다.
  const title = titleOf(t, entry) || categoryLabel || t('entry.noTitle');

  /*
   * 2줄에 들어가는 부속 정보. 있는 것만 " · "로 잇는다.
   *
   * 계좌 사이를 오가는 거래는 분류가 없고 "어디서 어디로"가 그 자리를 대신한다.
   * 이체 수수료의 분류는 그 수수료가 무슨 지출인지 알려 주므로 함께 남긴다.
   */
  const meta = (
    TWO_SIDED.includes(entry.kind)
      ? [
          `${entry.accountName} → ${entry.toAccountName ?? entry.cardName}`,
          hasFee ? entry.feeCategoryName : null,
          time,
        ]
      : [categoryLabel, entry.cardName ?? entry.accountName, time]
  )
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 transition-colors ${
        onClick ? 'cursor-pointer hover:bg-gray-50 active:bg-gray-100' : ''
      } ${isSelected ? 'bg-blue-50' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-[15px] font-medium text-gray-900">{title}</p>
        <p
          className={`shrink-0 text-[15px] font-semibold tabular-nums ${
            AMOUNT_COLOR_BY_KIND[entry.kind]
          }`}
        >
          {SIGN_BY_KIND[entry.kind]}
          {formatCurrency(entry.amount, displayCurrency)}
        </p>
      </div>

      {/* 2줄에 담을 것이 하나도 없는 거래도 있다. 그때는 빈 줄을 만들지 않는다. */}
      {(meta || hasExtra || showNotCounted || hasFee || original) && (
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
        <span className="min-w-0 truncate">{meta}</span>

        {/*
          과소비·추가 수입은 금액까지 적는다. 표시만 있으면 "얼마가 과했나"를
          거래를 열어 봐야 알 수 있는데, 그 값이 이 표시의 요점이다.
        */}
        {hasExtra && (
          <Badge tone={entry.kind === 'income' ? 'income' : 'expense'}>
            {entry.kind === 'income' ? t('entry.extraIncome') : t('entry.overspend')}{' '}
            {formatCurrency(entry.extraAmount, displayCurrency)}
          </Badge>
        )}
        {/* 이체와 카드사 이체는 수입도 지출도 아니다. 회색 금액과 같은 이야기를 글로 한 번 더 한다. */}
        {showNotCounted && <Badge>{t('entry.notCounted')}</Badge>}
        {hasFee && (
          <span className="shrink-0 font-medium tabular-nums text-red-600">
            {t('entry.fee', { amount: formatCurrency(fee, displayCurrency) })}
          </span>
        )}

        {/*
          외화가 얽힌 거래는 원래 금액을 함께 보여 준다. 위 금액은 언제나 기준통화
          환산액이라 그것만으로는 카드 명세서와 대조할 수 없다. "$50.00 · 환율 1,380".
        */}
        {original && (
          <span className="ml-auto shrink-0 tabular-nums text-gray-400">
            {original}
            {/*
              청구액이 아직 카드사 확정 전이라는 표시. 이 값이 붙어 있는 동안 위 금액은
              서버 추정 환율로 만든 값이고, 카드 화면에서 명세서의 실제 청구액으로 확정한다.
            */}
            {entry.rateProvisional && (
              <span className="ml-1 text-amber-600">· {t('entry.provisional')}</span>
            )}
          </span>
        )}
      </div>
      )}
    </div>
  );
}
