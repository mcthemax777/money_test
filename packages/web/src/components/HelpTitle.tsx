'use client';

/*
 * 제목 옆 물음표를 누르면 설명이 펼쳐지는 머리 (2026-10-09 사용자 요청 -- 설정 탭의 상자들).
 *
 * 설명을 늘 펼쳐 두면 상자마다 두세 줄씩 차지해 한 화면에 몇 개 들어가지 않는다. 처음 한두 번만
 * 읽으면 되는 글이라 접어 두고, 궁금할 때 연다. 다시 누르면 접힌다.
 *
 * 상자 전체가 링크인 자리(설정의 하위 화면 칸)에서도 쓴다. 물음표 누름이 링크까지 가지 않게 막는다.
 */
import { useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

import { useTranslation } from '@money/core/lib/i18n';

export default function HelpTitle({
  title,
  description,
  trailing,
}: {
  title: string;
  description: string;
  /** 제목 바로 옆에 붙는 것 (읽지 않은 수 배지 따위). */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        {title}
        {trailing}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          aria-label={t('common.help')}
          aria-expanded={open}
          title={t('common.help')}
          className={`rounded-full p-0.5 transition-colors hover:bg-gray-100 ${
            open ? 'text-blue-600' : 'text-gray-400'
          }`}
        >
          <CircleHelp className="h-4 w-4" aria-hidden />
        </button>
      </h2>
      {/* 펼칠 때 옅은 데서 떠오른다 (`unfold`). */}
      {open ? <p className="unfold mt-1 text-sm text-gray-600">{description}</p> : null}
    </div>
  );
}
