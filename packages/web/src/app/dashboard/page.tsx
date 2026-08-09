'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';

interface Person {
  id: string;
  name: string;
  relationship?: string | null;
}

interface Account {
  id: string;
  name: string;
  balance: number;
  bankName: string;
  currency: string;
  accountNumber?: string;
  owner: Person;
}

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardType: 'debit' | 'credit';
  issuer: string;
  cardNumberMasked: string;
  creditLimit?: number;
  currentBalance?: number;
  expiryDate?: string;
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [detailType, setDetailType] = useState<'person' | 'account' | 'card' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [editPersonForm, setEditPersonForm] = useState({ name: '', relationship: '' });
  const [editAccountForm, setEditAccountForm] = useState({
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
  });
  const [editCardForm, setEditCardForm] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    issuer: '',
    expiryDate: '',
    creditLimit: '',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const [accountsData, peopleData, cardsData] = await Promise.all([
          apiClient.getAccountsV2(),
          apiClient.getPeople(),
          apiClient.getCards(),
        ]);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
        setCards(cardsData || []);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.accountId === accountId);

  const handleDeletePerson = async () => {
    if (!selectedPerson || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deletePerson(selectedPerson.id);
      const peopleData = await apiClient.getPeople();
      setPeople(peopleData || []);
      setDetailType(null);
      setSelectedPerson(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteAccountV2(selectedAccount.id);
      const accountsData = await apiClient.getAccountsV2();
      setAccounts(accountsData || []);
      setDetailType(null);
      setSelectedAccount(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!selectedCard || !window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteCard(selectedCard.id);
      const cardsData = await apiClient.getCards();
      setCards(cardsData || []);
      setDetailType(null);
      setSelectedCard(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditPersonClick = () => {
    if (!selectedPerson) return;
    setEditPersonForm({
      name: selectedPerson.name,
      relationship: selectedPerson.relationship || '',
    });
    setIsEditing(true);
  };

  const handleSavePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) return;
    try {
      setIsSubmitting(true);
      await apiClient.updatePerson(selectedPerson.id, {
        name: editPersonForm.name,
        relationship: editPersonForm.relationship || undefined,
      });
      const peopleData = await apiClient.getPeople();
      setPeople(peopleData || []);
      const updatedPerson = peopleData?.find((p: Person) => p.id === selectedPerson.id);
      if (updatedPerson) setSelectedPerson(updatedPerson);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditAccountClick = () => {
    if (!selectedAccount) return;
    setEditAccountForm({
      name: selectedAccount.name,
      balance: selectedAccount.balance.toString(),
      bankName: selectedAccount.bankName,
      accountNumber: selectedAccount.accountNumber || '',
    });
    setIsEditing(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    try {
      setIsSubmitting(true);
      await apiClient.updateAccountV2(selectedAccount.id, {
        name: editAccountForm.name,
        balance: parseInt(editAccountForm.balance),
        bankName: editAccountForm.bankName,
        accountNumber: editAccountForm.accountNumber || undefined,
      });
      const accountsData = await apiClient.getAccountsV2();
      setAccounts(accountsData || []);
      const updatedAccount = accountsData?.find((a: Account) => a.id === selectedAccount.id);
      if (updatedAccount) setSelectedAccount(updatedAccount);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCardClick = () => {
    if (!selectedCard) return;
    setEditCardForm({
      accountId: selectedCard.accountId,
      name: selectedCard.name,
      cardNumber: '',
      issuer: selectedCard.issuer,
      expiryDate: '',
      creditLimit: selectedCard.creditLimit?.toString() || '',
    });
    setIsEditing(true);
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    try {
      setIsSubmitting(true);
      await apiClient.updateCard(selectedCard.id, {
        name: editCardForm.name,
        issuer: editCardForm.issuer,
        creditLimit: selectedCard.cardType === 'credit' ? parseInt(editCardForm.creditLimit) : undefined,
      });
      const cardsData = await apiClient.getCards();
      setCards(cardsData || []);
      const updatedCard = cardsData?.find((c: Card) => c.id === selectedCard.id);
      if (updatedCard) setSelectedCard(updatedCard);
      setIsEditing(false);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);

  const groupedAccounts = people.reduce(
    (acc, person) => {
      acc[person.id] = {
        person,
        accounts: accounts.filter((a) => a.owner.id === person.id),
      };
      return acc;
    },
    {} as Record<string, { person: Person; accounts: Account[] }>
  );

  return (
    <>
      <div className="bg-blue-600 text-white rounded-lg p-8 mb-8">
        <p className="text-sm opacity-90">총 자산</p>
        <p className="text-4xl font-bold mt-2">
          {new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
          }).format(totalBalance)}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded mb-4">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : accounts.length === 0 ? (
        <p className="text-gray-600">등록된 계좌가 없습니다.</p>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedAccounts).map(([personId, { person, accounts: personAccounts }]) => (
            <div
              key={personId}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md hover:bg-gray-50 transition"
            >
              <button
                onClick={() => {
                  setSelectedPerson(person);
                  setDetailType('person');
                }}
                className="w-full text-left mb-6"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{person.name}</h2>
                    <p className="text-sm text-gray-600">
                      소계: {new Intl.NumberFormat('ko-KR', {
                        style: 'currency',
                        currency: 'KRW',
                      }).format(personAccounts.reduce((sum, acc) => sum + acc.balance, 0))}
                    </p>
                  </div>
                </div>
              </button>

              {personAccounts.length === 0 ? (
                <p className="text-gray-600">등록된 계좌가 없습니다.</p>
              ) : (
                <div className="space-y-4">
                  {personAccounts.map((account) => {
                    const accountCards = getAccountCards(account.id);
                    return (
                      <div
                        key={account.id}
                        className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAccount(account);
                            setDetailType('account');
                          }}
                          className="w-full text-left hover:opacity-70 transition"
                        >
                          <p className="text-sm text-gray-600">{account.bankName}</p>
                          <p className="text-2xl font-bold text-gray-900 mt-2">
                            {new Intl.NumberFormat('ko-KR', {
                              style: 'currency',
                              currency: account.currency,
                            }).format(account.balance)}
                          </p>
                          <p className="text-xs text-gray-500 mt-2">{account.name}</p>
                          {account.accountNumber && (
                            <p className="text-xs text-gray-400 mt-1">{account.accountNumber}</p>
                          )}
                        </button>

                        {accountCards.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                            {accountCards.map((card) => (
                              <button
                                key={card.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCard(card);
                                  setDetailType('card');
                                }}
                                className="w-full text-left px-3 py-2 bg-green-50 rounded border border-green-100 hover:bg-green-100 transition"
                              >
                                <p className="text-sm font-medium text-gray-900">
                                  💳 {card.name}
                                </p>
                                <p className="text-xs text-gray-600">{card.issuer}</p>
                                <p className="text-xs text-gray-600">
                                  {card.cardType === 'debit' ? '체크카드' : '신용카드'}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 구성원 상세정보 모달 */}
      {detailType === 'person' && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedPerson(null);
            setIsEditing(false);
          }}
          title={isEditing ? '구성원 수정' : '구성원 상세정보'}
        >
          {isEditing ? (
            <form onSubmit={handleSavePerson} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름
                </label>
                <input
                  type="text"
                  required
                  value={editPersonForm.name}
                  onChange={(e) =>
                    setEditPersonForm({ ...editPersonForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  관계 (선택)
                </label>
                <input
                  type="text"
                  value={editPersonForm.relationship}
                  onChange={(e) =>
                    setEditPersonForm({ ...editPersonForm, relationship: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="배우자, 자녀 등"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    이름
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedPerson.name}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
                <button
                  onClick={handleEditPersonClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
                <button
                  onClick={handleDeletePerson}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  삭제하기
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* 계좌 상세정보 모달 */}
      {detailType === 'account' && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedAccount(null);
            setIsEditing(false);
          }}
          title={isEditing ? '계좌 수정' : '계좌 상세정보'}
        >
          {isEditing ? (
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  통장 주인
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedAccount?.owner?.name || '-'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  계좌명
                </label>
                <input
                  type="text"
                  required
                  value={editAccountForm.name}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  은행명
                </label>
                <input
                  type="text"
                  required
                  value={editAccountForm.bankName}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, bankName: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  잔액 (원)
                </label>
                <input
                  type="number"
                  required
                  value={editAccountForm.balance}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, balance: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  계좌번호 (선택)
                </label>
                <input
                  type="text"
                  value={editAccountForm.accountNumber}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, accountNumber: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="예: 123-456-7890"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    통장 주인
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedAccount.owner?.name || '-'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    계좌명
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedAccount.name}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    은행
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedAccount.bankName}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    잔액
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 font-semibold">
                    {new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: selectedAccount.currency,
                    }).format(selectedAccount.balance)}
                  </p>
                </div>

                {selectedAccount.accountNumber && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      계좌번호
                    </label>
                    <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                      {selectedAccount.accountNumber}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
                <button
                  onClick={handleEditAccountClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  삭제하기
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* 카드 상세정보 모달 */}
      {detailType === 'card' && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedCard(null);
            setIsEditing(false);
          }}
          title={isEditing ? '카드 수정' : '카드 상세정보'}
        >
          {isEditing ? (
            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  계좌
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {accounts.find((a) => a.id === editCardForm.accountId)?.name || '-'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 이름
                </label>
                <input
                  type="text"
                  required
                  value={editCardForm.name}
                  onChange={(e) =>
                    setEditCardForm({ ...editCardForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 번호
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.cardNumberMasked}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카드 유형
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedCard.cardType === 'debit' ? '체크카드' : '신용카드'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  발급사
                </label>
                <input
                  type="text"
                  required
                  value={editCardForm.issuer}
                  onChange={(e) =>
                    setEditCardForm({ ...editCardForm, issuer: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {selectedCard.cardType === 'credit' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    신용한도 (원)
                  </label>
                  <input
                    type="number"
                    value={editCardForm.creditLimit}
                    onChange={(e) =>
                      setEditCardForm({ ...editCardForm, creditLimit: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 이름
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.name}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    계좌
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {accounts.find((a) => a.id === selectedCard.accountId)?.name || '-'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 번호
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.cardNumberMasked}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    카드 유형
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.cardType === 'debit' ? '체크카드' : '신용카드'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    발급사
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                    {selectedCard.issuer}
                  </p>
                </div>

                {selectedCard.cardType === 'credit' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        사용액
                      </label>
                      <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                        {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(selectedCard.currentBalance || 0)}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        신용한도
                      </label>
                      <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                        {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(selectedCard.creditLimit || 0)}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
                <button
                  onClick={handleEditCardClick}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  수정하기
                </button>
                <button
                  onClick={handleDeleteCard}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  삭제하기
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
