'use client';

import type { EntryListItem } from '@money/types';
import { formatCurrency, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/datetime';
import { useProjectTimeZone } from '@/store/project';

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
 * 색이 곧 "합계에 들어가는가"다.
 * 수입은 초록, 지출은 빨강, 잔액 조정은 노랑.
 * 이체와 카드사 이체는 돈이 내 계좌 사이를 옮겨 다닌 것뿐이라 둘 다 회색이다.
 */
const BORDER_BY_KIND: Record<EntryListItem['kind'], string> = {
  income: 'border-green-500 bg-green-50',
  expense: 'border-red-500 bg-red-50',
  transfer: 'border-gray-400 bg-gray-50',
  card_payment: 'border-gray-400 bg-gray-50',
  adjustment: 'border-amber-400 bg-amber-50',
};

const AMOUNT_COLOR_BY_KIND: Record<EntryListItem['kind'], string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  transfer: 'text-gray-600',
  card_payment: 'text-gray-600',
  adjustment: 'text-amber-700',
};

/** 계좌 사이를 오가는 거래는 "A → B"로 보여준다. */
const TWO_SIDED: Array<EntryListItem['kind']> = ['transfer', 'card_payment', 'adjustment'];

const TITLE_BY_KIND: Partial<Record<EntryListItem['kind'], string>> = {
  transfer: '이체',
  adjustment: '잔액 조정',
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
function titleOf(entry: EntryListItem): string {
  if (entry.kind === 'card_payment') {
    return entry.cardTransferDirection === 'refund' ? '카드 환불 입금' : '카드 대금 결제';
  }
  return TITLE_BY_KIND[entry.kind] ?? entry.description;
}

export default function TransactionItem({ entry, onClick, isSelected }: TransactionItemProps) {
  const timeZone = useProjectTimeZone();
  const isTwoSided = TWO_SIDED.includes(entry.kind);

  // 이체는 "얼마를 어디로 보냈는가"와 "수수료를 얼마 냈는가"가 서로 다른 정보다.
  // 수수료가 있으면 실제 지출이 발생한 것이므로 지출 카드와 같은 빨간색으로 보여준다.
  const fee = entry.kind === 'transfer' ? toNumber(entry.feeAmount) : 0;
  const hasFee = fee > 0;

  const borderClass =
    entry.kind === 'transfer' && hasFee ? BORDER_BY_KIND.expense : BORDER_BY_KIND[entry.kind];
  const amountClass =
    entry.kind === 'transfer' && hasFee
      ? AMOUNT_COLOR_BY_KIND.expense
      : AMOUNT_COLOR_BY_KIND[entry.kind];

  // 카테고리는 "대분류 > 소분류"로 표시한다. 대분류만 지정한 거래는 앞부분만 나온다.
  const categoryLabel = entry.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry.categoryName;

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg shadow p-4 border-l-4 transition ${borderClass} ${
        onClick ? 'cursor-pointer hover:shadow-lg' : ''
      } ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="flex justify-between gap-4">
        <div className="flex-1">
          <p className="font-bold text-gray-900 text-base">
            {titleOf(entry)}
          </p>

          {entry.kind === 'transfer' ? (
            <div className="mt-2">
              <p className="text-sm text-gray-700 font-semibold">
                {entry.accountName} → {entry.toAccountName}
              </p>
              <p className="text-sm text-gray-600 mt-1">{formatCurrency(entry.amount)} 보냄</p>
              {hasFee && entry.feeCategoryName && (
                <p className="text-xs text-gray-500 mt-1">{entry.feeCategoryName}</p>
              )}
            </div>
          ) : isTwoSided ? (
            <p className="mt-2 text-sm text-gray-700 font-semibold">
              {entry.accountName} → {entry.toAccountName ?? entry.cardName}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-gray-600 font-semibold">
                {categoryLabel}
                {entry.isFixed && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded">
                    고정
                  </span>
                )}
              </p>
              {(entry.cardName || entry.accountName) && (
                <p className="text-xs text-gray-500 mt-1">{entry.cardName ?? entry.accountName}</p>
              )}
            </>
          )}

          <p className="text-xs text-gray-500 mt-2">
            {formatDate(entry.date, timeZone)}
            {NOT_COUNTED.includes(entry.kind) && !hasFee && (
              <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                합계 제외
              </span>
            )}
          </p>
        </div>

        <div className="text-right flex flex-col justify-between">
          {entry.kind === 'transfer' ? (
            // 이체에서 실제로 나간 돈은 수수료다. 0이어도 표시해 "수수료 없음"을 드러낸다.
            <div>
              <p className="text-xs text-gray-500">수수료</p>
              <p className={`text-lg font-bold ${amountClass}`}>
                {hasFee && '-'}
                {formatCurrency(fee)}
              </p>
            </div>
          ) : (
            <p className={`text-lg font-bold ${amountClass}`}>
              {entry.kind === 'income' && '+'}
              {entry.kind === 'expense' && '-'}
              {formatCurrency(entry.amount)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
