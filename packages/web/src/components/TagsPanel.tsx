'use client';

/*
 * 태그를 만들고 고치고 지우는 자리.
 *
 * 카테고리 화면 안의 한 탭으로 산다. 둘 다 "거래를 무엇으로 묶어 보나"를 정하는 일이고,
 * 태그는 계층이 없어 화면 하나를 따로 둘 만큼 크지 않다.
 *
 * 카테고리와 달리 **지우기를 막지 않는다.** 태그를 떼어 내도 거래는 온전하고 분류별
 * 합계도 그대로다. 막아 두면 오래된 태그를 영영 정리하지 못한다.
 */
import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import type { TagDto } from '@money/types';

import { EMPTY_TAG_FORM, useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { useTranslation } from '@money/core/lib/i18n';
import { useCanEdit } from '@money/core/store/project';

import Modal from '@/components/Modal';
import AddButton from '@/components/AddButton';
import { useDragReorder } from '@/hooks/useDragReorder';
import { TagFields } from '@/components/TagFields';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const FORM_ID = 'tag-form';

export default function TagsPanel({
  projectId,
  onShowEntries,
  reopenTagId,
  onReopened,
}: {
  projectId: string | null;
  /**
   * 이 태그가 붙은 거래내역을 보여 달라고 할 때. 없으면 그 단추를 그리지 않는다.
   *
   * 펼치는 일은 이 판이 하지 않는다. 태그 판은 분류 화면 안의 한 탭이라, 거래내역을
   * 여기서 그리면 탭 안에 화면이 또 생긴다 -- 바깥 화면이 제 자리를 통째로 바꾸는
   * 쪽이 맞다.
   */
  onShowEntries?: (tag: TagDto.Response) => void;
  /** 거래내역에서 돌아왔을 때 다시 펼 태그. 목록에 그 태그가 있으면 고치는 창이 열린다. */
  reopenTagId?: string | null;
  /** 그 창을 펴고 나면 알린다. 부르는 쪽이 표시를 지운다. */
  onReopened?: () => void;
}) {
  const { t } = useTranslation();
  /** 읽기 전용 구성원에게는 쓰기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const manager = useTagManager(projectId);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<TagFormValues>(EMPTY_TAG_FORM);
  const [error, setError] = useState('');

  /*
   * 끌어서 자리를 바꾼다. 분류·자산 목록과 같은 훅이다.
   *
   * 앱은 옮긴 줄의 값 하나만 보내지만(사본 창구를 타야 해서), 웹은 다른 목록들과 같이
   * 목록 전체를 보내는 엔드포인트를 쓴다. 한 화면 안에서 방식이 갈리면 같은 드래그가
   * 목록마다 다르게 저장된다.
   */
  const handleReorder = async (ids: string[]) => {
    const result = await manager.reorder(ids);
    setError(result.ok ? '' : result.message);
  };

  const { items, dragProps, draggingId } = useDragReorder(manager.tags, (ids) => {
    void handleReorder(ids);
  });

  const openNew = () => {
    setEditingId(null);
    setValues(EMPTY_TAG_FORM);
    setError('');
    setIsFormOpen(true);
  };

  const openEdit = (tag: TagDto.Response) => {
    setEditingId(tag.id);
    setValues(manager.formValuesOf(tag));
    setError('');
    setIsFormOpen(true);
  };

  /*
   * 거래내역에서 ←로 돌아왔을 때 떠나온 태그 창을 다시 편다.
   *
   * 목록이 도착해야 그 태그를 찾을 수 있으므로 올 때까지 기다린다. 지운 태그로
   * 돌아오는 일도 있어(다른 기기에서 지웠다) 못 찾으면 아무것도 하지 않는다.
   */
  useEffect(() => {
    if (!reopenTagId) return;

    const tag = manager.tags.find((item) => item.id === reopenTagId);
    if (!tag) return;

    openEdit(tag);
    onReopened?.();
    // openEdit 은 렌더마다 새로 만들어지는 함수라 의존성에 넣지 않는다. 여는 일은
    // 표시와 목록이 갖춰졌을 때 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopenTagId, manager.tags, onReopened]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const result = await manager.save(editingId, values);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setIsFormOpen(false);
  };

  const remove = async (tag: TagDto.Response) => {
    if (!window.confirm(t('tags.deleteConfirm', { name: tag.name }))) return;

    const result = await manager.remove(tag.id);
    setError(result.ok ? '' : result.message);
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {/* 추가 버튼은 목록 바로 위다 (자산·분류 화면과 같은 규칙). */}
      <AddButton label={t('tags.add')} onClick={openNew} />

      {manager.isLoading && manager.tags.length === 0 ? (
        <p className="text-gray-600">{t('common.loading')}</p>
      ) : manager.tags.length === 0 ? (
        <p className="text-gray-600">{t('tags.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((tag) => (
            <li
              key={tag.id}
              {...dragProps(tag.id)}
              /* 새 줄이 옅은 데서 떠오른다. 목록이 늘어난 자리가 눈에 남는다. */
              className={`unfold flex items-center gap-3 rounded-lg bg-white p-4 shadow-sm ${
                draggingId === tag.id ? 'opacity-50' : ''
              }`}
            >
              {/* 색을 정한 태그는 점으로 보인다. 이름만으로는 목록에서 찾기 어렵다. */}
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${tag.color ? '' : 'border border-gray-300'}`}
                style={tag.color ? { backgroundColor: tag.color } : undefined}
              />
              {/*
                읽기 전용 구성원에게는 고치기와 지우기가 없다. 이름은 그대로 읽히도록
                단추 대신 글자로 그린다.
              */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => openEdit(tag)}
                  className="min-w-0 flex-1 truncate text-left font-medium text-gray-900 hover:text-blue-600"
                >
                  {tag.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                  {tag.name}
                </span>
              )}
              <button
                type="button"
                hidden={!canEdit}
                onClick={() => remove(tag)}
                aria-label={t('entryForm.delete')}
                className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t(editingId ? 'tags.edit' : 'tags.add')}
        /*
          이 태그가 붙은 거래내역으로 건너간다. 새로 만드는 중에는 볼 것이 없으므로
          고치는 창에만 선다.
        */
        headerAction={
          editingId && onShowEntries ? (
            <button
              type="button"
              onClick={() => {
                const tag = manager.tags.find((item) => item.id === editingId);
                if (!tag) return;
                setIsFormOpen(false);
                onShowEntries(tag);
              }}
              aria-label={t('tags.viewEntries')}
              title={t('tags.viewEntries')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-900 transition-colors hover:bg-gray-100"
            >
              <Receipt className="h-4 w-4" aria-hidden />
            </button>
          ) : null
        }
        footer={
          <button
            type="submit"
            form={FORM_ID}
            disabled={manager.isSubmitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {t(manager.isSubmitting ? 'common.saving' : 'common.save')}
          </button>
        }
      >
        <form id={FORM_ID} onSubmit={submit} className="space-y-5">
          <TagFields values={values} onChange={setValues} />
        </form>
      </Modal>
    </div>
  );
}
