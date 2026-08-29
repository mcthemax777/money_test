'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useTranslation, type MessageKey } from '@/lib/i18n';
import { useApiError } from '@/lib/api-error';

interface InvitationInfo {
  invitationCode: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: string | null;
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  ownerName: string | null;
  memberCount: number;
  isMember: boolean;
}

const ROLE_KEYS: Record<string, MessageKey> = {
  owner: 'role.owner',
  editor: 'role.editor',
  viewer: 'role.viewer',
};

// useSearchParams는 Suspense 경계 안에서만 프리렌더가 가능하다.
export default function JoinPage() {
  const { t } = useTranslation();

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-600">{t('invite.checking')}</p>
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}

function JoinContent() {
  const { t, tag } = useTranslation();
  const { messageOf } = useApiError();
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');

  const { isAuthenticated, isInitializing, signInWithGoogle } = useAuth();
  const { setSelectedProjectId } = useProject();

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 로그인 상태가 되면 초대 정보를 불러온다.
  // 로그인 전에는 이 페이지를 벗어나지 않으므로 코드가 유실되지 않는다.
  useEffect(() => {
    if (isInitializing || !isAuthenticated || !code) {
      return;
    }

    const loadInvitation = async () => {
      try {
        setIsLoading(true);
        const data = await apiClient.getInvitationByCode(code);
        setInvitation(data);
        setError('');
      } catch (err: any) {
        setError(messageOf(err, 'invite.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    loadInvitation();
  }, [isInitializing, isAuthenticated, code]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setError('');

      try {
        await signInWithGoogle(idToken);
      } catch {
        setError(t('login.failed'));
      }
    },
    [signInWithGoogle],
  );

  const handleAccept = async () => {
    if (!code) return;

    try {
      setIsSubmitting(true);
      const result = await apiClient.acceptInvitation(code);
      // 방금 합류한 프로젝트를 바로 선택해 대시보드에서 보이게 한다.
      if (result?.projectId) {
        setSelectedProjectId(result.projectId);
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(messageOf(err, 'invite.acceptFailed'));
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!code) return;

    try {
      setIsSubmitting(true);
      await apiClient.declineInvitation(code);
      setInvitation((prev) => (prev ? { ...prev, status: 'declined' } : prev));
      setError('');
    } catch (err: any) {
      setError(messageOf(err, 'invite.declineFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">{t('invite.title')}</h1>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {!code ? (
          <div className="bg-white rounded-lg shadow p-6 text-center space-y-4">
            <p className="text-gray-700">{t('invite.noCode')}</p>
            <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
              {t('invite.toDashboard')}
            </Link>
          </div>
        ) : isInitializing ? (
          <p className="text-center text-gray-600">{t('invite.checking')}</p>
        ) : !isAuthenticated ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <p className="text-sm text-gray-700 text-center">
              {t('invite.signInFirst')}
            </p>
            <GoogleSignInButton onCredential={handleCredential} onError={setError} />
          </div>
        ) : isLoading ? (
          <p className="text-center text-gray-600">{t('invite.loading')}</p>
        ) : invitation ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{invitation.projectName}</h2>
              {invitation.projectDescription && (
                <p className="text-sm text-gray-600 mt-1">{invitation.projectDescription}</p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                {t('projects.ownerAndMembers', {
                  owner: invitation.ownerName ?? t('projects.unknownOwner'),
                  count: invitation.memberCount,
                })}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('invite.role', {
                  role: ROLE_KEYS[invitation.role] ? t(ROLE_KEYS[invitation.role]) : invitation.role,
                })}
                {invitation.expiresAt &&
                  t('invite.validUntil', {
                    date: new Date(invitation.expiresAt).toLocaleDateString(tag),
                  })}
              </p>
            </div>

            {invitation.isMember ? (
              <div className="space-y-3">
                <p className="text-sm text-green-700">{t('projects.alreadyMember')}</p>
                <Link
                  href="/dashboard"
                  className="block text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  {t('invite.toDashboard')}
                </Link>
              </div>
            ) : invitation.status === 'pending' ? (
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {isSubmitting ? t('invite.processing') : t('invite.accept')}
                </button>
                <button
                  onClick={handleDecline}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition"
                >
                  {t('invite.decline')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {invitation.status === 'expired'
                    ? t('invite.expired')
                    : invitation.status === 'accepted'
                      ? t('invite.used')
                      : t('invite.declined')}
                </p>
                <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
                  {t('invite.toDashboard')}
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
