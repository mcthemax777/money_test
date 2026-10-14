'use client';

import { Loader2 } from 'lucide-react';

/**
 * 받는 동안 그 자리에 서는 돌림 표시 (2026-10-15 사용자 요청 -- 기다릴 때는 글자 대신 움직이는
 * 표시). 분석 탭을 처음 열 때, 그래프를 처음 받을 때 같은 자리가 쓴다. 앱의 같은 이름 부품과 같다.
 */
export default function LoadingBlock({ label }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-12">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  );
}
