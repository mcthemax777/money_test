'use client';

/*
 * 캡처를 올리는 자리. 끌어다 놓거나, 눌러 고르거나, 붙여넣는다.
 *
 * 세 길을 다 두는 이유가 있다. 화면 캡처는 대개 **방금 찍은 것**이라 파일 탐색기를
 * 여는 것보다 끌어다 놓는 편이 짧고, 윈도의 캡처 도구나 맥의 ⌘⇧4 는 클립보드에
 * 그림을 남기므로 붙여넣기가 가장 짧다. 파일 고르기는 그 둘이 안 되는 자리(모바일
 * 브라우저)를 위해 남긴다.
 *
 * 읽는 일은 이 컴포넌트가 하지 않는다. 사진만 넘기고, 진행과 결과는 부르는 쪽이
 * 그린다 -- 이 자리는 "무엇을 올렸는가"까지만 안다.
 */

import { useEffect, useRef, useState } from 'react';
import { Camera, Upload } from 'lucide-react';

import { useTranslation } from '@money/core/lib/i18n';

export default function CaptureDropzone({
  onPick,
  disabled,
}: {
  /** 사진을 골랐을 때. 여러 장을 한 번에 놓을 수 있다. */
  onPick: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  /** 지금 이 자리로 끌고 온 상태인가. 테두리와 바탕으로 알려 준다. */
  const [isOver, setIsOver] = useState(false);
  /** 사진이 아닌 것을 놓았을 때의 안내. */
  const [rejected, setRejected] = useState(false);

  /**
   * 사진만 받는다.
   *
   * PDF 나 텍스트를 놓으면 조용히 무시하지 않고 그렇다고 말해 준다 -- 아무 일도
   * 일어나지 않으면 사용자는 기능이 고장 났다고 읽는다.
   */
  const take = (list: FileList | File[] | null) => {
    if (disabled) return;

    const files = Array.from(list ?? []).filter((file) => file.type.startsWith('image/'));
    setRejected(files.length === 0);
    if (files.length > 0) onPick(files);
  };

  /*
   * 붙여넣기. 이 화면이 열려 있는 동안만 듣는다.
   *
   * 입력란에 붙여넣는 것과 부딪히지 않는다 -- 클립보드에 그림이 있을 때만 가져가고,
   * 글자를 붙여넣는 경우에는 아무것도 하지 않는다.
   */
  useEffect(() => {
    if (disabled) return;

    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;

      event.preventDefault();
      onPick(files);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, onPick]);

  return (
    <div>
      <div
        onDragOver={(event) => {
          // 막지 않으면 브라우저가 사진을 새 탭으로 열어 이 화면을 떠난다.
          event.preventDefault();
          if (!disabled) setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          take(event.dataTransfer?.files ?? null);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
            : isOver
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/40'
        }`}
      >
        {isOver ? (
          <Upload className="h-6 w-6 text-blue-600" aria-hidden />
        ) : (
          <Camera className="h-6 w-6 text-gray-400" aria-hidden />
        )}
        <p className="text-sm font-medium text-gray-900">{t('inbox.drop')}</p>
        <p className="text-xs text-gray-500">{t('inbox.dropOrPick')}</p>
        {/*
          사진이 어디까지 가는지 이 자리에 적는다. 브라우저에서 읽는다는 사실이
          이 기능을 쓸지 정하는 근거이고, 화면 밖에 두면 아무도 읽지 않는다.
        */}
        <p className="text-xs text-gray-500">{t('inbox.dropHint')}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          take(event.target.files);
          // 같은 사진을 다시 고를 수 있어야 한다. 값이 남으면 change 가 오지 않는다.
          event.target.value = '';
        }}
      />

      {rejected ? (
        <p className="mt-2 text-xs text-amber-800">{t('inbox.notImage')}</p>
      ) : null}
    </div>
  );
}
