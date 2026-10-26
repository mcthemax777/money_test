'use client';

/*
 * 자산 상세(구성원·계좌·카드·묶음)의 머리글과 그 옆의 아이콘 단추.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 상세 머리글의 아이콘 단추. 사용자·자산·카드 세 상세가 같은 것을 쓴다.
 *
 * 셋 다 아이콘이다. 글자 단추 둘 옆에 아이콘 하나만 서면 그것이 다른 종류의
 * 것으로 읽히고, 제목 옆에 글자가 넷(이름·금액·단추 둘) 늘어서 어느 것이 누를
 * 것인지도 흐려진다. 이름은 aria-label과 title로 남겨 둔다.
 *
 * 테두리와 바탕도 없앴다. 네모 셋이 이름 옆에 서면 그쪽이 무게를 가져가, 정작
 * 보러 온 금액과 추이보다 단추가 먼저 읽힌다.
 */
export function DetailIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      /*
        테두리도 바탕도 없다. 아이콘만 놓는다.

        누를 수 있다는 표시는 색으로 한다 -- 바탕 없이 크기만 잡아 두면 h-10 w-10 은
        손가락이 닿는 자리로 남고 눈에는 아이콘 셋만 보인다.
      */
      className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-600 transition-colors hover:text-gray-900"
    >
      {children}
    </button>
  );
}

/**
 * 상세의 머리글. 구성원·계좌·카드 셋이 같은 것을 쓴다.
 *
 * 좁은 화면에서는 이 상세가 화면을 통째로 덮는다(목록은 접힌다). 그래서 보관함·거래
 * 상세와 같은 모양을 쓴다 -- **왼쪽 위의 ←** 로 목록에 돌아가고, 오른쪽 끝의
 * 닫기(×)는 내린다. 클릭해서 들어가는 자리가 화면마다 다른 모양이면 돌아가는 길을
 * 그때마다 찾아야 한다.
 *
 * 넓은 화면에서는 목록이 옆에 그대로 있어 "돌아갈 곳"이 없으므로 지금처럼 × 만 둔다.
 */
export function AssetDetailHeader({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 이 상세에서만 쓰는 단추 (거래 보기·기본 정보). 좁은 화면에서는 ← 와 한 줄에 선다. */
  actions: ReactNode;
  /** 이름 아래에 붙는 것 (금액, 기관 이름, 유형 표). */
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/* 좁은 화면. 보관함·거래 상세와 같은 머리글 줄이다. */}
      <div className="mb-4 flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back')}
          title={t('common.back')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-gray-900">{title}</h2>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* 이름. 좁은 화면에서는 위 머리글 줄이 갖는다. */}
          <h2 className="hidden text-2xl font-bold text-gray-900 lg:block">{title}</h2>
          {children}
        </div>
        <div className="hidden shrink-0 gap-2 lg:flex">
          {actions}
          <DetailIconButton label={t('common.close')} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden />
          </DetailIconButton>
        </div>
      </div>
    </>
  );
}
