'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useProjectStart } from '@money/core/hooks/useProjectStart';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';

/**
 * 가계부가 하나도 없는 사람의 첫 화면.
 *
 * 첫 로그인 때 서버가 가계부를 만들어 주지 않는다(`auth.service`). 남의 가계부에
 * 들어오려고 가입한 사람에게 빈 가계부가 하나 생기는 것을 막으려는 것이고, 그 대신
 * 여기서 **만들지 들어갈지를 사람이 고른다.**
 *
 * 껍데기(AppShell)를 쓰지 않는다. 사이드바와 아래 탭은 가계부 하나를 고른 상태를
 * 전제로 그려져, 이 자리에서는 어느 칸을 눌러도 빈 화면이 나온다. 로그인 화면과 같은
 * 모양으로 혼자 선다.
 *
 * QR 찍기는 앱에서 한다. 브라우저에서도 카메라를 열 수는 있지만 https 와 권한이 필요하고
 * 데스크톱에는 카메라가 없는 일이 많아, 여기서는 번호를 받는다. 앱은 같은 화면에서
 * 카메라를 연다.
 */
export default function StartPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated, isInitializing, logout } = useAuth();
  const projects = useProject((state) => state.projects);
  const start = useProjectStart();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, isInitializing, router]);

  /*
   * 가계부가 생기면 홈으로 보낸다.
   *
   * 만들었을 때와 들어갔을 때가 같은 자리다. 목록은 껍데기가 다시 받으므로(useProjectBootstrap)
   * 여기서는 고른 값이 생겼는지만 본다.
   */
  const goHome = () => router.push('/home');

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const result = await start.create(name);
    if (result.ok) goHome();
    else setError(result.message);
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const result = await start.preview(code);
    if (!result.ok) setError(result.message || t('start.codeInvalid'));
  };

  const submitJoin = async () => {
    setError('');
    const result = await start.join();
    if (result.ok) goHome();
    else setError(result.message);
  };

  const invite = start.invite;
  const canJoin = invite !== null && (invite.isMember || invite.status === 'pending');

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{t('start.title')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('start.hint')}</p>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : null}

        {/*
          들어갈 곳을 찾았으면 그것만 보여 준다. 무엇에 들어가는지 한 번 확인시키는
          자리라, 옆에 다른 칸이 함께 있으면 눈이 갈린다.
        */}
        {invite ? (
          <section className="space-y-4 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{invite.projectName}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {invite.ownerName ? t('start.inviteOf', { name: invite.ownerName }) : null}
                {invite.ownerName ? ' · ' : null}
                {t('start.inviteMembers', { count: invite.memberCount })}
              </p>
            </div>

            {invite.isMember ? (
              <p className="text-sm text-gray-600">{t('start.alreadyMember')}</p>
            ) : invite.status !== 'pending' ? (
              <p className="text-sm text-red-700">{t('start.inviteUnusable')}</p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitJoin}
                disabled={!canJoin || start.isBusy}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t(start.isBusy ? 'start.joining' : 'start.joinSubmit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  start.clearInvite();
                  setCode('');
                  setError('');
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-700 hover:bg-gray-50"
              >
                {t('start.joinOther')}
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('start.createTitle')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('start.createHint')}</p>
              </div>

              <form onSubmit={submitCreate} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('start.nameLabel')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('start.namePlaceholder')}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!name.trim() || start.isBusy}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {t(start.isBusy ? 'start.creating' : 'start.createSubmit')}
                </button>
              </form>
            </section>

            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('start.joinTitle')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('start.joinHint')}</p>
              </div>

              <form onSubmit={submitCode} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('start.codeLabel')}
                  </label>
                  <input
                    type="text"
                    value={code}
                    /*
                      사람이 치는 번호라 대문자로 올려 보여 준다. 서버도 그렇게 찾는다
                      (`normalizeInvitationCode`). 붙여 넣은 링크는 그대로 두어야 하므로
                      주소처럼 생겼으면 손대지 않는다.
                    */
                    onChange={(event) =>
                      setCode(
                        /[/:?]/.test(event.target.value)
                          ? event.target.value
                          : event.target.value.toUpperCase(),
                      )
                    }
                    placeholder="ABCD2345"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!code.trim() || start.isBusy}
                  className="w-full rounded-lg border border-blue-600 px-4 py-2.5 font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {t('start.codeSubmit')}
                </button>
              </form>

              <p className="text-xs text-gray-500">{t('start.scanApp')}</p>
            </section>
          </>
        )}

        {/*
          이미 가계부가 있는 사람이 주소를 직접 쳐서 들어온 자리. 돌아갈 길을 둔다.
          로그아웃도 함께 둔다 -- 가계부가 없는 사람에게는 이 화면이 전부라, 계정을
          바꾸려면 여기서 나갈 수 있어야 한다.
        */}
        <div className="flex justify-center gap-4 text-sm">
          {projects.length > 0 ? (
            <button type="button" onClick={goHome} className="text-blue-600 hover:underline">
              {t('common.goHome')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="text-gray-500 hover:underline"
          >
            {t('profile.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
