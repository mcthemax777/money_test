'use client';

import TransactionItem from './TransactionItem';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
}

interface GroupedTransactions {
  [date: string]: Transaction[];
}

interface TransactionListViewProps {
  transactions: Transaction[];
  onTransactionClick: (tx: Transaction) => void;
}

export default function TransactionListView({
  transactions,
  onTransactionClick,
}: TransactionListViewProps) {
  const groupedTransactions = transactions.reduce((acc, tx) => {
    const date = new Date(tx.date).toLocaleDateString('ko-KR');
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(tx);
    return acc;
  }, {} as GroupedTransactions);

  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => {
    const dateA = new Date(a.replace(/년|월|일/g, (match) => {
      if (match === '년') return '/';
      if (match === '월') return '/';
      return '';
    }));
    const dateB = new Date(b.replace(/년|월|일/g, (match) => {
      if (match === '년') return '/';
      if (match === '월') return '/';
      return '';
    }));
    return dateB.getTime() - dateA.getTime();
  });

  const getDayOfWeek = (dateStr: string) => {
    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
    const date = new Date(dateStr.replace(/년|월|일/g, (match) => {
      if (match === '년') return '/';
      if (match === '월') return '/';
      return '';
    }));
    return weekDays[date.getDay()];
  };

  const calculateTotals = (transactions: Transaction[]) => {
    let incomeTotal = 0;
    let expenseTotal = 0;

    transactions.forEach((tx) => {
      if (tx.type === 'income') {
        incomeTotal += tx.amount;
      } else if (tx.type === 'expense' || tx.type === 'credit_usage') {
        expenseTotal += tx.amount;
      }
    });

    return { incomeTotal, expenseTotal };
  };

  return (
    <div className="space-y-6">
      {sortedDates.map((date) => {
        const dayOfWeek = getDayOfWeek(date);
        const { incomeTotal, expenseTotal } = calculateTotals(groupedTransactions[date]);

        return (
          <div key={date}>
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-white py-2 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                {date} <span className="text-sm text-gray-600">({dayOfWeek})</span>
              </h3>
              <div className="flex gap-6 text-sm font-semibold">
                {incomeTotal > 0 && (
                  <span className="text-green-600">
                    +{new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: 'KRW',
                    }).format(incomeTotal)}
                  </span>
                )}
                {expenseTotal > 0 && (
                  <span className="text-red-600">
                    -{new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: 'KRW',
                    }).format(expenseTotal)}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {groupedTransactions[date].map((tx) => (
                <TransactionItem
                  key={tx.id}
                  id={tx.id}
                  description={tx.description}
                  amount={tx.amount}
                  type={tx.type}
                  date={tx.date}
                  mainCategory={tx.mainCategory}
                  subCategory={tx.subCategory}
                  onClick={() => onTransactionClick(tx)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
