/**
 * 태그 목록과 그 손질.
 *
 * `useCategoryManager` 와 나란히 서지만 훨씬 짧다 -- 계층이 없어 "대분류를 고치면서
 * 소분류를 함께 맞추는" 절차가 없고, 유형도 없어 목록이 하나뿐이다.
 *
 * **읽기와 쓰기 모두 `apiClient` 를 직접 부른다** (`useCategoryManager` 와 같다).
 *
 * 사본(`homeDataPort`)으로 읽지 않는 이유가 있다. 쓰기는 서버로 나가는데 읽기가 사본이면,
 * 방금 만든 태그가 목록에 나타나지 않는다 -- 사본은 다음 동기화가 와야 채워진다.
 * 실제로 그랬다. 태그는 서버에 생겼는데 화면은 그대로였다.
 *
 * 그래서 이 화면은 온라인 전용이다. 만들고 고치는 일이 어차피 서버를 타므로 잃는 것이
 * 없다. **거래 입력 화면은 다르다** -- 그쪽은 `useEntryForm` 이 창구로 읽어(`port.getTags`)
 * 비행기 안에서도 이미 받아 둔 태그를 고를 수 있다.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TagDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import { isOfflineError } from '../lib/offline-error';
import { useLocaleStore } from '../store/locale';

/** 태그 폼이 담는 값. 이름과 색뿐이다. */
export interface TagFormValues {
  name: string;
  /** "#RRGGBB". 빈 문자열은 "색을 정하지 않았다"다. */
  color: string;
}

export const EMPTY_TAG_FORM: TagFormValues = { name: '', color: '' };

/** 저장·삭제의 결과. 실패하면 화면에 그대로 적을 문장이 함께 온다. */
export type TagResult = { ok: true } | { ok: false; message: string };

export function useTagManager(projectId: string | null) {
  const { messageOf } = useApiError();
  const locale = useLocaleStore((state) => state.locale);
  const say = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values),
    [locale],
  );

  const [tags, setTags] = useState<TagDto.Response[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = useCallback(async (): Promise<TagResult> => {
    if (!projectId) {
      setTags([]);
      setIsLoading(false);
      return { ok: true };
    }

    try {
      setIsLoading(true);
      setTags((await apiClient.getTags(projectId)) ?? []);
      return { ok: true };
    } catch (error) {
      // 오프라인이면 조용히 빈 목록으로 둔다. 이 화면은 온라인 전용이다(머리말).
      if (isOfflineError(error)) return { ok: true };
      return { ok: false, message: say('tags.loadFailed') };
    } finally {
      setIsLoading(false);
    }
  }, [projectId, say]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 태그 하나를 저장한다. `editingId` 가 있으면 고치기다. */
  const save = useCallback(
    async (editingId: string | null, values: TagFormValues): Promise<TagResult> => {
      const name = values.name.trim();
      if (!name) return { ok: false, message: say('tags.nameRequired') };

      try {
        setIsSubmitting(true);
        if (editingId) {
          // 색을 비운 것은 "지운다"다. 생략과 다르므로 null 을 실어 보낸다.
          await apiClient.updateTag(editingId, { name, color: values.color || null });
        } else {
          await apiClient.createTag({
            name,
            ...(values.color ? { color: values.color } : {}),
            projectId: projectId ?? undefined,
          });
        }
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'tags.saveFailed') };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, projectId, reload, say],
  );

  /**
   * 태그를 감춘다.
   *
   * 카테고리와 달리 거래에 쓰이고 있어도 막지 않는다. 태그를 떼어 내도 거래는 온전하고
   * 카테고리 합계도 그대로다. 지난 거래에 붙어 있던 이름은 목록에 그대로 남는다.
   */
  const remove = useCallback(
    async (id: string): Promise<TagResult> => {
      try {
        setIsSubmitting(true);
        await apiClient.deleteTag(id);
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'tags.deleteFailed') };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, reload],
  );

  /** 드래그로 바꾼 순서를 저장한다. 실패하면 목록을 다시 받아 원래 순서로 되돌린다. */
  const reorder = useCallback(
    async (ids: string[]): Promise<TagResult> => {
      try {
        setTags(await apiClient.reorderTags(ids, projectId));
        return { ok: true };
      } catch (error) {
        await reload();
        return { ok: false, message: messageOf(error, 'assets.orderSaveFailed') };
      }
    },
    [messageOf, projectId, reload],
  );

  return {
    tags,
    isLoading,
    isSubmitting,
    reload,
    save,
    remove,
    reorder,
    /** 고칠 대상을 폼 값으로 편다. */
    formValuesOf: useCallback(
      (tag: TagDto.Response): TagFormValues => ({ name: tag.name, color: tag.color ?? '' }),
      [],
    ),
  };
}

export type TagManager = ReturnType<typeof useTagManager>;
