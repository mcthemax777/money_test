'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';

interface Invitation {
  id: string;
  email: string;
  invitationCode: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export default function InvitationsPage() {
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();
  const { selectedProjectId } = useProject();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: '', role: 'editor' });
  const [linkForm, setLinkForm] = useState({ role: 'editor' });
  const [generatedLink, setGeneratedLink] = useState('');
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  useEffect(() => {
    if (selectedProjectId) {
      loadInvitations();
    }
  }, [selectedProjectId]);

  const loadInvitations = async () => {
    if (!selectedProjectId) return;

    try {
      setLoading(true);
      const data = await apiClient.getProjectPendingInvitations(selectedProjectId);
      setInvitations(data || []);
      setError('');
    } catch (err) {
      console.error('초대 목록 조회 실패:', err);
      setError('초대 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailInvitation = async () => {
    if (!selectedProjectId || !emailForm.email) {
      setError('이메일을 입력해주세요.');
      return;
    }

    try {
      await apiClient.sendEmailInvitation(selectedProjectId, emailForm.email, emailForm.role);
      setError('');
      setEmailForm({ email: '', role: 'editor' });
      setShowEmailForm(false);
      await loadInvitations();
      alert('초대 이메일이 발송되었습니다.');
    } catch (err) {
      setError('초대 발송에 실패했습니다.');
      console.error(err);
    }
  };

  const handleGenerateLink = async () => {
    if (!selectedProjectId) return;

    try {
      const response = await apiClient.generateInvitationLink(selectedProjectId, linkForm.role);
      setGeneratedLink(response.invitationLink);
      setError('');
      await loadInvitations();
    } catch (err) {
      setError('링크 생성에 실패했습니다.');
      console.error(err);
    }
  };

  const copyLinkToClipboard = (link: string, id: string) => {
    navigator.clipboard.writeText(link);
    setCopiedLinkId(id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR');
  };

  if (isInitializing || !isAuthenticated) {
    return <div className="flex justify-center items-center h-screen">로그인 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">프로젝트 초대 관리</h1>
        <p className="text-gray-600 mt-2">팀원을 프로젝트에 초대하세요</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 이메일 초대 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">이메일로 초대</h2>

          {!showEmailForm ? (
            <button
              onClick={() => setShowEmailForm(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              이메일 초대 보내기
            </button>
          ) : (
            <div className="space-y-4">
              <input
                type="email"
                placeholder="초대할 이메일"
                value={emailForm.email}
                onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={emailForm.role}
                onChange={(e) => setEmailForm({ ...emailForm, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="owner">소유자 (Owner)</option>
                <option value="editor">편집자 (Editor)</option>
                <option value="viewer">조회자 (Viewer)</option>
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleSendEmailInvitation}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  발송
                </button>
                <button
                  onClick={() => setShowEmailForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 링크로 초대 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">링크로 초대</h2>

          {!showLinkForm ? (
            <button
              onClick={() => setShowLinkForm(true)}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
            >
              초대 링크 생성
            </button>
          ) : (
            <div className="space-y-4">
              <select
                value={linkForm.role}
                onChange={(e) => setLinkForm({ ...linkForm, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="owner">소유자 (Owner)</option>
                <option value="editor">편집자 (Editor)</option>
                <option value="viewer">조회자 (Viewer)</option>
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleGenerateLink}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  생성
                </button>
                <button
                  onClick={() => setShowLinkForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 생성된 링크 */}
      {generatedLink && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-3">생성된 초대 링크</h3>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={generatedLink}
              className="flex-1 px-3 py-2 border border-blue-300 rounded-lg bg-white text-sm"
            />
            <button
              onClick={() => copyLinkToClipboard(generatedLink, 'generated')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {copiedLinkId === 'generated' ? '복사됨!' : '복사'}
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-2">30일 동안 유효합니다</p>
        </div>
      )}

      {/* 대기 중인 초대 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            대기 중인 초대 ({invitations.length})
          </h2>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-gray-500">로딩 중...</div>
        ) : invitations.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            대기 중인 초대가 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    이메일
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    역할
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    만료일
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {invitation.email || '링크 초대'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{invitation.role}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {invitation.expiresAt ? formatDate(invitation.expiresAt) : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {!invitation.email && (
                        <button
                          onClick={() => {
                            const link = `${window.location.origin}/join?code=${invitation.invitationCode}`;
                            copyLinkToClipboard(link, invitation.id);
                          }}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {copiedLinkId === invitation.id ? '복사됨!' : '링크 복사'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
