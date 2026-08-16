'use client';

import { useMemo } from 'react';

interface Transaction {
  id: string;
  type: 'income' | 'expense' | 'transfer' | 'credit_usage' | 'credit_payment';
  amount: number;
  accountId?: string;
  cardId?: string;
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
}

export default function PaymentMethodTab({
  transactions,
  accounts,
  cards,
  people,
}: Props) {
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

  return (
    <div className="space-y-6">
      {/* 3개 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 계좌 결제 */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">💰</span>
            <h3 className="text-lg font-semibold text-gray-900">계좌 결제</h3>
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {formatCurrency(stats.accountPayment.total)}
          </p>
          <p className="text-sm text-gray-600 mt-2">
            {stats.accountPayment.byAccount.length}개 계좌
          </p>
        </div>

        {/* 체크카드 */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🏧</span>
            <h3 className="text-lg font-semibold text-gray-900">체크카드</h3>
          </div>
          <p className="text-3xl font-bold text-green-600">
            {formatCurrency(stats.debitCardPayment.total)}
          </p>
          <p className="text-sm text-gray-600 mt-2">
            {stats.debitCardPayment.byCard.length}개 카드
          </p>
        </div>

        {/* 신용카드 */}
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-6 border border-red-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">💳</span>
            <h3 className="text-lg font-semibold text-gray-900">신용카드</h3>
          </div>
          <p className="text-3xl font-bold text-red-600">
            {formatCurrency(stats.creditCardPayment.total)}
          </p>
          <p className="text-sm text-gray-600 mt-2">
            {stats.creditCardPayment.byCard.length}개 카드
          </p>
        </div>
      </div>

      {/* 상세 목록 */}
      <div className="space-y-4">
        {/* 계좌 결제 상세 */}
        {stats.accountPayment.byAccount.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>💰</span> 계좌 결제 ({formatCurrency(stats.accountPayment.total)})
            </h4>
            <div className="space-y-3">
              {stats.accountPayment.byAccount.map(item => (
                <div key={item.accountId} className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                  <div className="flex flex-col">
                    <span className="text-gray-700 font-medium">{item.accountName}</span>
                    <span className="text-xs text-gray-500">{item.ownerName}</span>
                  </div>
                  <span className="font-semibold text-blue-600">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 체크카드 상세 */}
        {stats.debitCardPayment.byCard.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>🏧</span> 체크카드 ({formatCurrency(stats.debitCardPayment.total)})
            </h4>
            <div className="space-y-3">
              {stats.debitCardPayment.byCard.map(item => (
                <div key={item.cardId} className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                  <div className="flex flex-col">
                    <span className="text-gray-700 font-medium">{item.cardName}</span>
                    <span className="text-xs text-gray-500">{item.ownerName}</span>
                  </div>
                  <span className="font-semibold text-green-600">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 신용카드 상세 */}
        {stats.creditCardPayment.byCard.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>💳</span> 신용카드 ({formatCurrency(stats.creditCardPayment.total)})
            </h4>
            <div className="space-y-3">
              {stats.creditCardPayment.byCard.map(item => (
                <div key={item.cardId} className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                  <div className="flex flex-col">
                    <span className="text-gray-700 font-medium">{item.cardName}</span>
                    <span className="text-xs text-gray-500">{item.ownerName}</span>
                  </div>
                  <span className="font-semibold text-red-600">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 합계 */}
      {stats.grandTotal > 0 && (
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-6 border border-gray-200">
          <div className="flex justify-between items-center">
            <h4 className="font-bold text-gray-900 text-lg">합계</h4>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.grandTotal)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
