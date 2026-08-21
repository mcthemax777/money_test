'use client';

import { useEffect, useRef, useState } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * 스크립트 로딩 상한.
 *
 * 차단기나 인앱 브라우저에서는 onload도 onerror도 오지 않고 그대로 멈추는 경우가 있다.
 * 상한이 없으면 화면에 아무 버튼도 없는 상태로 남는다.
 */
const LOAD_TIMEOUT_MS = 10_000;

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let gisPromise: Promise<void> | null = null;

// GIS 스크립트는 앱 전체에서 한 번만 로드한다.
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (gisPromise) {
    return gisPromise;
  }

  gisPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 실패한 프로미스와 스크립트 태그를 남기면 재시도가 막힌다.
      gisPromise = null;
      script.remove();
      reject(new Error(message));
    };

    const timer = setTimeout(
      () => fail('구글 로그인 스크립트 응답이 없습니다. 네트워크 상태를 확인해 주세요.'),
      LOAD_TIMEOUT_MS,
    );

    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      // 차단 확장이 빈 응답으로 바꿔치기하면 onload는 떠도 전역이 없다.
      if (!window.google?.accounts?.id) {
        fail('구글 로그인 스크립트가 차단되었습니다.');
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => fail('구글 로그인 스크립트를 불러오지 못했습니다.');
    document.head.appendChild(script);
  });

  return gisPromise;
}

/**
 * 준비 상태.
 *
 * `failed`는 다시 시도할 여지가 있는 실패(차단·네트워크)이고, `misconfigured`는
 * 배포 설정 문제라 사용자가 다시 눌러도 달라지지 않는다.
 */
type Status = 'loading' | 'ready' | 'failed' | 'misconfigured';

interface GoogleSignInButtonProps {
  onCredential: (idToken: string) => void;
  onError: (message: string) => void;
}

export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [status, setStatus] = useState<Status>('loading');
  /** 다시 시도 횟수. 늘어나면 아래 effect가 다시 돈다. */
  const [attempt, setAttempt] = useState(0);
  /** 실패했을 때 다른 브라우저에 옮겨 붙일 수 있게 보여 주는 현재 주소 */
  const [pageUrl, setPageUrl] = useState('');

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  // 콜백을 의존성에 넣으면 부모가 리렌더될 때마다 버튼이 다시 초기화되므로
  // ref로 최신 값만 유지한다.
  const callbacksRef = useRef({ onCredential, onError });
  callbacksRef.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId) {
      setStatus('misconfigured');
      callbacksRef.current.onError(
        'NEXT_PUBLIC_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.',
      );
      return;
    }

    let cancelled = false;
    setStatus('loading');

    loadGis()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              callbacksRef.current.onError('구글 인증 정보를 받지 못했습니다.');
              return;
            }
            callbacksRef.current.onCredential(response.credential);
          },
        });

        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          locale: 'ko',
          width: 320,
        });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('failed');
        callbacksRef.current.onError(
          err instanceof Error ? err.message : '구글 로그인을 준비하지 못했습니다.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, attempt]);

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="flex justify-center" />

      {status === 'loading' && (
        <p className="text-center text-sm text-gray-500">구글 로그인 준비 중...</p>
      )}

      {/*
        실패하면 화면에 아무 버튼도 남지 않아 사용자가 할 수 있는 일이 없었다.
        구글 버튼은 스크립트가 그리므로, 우리 쪽에서 최소한 다시 시도할 수단을 준다.
      */}
      {status === 'failed' && (
        <div className="space-y-2 text-center">
          <button
            type="button"
            onClick={() => setAttempt((count) => count + 1)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            다시 시도
          </button>
          <p className="text-xs text-gray-500">
            카카오톡 등 앱 안에서 열린 화면이거나 광고 차단 확장·사내 네트워크가
            accounts.google.com을 막고 있으면 로그인 창을 띄울 수 없습니다.
            크롬·사파리 같은 브라우저에서 이 주소를 다시 열어 주세요.
          </p>
          {pageUrl && (
            <p className="text-xs text-gray-500 break-all">
              현재 주소: <span className="font-mono">{pageUrl}</span>
            </p>
          )}
        </div>
      )}

      {status === 'misconfigured' && (
        <p className="text-center text-xs text-gray-500">
          로그인 설정이 완료되지 않았습니다. 관리자에게 알려 주세요.
        </p>
      )}
    </div>
  );
}
