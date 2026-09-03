'use client';

import type { EntryListItem } from '@money/types';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, formatOriginal, toNumber } from '@money/core/lib/money';
import { formatTime } from '@money/core/lib/datetime';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

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
  adjustment: 'entry.adjustment',
};

/**
 * 그 줄의 이름.
 *
 * 카드사 이체는 어느 카드 대금인지가 이름이다 ("신한 대금 결제"). 방향이 뜻을
 * 바꾸므로 환불 입금은 다른 문구를 쓴다.
 *
 * 이체는 "어디서 어디로"를 이름으로 올린다. "이체" 한 마디는 목록의 모든 이체 줄에
 * 똑같이 적혀 어느 거래인지 가려 주지 못한다. 계좌 이름을 못 받은 경우에만
 * 그 문구로 물러선다.
 */
function titleOf(
  t: ReturnType<typeof useTranslation>['t'],
  entry: EntryListItem,
  flow: string,
): string {
  if (entry.kind === 'card_payment') {
    const name = entry.cardName ?? t('editor.methodCard');
    return t(entry.cardTransferDirection === 'refund' ? 'entry.cardRefund' : 'entry.cardPayment', {
      name,
    });
  }

  if (entry.kind === 'transfer') return flow || t('entry.transfer');

  const key = TITLE_KEY_BY_KIND[entry.kind];
  return key ? t(key) : entry.description;
}

/**
 * 목록의 거래 한 줄.
 *
 * 휴대폰에서 한 화면에 여러 건이 들어와야 하므로 두 줄로 고정한다.
 *   1줄: 무슨 거래인가 + 얼마
 *   2줄: 시각 같은 부속 정보 + 외화 원금액
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
  const hasExtra = toNumber(entry.extraAmount) > 0;

  /*
   * "보낸 곳 → 받은 곳". 계좌 사이를 오가는 거래에만 만든다.
   *
   * 한쪽 이름이라도 비면 만들지 않는다. 잔액 조정은 상대가 없고, 그때 "농협 → "
   * 같은 반쪽짜리 화살표를 그리면 받는 곳이 지워진 것처럼 읽힌다.
   */
  const flowTo = entry.toAccountName ?? entry.cardName;
  const flow =
    TWO_SIDED.includes(entry.kind) && entry.accountName && flowTo
      ? `${entry.accountName} → ${flowTo}`
      : '';

  // 카테고리는 "대분류 > 소분류"로 표시한다. 대분류만 지정한 거래는 앞부분만 나온다.
  // 부속 정보 줄에서는 뺐지만, 설명이 빈 거래의 이름으로는 여전히 쓴다.
  const categoryLabel = entry.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry.categoryName;

  // 설명을 비워 둔 거래도 있다. 그때는 분류가 그 거래의 이름 노릇을 한다.
  const title = titleOf(t, entry, flow) || categoryLabel || t('entry.noTitle');

  /*
   * 2줄에 들어가는 부속 정보. 있는 것만 " · "로 잇는다.
   *
   * 어느 거래든 시각만 적는다. 분류와 결제수단은 거래를 눌러 상세에서 본다.
   *
   * 잔액 조정은 상대 계좌가 있으면 함께 남긴다. 제목이 "잔액 조정"뿐이라 어느
   * 계좌 이야기인지가 이 줄에만 있다.
   */
  const meta = (entry.kind === 'adjustment' ? [flow, time] : [time])
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

      {/*
        붙은 태그. 금액 줄 아래에 둔다.
        이름만 작게 늘어놓는다 -- 목록 한 줄에서 태그는 "이 거래가 어느 일에 딸렸나"를
        알려 주는 곁말이라, 제목만큼 크면 무엇이 거래인지 흐려진다.
      */}
      {entry.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {entry.tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
            >
              {tag.color && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* 2줄에 담을 것이 하나도 없는 거래도 있다. 그때는 빈 줄을 만들지 않는다. */}
      {(meta || hasExtra || hasFee || original) && (
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
        <span className="min-w-0 truncate">{meta}</span>

        {/* 금액이 붙는 표시들은 오른쪽 끝에 모은다. 위 줄의 금액과 같은 세로선에 선다. */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/*
            외화가 얽힌 거래는 원래 금액을 함께 보여 준다. 위 금액은 언제나 기준통화
            환산액이라 그것만으로는 카드 명세서와 대조할 수 없다. "$50.00 · 환율 1,380".
          */}
          {original && (
            <span className="tabular-nums text-gray-400">
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

          {hasFee && (
            <span className="font-medium tabular-nums text-red-600">
              {t('entry.fee', { amount: formatCurrency(fee, displayCurrency) })}
            </span>
          )}

          {/*
            과소비·추가 수입은 금액까지 적는다. 표시만 있으면 "얼마가 과했나"를
            거래를 열어 봐야 알 수 있는데, 그 값이 이 표시의 요점이다.

            수수료와 같은 모양이다. 둘 다 "이 거래에서 얼마가 어느 쪽으로 갔나"를
            말하는 금액이라, 한쪽만 알약 배지로 두면 다른 뜻처럼 보인다. 색은 돈이
            움직인 방향이다 (과소비 빨강, 추가 수입 초록).
          */}
          {hasExtra && (
            <span
              className={`font-medium tabular-nums ${
                entry.kind === 'income' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {entry.kind === 'income' ? t('entry.extraIncome') : t('entry.overspend')}{' '}
              {formatCurrency(entry.extraAmount, displayCurrency)}
            </span>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
