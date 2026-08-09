'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardType: 'debit' | 'credit';
  issuer: string;
  cardNumberMasked: string;
  creditLimit?: number;
  currentBalance?: number;
}

interface Account {
  id: string;
  ownerId: string;
  name: string;
  balance: number;
  bankName: string;
  accountNumber?: string;
  currency: string;
}

interface Person {
  id: string;
  name: string;
  relationship?: string | null;
}

export default function AssetsPage() {
  const { isAuthenticated, loadUser } = useAuth();
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [detailType, setDetailType] = useState<'person' | 'account' | 'card' | null>(null);

  const [addType, setAddType] = useState<'person' | 'account' | 'card' | null>(null);

  // 추가 폼 상태
  const [personForm, setPersonForm] = useState({ name: '', relationship: '' });
  const [accountForm, setAccountForm] = useState({
    ownerId: '',
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
  });
  const [cardForm, setCardForm] = useState({
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit' as 'debit' | 'credit',
    issuer: '',
    creditLimit: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState('');

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
        const [peopleData, accountsData, cardsData] = await Promise.all([
          apiClient.getPeople(),
          apiClient.getAccountsV2(),
          apiClient.getCards(),
        ]);
        setPeople(peopleData || []);
        setAccounts(accountsData || []);
        setCards(cardsData || []);
      } catch (err) {
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router]);

  const getPersonAccounts = (personId: string) =>
    accounts.filter((a) => a.ownerId === personId);

  const getAccountCards = (accountId: string) =>
    cards.filter((c) => c.accountId === accountId);

  const togglePersonExpand = (personId: string) => {
    const newSet = new Set(expandedPeople);
    if (newSet.has(personId)) {
      newSet.delete(personId);
    } else {
      newSet.add(personId);
    }
    setExpandedPeople(newSet);
  };

  const toggleAccountExpand = (accountId: string) => {
    const newSet = new Set(expandedAccounts);
    if (newSet.has(accountId)) {
      newSet.delete(accountId);
    } else {
      newSet.add(accountId);
    }
    setExpandedAccounts(newSet);
  };

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');
      await apiClient.createPerson({
        name: personForm.name,
        relationship: personForm.relationship || undefined,
      });
      const data = await apiClient.getPeople();
      setPeople(data || []);
      setPersonForm({ name: '', relationship: '' });
      setAddType(null);
    } catch (err: any) {
      setAddError(err?.response?.data?.error?.message || '구성원 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');
      await apiClient.createAccountV2({
        ownerId: accountForm.ownerId,
        name: accountForm.name,
        balance: parseInt(accountForm.balance),
        bankName: accountForm.bankName,
        accountNumber: accountForm.accountNumber || undefined,
      });
      const data = await apiClient.getAccountsV2();
      setAccounts(data || []);
      setAccountForm({
        ownerId: '',
        name: '',
        balance: '',
        bankName: '',
        accountNumber: '',
      });
      setAddType(null);
    } catch (err: any) {
      setAddError(err?.response?.data?.error?.message || '계좌 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');
      await apiClient.createCard({
        accountId: cardForm.accountId,
        name: cardForm.name,
        cardNumber: cardForm.cardNumber || undefined,
        cardType: cardForm.cardType,
        issuer: cardForm.issuer,
        creditLimit:
          cardForm.cardType === 'credit' ? parseInt(cardForm.creditLimit) : undefined,
      });
      const data = await apiClient.getCards();
      setCards(data || []);
      setCardForm({
        accountId: '',
        name: '',
        cardNumber: '',
        cardType: 'debit',
        issuer: '',
        creditLimit: '',
      });
      setAddType(null);
    } catch (err: any) {
      setAddError(err?.response?.data?.error?.message || '카드 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">자산 관리</h1>
        <button
          onClick={() => setAddType('select')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          추가하기
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : error ? (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
          {error}
        </div>
      ) : (
        <div className="space-y-2">
          {people.map((person) => {
            const personAccounts = getPersonAccounts(person.id);
            const isExpanded = expandedPeople.has(person.id);

            return (
              <div key={person.id}>
                <button
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('span')) {
                      togglePersonExpand(person.id);
                    } else {
                      setSelectedPerson(person);
                      setDetailType('person');
                    }
                  }}
                  className="w-full text-left px-4 py-3 bg-white rounded-lg shadow hover:shadow-md transition flex items-center gap-2 cursor-pointer"
                >
                  <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                  <span className="font-bold text-gray-900">{person.name}</span>
                  <span className="text-xs text-gray-500 ml-auto">
                    ({personAccounts.length}개 계좌)
                  </span>
                </button>

                {isExpanded && (
                  <div className="ml-6 mt-2 space-y-2 border-l-2 border-gray-200 pl-4">
                    {personAccounts.length === 0 ? (
                      <p className="text-sm text-gray-500 py-2">등록된 계좌가 없습니다.</p>
                    ) : (
                      personAccounts.map((account) => {
                        const accountCards = getAccountCards(account.id);
                        const isAccountExpanded = expandedAccounts.has(account.id);

                        return (
                          <div key={account.id}>
                            <button
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest('span')) {
                                  toggleAccountExpand(account.id);
                                } else {
                                  setSelectedAccount(account);
                                  setDetailType('account');
                                }
                              }}
                              className="w-full text-left px-4 py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition flex items-center gap-2 cursor-pointer"
                            >
                              <span
                                className={`transition-transform ${
                                  isAccountExpanded ? 'rotate-180' : ''
                                }`}
                              >
                                ▼
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900">{account.name}</p>
                                <p className="text-sm text-gray-600">{account.bankName}</p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="font-bold text-blue-600">
                                  {new Intl.NumberFormat('ko-KR', {
                                    style: 'currency',
                                    currency: account.currency,
                                  }).format(account.balance)}
                                </p>
                              </div>
                            </button>

                            {isAccountExpanded && (
                              <div className="ml-6 mt-2 space-y-2 border-l-2 border-gray-200 pl-4">
                                {accountCards.length === 0 ? (
                                  <p className="text-sm text-gray-500 py-2">등록된 카드가 없습니다.</p>
                                ) : (
                                  accountCards.map((card) => (
                                    <div
                                      key={card.id}
                                      onClick={() => {
                                        setSelectedCard(card);
                                        setDetailType('card');
                                      }}
                                      className="px-4 py-2 bg-green-50 rounded-lg hover:bg-green-100 transition flex items-center gap-2 cursor-pointer"
                                    >
                                      <span className="text-green-600">💳</span>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900">{card.name}</p>
                                        <p className="text-xs text-gray-600">{card.issuer}</p>
                                      </div>
                                      <span className="text-xs px-2 py-1 rounded bg-white text-gray-600">
                                        {card.cardType === 'debit' ? '체크' : '신용'}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 추가 유형 선택 팝업 */}
      <Modal
        isOpen={addType === 'select'}
        onClose={() => setAddType(null)}
        title="추가하기"
      >
        <div className="space-y-3">
          <button
            onClick={() => setAddType('person')}
            className="w-full px-4 py-3 text-left bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
          >
            <p className="font-semibold text-gray-900">👤 구성원 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 가족 구성원을 추가합니다</p>
          </button>

          <button
            onClick={() => setAddType('account')}
            className="w-full px-4 py-3 text-left bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition"
          >
            <p className="font-semibold text-gray-900">🏦 계좌 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 계좌를 추가합니다</p>
          </button>

          <button
            onClick={() => setAddType('card')}
            className="w-full px-4 py-3 text-left bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition"
          >
            <p className="font-semibold text-gray-900">💳 카드 추가</p>
            <p className="text-xs text-gray-600 mt-1">새로운 카드를 추가합니다</p>
          </button>
        </div>
      </Modal>

      {/* 구성원 추가 모달 */}
      <Modal
        isOpen={addType === 'person'}
        onClose={() => {
          setAddType(null);
          setPersonForm({ name: '', relationship: '' });
          setAddError('');
        }}
        title="구성원 추가"
      >
        <form onSubmit={handleAddPerson} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이름
            </label>
            <input
              type="text"
              required
              value={personForm.name}
              onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="이름 입력"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              관계 (선택)
            </label>
            <input
              type="text"
              value={personForm.relationship}
              onChange={(e) => setPersonForm({ ...personForm, relationship: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="배우자, 자녀 등"
            />
          </div>

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>

      {/* 계좌 추가 모달 */}
      <Modal
        isOpen={addType === 'account'}
        onClose={() => {
          setAddType(null);
          setAccountForm({
            ownerId: '',
            name: '',
            balance: '',
            bankName: '',
            accountNumber: '',
          });
          setAddError('');
        }}
        title="계좌 추가"
      >
        <form onSubmit={handleAddAccount} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              통장 주인
            </label>
            <CustomSelect
              options={people.map((p) => ({ id: p.id, name: p.name }))}
              value={accountForm.ownerId}
              onChange={(value) => setAccountForm({ ...accountForm, ownerId: value })}
              placeholder="선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌명
            </label>
            <input
              type="text"
              required
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 급여 통장"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              은행명
            </label>
            <input
              type="text"
              required
              value={accountForm.bankName}
              onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="KB Bank, Samsung Bank 등"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              초기 잔액 (원)
            </label>
            <input
              type="number"
              required
              value={accountForm.balance}
              onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="1000000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌번호 (선택)
            </label>
            <input
              type="text"
              value={accountForm.accountNumber}
              onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 123-456-7890"
            />
          </div>

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>

      {/* 카드 추가 모달 */}
      <Modal
        isOpen={addType === 'card'}
        onClose={() => {
          setAddType(null);
          setCardForm({
            accountId: '',
            name: '',
            cardNumber: '',
            cardType: 'debit',
            issuer: '',
            creditLimit: '',
          });
          setAddError('');
        }}
        title="카드 추가"
      >
        <form onSubmit={handleAddCard} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌
            </label>
            <CustomSelect
              options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
              value={cardForm.accountId}
              onChange={(value) => setCardForm({ ...cardForm, accountId: value })}
              placeholder="선택하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              카드 이름
            </label>
            <input
              type="text"
              required
              value={cardForm.name}
              onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
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
              value={cardForm.cardNumber}
              onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
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
              value={cardForm.cardType}
              onChange={(value) => setCardForm({ ...cardForm, cardType: value as 'debit' | 'credit' })}
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
              value={cardForm.issuer}
              onChange={(e) => setCardForm({ ...cardForm, issuer: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="KB Bank, Samsung Card 등"
            />
          </div>

          {cardForm.cardType === 'credit' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                신용한도 (원)
              </label>
              <input
                type="number"
                value={cardForm.creditLimit}
                onChange={(e) => setCardForm({ ...cardForm, creditLimit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5000000"
              />
            </div>
          )}

          {addError && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '추가 중...' : '추가하기'}
          </button>
        </form>
      </Modal>

      {/* 상세 정보 모달 - 구성원 */}
      {detailType === 'person' && selectedPerson && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedPerson(null);
          }}
          title="구성원 상세정보"
        >
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                이름
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedPerson.name}
              </p>
            </div>

            {selectedPerson.relationship && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  관계
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {selectedPerson.relationship}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 상세 정보 모달 - 계좌 */}
      {detailType === 'account' && selectedAccount && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedAccount(null);
          }}
          title="계좌 상세정보"
        >
          <div className="space-y-4 max-h-96 overflow-y-auto">
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
        </Modal>
      )}

      {/* 상세 정보 모달 - 카드 */}
      {detailType === 'card' && selectedCard && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailType(null);
            setSelectedCard(null);
          }}
          title="카드 상세정보"
        >
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
                카드 번호
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedCard.cardNumberMasked}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                카드 유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedCard.cardType === 'debit' ? '체크카드' : '신용카드'}
              </p>
            </div>

            {selectedCard.cardType === 'credit' && (
              <>
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
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
