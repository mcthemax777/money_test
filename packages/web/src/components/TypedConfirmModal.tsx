'use client';

/*
 * 되돌리기 어려운 일을 글자로 한 번 더 확인하는 창 (2026-10-09 사용자 요청).
 *
 * 프로젝트 삭제와 소유자 넘기기가 쓴다. 확인 단추 한 번은 습관처럼 눌린다. 정해 둔 말을
 * 그대로 적어야 단추가 살아나서, 무엇을 하려는지 읽지 않고는 넘어갈 수 없다.
 */
import { useEffect, useState } from 'react';

import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';

export default function TypedConfirmModal({
  isOpen,
  onClose,
  title,
  body,
  phrase,
  actionLabel,
  isSubmitting,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** 무엇이 일어나는지. 줄마다 한 문단이다. */
  body: string[];
  /** 그대로 적어야 하는 말. 앞뒤 빈칸만 봐준다. */
  phrase: string;
  actionLabel: string;
  isSubmitting: boolean;
  /** 실패하면 창을 닫지 않고 이유를 적는다. */
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 적은 말이 남으면 다른 대상에 그대로 눌린다.
  useEffect(() => {
    if (!isOpen) return;
    setTyped('');
    setError('');
  }, [isOpen, title]);

  const matches = typed.trim() === phrase;

  const submit = async () => {
    if (!matches || isSubmitting) return;
    const result = await onConfirm();
    if (result.ok) onClose();
    else setError(result.message ?? '');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!matches || isSubmitting}
          className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? t('common.saving') : actionLabel}
        </button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <label className="block space-y-2">
          <span className="block text-sm text-gray-700">
            {t('projects.typeToConfirm', { phrase })}
          </span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder={phrase}
            autoFocus
            autoComplete="off"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900"
          />
        </label>
      </div>
    </Modal>
  );
}
