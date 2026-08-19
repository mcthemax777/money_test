'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import type { Person } from '@/lib/types';


interface PersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  person: Person | null;
  mode?: 'add' | 'view' | 'edit';
  onSuccess: (updatedPeople: Person[]) => void;
  onDelete?: (id: string) => Promise<void>;
}

export default function PersonModal({
  isOpen,
  onClose,
  person,
  mode = 'edit',
  onSuccess,
  onDelete,
}: PersonModalProps) {
  const [formData, setFormData] = useState({ name: '', relationship: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (person && mode !== 'add') {
      setFormData({
        name: person.name,
        relationship: person.relationship || '',
      });
      setEditMode(mode === 'edit');
    } else if (mode === 'add') {
      setFormData({ name: '', relationship: '' });
      setEditMode(true);
    }
  }, [person, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'edit' && !person) return;

    try {
      setIsSubmitting(true);
      setError('');

      if (mode === 'add') {
        await apiClient.createPerson({
          name: formData.name,
          relationship: formData.relationship || undefined,
        });
      } else {
        await apiClient.updatePerson(person!.id, {
          name: formData.name,
          relationship: formData.relationship || undefined,
        });
      }

      const data = await apiClient.getPeople();
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      const errorMsg = mode === 'add' ? '추가에 실패했습니다.' : '수정에 실패했습니다.';
      setError(err?.response?.data?.error?.message || errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!person || !onDelete) return;
    if (!window.confirm('정말 삭제하시겠습니까?')) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(person.id);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', relationship: '' });
    setError('');
    onClose();
  };

  if (!person && mode !== 'add') return null;

  const getTitle = () => {
    if (mode === 'add') return '구성원 추가';
    if (editMode) return '구성원 수정';
    return '구성원 상세정보';
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getTitle()}>
      {editMode || mode === 'add' ? (
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

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? (mode === 'add' ? '추가 중...' : '수정 중...') : (mode === 'add' ? '추가하기' : '수정하기')}
            </button>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={isDeleting || isSubmitting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? '삭제 중...' : '삭제하기'}
              </button>
            )}
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
                {person?.name}
              </p>
            </div>

            {person?.relationship && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  관계
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {person.relationship}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
            <button
              onClick={() => setEditMode(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              수정하기
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
