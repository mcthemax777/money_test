'use client';

/*
 * 태그를 여럿 고르는 알약 줄과, 나누지 않은 거래의 태그 칸.
 *
 * 알약 줄은 두 자리가 쓴다. 나누지 않은 거래의 태그 칸(보통 크기)과, 나눈 줄마다의
 * 태그(한 단 작은 크기)다. 뒤집는 일은 부르는 쪽이 앞선 값에서 한다 (`onToggle`).
 */
import { useTranslation } from '@money/core/lib/i18n';

interface PillTag {
  id: string;
  name: string;
  color?: string | null;
}

const SIZE_CLASS = {
  md: { row: 'flex flex-wrap gap-2', gap: 'gap-1.5', box: 'px-3 py-1.5 text-sm' },
  sm: { row: 'flex flex-wrap gap-1.5', gap: 'gap-1', box: 'px-2.5 py-1 text-xs' },
} as const;

export function TagPillButtons({
  tags,
  selectedIds,
  onToggle,
  size,
}: {
  tags: PillTag[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  size: keyof typeof SIZE_CLASS;
}) {
  return (
    <div className={SIZE_CLASS[size].row}>
      {tags.map((tag) => {
        const isSelected = selectedIds.includes(tag.id);

        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(tag.id)}
            /* 눌린 것이 살짝 커졌다 돌아온다. 색만으로는 방금 무엇이 바뀌었는지 잘 안 보인다. */
            className={`flex items-center ${SIZE_CLASS[size].gap} rounded-full border ${SIZE_CLASS[size].box} transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${
              isSelected
                ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tag.color && (
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
            )}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}

/** 목록에서 하나를 뒤집는다. 있으면 빼고 없으면 더한다. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/**
 * 나누지 않은 거래의 태그 칸. 갈래를 가리지 않으므로 이체에도 뜬다.
 *
 * 카테고리와 달리 **여럿을 고른다.** 그래서 select 가 아니라 알약 줄이다 --
 * 여러 개 고르는 select 는 무엇이 골라졌는지 열어 봐야 알 수 있다.
 *
 * 태그가 하나도 없어도 이 자리는 선다. 만드는 길이 여기뿐이라, 비었다고
 * 접으면 첫 태그를 만들 곳이 없다.
 */
export function EntryTagField({
  tags,
  selectedIds,
  onToggle,
  onAddClick,
}: {
  tags: PillTag[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  onAddClick: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="block text-sm font-medium text-gray-700">{t('editor.tagsOptional')}</span>
        <button
          type="button"
          onClick={onAddClick}
          aria-label={t('tags.add')}
          className="rounded px-2 py-0.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
        >
          + {t('common.add')}
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="text-sm text-gray-500">{t('tags.empty')}</p>
      ) : (
        <TagPillButtons tags={tags} selectedIds={selectedIds} onToggle={onToggle} size="md" />
      )}
      {tags.length > 0 ? <p className="mt-1 text-xs text-gray-500">{t('tags.pickHint')}</p> : null}
    </div>
  );
}
