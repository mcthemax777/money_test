'use client';

/*
 * 거래 폼 안에서 분류를 바로 만드는 팝업.
 *
 * 대분류 추가와 "이 대분류에 소분류 추가"를 한 팝업으로 처리한다. 소분류는 반드시 대분류
 * 밑에 붙으므로 "어느 대분류인가"만 다르고 받을 값(이름 목록)은 같다.
 *
 * 폼 상태와 저장은 `useCategoryAdd` 가 갖고, 팝업은 그것을 그린다. 거래 폼이 칸마다
 * "이 대분류로 열기"를 불러야 해서 여는 손잡이를 부르는 쪽에 둔다.
 */
import { useState } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import { useApiError } from '@money/core/lib/api-error';
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import CategoryFormFields, {
  NO_SUB_CATEGORIES,
  filledSubCategories,
  type SubCategoryRow,
} from '@/components/CategoryFormFields';
import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const CATEGORY_FORM_ID = 'category-form';

export function useCategoryAdd({
  projectId,
  categories,
  onCategoriesChange,
  onSubCreated,
}: {
  projectId: string | null;
  categories: Category[];
  onCategoriesChange: (categories: Category[]) => void;
  /** 소분류 하나를 만들었을 때. 거래 폼이 그것을 바로 고른다. */
  onSubCreated: (parentId: string, subId: string) => void;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    subCategories: NO_SUB_CATEGORIES as SubCategoryRow[],
  });
  /** 카테고리 추가가 실패한 이유. 예전에는 콘솔에만 남아 사용자는 아무 반응을 못 봤다. */
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 소분류를 붙일 대분류 id. 비어 있으면 대분류를 새로 만드는 모드다. */
  const [parentId, setParentId] = useState('');
  /** 소분류 모드일 때의 대분류. 없으면 대분류를 새로 만드는 모드다. */
  const parent = categories.find((c) => c.id === parentId);

  /** 팝업을 닫고 폼을 비운다. 다음에 열 때 지난 입력이 남아 있으면 안 된다. */
  const close = () => {
    setIsOpen(false);
    setParentId('');
    setFormData({ name: '', type: 'expense', subCategories: NO_SUB_CATEGORIES });
    setError('');
  };

  /** 팝업 열기. parentId를 주면 그 대분류에 소분류만 붙이는 모드다. */
  const open = (nextParentId = '') => {
    setParentId(nextParentId);
    setFormData({
      name: '',
      type: 'expense',
      // 소분류를 붙이러 열었으면 첫 줄을 미리 준다. 그 줄이 이 팝업의 본론이다.
      subCategories: nextParentId ? [{ id: '', name: '' }] : NO_SUB_CATEGORIES,
    });
    setError('');
    setIsOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const subs = filledSubCategories(formData.subCategories);
    // 소분류 모드에서는 이름이 하나라도 있어야 만들 것이 있다.
    if (parent && subs.length === 0) {
      setError(t('editor.subNameRequired'));
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // 소분류 모드: 고른 대분류 밑에만 붙인다. 유형은 대분류를 따라간다.
      // 대분류 모드: 대분류를 먼저 만들고 그 id로 소분류를 붙인다.
      const target = parent
        ? parent
        : await apiClient.createCategory({
            name: formData.name,
            type: formData.type,
            projectId: projectId ?? undefined,
          });

      /*
       * 소분류가 실패하면 다시 시도할 수 있게 창을 "만든 대분류에 소분류 붙이기"로 바꾼다 (2026-10-21). 예전에는
       * 대분류만 만들어진 채 같은 창이 남아, 다시 누르면 대분류를 또 만들려다 이름이 겹쳐 영영 실패했다.
       * 이미 만든 소분류는 건너뛴다 -- 같은 이름을 다시 만들면 또 겹친다.
       */
      const existingSubs = new Set(
        categories.filter((category) => category.parentId === target.id).map((category) => category.name),
      );
      const created: Category[] = [];
      try {
        for (const sub of subs) {
          if (existingSubs.has(sub.name.trim())) continue;
          created.push(
            await apiClient.createCategory({
              name: sub.name.trim(),
              type: target.type,
              parentId: target.id,
              projectId: projectId ?? undefined,
            }),
          );
        }
      } catch (subError) {
        if (!parent) {
          const data = await apiClient.getCategories(projectId).catch(() => null);
          if (data) onCategoriesChange(data);
          setParentId(target.id);
        }
        throw subError;
      }

      // 고른 가계부를 늘 싣는다. 빠지면 서버가 그 사람의 기본 가계부로 만들고 읽는다 -- 화면이
      // 보고 있는 가계부와 다를 수 있다 (초대를 받아 옮겨 왔거나 다른 탭에서 바꿨을 때).
      const data = await apiClient.getCategories(projectId);
      onCategoriesChange(data || []);

      /*
       * 방금 만든 소분류를 거래 폼에 바로 꽂아 준다.
       *
       * 소분류를 추가하러 팝업을 연 이유는 그 소분류로 거래를 적으려는 것이다.
       * 목록만 갱신하고 두면 사용자가 드롭다운을 다시 열어 같은 값을 또 골라야 한다.
       * 여러 개를 넣었으면 무엇을 고를지 알 수 없으므로 하나일 때만 고른다.
       */
      if (parent && created.length === 1) onSubCreated(parent.id, created[0].id);

      close();
    } catch (err: any) {
      setError(messageOf(err, 'categories.addFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return { isOpen, open, close, submit, parent, formData, setFormData, error, submitting };
}

export default function CategoryAddModal({ form }: { form: ReturnType<typeof useCategoryAdd> }) {
  const { t } = useTranslation();
  const { isOpen, close, submit, parent, formData, setFormData, error, submitting } = form;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={parent ? t('editor.subCategoryAddTitle', { parent: parent.name }) : t('editor.categoryAddTitle')}
      footer={
        <button
          type="submit"
          form={CATEGORY_FORM_ID}
          /* 소분류 모드에는 이름 칸이 없다. 그때는 소분류 줄이 채워졌는지 본다. */
          disabled={
            submitting ||
            (parent
              ? filledSubCategories(formData.subCategories).length === 0
              : !formData.name.trim())
          }
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? t('account.adding') : t('account.addSubmit')}
        </button>
      }
    >
      <form id={CATEGORY_FORM_ID} onSubmit={submit} className="space-y-4">
        <CategoryFormFields
          name={formData.name}
          onNameChange={(name) => setFormData({ ...formData, name })}
          type={formData.type}
          onTypeChange={(type) => setFormData({ ...formData, type })}
          subCategories={formData.subCategories}
          onSubCategoriesChange={(subCategories) => setFormData({ ...formData, subCategories })}
          parentName={parent?.name}
        />

        {error && <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>}
      </form>
    </Modal>
  );
}
