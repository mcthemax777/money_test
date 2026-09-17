'use client';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 끊어 받는 목록의 바닥.
 *
 * 당긴 만큼 아래로 밀렸다가 손을 떼면 제자리로 튕겨 돌아온다. 되돌아올 때만 애니메이션을
 * 걸어야 당기는 동안 손끝을 따라온다.
 *
 * 홈의 거래 목록과 자산 상세의 원장이 함께 쓴다. 같은 손짓에는 같은 표시가 서야 한다 --
 * 한쪽만 "더 보기" 단추면 다른 쪽에서도 단추를 찾게 된다.
 */
export default function PullFooter({
  pull,
  isLoading,
  hasMore,
  isEmpty,
}: {
  /** 바닥에서 더 당긴 거리(px). `useBottomPull` 이 준다. */
  pull: number;
  isLoading: boolean;
  hasMore: boolean;
  /** 줄이 하나도 없는가. 빈 목록에는 "끝"을 적지 않는다. */
  isEmpty: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="py-2 text-center text-sm text-gray-500"
      style={{
        transform: `translateY(${pull * 0.5}px)`,
        transition: pull === 0 ? 'transform 320ms cubic-bezier(.2,1.4,.4,1)' : 'none',
      }}
    >
      {isLoading
        ? t('feed.loadingMore')
        : !hasMore
          ? isEmpty
            ? ''
            : t('feed.end')
          : pull > 0
            ? t('feed.pullMore')
            : t('feed.pullHint')}
    </div>
  );
}
