'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useUserFilter } from '@/store/user-filter';
import { apiClient } from '@/lib/api-client';
import PersonModal from '@/components/PersonModal';
import type { Person } from '@/lib/types';


export default function PeoplePage() {
  const router = useRouter();
  const { isAuthenticated, loadUser } = useAuth();
  const { setPeople: setStorePeople } = useUserFilter();
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [personModalMode, setPersonModalMode] = useState<'add' | 'view' | 'edit'>('view');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

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

  const handlePersonClick = (person: Person) => {
    setSelectedPerson(person);
    setPersonModalMode('view');
    setPersonModalOpen(true);
  };

  const handleAddClick = () => {
    setSelectedPerson(null);
    setPersonModalMode('add');
    setPersonModalOpen(true);
  };

  const handlePersonModalSuccess = (updatedPeople: Person[]) => {
    setPeople(updatedPeople);
    setStorePeople(updatedPeople);
    setPersonModalOpen(false);
  };

  const handlePersonDelete = async (id: string) => {
    await apiClient.deletePerson(id);
    const data = await apiClient.getPeople();
    setPeople(data || []);
    setStorePeople(data || []);
  };

  if (!isAuthenticated) {
    return <div className="flex justify-center items-center h-screen">로그인 중...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">가족 구성원</h1>
        <button
          onClick={handleAddClick}
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

      <PersonModal
        isOpen={personModalOpen}
        onClose={() => setPersonModalOpen(false)}
        person={selectedPerson}
        mode={personModalMode}
        onSuccess={handlePersonModalSuccess}
        onDelete={handlePersonDelete}
      />
    </>
  );
}
