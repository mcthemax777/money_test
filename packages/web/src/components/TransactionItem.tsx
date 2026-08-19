'use client';

import { formatCurrency, toNumber } from '@/lib/money';

/**
 * 서버가 전표를 한 줄로 펴서 주는 형태.
 * 화면은 postings를 직접 다루지 않는다 (packages/api entry-view.ts 참고).
 */
export interface EntryListItem {
  id: string;
  kind: 'expense' | 'income' | 'transfer' | 'card_payment' | 'adjustment';
  date: string;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  personName: string;
  /** 항상 양수. 부호는 kind로 판단한다. */
  amount: string;
  isFixed: boolean;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  cardId: string | null;
  cardName: string | null;
  /** 이체에 붙은 수수료. 이체가 아니면 null, 수수료 없는 이체면 "0" */
  feeAmount: string | null;
  feeCategoryId: string | null;
  feeCategoryName: string | null;
  /** 결제된 청구서에 포함된 내역. 금액·결제수단 변경과 삭제가 막힌다 */
  lockedByStatement: boolean;
  /** 이 거래가 속한 카드 청구 기간. 잠겨 있어도 이 안에서는 날짜를 고칠 수 있다 */
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
}

interface TransactionItemProps {
  entry: EntryListItem;
  onClick?: () => void;
  isSelected?: boolean;
}

const BORDER_BY_KIND: Record<EntryListItem['kind'], string> = {
  income: 'border-green-500 bg-green-50',
  expense: 'border-red-500 bg-red-50',
  transfer: 'border-gray-400 bg-gray-50',
  card_payment: 'border-blue-500 bg-blue-50',
  adjustment: 'border-amber-400 bg-amber-50',
};

const AMOUNT_COLOR_BY_KIND: Record<EntryListItem['kind'], string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  transfer: 'text-gray-600',
  card_payment: 'text-blue-600',
  adjustment: 'text-amber-700',
};

/** 계좌 사이를 오가는 거래는 "A → B"로 보여준다. */
const TWO_SIDED: Array<EntryListItem['kind']> = ['transfer', 'card_payment', 'adjustment'];

const TITLE_BY_KIND: Partial<Record<EntryListItem['kind'], string>> = {
  transfer: '이체',
  card_payment: '카드대금 결제',
  adjustment: '잔액 조정',
};

export default function TransactionItem({ entry, onClick, isSelected }: TransactionItemProps) {
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
            {TITLE_BY_KIND[entry.kind] ?? entry.description}
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
            {new Date(entry.date).toLocaleDateString('ko-KR')}
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
