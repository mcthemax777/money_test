'use client';

import Link from 'next/link';

/**
 * 화면 제목 줄. 사이드탭 이름을 그대로 쓴다.
 *
 * 제목 크기(2xl/3xl)와 태그(h1/h2), 버튼 정렬이 화면마다 달랐다.
 * 오른쪽 `action`에는 그 화면의 주요 버튼을 넣는다.
 *
 * `backHref`는 사이드탭에 없는 하위 화면(설정 > 내 정보 등)에서만 쓴다.
 * 브라우저 히스토리(router.back)가 아니라 고정 경로로 보낸다. 새 탭이나
 * 링크로 바로 들어온 경우 돌아갈 히스토리가 없기 때문이다.
 */
export default function PageHeader({
  title,
  action,
  backHref,
}: {
  title: string;
  action?: React.ReactNode;
  backHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            aria-label="뒤로 가기"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
          >
            ←
          </Link>
        )}
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
