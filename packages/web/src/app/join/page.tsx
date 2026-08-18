'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

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

const ROLE_LABELS: Record<string, string> = {
  owner: '소유자',
  editor: '편집자',
  viewer: '조회자',
};

// useSearchParams는 Suspense 경계 안에서만 프리렌더가 가능하다.
export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-600">확인 중...</p>
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}

function JoinContent() {
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
        setError(err.response?.data?.error?.message || '초대 정보를 불러올 수 없습니다.');
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
        setError('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
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
      setError(err.response?.data?.error?.message || '초대 수락에 실패했습니다.');
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
      setError(err.response?.data?.error?.message || '초대 거절에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">프로젝트 초대</h1>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {!code ? (
          <div className="bg-white rounded-lg shadow p-6 text-center space-y-4">
            <p className="text-gray-700">초대 코드가 없는 주소입니다.</p>
            <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
              대시보드로 이동
            </Link>
          </div>
        ) : isInitializing ? (
          <p className="text-center text-gray-600">확인 중...</p>
        ) : !isAuthenticated ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <p className="text-sm text-gray-700 text-center">
              초대를 수락하려면 먼저 로그인해 주세요.
            </p>
            <GoogleSignInButton onCredential={handleCredential} onError={setError} />
          </div>
        ) : isLoading ? (
          <p className="text-center text-gray-600">초대 정보를 불러오는 중...</p>
        ) : invitation ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{invitation.projectName}</h2>
              {invitation.projectDescription && (
                <p className="text-sm text-gray-600 mt-1">{invitation.projectDescription}</p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                소유자 {invitation.ownerName ?? '알 수 없음'} · 멤버 {invitation.memberCount}명
              </p>
              <p className="text-xs text-gray-500 mt-1">
                권한 {ROLE_LABELS[invitation.role] ?? invitation.role}
                {invitation.expiresAt &&
                  ` · ${new Date(invitation.expiresAt).toLocaleDateString('ko-KR')}까지 유효`}
              </p>
            </div>

            {invitation.isMember ? (
              <div className="space-y-3">
                <p className="text-sm text-green-700">이미 이 프로젝트의 멤버입니다.</p>
                <Link
                  href="/dashboard"
                  className="block text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  대시보드로 이동
                </Link>
              </div>
            ) : invitation.status === 'pending' ? (
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {isSubmitting ? '처리 중...' : '수락'}
                </button>
                <button
                  onClick={handleDecline}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition"
                >
                  거절
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {invitation.status === 'expired'
                    ? '만료된 초대입니다. 소유자에게 새 링크를 요청해 주세요.'
                    : invitation.status === 'accepted'
                      ? '이미 사용된 초대입니다.'
                      : '거절한 초대입니다.'}
                </p>
                <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
                  대시보드로 이동
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
