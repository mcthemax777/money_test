'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import { useTranslation } from '@/lib/i18n';
import type { Person } from '@/lib/types';
import { useApiError } from '@/lib/api-error';


/** 하단 고정 버튼과 본문 form을 잇는 id */
const FORM_ID = 'person-form';

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
  const { t } = useTranslation();
  const { messageOf } = useApiError();
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
      setError(messageOf(err, mode === 'add' ? 'person.addFailed' : 'account.editFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!person || !onDelete) return;
    if (!window.confirm(t('account.deleteConfirm'))) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(person.id);
      handleClose();
    } catch (err: any) {
      setError(messageOf(err, 'account.deleteFailed'));
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
    if (mode === 'add') return t('person.add');
    if (editMode) return t('person.edit');
    return t('person.detail');
  };

  const isFormMode = editMode || mode === 'add';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={getTitle()}
      /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
      footer={
        isFormMode ? (
          <div className="flex gap-2">
            <button
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting
                ? mode === 'add'
                  ? t('account.adding')
                  : t('account.editing')
                : mode === 'add'
                  ? t('account.addSubmit')
                  : t('account.editSubmit')}
            </button>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={isDeleting || isSubmitting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? t('account.deleting') : t('account.deleteSubmit')}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => setEditMode(true)}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t('account.editSubmit')}
          </button>
        )
      }
    >
      {isFormMode ? (
        <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('person.name')}
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('person.namePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('person.relationship')}
            </label>
            <input
              type="text"
              value={formData.relationship}
              onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('person.relationshipPlaceholder')}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {error}
            </div>
          )}

        </form>
      ) : (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('person.name')}
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {person?.name}
              </p>
            </div>

            {person?.relationship && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('person.relationshipLabel')}
                </label>
                <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                  {person.relationship}
                </p>
              </div>
            )}
          </div>

        </>
      )}
    </Modal>
  );
}
