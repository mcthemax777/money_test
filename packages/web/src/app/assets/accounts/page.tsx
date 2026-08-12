'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { apiClient } from '@/lib/api-client';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import AddAccountModal from '@/components/AddAccountModal';
import EditAccountModal from '@/components/EditAccountModal';
import PersonModal from '@/components/PersonModal';

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
}

export default function AccountsPage() {
  const { isAuthenticated, loadUser } = useAuth();
  const { setPeople: setStorePeople } = useUserFilter();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    ownerId: '',
    name: '',
    balance: '',
    bankName: '',
    accountNumber: '',
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
        const [accountsData, peopleData] = await Promise.all([
          apiClient.getAccountsV2(),
          apiClient.getPeople(),
        ]);
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
      if (editingId) {
        await apiClient.updateAccountV2(editingId, {
          name: formData.name,
          bankName: formData.bankName,
          ...(formData.accountNumber && { accountNumber: formData.accountNumber }),
        });
      } else {
        await apiClient.createAccountV2({
          ownerId: formData.ownerId,
          name: formData.name,
          balance: parseInt(formData.balance),
          bankName: formData.bankName,
          ...(formData.accountNumber && { accountNumber: formData.accountNumber }),
        });
      }
      const data = await apiClient.getAccountsV2();
      setAccounts(data || []);
      setFormData({
        ownerId: '',
        name: '',
        balance: '',
        bankName: '',
        accountNumber: '',
      });
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err) {
      setError(editingId ? '계좌 수정에 실패했습니다.' : '계좌 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      ownerId: '',
      name: '',
      balance: '',
      bankName: '',
      accountNumber: '',
    });
    setEditingId(null);
    setError('');
  };

  const handleAccountClick = (account: Account) => {
    setSelectedAccount(account);
    setIsDetailModalOpen(true);
  };

  const handleDetailEditClick = () => {
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleEditClick = (account: Account) => {
    setEditingId(account.id);
    setFormData({
      ownerId: account.ownerId,
      name: account.name,
      balance: account.balance.toString(),
      bankName: account.bankName,
      accountNumber: account.accountNumber || '',
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteAccountV2(id);
      const data = await apiClient.getAccountsV2();
      setAccounts(data || []);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '계좌 삭제에 실패했습니다.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePersonModalSuccess = (updatedPeople: Person[]) => {
    setPeople(updatedPeople);
    setStorePeople(updatedPeople);
    setIsPersonModalOpen(false);
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">계좌 관리</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          계좌 추가
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : accounts.length === 0 ? (
        <p className="text-gray-600">계좌가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="bg-white rounded-lg shadow p-4 flex justify-between items-start cursor-pointer hover:shadow-lg transition"
              onClick={() => handleAccountClick(account)}
            >
              <div className="flex-1">
                <p className="font-bold text-gray-900">{account.name}</p>
                <p className="text-sm text-gray-600">{account.bankName}</p>
                <p className="text-xs text-gray-500 mt-1">
                  계좌번호: {account.accountNumber || 'N/A'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">
                  {new Intl.NumberFormat('ko-KR', {
                    style: 'currency',
                    currency: account.currency,
                  }).format(account.balance)}
                </p>
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
        title={editingId ? '계좌 수정' : '계좌 추가'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              통장 주인
            </label>
            <CustomSelect
              options={people.map((p) => ({ id: p.id, name: p.name }))}
              value={formData.ownerId}
              onChange={(value) => setFormData({ ...formData, ownerId: value })}
              placeholder="선택하세요"
              onAddClick={() => setIsPersonModalOpen(true)}
              addButtonLabel="사용자 추가"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              계좌명
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
              value={formData.bankName}
              onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
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
              value={formData.balance}
              onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
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
              value={formData.accountNumber}
              onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 123-456-7890"
            />
          </div>

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
        title="계좌 상세정보"
      >
        {selectedAccount && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                통장 주인
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {people.find(p => p.id === selectedAccount.ownerId)?.name || '-'}
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
                은행명
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.bankName}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                잔액
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-lg font-bold text-blue-600">
                {new Intl.NumberFormat('ko-KR', {
                  style: 'currency',
                  currency: selectedAccount.currency,
                }).format(selectedAccount.balance)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                계좌번호
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedAccount.accountNumber || '-'}
              </p>
            </div>

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

      <PersonModal
        isOpen={isPersonModalOpen}
        onClose={() => setIsPersonModalOpen(false)}
        person={null}
        mode="add"
        onSuccess={handlePersonModalSuccess}
        onDelete={async () => {}}
      />

      <EditAccountModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        account={selectedAccount}
        people={people}
        onSuccess={(updatedAccounts) => {
          setAccounts(updatedAccounts || []);
          setSelectedAccount(null);
        }}
        onDelete={async (id) => {
          await apiClient.deleteAccountV2(id);
          const data = await apiClient.getAccountsV2();
          setAccounts(data || []);
          setSelectedAccount(null);
        }}
      />
    </>
  );
}
