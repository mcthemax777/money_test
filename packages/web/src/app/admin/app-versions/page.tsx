'use client';

/*
 * 앱 버전 정책. 안드로이드·iOS·웹마다 두 값을 둔다.
 *
 *   - **강제 업데이트 버전.** 이보다 낮은 판은 서버가 모든 요청을 426 으로 거절하고, 화면은
 *     닫을 수 없는 업데이트 창을 띄운다. API 를 옛 판과 맞지 않게 바꾸는 배포 때 올린다.
 *   - **권유 버전.** 이보다 낮으면 "새 버전이 있습니다"를 한 번 묻는다. 새 판을 스토어에
 *     올린 뒤 올린다.
 *
 * 웹의 버전은 빌드 번호("20260929.153000")다. 새로 배포하면 열려 있던 탭에는 저절로 띠가
 * 뜨므로 권유는 대개 비워 둔다. 강제는 "지금 배포된 빌드로"를 눌러 채운다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  APP_PLATFORMS,
  compareVersions,
  isVersion,
  type AppPlatform,
  type AppVersionPolicy,
} from '@money/types';

import { AdminAuthError, listAppVersions, updateAppVersion } from '@/lib/admin-api';

const PLATFORM_NAME: Record<AppPlatform, string> = {
  android: '안드로이드',
  ios: 'iOS',
  web: '웹',
};

const PLACEHOLDER: Record<AppPlatform, string> = {
  android: '1.2.0',
  ios: '1.2.0',
  web: '20260929.153000',
};

interface Draft {
  minVersion: string;
  latestVersion: string;
  storeUrl: string;
  message: string;
}

function draftOf(policy: AppVersionPolicy): Draft {
  return {
    minVersion: policy.minVersion ?? '',
    latestVersion: policy.latestVersion ?? '',
    storeUrl: policy.storeUrl ?? '',
    message: policy.message ?? '',
  };
}

/** 지금 배포된 웹 빌드 번호. 강제 값을 채우고, 그보다 높은 값을 막는 데 쓴다. */
async function deployedWebVersion(): Promise<string | null> {
  try {
    const response = await fetch('/version', { cache: 'no-store' });
    const data = (await response.json()) as { version?: string | null };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export default function AdminAppVersionsPage() {
  const router = useRouter();
  const [policies, setPolicies] = useState<AppVersionPolicy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [webVersion, setWebVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<AppPlatform | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof AdminAuthError) {
        router.replace('/admin/login');
        return;
      }
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    },
    [router],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [rows, deployed] = await Promise.all([listAppVersions(), deployedWebVersion()]);
        setPolicies(rows);
        setDrafts(Object.fromEntries(rows.map((row) => [row.platform, draftOf(row)])));
        setWebVersion(deployed);
      } catch (error) {
        fail(error);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [fail]);

  const setField = (platform: AppPlatform, field: keyof Draft, value: string) =>
    setDrafts((previous) => ({ ...previous, [platform]: { ...previous[platform], [field]: value } }));

  const save = async (platform: AppPlatform) => {
    const draft = drafts[platform];
    const minVersion = draft.minVersion.trim();

    /*
     * 웹의 강제 값이 배포된 빌드보다 높으면 막는다.
     *
     * 그 값이면 새로고침해도 강제 창이 다시 뜬다 -- 올릴 수 있는 빌드가 아직 없다. 모든
     * 사람이 웹을 못 쓰게 된다.
     */
    if (
      platform === 'web' &&
      minVersion &&
      webVersion &&
      isVersion(minVersion) &&
      compareVersions(minVersion, webVersion) > 0
    ) {
      setMessage({
        kind: 'error',
        text: `웹 강제 버전(${minVersion})이 지금 배포된 빌드(${webVersion})보다 높습니다. 새로고침해도 쓸 수 없게 됩니다.`,
      });
      return;
    }

    const isRaisingForce = minVersion && minVersion !== (policies.find((p) => p.platform === platform)?.minVersion ?? '');
    if (
      isRaisingForce &&
      !window.confirm(
        `${PLATFORM_NAME[platform]} ${minVersion} 보다 낮은 판은 저장하는 순간(서버마다 30초 안에) 쓸 수 없게 됩니다. 저장할까요?`,
      )
    ) {
      return;
    }

    setSaving(platform);
    setMessage(null);
    try {
      const saved = await updateAppVersion(platform, {
        minVersion: minVersion || null,
        latestVersion: draft.latestVersion.trim() || null,
        storeUrl: draft.storeUrl.trim() || null,
        message: draft.message.trim() || null,
      });
      setPolicies((previous) => previous.map((row) => (row.platform === platform ? saved : row)));
      setDrafts((previous) => ({ ...previous, [platform]: draftOf(saved) }));
      setMessage({ kind: 'ok', text: `${PLATFORM_NAME[platform]} 정책을 저장했습니다.` });
    } catch (error) {
      fail(error);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">앱 버전</h1>
        <p className="mt-1 text-sm text-gray-600">
          강제 업데이트 버전보다 낮은 판은 쓸 수 없고, 권유 버전보다 낮으면 업데이트를 권합니다.
          비워 두면 그 단계는 없습니다. 이 기능이 들어가기 전의 앱은 버전을 보내지 않아 막히지
          않습니다.
        </p>
      </div>

      {message ? (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-gray-500">불러오는 중...</p>
      ) : (
        APP_PLATFORMS.map((platform) => {
          const draft = drafts[platform];
          if (!draft) return null;
          const updatedAt = policies.find((row) => row.platform === platform)?.updatedAt;

          return (
            <section
              key={platform}
              className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold text-gray-900">{PLATFORM_NAME[platform]}</h2>
                <span className="text-xs text-gray-500">
                  {updatedAt ? `마지막 저장 ${new Date(updatedAt).toLocaleString()}` : '저장한 적 없음'}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    강제 업데이트 버전 (이보다 낮으면 쓸 수 없음)
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={draft.minVersion}
                      onChange={(event) => setField(platform, 'minVersion', event.target.value)}
                      placeholder={PLACEHOLDER[platform]}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    {platform === 'web' && webVersion ? (
                      <button
                        type="button"
                        onClick={() => setField('web', 'minVersion', webVersion)}
                        className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        지금 배포된 빌드로
                      </button>
                    ) : null}
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    권유 버전 (이보다 낮으면 업데이트를 권함)
                  </span>
                  <input
                    value={draft.latestVersion}
                    onChange={(event) => setField(platform, 'latestVersion', event.target.value)}
                    placeholder={PLACEHOLDER[platform]}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              {platform === 'web' ? (
                <p className="text-xs text-gray-500">
                  지금 배포된 빌드: {webVersion ?? '알 수 없음'}. 새로 배포하면 열려 있던 탭에
                  &quot;새 버전이 있습니다&quot; 띠가 저절로 뜹니다.
                </p>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    업데이트 주소 (비우면 플레이 스토어)
                  </span>
                  <input
                    value={draft.storeUrl}
                    onChange={(event) => setField(platform, 'storeUrl', event.target.value)}
                    placeholder="https://play.google.com/store/apps/details?id=online.bboyong.app"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              )}

              {platform === 'web' ? null : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    창에 덧붙일 말 (선택)
                  </span>
                  <textarea
                    value={draft.message}
                    onChange={(event) => setField(platform, 'message', event.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void save(platform)}
                  disabled={saving !== null}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
                >
                  {saving === platform ? '저장하는 중...' : '저장'}
                </button>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
