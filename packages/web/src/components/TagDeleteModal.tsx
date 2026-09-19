'use client';

/*
 * 붙어 있는 태그를 없앨 때 무엇을 할지 묻는 창.
 *
 * 태그는 분류와 달리 쓰이고 있어도 지울 수 있다 -- 떼어 내도 거래는 온전하고 분류별
 * 합계도 그대로다. 그런데 그 말이 "그냥 지워도 된다"는 뜻은 아니다. 몇 백 줄에 붙은
 * 이름을 한 번의 확인으로 없애면, 무엇이 사라졌는지 돌아볼 자리가 없다.
 *
 * 그래서 붙은 데가 있으면 길을 세 가지로 펼친다.
 *
 *   - **다른 태그로 옮기기**. 이름을 바꿔 부르기로 한 태그가 대개 여기다.
 *   - **거래내역 보기**. 줄마다 사정이 다를 때다. 태그는 그대로 두고 화면만 옮긴다.
 *   - **떼고 없애기**. 태그 자체를 그만 쓰기로 한 때다.
 *
 * 붙은 데가 없으면 이 창을 열지 않는다. 고를 것이 하나뿐인 물음은 물음이 아니다.
 */
import { useEffect, useState } from 'react';
import type { TagDto } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';

/** 고른 길. 창을 열 때는 아무것도 고르지 않은 채로 둔다. */
type Choice = 'move' | 'visit' | 'drop';

export default function TagDeleteModal({
  isOpen,
  onClose,
  tag,
  tags,
  usage,
  isSubmitting,
  onMove,
  onDrop,
  onVisit,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 없애려던 태그. 닫혀 있으면 null 이다. */
  tag: TagDto.Response | null;
  /** 이 가계부의 태그 전부. 옮길 곳을 여기서 고른다. */
  tags: TagDto.Response[];
  /** 붙어 있는 자리의 수. 서버에서 셈해 온다. */
  usage: TagDto.UsageResponse;
  isSubmitting: boolean;
  /** 고른 태그로 옮기고 없앤다. */
  onMove: (toId: string) => Promise<{ ok: boolean; message?: string }>;
  /** 붙은 자리에서 전부 떼고 없앤다. */
  onDrop: () => Promise<{ ok: boolean; message?: string }>;
  /**
   * 이 태그가 붙은 거래내역으로 건너간다. 없애지 않는다.
   *
   * 없으면 그 길을 아예 그리지 않는다 -- 갈 데가 없는 선택지를 보여 주면 눌러 보고
   * 아무 일도 일어나지 않는다.
   */
  onVisit?: () => void;
}) {
  const { t } = useTranslation();

  const [choice, setChoice] = useState<Choice | null>(null);
  const [toId, setToId] = useState('');
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 고르다 만 것이 남으면 엉뚱한 데로 옮긴다.
  useEffect(() => {
    if (!isOpen) return;
    setChoice(null);
    setToId('');
    setError('');
  }, [isOpen, tag?.id]);

  if (!tag) return null;

  /** 옮길 수 있는 곳. 자기 자신만 뺀다. */
  const targets = tags.filter((row) => row.id !== tag.id);

  const submit = async () => {
    if (choice === 'visit') {
      onVisit?.();
      return;
    }

    if (choice === 'move') {
      if (!toId) {
        setError(t('tags.deletePick'));
        return;
      }
      const result = await onMove(toId);
      if (result.ok) onClose();
      else setError(result.message ?? t('tags.mergeFailed'));
      return;
    }

    if (choice === 'drop') {
      const result = await onDrop();
      if (result.ok) onClose();
      else setError(result.message ?? t('tags.deleteFailed'));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tags.deleteTitle')}
      footer={
        <button
          type="button"
          onClick={() => void submit()}
          /* 고르기 전에는 누를 것이 없다. 무엇이 일어날지 모르는 채로 눌리면 안 된다. */
          disabled={isSubmitting || choice === null}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isSubmitting ? 'common.saving' : 'common.confirm')}
        </button>
      }
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <div className="space-y-1">
          <p className="text-sm text-gray-900">
            {t('tags.deleteUsage', { name: tag.name, count: usage.entries })}
          </p>
          {/* 거래 말고도 붙은 데가 있으면 함께 적는다. 옮기기와 떼기가 그것까지 건드린다. */}
          {usage.drafts + usage.rules > 0 ? (
            <p className="text-sm text-gray-500">
              {t('tags.deleteUsageAlso', { drafts: usage.drafts, rules: usage.rules })}
            </p>
          ) : null}
        </div>

        <p className="text-sm font-medium text-gray-700">{t('tags.deleteChoice')}</p>

        <div className="space-y-2">
          <ChoiceRow
            label={t('tags.deleteMove')}
            body={t('tags.deleteMoveBody')}
            selected={choice === 'move'}
            onSelect={() => setChoice('move')}
          >
            {/*
              고른 뒤에만 펼친다. 늘 펼쳐 두면 고르지도 않은 길의 선택상자가 창을
              차지하고, 무엇을 고르는 중인지 흐려진다.
            */}
            {choice === 'move' ? (
              targets.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t('tags.deleteNoTarget')}</p>
              ) : (
                <select
                  value={toId}
                  onChange={(event) => setToId(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900"
                >
                  <option value="">{t('tags.deletePick')}</option>
                  {targets.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              )
            ) : null}
          </ChoiceRow>

          {onVisit ? (
            <ChoiceRow
              label={t('tags.deleteVisit')}
              body={t('tags.deleteVisitBody')}
              selected={choice === 'visit'}
              onSelect={() => setChoice('visit')}
            />
          ) : null}

          <ChoiceRow
            label={t('tags.deleteDrop')}
            body={t('tags.deleteDropBody')}
            selected={choice === 'drop'}
            onSelect={() => setChoice('drop')}
          />
        </div>
      </div>
    </Modal>
  );
}

/** 길 하나. 고른 것은 파란 테두리로 둘러 어느 것을 골랐는지 한눈에 보인다. */
function ChoiceRow({
  label,
  body,
  selected,
  onSelect,
  children,
}: {
  label: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 transition ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="mt-0.5 block text-xs text-gray-600">{body}</span>
      </button>
      {children}
    </div>
  );
}
