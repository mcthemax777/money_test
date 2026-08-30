import { useCallback, useEffect, useState } from 'react';
import type { CategoryDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { apiErrorCode, useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import type { Category } from '../lib/types';
import { useLocaleStore } from '../store/locale';

/** 소분류 입력 한 줄. id 가 없으면 아직 저장되지 않은 새 줄이다. */
export interface SubCategoryRow {
  id: string;
  name: string;
  defaultIsExtra: boolean;
}

/** 카테고리 폼이 담는 값. 대분류 하나와 그 아래 소분류 줄들이다. */
export interface CategoryFormValues {
  name: string;
  type: 'income' | 'expense';
  subCategories: SubCategoryRow[];
  defaultIsExtra: boolean;
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

  const reload = useCallback(async (): Promise<CategoryResult> => {
    if (!projectId) return { ok: true };

    try {
      setIsLoading(true);
      setCategories(((await apiClient.getCategories(projectId)) ?? []) as Category[]);
      return { ok: true };
    } catch (error) {
      console.error('카테고리 조회 실패:', error);
      return { ok: false, message: say('categories.loadFailed') };
    } finally {
      setIsLoading(false);
    }
  }, [projectId, say]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * 대분류 하나와 그 소분류를 저장한다. `editingId` 가 있으면 고치기다.
   *
   * 고칠 때는 세 가지를 함께 맞춘다. 목록에서 빠진 소분류는 지우고(기본 제공은
   * 그대로 둔다), 이름이나 과소비 기본값이 바뀐 줄은 고치고, id 가 없는 줄은
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
          await apiClient.updateCategory(editingId, {
            name: values.name,
            defaultIsExtra: values.defaultIsExtra,
          });

          const existing = categories.filter((category) => category.parentId === editingId);

          for (const sub of existing) {
            if (subs.some((row) => row.id === sub.id) || sub.isDefault) continue;

            try {
              await apiClient.deleteCategory(sub.id);
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
              await apiClient.createCategory({
                name: sub.name,
                type: values.type,
                parentId: editingId,
                defaultIsExtra: sub.defaultIsExtra,
                projectId: projectId ?? undefined,
              });
              continue;
            }

            const before = existing.find((row) => row.id === sub.id);
            if (before && (before.name !== sub.name || before.defaultIsExtra !== sub.defaultIsExtra)) {
              await apiClient.updateCategory(sub.id, {
                name: sub.name,
                defaultIsExtra: sub.defaultIsExtra,
              });
            }
          }
        } else {
          const created = await apiClient.createCategory({
            name: values.name,
            type: values.type,
            defaultIsExtra: values.defaultIsExtra,
            projectId: projectId ?? undefined,
          });

          for (const sub of subs) {
            await apiClient.createCategory({
              name: sub.name,
              type: values.type,
              parentId: created.id,
              defaultIsExtra: sub.defaultIsExtra,
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
        await apiClient.deleteCategory(id);
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

  /** 고칠 대상을 폼 값으로 편다. 소분류는 그 아래 줄들을 그대로 가져온다. */
  const formValuesOf = useCallback(
    (category: Category): CategoryFormValues => ({
      name: category.name,
      type: category.type,
      subCategories: category.parentId
        ? NO_SUB_CATEGORIES
        : categories
            .filter((row) => row.parentId === category.id)
            .map((row) => ({
              id: row.id,
              name: row.name,
              defaultIsExtra: row.defaultIsExtra || false,
            })),
      defaultIsExtra: category.defaultIsExtra || false,
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
