'use client';

import type { SubCategoryRow } from '@money/core/hooks/useCategoryManager';

import CustomSelect from './CustomSelect';
import { useTranslation } from '@money/core/lib/i18n';

/*
 * 줄의 모양과 손질(빈 줄 버리기)은 저장하는 쪽인 core 에 있다. 이 파일을 거쳐
 * 가져다 쓰던 곳이 있어 이름은 여기서도 그대로 내보낸다.
 */
export {
  NO_SUB_CATEGORIES,
  filledSubCategories,
  type SubCategoryRow,
} from '@money/core/hooks/useCategoryManager';

interface CategoryFormFieldsProps {
  name: string;
  onNameChange: (name: string) => void;
  type: 'income' | 'expense';
  onTypeChange: (type: 'income' | 'expense') => void;
  subCategories: SubCategoryRow[];
  onSubCategoriesChange: (rows: SubCategoryRow[]) => void;
  /**
   * 대분류가 이미 정해져 있을 때 그 이름.
   *
   * 주면 소분류만 만드는 모드가 된다. 이름과 유형은 대분류에서 정해지므로 물을
   * 것이 없고, 소분류 줄만 남는다.
   */
  parentName?: string;
}

/**
 * 카테고리 입력 칸들. 대분류 이름 + 유형 + 소분류 줄 목록.
 *
 * 카테고리 화면과 거래 추가 팝업이 같은 폼을 쓴다. 예전에는 두 곳에 따로 적어
 * 두어서 한쪽에만 남은 색상 칸처럼 서로 어긋났다.
 *
 * form 태그와 저장 로직은 부모에 둔다. 두 화면의 저장 규칙이 다르다(카테고리
 * 화면은 수정까지 하고, 거래 팝업은 만들기만 한다).
 */
export default function CategoryFormFields({
  name,
  onNameChange,
  type,
  onTypeChange,
  subCategories,
  onSubCategoriesChange,
  parentName,
}: CategoryFormFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      {parentName ? (
        <p className="text-sm text-gray-600">
          {t('categories.subHint', { parent: parentName })}
        </p>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('categories.parentName')}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('categories.parentPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('account.type')}</label>
            <CustomSelect
              options={[
                { id: 'expense', name: t('home.tab.expense') },
                { id: 'income', name: t('home.tab.income') },
              ]}
              value={type}
              onChange={(value) => onTypeChange(value as 'income' | 'expense')}
            />
          </div>
        </>
      )}

      <div>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {subCategories.map((subCat, index) => (
            <div key={index} className="p-3 border border-gray-200 rounded-lg">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={subCat.name}
                  onChange={(e) => {
                    const rows = [...subCategories];
                    rows[index] = { ...rows[index], name: e.target.value };
                    onSubCategoriesChange(rows);
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('categories.subPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => onSubCategoriesChange(subCategories.filter((_, i) => i !== index))}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                >
                  {t('categories.removeSub')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            onSubCategoriesChange([...subCategories, { id: '', name: '', defaultIsExtra: false }])
          }
          className="mt-2 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {t('categories.addSub')}
        </button>
      </div>
    </>
  );
}
