'use client';

interface TransactionItemProps {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'credit_usage' | 'credit_payment';
  date: string;
  mainCategory: string;
  subCategory?: string;
  onClick?: () => void;
  isSelected?: boolean;
  fromAccountName?: string;
  toAccountName?: string;
}

export default function TransactionItem({
  id,
  description,
  amount,
  type,
  date,
  mainCategory,
  subCategory,
  onClick,
  isSelected,
  fromAccountName,
  toAccountName,
}: TransactionItemProps) {
  const getTypeColor = (txType: string) => {
    switch (txType) {
      case 'income':
        return 'border-green-500 bg-green-50';
      case 'expense':
      case 'credit_usage':
        return 'border-red-500 bg-red-50';
      case 'transfer':
        return 'border-gray-400 bg-gray-50';
      case 'credit_payment':
        return 'border-gray-900 bg-gray-900';
      default:
        return 'border-gray-500 bg-gray-50';
    }
  };

  const getAmountColor = (txType: string) => {
    switch (txType) {
      case 'income':
        return 'text-green-600';
      case 'expense':
      case 'credit_usage':
        return 'text-red-600';
      case 'transfer':
        return 'text-gray-600';
      case 'credit_payment':
        return 'text-gray-200';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg shadow p-4 border-l-4 transition ${getTypeColor(type)} ${
        onClick ? 'cursor-pointer hover:shadow-lg' : ''
      } ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="flex justify-between gap-4">
        <div className="flex-1">
          {type === 'transfer' ? (
            <>
              <p className="font-bold text-gray-900 text-base">이체</p>
              <div className="mt-2">
                <p className="text-sm text-gray-700 font-semibold">
                  {fromAccountName} → {toAccountName}
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="font-bold text-gray-900 text-base">{description}</p>
              <div className="mt-2">
                <p className="text-sm text-gray-600 font-semibold">
                  {mainCategory}
                  {subCategory && ` > ${subCategory}`}
                </p>
              </div>
            </>
          )}
          <p className="text-xs text-gray-500 mt-2">
            {new Date(date).toLocaleDateString('ko-KR')}
          </p>
        </div>
        <div className="text-right flex flex-col justify-between">
          <p className={`text-lg font-bold ${getAmountColor(type)}`}>
            {type === 'transfer'
              ? new Intl.NumberFormat('ko-KR', {
                  style: 'currency',
                  currency: 'KRW',
                }).format(amount)
              : <>
                  {type === 'income' ? '+' : '-'}
                  {new Intl.NumberFormat('ko-KR', {
                    style: 'currency',
                    currency: 'KRW',
                  }).format(amount)}
                </>
            }
          </p>
        </div>
      </div>
    </div>
  );
}
