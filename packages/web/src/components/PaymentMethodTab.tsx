'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import TransactionItem from './TransactionItem';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'credit_usage' | 'credit_payment';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
}

interface Account {
  id: string;
  name: string;
  ownerId?: string;
}

interface Card {
  id: string;
  name: string;
  cardType: 'debit' | 'credit';
  accountId?: string;
}

interface Person {
  id: string;
  name: string;
}

interface PaymentStats {
  accountPayment: {
    total: number;
    byAccount: Array<{ accountId: string; accountName: string; ownerName: string; amount: number }>;
  };
  debitCardPayment: {
    total: number;
    byCard: Array<{ cardId: string; cardName: string; ownerName: string; amount: number }>;
  };
  creditCardPayment: {
    total: number;
    byCard: Array<{ cardId: string; cardName: string; ownerName: string; amount: number }>;
  };
  grandTotal: number;
}

interface Props {
  transactions: Transaction[];
  accounts: Account[];
  cards: Card[];
  people: Person[];
  currentMonth?: number;
  currentYear?: number;
}

export default function PaymentMethodTab({
  transactions,
  accounts,
  cards,
  people,
  currentMonth: propMonth,
  currentYear: propYear,
}: Props) {
  const now = new Date();
  const currentMonth = propMonth ?? (now.getMonth() + 1);
  const currentYear = propYear ?? now.getFullYear();
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>('');
  const [selectedPaymentType, setSelectedPaymentType] = useState<'account' | 'debit_card' | 'credit_card'>('account');

  const stats = useMemo(() => {
    const stats: PaymentStats = {
      accountPayment: { total: 0, byAccount: [] },
      debitCardPayment: { total: 0, byCard: [] },
      creditCardPayment: { total: 0, byCard: [] },
      grandTotal: 0,
    };

    // 맵 생성
    const cardMap = new Map(cards.map(c => [c.id, c]));
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const personMap = new Map(people.map(p => [p.id, p]));

    // 계좌 결제 (expense 타입이고 cardId가 없음)
    const accountPayments = transactions.filter(
      tx => tx.type === 'expense' && !tx.cardId && tx.accountId
    );

    // 체크카드 결제 (expense 타입이고 체크카드 사용)
    const debitCardPayments = transactions.filter(tx => {
      if (tx.type !== 'expense' || !tx.cardId) return false;
      const card = cardMap.get(tx.cardId);
      return card?.cardType === 'debit';
    });

    // 신용카드 결제 (credit_usage 타입)
    const creditCardPayments = transactions.filter(tx => tx.type === 'credit_usage' && tx.cardId);

    // 계좌 결제 집계
    const accountMap2 = new Map<string, number>();
    accountPayments.forEach(tx => {
      if (tx.accountId) {
        accountMap2.set(tx.accountId, (accountMap2.get(tx.accountId) || 0) + tx.amount);
      }
    });

    // 모든 계좌 표시 (사용하지 않은 계좌도 0원으로)
    accounts.forEach(account => {
      const amount = accountMap2.get(account.id) || 0;
      const owner = personMap.get(account.ownerId || '');
      stats.accountPayment.byAccount.push({
        accountId: account.id,
        accountName: account.name,
        ownerName: owner?.name || '미정',
        amount,
      });
      stats.accountPayment.total += amount;
    });

    // 체크카드 결제 집계
    const debitCardMap = new Map<string, number>();
    debitCardPayments.forEach(tx => {
      if (tx.cardId) {
        debitCardMap.set(tx.cardId, (debitCardMap.get(tx.cardId) || 0) + tx.amount);
      }
    });

    // 모든 체크카드 표시 (사용하지 않은 카드도 0원으로)
    cards.forEach(card => {
      if (card.cardType === 'debit') {
        const amount = debitCardMap.get(card.id) || 0;
        const account = accountMap.get(card.accountId || '');
        const owner = personMap.get(account?.ownerId || '');
        stats.debitCardPayment.byCard.push({
          cardId: card.id,
          cardName: card.name,
          ownerName: owner?.name || '미정',
          amount,
        });
        stats.debitCardPayment.total += amount;
      }
    });

    // 신용카드 결제 집계
    const creditCardMap = new Map<string, number>();
    creditCardPayments.forEach(tx => {
      if (tx.cardId) {
        creditCardMap.set(tx.cardId, (creditCardMap.get(tx.cardId) || 0) + tx.amount);
      }
    });

    // 모든 신용카드 표시 (사용하지 않은 카드도 0원으로)
    cards.forEach(card => {
      if (card.cardType === 'credit') {
        const amount = creditCardMap.get(card.id) || 0;
        const account = accountMap.get(card.accountId || '');
        const owner = personMap.get(account?.ownerId || '');
        stats.creditCardPayment.byCard.push({
          cardId: card.id,
          cardName: card.name,
          ownerName: owner?.name || '미정',
          amount,
        });
        stats.creditCardPayment.total += amount;
      }
    });

    stats.grandTotal = stats.accountPayment.total + stats.debitCardPayment.total + stats.creditCardPayment.total;

    return stats;
  }, [transactions, accounts, cards, people]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW',
    }).format(amount);
  };

  const selectedData = useMemo(() => {
    if (!selectedPaymentId) return null;

    const cardMap = new Map(cards.map(c => [c.id, c]));
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const personMap = new Map(people.map(p => [p.id, p]));

    let selectedItem: any = null;
    let allPaymentTransactions: Transaction[] = [];
    let currentMonthTransactions: Transaction[] = [];

    if (selectedPaymentType === 'account') {
      const account = accounts.find(a => a.id === selectedPaymentId);
      if (account) {
        const owner = personMap.get(account.ownerId || '');
        selectedItem = {
          name: account.name,
          ownerName: owner?.name || '미정',
        };
        allPaymentTransactions = transactions.filter(
          tx => tx.type === 'expense' && !tx.cardId && tx.accountId === selectedPaymentId
        );
        currentMonthTransactions = allPaymentTransactions.filter(tx => {
          const txDate = new Date(tx.date);
          return txDate.getMonth() + 1 === currentMonth && txDate.getFullYear() === currentYear;
        });
      }
    } else if (selectedPaymentType === 'debit_card') {
      const card = cards.find(c => c.id === selectedPaymentId);
      if (card) {
        const account = accountMap.get(card.accountId || '');
        const owner = personMap.get(account?.ownerId || '');
        selectedItem = {
          name: card.name,
          ownerName: owner?.name || '미정',
        };
        allPaymentTransactions = transactions.filter(
          tx => tx.type === 'expense' && tx.cardId === selectedPaymentId
        );
        currentMonthTransactions = allPaymentTransactions.filter(tx => {
          const txDate = new Date(tx.date);
          return txDate.getMonth() + 1 === currentMonth && txDate.getFullYear() === currentYear;
        });
      }
    } else if (selectedPaymentType === 'credit_card') {
      const card = cards.find(c => c.id === selectedPaymentId);
      if (card) {
        const account = accountMap.get(card.accountId || '');
        const owner = personMap.get(account?.ownerId || '');
        selectedItem = {
          name: card.name,
          ownerName: owner?.name || '미정',
        };
        allPaymentTransactions = transactions.filter(
          tx => tx.type === 'credit_usage' && tx.cardId === selectedPaymentId
        );
        currentMonthTransactions = allPaymentTransactions.filter(tx => {
          const txDate = new Date(tx.date);
          return txDate.getMonth() + 1 === currentMonth && txDate.getFullYear() === currentYear;
        });
      }
    }

    const monthlyData = Array.from({ length: 12 }, (_, i) => {
      const monthIndex = (currentMonth - 1 - i + 12) % 12;
      const yearOffset = Math.floor((currentMonth - 1 - i) / 12);
      const month = monthIndex + 1;
      const year = currentYear - yearOffset;

      const monthAmount = allPaymentTransactions
        .filter(tx => {
          const txDate = new Date(tx.date);
          return txDate.getMonth() + 1 === month && txDate.getFullYear() === year;
        })
        .reduce((sum, tx) => sum + tx.amount, 0);

      return {
        month: `${month}월`,
        amount: monthAmount,
      };
    }).reverse();

    const dailyMap = new Map<number, number>();
    currentMonthTransactions
      .forEach(tx => {
        const txDate = new Date(tx.date);
        const day = txDate.getDate();
        dailyMap.set(day, (dailyMap.get(day) || 0) + tx.amount);
      });

    const dailyData: Array<{ day: number; amount: number; cumulative: number }> = [];
    let cumulativeAmount = 0;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const amount = dailyMap.get(day) || 0;
      cumulativeAmount += amount;
      dailyData.push({ day, amount, cumulative: cumulativeAmount });
    }

    return {
      selectedItem,
      filteredTransactions: currentMonthTransactions,
      monthlyData,
      dailyData,
    };
  }, [selectedPaymentId, selectedPaymentType, transactions, accounts, cards, people, currentMonth, currentYear]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {stats.accountPayment.byAccount.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>💰</span> 계좌 결제
            </h4>
            <div className="space-y-2">
              {stats.accountPayment.byAccount.map(item => (
                <button
                  key={item.accountId}
                  onClick={() => {
                    setSelectedPaymentId(item.accountId);
                    setSelectedPaymentType('account');
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedPaymentId === item.accountId && selectedPaymentType === 'account'
                      ? 'bg-blue-100 border-2 border-blue-500'
                      : 'bg-blue-50 border border-blue-200 hover:bg-blue-75'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-gray-700 font-medium">{item.accountName}</span>
                      <span className="text-xs text-gray-500">{item.ownerName}</span>
                    </div>
                  </div>
                  <span className="font-semibold text-blue-600 text-sm">{formatCurrency(item.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stats.debitCardPayment.byCard.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>🏧</span> 체크카드
            </h4>
            <div className="space-y-2">
              {stats.debitCardPayment.byCard.map(item => (
                <button
                  key={item.cardId}
                  onClick={() => {
                    setSelectedPaymentId(item.cardId);
                    setSelectedPaymentType('debit_card');
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedPaymentId === item.cardId && selectedPaymentType === 'debit_card'
                      ? 'bg-green-100 border-2 border-green-500'
                      : 'bg-green-50 border border-green-200 hover:bg-green-75'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-gray-700 font-medium">{item.cardName}</span>
                      <span className="text-xs text-gray-500">{item.ownerName}</span>
                    </div>
                  </div>
                  <span className="font-semibold text-green-600 text-sm">{formatCurrency(item.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stats.creditCardPayment.byCard.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>💳</span> 신용카드
            </h4>
            <div className="space-y-2">
              {stats.creditCardPayment.byCard.map(item => (
                <button
                  key={item.cardId}
                  onClick={() => {
                    setSelectedPaymentId(item.cardId);
                    setSelectedPaymentType('credit_card');
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedPaymentId === item.cardId && selectedPaymentType === 'credit_card'
                      ? 'bg-red-100 border-2 border-red-500'
                      : 'bg-red-50 border border-red-200 hover:bg-red-75'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-gray-700 font-medium">{item.cardName}</span>
                      <span className="text-xs text-gray-500">{item.ownerName}</span>
                    </div>
                  </div>
                  <span className="font-semibold text-red-600 text-sm">{formatCurrency(item.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        {selectedData && selectedData.selectedItem ? (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{selectedData.selectedItem.name}</h3>
              <p className="text-sm text-gray-500 mb-6">{selectedData.selectedItem.ownerName}</p>

              <div className="mb-8">
                <h4 className="font-semibold text-gray-900 mb-4">월별 사용 금액</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={selectedData.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                    <Bar dataKey="amount" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mb-8">
                <h4 className="font-semibold text-gray-900 mb-4">일별 누적 사용금액</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={selectedData.dailyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {selectedData.filteredTransactions.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-4">거래 기록</h4>
                  <div className="space-y-6 max-h-96 overflow-y-auto">
                    {(() => {
                      const groupedTransactions: { [date: string]: Transaction[] } = {};
                      selectedData.filteredTransactions.forEach(tx => {
                        const date = new Date(tx.date).toLocaleDateString('ko-KR');
                        if (!groupedTransactions[date]) {
                          groupedTransactions[date] = [];
                        }
                        groupedTransactions[date].push(tx);
                      });

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

                      const calculateTotals = (txs: Transaction[]) => {
                        let incomeTotal = 0;
                        let expenseTotal = 0;
                        txs.forEach(tx => {
                          if (tx.type === 'income') {
                            incomeTotal += tx.amount;
                          } else if (tx.type === 'expense' || tx.type === 'credit_usage') {
                            expenseTotal += tx.amount;
                          }
                        });
                        return { incomeTotal, expenseTotal };
                      };

                      return sortedDates.map(date => {
                        const dayOfWeek = getDayOfWeek(date);
                        const { incomeTotal, expenseTotal } = calculateTotals(groupedTransactions[date]);

                        return (
                          <div key={date}>
                            <div className="flex items-center justify-between mb-3 bg-gray-100 py-2 px-3 rounded-lg border border-gray-200">
                              <h3 className="text-lg font-bold text-gray-900">
                                {date} <span className="text-sm text-gray-600">({dayOfWeek})</span>
                              </h3>
                              <div className="flex gap-6 text-sm font-semibold">
                                {incomeTotal > 0 && (
                                  <span className="text-green-600">
                                    +{formatCurrency(incomeTotal)}
                                  </span>
                                )}
                                {expenseTotal > 0 && (
                                  <span className="text-red-600">
                                    -{formatCurrency(expenseTotal)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {groupedTransactions[date].map(tx => (
                                <TransactionItem
                                  key={tx.id}
                                  id={tx.id}
                                  description={tx.description}
                                  amount={tx.amount}
                                  type={tx.type}
                                  date={tx.date}
                                  mainCategory={tx.mainCategory}
                                  subCategory={tx.subCategory}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
            <p className="text-gray-500">항목을 선택하여 상세 정보를 확인하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
