'use client';

import { useEffect } from 'react';

import { isChunkError, reloadForChunk } from '@/components/WebUpdate';

/**
 * 맨 바깥(레이아웃)까지 무너졌을 때의 자리 (2026-10-16). 레이아웃이 없으므로 html·body 를 스스로 그리고,
 * 언어 상자도 쓸 수 없어 세 언어를 함께 적는다. 배포 직후의 조각 실패면 한 번 새로고침한다 (app/error.tsx).
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('화면 오류:', error);
    if (isChunkError(error)) reloadForChunk();
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div style={{ padding: 24, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <p>화면을 그리다 문제가 생겼습니다 · Something went wrong · 問題が発生しました</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: '8px 16px' }}>
            다시 시도 · Try again · 再試行
          </button>
        </div>
      </body>
    </html>
  );
}
