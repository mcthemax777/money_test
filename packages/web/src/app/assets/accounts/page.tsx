'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { apiClient } from '@/lib/api-client';
import type { Account, Person } from '@/lib/types';
import { formatCurrency } from '@/lib/money';
import { useProject } from '@/store/project';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import AddAccountModal from '@/components/AddAccountModal';
import EditAccountModal from '@/components/EditAccountModal';
import PersonModal from '@/components/PersonModal';


export default function AccountsPage() {
  const { isAuthenticated, loadUser } = useAuth();
  const { setPeople: setStorePeople } = useUserFilter();
  const { selectedProjectId } = useProject();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
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
          apiClient.getAccountsV2(selectedProjectId),
          apiClient.getPeople(selectedProjectId),
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
  }, [isAuthenticated, router, selectedProjectId]);

  const handleAccountClick = (account: Account) => {
    setSelectedAccount(account);
    setIsDetailModalOpen(true);
  };

  const handleDetailEditClick = () => {
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleEditClick = (account: Account) => {
    setSelectedAccount(account);
    setIsEditModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteAccountV2(id);
      const data = await apiClient.getAccountsV2(selectedProjectId);
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
          onClick={() => setIsAddModalOpen(true)}
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
                  {formatCurrency(account.balance)}
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

      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={(newAccounts) => setAccounts(newAccounts)}
        people={people}
        projectId={selectedProjectId}
      />

      <PersonModal
        isOpen={isPersonModalOpen}
        onClose={() => setIsPersonModalOpen(false)}
        person={null}
        mode="add"
        onSuccess={handlePersonModalSuccess}
        onDelete={async () => {}}
      />

      <EditAccountModal
        projectId={selectedProjectId}
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
          const data = await apiClient.getAccountsV2(selectedProjectId);
          setAccounts(data || []);
          setSelectedAccount(null);
        }}
      />
    </>
  );
}
