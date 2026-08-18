'use client';

import { useEffect, useRef } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

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
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // 실패한 프로미스를 캐시하면 재시도가 막히므로 초기화한다.
      gisPromise = null;
      reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });

  return gisPromise;
}

interface GoogleSignInButtonProps {
  onCredential: (idToken: string) => void;
  onError: (message: string) => void;
}

export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  // 콜백을 의존성에 넣으면 부모가 리렌더될 때마다 버튼이 다시 초기화되므로
  // ref로 최신 값만 유지한다.
  const callbacksRef = useRef({ onCredential, onError });
  callbacksRef.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId) {
      callbacksRef.current.onError(
        'NEXT_PUBLIC_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.',
      );
      return;
    }

    let cancelled = false;

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
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        callbacksRef.current.onError(
          err instanceof Error ? err.message : '구글 로그인을 준비하지 못했습니다.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={containerRef} className="flex justify-center" />;
}
