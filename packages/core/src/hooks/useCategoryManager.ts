import { useCallback, useEffect, useState } from 'react';
import { rankForStep, type CategoryDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { apiErrorCode, useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import type { Category } from '../lib/types';
import { useLocaleStore } from '../store/locale';
import { useMirrorVersion } from './useMirrorVersion';
import { homeDataPort } from '../data/home-port';
import { settingsWritePort } from '../data/settings-write-port';

/** 소분류 입력 한 줄. id 가 없으면 아직 저장되지 않은 새 줄이다. */
export interface SubCategoryRow {
  id: string;
  name: string;
}

/** 카테고리 폼이 담는 값. 대분류 하나와 그 아래 소분류 줄들이다. */
export interface CategoryFormValues {
  name: string;
  type: 'income' | 'expense';
  subCategories: SubCategoryRow[];
}

/**
 * 소분류는 빈 줄 없이 시작한다.
 *
 * 빈 줄 하나를 미리 넣어 두면 소분류가 필요 없는데도 항상 빈 입력칸이 보인다.
 */
export const NO_SUB_CATEGORIES: SubCategoryRow[] = [];

/** 이름이 남아 있는 줄만. 빈 줄은 늘렸다가 채우지 않은 것이므로 버린다. */
export function filledSubCategories(rows: SubCategoryRow[]): SubCategoryRow[] {
  return rows.filter((row) => row.name.trim());
}

/** 저장·삭제의 결과. 실패하면 화면에 그대로 적을 문장이 함께 온다. */
export type CategoryResult = { ok: true } | { ok: false; message: string };

/**
 * 카테고리 목록과 그 손질.
 *
 * 웹의 카테고리 화면과 앱이 같은 규칙으로 만들고 고치고 지운다. 소분류를 함께
 * 저장하는 절차(사라진 것 삭제, 바뀐 것 수정, 새 것 생성)가 화면마다 다르면
 * 한쪽에서만 소분류가 남는 식으로 어긋난다.
 */
export function useCategoryManager(projectId: string | null) {
  const { messageOf } = useApiError();
  const locale = useLocaleStore((state) => state.locale);
  const say = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values),
    [locale],
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * 사본이 채워질 때마다 올라간다.
   *
   * 앱은 사본을 읽고 동기화가 뒤에서 그것을 채운다. 이 값을 의존성에 넣지 않으면 처음
   * 열었을 때 빈 사본을 읽은 화면이 그대로 멈춘다. 웹에서는 0에 머문다.
   */
  const mirrorVersion = useMirrorVersion();

  const reload = useCallback(async (): Promise<CategoryResult> => {
    if (!projectId) return { ok: true };

    try {
      setIsLoading(true);
      setCategories(((await homeDataPort().getCategories(projectId)) ?? []) as Category[]);
      return { ok: true };
    } catch (error) {
      console.error('카테고리 조회 실패:', error);
      return { ok: false, message: say('categories.loadFailed') };
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, say, mirrorVersion]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * 대분류 하나와 그 소분류를 저장한다. `editingId` 가 있으면 고치기다.
   *
   * 고칠 때는 세 가지를 함께 맞춘다. 목록에서 빠진 소분류는 지우고(기본 제공은
   * 그대로 둔다), 이름이 바뀐 줄은 고치고, id 가 없는 줄은
   * 새로 만든다.
   */
  const save = useCallback(
    async (editingId: string | null, values: CategoryFormValues): Promise<CategoryResult> => {
      if (!values.name.trim()) {
        return { ok: false, message: say('categories.nameRequired') };
      }

      const subs = filledSubCategories(values.subCategories);

      try {
        setIsSubmitting(true);

        if (editingId) {
          await settingsWritePort().updateCategory(editingId, { name: values.name });

          const existing = categories.filter((category) => category.parentId === editingId);

          for (const sub of existing) {
            if (subs.some((row) => row.id === sub.id) || sub.isDefault) continue;

            try {
              await settingsWritePort().updateCategory(sub.id, { isActive: false });
            } catch (error) {
              // 서버가 붙인 코드로 가른다. 오류 문장을 뒤지면 언어가 바뀔 때 깨진다.
              if (apiErrorCode(error) === 'CATEGORY_IN_USE') {
                return {
                  ok: false,
                  message: say('categories.subInUse', { name: sub.name }),
                };
              }
              throw error;
            }
          }

          for (const sub of subs) {
            if (!sub.id) {
              await settingsWritePort().addCategory({
                name: sub.name,
                type: values.type,
                parentId: editingId,
                projectId: projectId ?? undefined,
              });
              continue;
            }

            const before = existing.find((row) => row.id === sub.id);
            if (before && before.name !== sub.name) {
              await settingsWritePort().updateCategory(sub.id, { name: sub.name });
            }
          }
        } else {
          const created = await settingsWritePort().addCategory({
            name: values.name,
            type: values.type,
            projectId: projectId ?? undefined,
          });

          for (const sub of subs) {
            await settingsWritePort().addCategory({
              name: sub.name,
              type: values.type,
              parentId: created.id,
              projectId: projectId ?? undefined,
            });
          }
        }

        await reload();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: messageOf(error, editingId ? 'categories.editFailed' : 'categories.addFailed'),
        };
      } finally {
        setIsSubmitting(false);
      }
    },
    [categories, messageOf, projectId, reload, say],
  );

  /** 기본 제공 분류는 지울 수 없다. 서버도 같은 규칙으로 막는다. */
  const remove = useCallback(
    async (id: string): Promise<CategoryResult> => {
      const category = categories.find((row) => row.id === id);
      if (category?.isDefault) {
        return { ok: false, message: say('categories.deleteDefault') };
      }

      try {
        setIsSubmitting(true);
        await settingsWritePort().updateCategory(id, { isActive: false });
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'categories.deleteFailed') };
      } finally {
        setIsSubmitting(false);
      }
    },
    [categories, messageOf, reload, say],
  );

  /** 드래그로 바꾼 순서를 저장한다. 실패하면 목록을 다시 받아 원래 순서로 되돌린다. */
  const reorder = useCallback(
    async (ids: string[]): Promise<CategoryResult> => {
      try {
        setCategories((await apiClient.reorderCategories(ids, projectId)) as Category[]);
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
   * 옮긴 자리의 값 하나만 보낸다 (분수 색인). `reorder` 와 갈라 두는 이유가 여기 있다 --
   * 그쪽은 목록 전체를 다시 매기므로, 그 사이 남이 옮긴 것이 통째로 지워진다 (D5).
   *
   * 이웃은 **화면에 보이는 묶음 안에서** 고른다. 소분류는 같은 부모 아래에서, 대분류는
   * 같은 유형(지출·수입)의 단 안에서다. 대분류의 순서 값은 지출과 수입이 한 공간을
   * 쓰지만, 두 단이 따로 그려지므로 한쪽 안의 앞뒤만 맞으면 된다.
   */
  const move = useCallback(
    async (id: string, step: 1 | -1): Promise<CategoryResult> => {
      const category = categories.find((row) => row.id === id);
      if (!category) return { ok: true };

      const siblings = category.parentId
        ? categories.filter((row) => row.parentId === category.parentId)
        : categories.filter((row) => !row.parentId && row.type === category.type);

      const rank = rankForStep(siblings, id, step);
      // 끝에서 더 밀었다. 값을 새로 찍으면 그 필드의 시계만 올라가 남의 이동을 되돌린다.
      if (!rank) return { ok: true };

      try {
        await settingsWritePort().updateCategory(id, { sortRank: rank });
        await reload();
        return { ok: true };
      } catch (error) {
        await reload();
        return { ok: false, message: messageOf(error, 'assets.orderSaveFailed') };
      }
    },
    [categories, messageOf, reload],
  );

  /** 고칠 대상을 폼 값으로 편다. 소분류는 그 아래 줄들을 그대로 가져온다. */
  const formValuesOf = useCallback(
    (category: Category): CategoryFormValues => ({
      name: category.name,
      type: category.type,
      subCategories: category.parentId
        ? NO_SUB_CATEGORIES
        : categories
            .filter((row) => row.parentId === category.id)
            .map((row) => ({ id: row.id, name: row.name })),
    }),
    [categories],
  );

  return {
    categories,
    isLoading,
    isSubmitting,
    reload,
    save,
    remove,
    reorder,
    /** 한 칸 위로(-1) 또는 아래로(+1). 같은 묶음 안에서만 움직인다. */
    move,
    formValuesOf,
    /** 대분류만. 목록의 윗줄이다. */
    parentsOf: useCallback(
      (type: 'income' | 'expense') =>
        categories.filter((category) => !category.parentId && category.type === type),
      [categories],
    ),
    childrenOf: useCallback(
      (parentId: string) => categories.filter((category) => category.parentId === parentId),
      [categories],
    ),
  };
}

export type CategoryManager = ReturnType<typeof useCategoryManager>;
export type { CategoryDto };
