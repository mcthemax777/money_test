'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { apiClient } from '@/lib/api-client';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import AddAccountModal from '@/components/AddAccountModal';
import EditCardModal from '@/components/EditCardModal';

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardNumberMasked: string;
  cardType: 'debit' | 'credit';
  issuer: string;
  creditLimit?: number;
  currentBalance?: number;
  expiryDate?: string;
}

interface Account {
  id: string;
  name: string;
}

export default function CardsPage() {
  const router = useRouter();
  const { isAuthenticated, loadUser } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountFormData, setAccountFormData] = useState({
    ownerId: '',
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
  });
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [formData, setFormData] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit',
    issuer: '',
    expiryDate: '',
    creditLimit: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
        const [cardsData, accountsData, peopleData] = await Promise.all([
          apiClient.getCards(),
          apiClient.getAccountsV2(),
          apiClient.getPeople(),
        ]);
        setCards(cardsData || []);
        setAccounts(accountsData || []);
        setPeople(peopleData || []);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setError('');

      if (!editingId && !formData.accountId) {
        setError('계좌를 선택하세요.');
        setIsSubmitting(false);
        return;
      }

      const isoDate = formData.expiryDate ? new Date(formData.expiryDate).toISOString() : undefined;

      if (editingId) {
        await apiClient.updateCard(editingId, {
          name: formData.name,
          issuer: formData.issuer,
          creditLimit: formData.cardType === 'credit' ? parseInt(formData.creditLimit) : undefined,
        });
      } else {
        await apiClient.createCard({
          accountId: formData.accountId,
          name: formData.name,
          ...(formData.cardNumber && { cardNumber: formData.cardNumber }),
          cardType: formData.cardType,
          issuer: formData.issuer,
          ...(isoDate && { expiryDate: isoDate }),
          creditLimit: formData.cardType === 'credit' ? parseInt(formData.creditLimit) : undefined,
        });
      }
      const data = await apiClient.getCards();
      setCards(data || []);
      setFormData({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuer: '',
        expiryDate: '',
        creditLimit: '',
      });
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error?.message || err?.message || (editingId ? '카드 수정에 실패했습니다.' : '카드 추가에 실패했습니다.');
      setError(errorMessage);
      console.error(editingId ? '카드 수정 에러:' : '카드 추가 에러:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      accountId: '',
      name: '',
      cardNumber: '',
      cardType: 'debit',
      issuer: '',
      expiryDate: '',
      creditLimit: '',
    });
    setEditingId(null);
    setError('');
  };

  const handleCardClick = (card: Card) => {
    setSelectedCard(card);
    setIsDetailModalOpen(true);
  };

  const handleDetailEditClick = () => {
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleEditClick = (card: Card) => {
    setEditingId(card.id);
    setFormData({
      accountId: card.accountId,
      name: card.name,
      cardNumber: '',
      cardType: card.cardType,
      issuer: card.issuer,
      expiryDate: '',
      creditLimit: card.creditLimit?.toString() || '',
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteCard(id);
      const data = await apiClient.getCards();
      setCards(data || []);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '카드 삭제에 실패했습니다.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };


  if (!isAuthenticated) {
    return <div className="flex justify-center items-center h-screen">로그인 중...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">카드 관리</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          카드 추가
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : cards.length === 0 ? (
        <p className="text-gray-600">카드가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <div
              key={card.id}
              className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500 cursor-pointer hover:shadow-lg transition"
              onClick={() => handleCardClick(card)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{card.name}</p>
                  <p className="text-sm text-gray-600">{card.cardNumberMasked}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {card.issuer} · {card.cardType === 'debit' ? '체크카드' : '신용카드'}
                  </p>
                </div>
                <div className="text-right">
                  {card.cardType === 'credit' && (
                    <div>
                      <p className="text-xs text-gray-600">사용액</p>
                      <p className="text-lg font-bold text-gray-900">
                        {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(card.currentBalance || 0)}
                      </p>
                      <p className="text-xs text-gray-500">
                        한도: {new Intl.NumberFormat('ko-KR', {
                          style: 'currency',
                          currency: 'KRW',
                        }).format(card.creditLimit || 0)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 text-red-800 text-sm rounded">
          {error}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? '카드 수정' : '카드 추가'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={formData.accountId}
              onChange={(value) => setFormData({ ...formData, accountId: value })}
              placeholder="선택하세요"
              onAddClick={() => setIsAccountModalOpen(true)}
              addButtonLabel="계좌 추가"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 이름
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 내 체크카드"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 번호 (선택)
            </label>
            <input
              type="text"
              value={formData.cardNumber}
              onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="16자리"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 유형
            </label>
            <CustomSelect
              options={[
                { id: 'debit', name: '체크카드' },
                { id: 'credit', name: '신용카드' },
              ]}
              value={formData.cardType}
              onChange={(value) => setFormData({ ...formData, cardType: value })}
              placeholder="선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              발급사
            </label>
            <input
              type="text"
              required
              value={formData.issuer}
              onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="KB Bank, Samsung Card 등"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              만료일 (선택)
            </label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {formData.cardType === 'credit' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                신용한도 (원)
              </label>
              <input
                type="number"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5000000"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="카드 상세정보"
      >
        {selectedCard && (
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
                {accounts.find(a => a.id === selectedCard.accountId)?.name || '-'}
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

            {selectedCard.expiryDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  만료일
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {new Date(selectedCard.expiryDate).toLocaleDateString('ko-KR')}
                </p>
              </div>
            )}

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

            <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
              <button
                onClick={handleDetailEditClick}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                수정하기
              </button>
            </div>
          </div>
        )}
      </Modal>

      <AddAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAccounts) => setAccounts(newAccounts)}
        people={people}
      />

      <EditCardModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        card={selectedCard}
        accounts={accounts}
        onSuccess={(updatedCards) => {
          setCards(updatedCards || []);
          setSelectedCard(null);
        }}
        onDelete={async (id) => {
          await apiClient.deleteCard(id);
          const data = await apiClient.getCards();
          setCards(data || []);
          setSelectedCard(null);
        }}
      />
    </>
  );
}
