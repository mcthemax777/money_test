'use client';

/**
 * 화면 제목 줄. 사이드탭 이름을 그대로 쓴다.
 *
 * 제목 크기(2xl/3xl)와 태그(h1/h2), 버튼 정렬이 화면마다 달랐다.
 * 오른쪽 `action`에는 그 화면의 주요 버튼을 넣는다.
 */
export default function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
