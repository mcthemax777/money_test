'use client';

/*
 * 고른 거래에 붙일 태그를 정하는 창.
 *
 * **더하기만 한다.**
 *
 * 고른 거래가 **모두** 가진 태그는 체크된 채로, 풀 수 없게 보인다. 이미 붙어 있다는
 * 사실을 알려 주는 것이고, 풀 수 없는 것은 이 창이 더하기만 하기 때문이다 -- 풀리게
 * 두면 풀고 확인했을 때 떨어질 것으로 읽히는데 그런 일은 없다.
 *
 * 일부만 가진 태그는 체크하지 않는다. 체크로 보이면 "이미 다 붙어 있다"로 읽히는데,
 * 그 상태에서 확인을 눌러도 나머지에는 붙지 않아 말과 결과가 어긋난다.
 *
 * 켜고 끈 것(`changed`)은 부르는 쪽이 든다. 열 때마다 비워야 해서다.
 */
import { useTranslation } from '@money/core/lib/i18n';
import { tagPickResult, tagPickState, toggleTagPick } from '@money/core/lib/tag-pick';
import Modal from '@/components/Modal';
import { Chip } from '@/components/TransactionSearchModal';

export default function TagPickModal({
  isOpen,
  onClose,
  tags,
  changed,
  onChangedChange,
  commonTagIds,
  partialTagIds,
  selectedCount,
  installmentCount,
  isTagging,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  /**
   * 사용자가 켜고 끈 것. 여기 없는 태그는 처음 상태 그대로다.
   *
   * 켠 것과 끈 것을 함께 담아야 "처음부터 꺼져 있던 것"과 "켜져 있던 것을 껐다"를
   * 가를 수 있다. 앞은 손대지 않고 뒤는 뗀다.
   */
  changed: Record<string, boolean>;
  onChangedChange: (next: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  commonTagIds: string[];
  partialTagIds: string[];
  selectedCount: number;
  /** 고른 것 중 할부 회차의 수. */
  installmentCount: number;
  isTagging: boolean;
  /** 처음 상태에서 달라진 것만 넘긴다. */
  onApply: (addTagIds: string[], removeTagIds: string[]) => void;
}) {
  const { t } = useTranslation();

  /** 알약 하나가 놓인 자리. 손대지 않았으면 처음 상태 그대로다 (규칙은 core 의 tag-pick). */
  const tagStateOf = (tagId: string) => tagPickState(tagId, changed, commonTagIds, partialTagIds);

  /** 처음 상태에서 달라진 것만 보낸다. 손대지 않은 태그는 그대로 둔다. */
  const { addTagIds, removeTagIds } = tagPickResult(
    tags.map((tag) => tag.id),
    changed,
    commonTagIds,
  );
  const hasTagChange = addTagIds.length > 0 || removeTagIds.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tx.tagSelected')}
      footer={
        <button
          type="button"
          disabled={!hasTagChange || isTagging}
          onClick={() => onApply(addTagIds, removeTagIds)}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isTagging ? 'common.saving' : 'common.confirm')}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('tx.tagTargets', { count: selectedCount })}</p>
        {/* 회차 하나를 골라도 태그는 원거래에 붙는다. 함께 켜진 까닭을 적는다. */}
        {installmentCount > 0 ? (
          <p className="text-xs text-amber-700">{t('tx.tagInstallmentNote', { count: installmentCount })}</p>
        ) : null}

        {tags.length === 0 ? (
          <p className="text-sm text-gray-500">{t('tags.empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const state = tagStateOf(tag.id);

              return (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  color={tag.color}
                  selected={state === 'on'}
                  partial={state === 'partial'}
                  mark
                  /* 누르면 켜지고 꺼진다. "일부"는 켜짐과 일부 사이만 오간다 (tag-pick). */
                  onClick={() =>
                    onChangedChange((prev) => toggleTagPick(tag.id, prev, commonTagIds, partialTagIds))
                  }
                />
              );
            })}
          </div>
        )}

        {/*
          무엇이 벌어지는지 글자로 못 박는다. 여러 건을 한꺼번에 다루는 자리라, 이미
          붙어 있던 것이 사라질지 모른다는 걱정이 실제로 생긴다.
        */}
        <p className="text-xs leading-5 text-gray-500">{t('tx.tagHowTo')}</p>
        {partialTagIds.length > 0 ? (
          <p className="text-xs leading-5 text-gray-500">{t('tx.tagPartialHint')}</p>
        ) : null}
      </div>
    </Modal>
  );
}
