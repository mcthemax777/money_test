'use client';

interface TransactionItemProps {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  mainCategory: string;
  subCategory?: string;
  onClick?: () => void;
  isSelected?: boolean;
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
}: TransactionItemProps) {
  const getTypeColor = (txType: string) => {
    switch (txType) {
      case 'income':
        return 'border-green-500 bg-green-50';
      case 'expense':
        return 'border-red-500 bg-red-50';
      case 'transfer':
        return 'border-blue-500 bg-blue-50';
      default:
        return 'border-gray-500 bg-gray-50';
    }
  };

  const getAmountColor = (txType: string) => {
    switch (txType) {
      case 'income':
        return 'text-green-600';
      case 'expense':
        return 'text-red-600';
      case 'transfer':
        return 'text-blue-600';
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
          <p className="font-bold text-gray-900 text-base">{description}</p>
          <div className="mt-2">
            <p className="text-sm text-gray-600 font-semibold">
              {mainCategory}
              {subCategory && ` > ${subCategory}`}
            </p>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {new Date(date).toLocaleDateString('ko-KR')}
          </p>
        </div>
        <div className="text-right flex flex-col justify-between">
          <p className={`text-lg font-bold ${getAmountColor(type)}`}>
            {type === 'income' ? '+' : '-'}
            {new Intl.NumberFormat('ko-KR', {
              style: 'currency',
              currency: 'KRW',
            }).format(amount)}
          </p>
        </div>
      </div>
    </div>
  );
}
