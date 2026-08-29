'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { apiClient } from '@/lib/api-client';
import { UserAvatar } from '@/components/UserAvatar';
import PageHeader from '@/components/PageHeader';
import { useTranslation } from '@/lib/i18n';
import { useApiError } from '@/lib/api-error';

export default function ProfilePage() {
  const router = useRouter();
  const { t, tag } = useTranslation();
  const { messageOf } = useApiError();
  const { user, loadUser, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const startEditing = () => {
    setNameInput(user?.name ?? '');
    setError('');
    setSavedMessage('');
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    const name = nameInput.trim();

    if (!name) {
      setError(t('profile.nameRequired'));
      return;
    }

    if (name === user?.name) {
      setIsEditingName(false);
      return;
    }

    try {
      setIsSaving(true);
      await apiClient.updateProfile({ name });
      // 스토어의 사용자 정보를 서버 값으로 다시 맞춘다.
      await loadUser();
      setIsEditingName(false);
      setError('');
      setSavedMessage(t('profile.nameSaved'));
    } catch (err: any) {
      setError(messageOf(err, 'profile.nameSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * 로그아웃.
   *
   * 화면 상단 헤더에 있던 버튼을 이 화면으로 옮겼다. 스토어의 logout은 서버 호출이
   * 실패해도 finally에서 토큰과 상태를 비우므로, 결과와 무관하게 로그인 화면으로 보낸다.
   */
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      router.push('/login');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.profile.title')} backHref="/settings" />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {savedMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {savedMessage}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-4 pb-6 border-b border-gray-100">
          <UserAvatar name={user?.name} avatar={user?.avatar} size="lg" />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-sm text-gray-600 truncate">{user?.email}</p>
          </div>
        </div>

        <dl className="divide-y divide-gray-100">
          <div className="py-4">
            <dt className="text-sm text-gray-600">{t('profile.name')}</dt>
            {isEditingName ? (
              <dd className="mt-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') setIsEditingName(false);
                  }}
                  maxLength={50}
                  autoFocus
                  className="flex-1 min-w-[12rem] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSaveName}
                  disabled={isSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
                <button
                  onClick={() => setIsEditingName(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  {t('common.cancel')}
                </button>
              </dd>
            ) : (
              <dd className="mt-1 flex items-center gap-3">
                <span className="text-lg font-medium text-gray-900">{user?.name}</span>
                <button onClick={startEditing} className="text-sm text-blue-600 hover:underline">
                  {t('common.change')}
                </button>
              </dd>
            )}
            <p className="mt-2 text-xs text-gray-500">{t('profile.nameHint')}</p>
          </div>

          <div className="py-4">
            <dt className="text-sm text-gray-600">{t('profile.email')}</dt>
            <dd className="mt-1 text-lg font-medium text-gray-900">{user?.email}</dd>
            <p className="mt-2 text-xs text-gray-500">{t('profile.emailHint')}</p>
          </div>

          <div className="py-4">
            <dt className="text-sm text-gray-600">{t('profile.joinedAt')}</dt>
            <dd className="mt-1 text-lg font-medium text-gray-900">
              {user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString(tag)
                : '-'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('profile.logout')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('profile.logoutHint')}</p>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
        >
          {isLoggingOut ? t('profile.loggingOut') : t('profile.logout')}
        </button>
      </div>
    </div>
  );
}
