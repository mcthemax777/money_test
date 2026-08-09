'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';

interface Person {
  id: string;
  name: string;
  relationship?: string | null;
  isActive: boolean;
}

export default function PeoplePage() {
  const router = useRouter();
  const { isAuthenticated, loadUser } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', relationship: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const loadPeople = async () => {
      try {
        setIsLoading(true);
        const data = await apiClient.getPeople();
        setPeople(data || []);
      } catch (err) {
        setError('가족 구성원 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadPeople();
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      if (editingId) {
        await apiClient.updatePerson(editingId, {
          name: formData.name,
          relationship: formData.relationship || undefined,
        });
      } else {
        await apiClient.createPerson({
          name: formData.name,
          relationship: formData.relationship || undefined,
        });
      }
      const data = await apiClient.getPeople();
      setPeople(data || []);
      setFormData({ name: '', relationship: '' });
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err) {
      setError(editingId ? '사용자 수정에 실패했습니다.' : '사용자 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({ name: '', relationship: '' });
    setEditingId(null);
    setError('');
  };

  const handlePersonClick = (person: Person) => {
    setSelectedPerson(person);
    setIsDetailModalOpen(true);
  };

  const handleDetailEditClick = () => {
    if (!selectedPerson) return;
    setEditingId(selectedPerson.id);
    setFormData({ name: selectedPerson.name, relationship: selectedPerson.relationship || '' });
    setIsDetailModalOpen(false);
    setIsModalOpen(true);
    setError('');
  };

  const handleEditClick = (person: Person) => {
    setEditingId(person.id);
    setFormData({ name: person.name, relationship: person.relationship || '' });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deletePerson(id);
      const data = await apiClient.getPeople();
      setPeople(data || []);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '사용자 삭제에 실패했습니다.';
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
        <h1 className="text-2xl font-bold text-gray-900">가족 구성원</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          구성원 추가
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : people.length === 0 ? (
        <p className="text-gray-600">구성원이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {people.map((person) => (
            <div
              key={person.id}
              className="bg-white rounded-lg shadow p-4 flex justify-between items-center cursor-pointer hover:shadow-lg transition"
              onClick={() => handlePersonClick(person)}
            >
              <div className="flex-1">
                <p className="font-bold text-gray-900">{person.name}</p>
                {person.relationship && (
                  <p className="text-sm text-gray-600">{person.relationship}</p>
                )}
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
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="구성원 상세정보"
      >
        {selectedPerson && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                이름
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedPerson.name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                관계
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedPerson.relationship || '-'}
              </p>
            </div>

            <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
              <button
                onClick={handleDetailEditClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                수정하기
              </button>
              <button
                onClick={async () => {
                  setIsDetailModalOpen(false);
                  await handleDeleteClick(selectedPerson.id);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                disabled={isSubmitting}
              >
                삭제하기
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? '구성원 수정' : '구성원 추가'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이름
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
              value={formData.relationship}
              onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="배우자, 자녀 등"
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
    </>
  );
}
