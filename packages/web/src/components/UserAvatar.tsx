'use client';

import { useState } from 'react';

interface UserAvatarProps {
  name?: string | null;
  avatar?: string | null;
  size?: 'md' | 'lg';
}

/**
 * 구글 프로필 이미지를 보여주고, 없거나 로드에 실패하면 이름 첫 글자로 대체한다.
 */
export function UserAvatar({ name, avatar, size = 'md' }: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const dimension = size === 'lg' ? 'w-14 h-14 text-xl' : 'w-9 h-9 text-sm';

  if (avatar && !hasError) {
    return (
      // next/image를 쓰면 외부 도메인 설정이 필요해 일반 img를 사용한다.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt=""
        onError={() => setHasError(true)}
        className={`${dimension} rounded-full object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${dimension} rounded-full bg-blue-100 text-blue-700 font-semibold flex items-center justify-center shrink-0`}
    >
      {name?.trim().charAt(0) || '?'}
    </div>
  );
}
