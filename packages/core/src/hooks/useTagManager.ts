/**
 * 태그 목록과 그 손질.
 *
 * `useCategoryManager` 와 나란히 서지만 훨씬 짧다 -- 계층이 없어 "대분류를 고치면서
 * 소분류를 함께 맞추는" 절차가 없고, 유형도 없어 목록이 하나뿐이다.
 *
 * **읽기는 `homeDataPort`, 쓰기는 `settingsWritePort` 를 거친다.**
 *
 * 둘이 같은 자리를 보아야 한다는 것이 요점이다. 예전에는 읽기만 사본이고 쓰기는 서버였던
 * 적이 있는데, 그때는 방금 만든 태그가 목록에 나타나지 않았다 -- 사본은 다음 동기화가
 * 와야 채워지기 때문이다. 이제 앱에서는 둘 다 사본이라 만들자마자 보이고, 웹에서는 둘 다
 * 서버라 지금까지와 같다.
 */
import { useCallback, useEffect, useState } from 'react';
import { rankForStep, type TagDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import { isOfflineError } from '../lib/offline-error';
import { useLocaleStore } from '../store/locale';
import { useMirrorVersion } from './useMirrorVersion';
import { homeDataPort } from '../data/home-port';
import { settingsWritePort } from '../data/settings-write-port';

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
  /**
   * 사본이 채워질 때마다 올라간다.
   *
   * 앱은 사본을 읽고 동기화가 뒤에서 그것을 채운다. 이 값을 의존성에 넣지 않으면 처음
   * 열었을 때 빈 사본을 읽은 화면이 그대로 멈춘다. 웹에서는 0에 머문다.
   */
  const mirrorVersion = useMirrorVersion();

  const reload = useCallback(async (): Promise<TagResult> => {
    if (!projectId) {
      setTags([]);
      setIsLoading(false);
      return { ok: true };
    }

    try {
      setIsLoading(true);
      setTags((await homeDataPort().getTags(projectId)) ?? []);
      return { ok: true };
    } catch (error) {
      // 사본이 아직 비었거나 서버를 못 부른 경우다. 빈 목록으로 두고 다음 동기화를 기다린다.
      if (isOfflineError(error)) return { ok: true };
      return { ok: false, message: say('tags.loadFailed') };
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, say, mirrorVersion]);

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
          await settingsWritePort().updateTag(editingId, { name, color: values.color || null });
        } else {
          await settingsWritePort().addTag({
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
        await settingsWritePort().updateTag(id, { isActive: false });
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

  /**
   * 목록에서 한 칸 옮긴다. 드래그가 없는 화면(앱)이 쓴다.
   *
   * 옮긴 자리의 값 하나만 보낸다 (분수 색인). `reorder` 와 달리 목록 전체를 다시 매기지
   * 않으므로, 그 사이 남이 옮긴 태그가 지워지지 않는다 (D5). 태그는 계층이 없어 이웃은
   * 언제나 목록 전체에서 고른다.
   */
  const move = useCallback(
    async (id: string, step: 1 | -1): Promise<TagResult> => {
      const rank = rankForStep(tags, id, step);
      // 끝에서 더 밀었다. 값을 새로 찍으면 그 필드의 시계만 올라가 남의 이동을 되돌린다.
      if (!rank) return { ok: true };

      try {
        await settingsWritePort().updateTag(id, { sortRank: rank });
        await reload();
        return { ok: true };
      } catch (error) {
        await reload();
        return { ok: false, message: messageOf(error, 'assets.orderSaveFailed') };
      }
    },
    [messageOf, reload, tags],
  );

  return {
    tags,
    isLoading,
    isSubmitting,
    reload,
    save,
    remove,
    reorder,
    /** 한 칸 위로(-1) 또는 아래로(+1). */
    move,
    /** 고칠 대상을 폼 값으로 편다. */
    formValuesOf: useCallback(
      (tag: TagDto.Response): TagFormValues => ({ name: tag.name, color: tag.color ?? '' }),
      [],
    ),
  };
}

export type TagManager = ReturnType<typeof useTagManager>;
