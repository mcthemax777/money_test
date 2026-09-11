'use client';

import Link from 'next/link';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 화면 제목 줄. 사이드탭 이름을 그대로 쓴다.
 *
 * 제목 크기(2xl/3xl)와 태그(h1/h2), 버튼 정렬이 화면마다 달랐다.
 * 오른쪽 `action`에는 그 화면의 주요 버튼을 넣는다.
 *
 * `backHref`는 사이드탭에 없는 하위 화면(설정 > 내 정보 등)에서만 쓴다.
 * 브라우저 히스토리(router.back)가 아니라 고정 경로로 보낸다. 새 탭이나
 * 링크로 바로 들어온 경우 돌아갈 히스토리가 없기 때문이다.
 *
 * `onBack`은 돌아가기 전에 할 일이 있는 자리가 쓴다 (분류에서 건너온 거래 화면은
 * 떠나온 상세를 다시 펴 달라고 남기고 간다). 둘 다 주면 `onBack`이 이긴다.
 */
export default function PageHeader({
  title,
  action,
  backHref,
  onBack,
}: {
  /** 글자면 그대로 제목이 되고, 노드면 그 자리에 들어간다 (자산주인을 겸하는 제목 등) */
  title: React.ReactNode;
  action?: React.ReactNode;
  backHref?: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const backClassName =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label={t('common.back')} className={backClassName}>
            ←
          </button>
        ) : backHref ? (
          <Link href={backHref} aria-label={t('common.back')} className={backClassName}>
            ←
          </Link>
        ) : null}
        {typeof title === 'string' ? (
          /*
            위아래 여백은 홈의 자산주인 제목(누를 수 있어 py-1 을 갖는다)과 맞춘 것이다.
            빼면 홈만 첫 줄이 4px 내려가 화면을 옮길 때마다 제목이 흔들린다.
          */
          <h1 className="py-1 text-2xl font-bold text-gray-900">{title}</h1>
        ) : (
          title
        )}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
