'use client';

import CustomSelect from './CustomSelect';

/** 소분류 입력 한 줄. id가 빈 문자열이면 아직 저장되지 않은 새 줄이다. */
export type SubCategoryRow = { id: string; name: string; defaultIsExtra: boolean };

/**
 * 소분류는 빈 줄 없이 시작한다.
 *
 * 빈 줄 하나를 미리 넣어 두면 소분류가 필요 없는데도 항상 빈 입력칸이 보인다.
 * 필요하면 "소분류 추가" 버튼으로 늘린다.
 */
export const NO_SUB_CATEGORIES: SubCategoryRow[] = [];

/** 이름이 남아 있는 줄만. 빈 줄은 사용자가 늘렸다가 채우지 않은 것이므로 버린다. */
export function filledSubCategories(rows: SubCategoryRow[]): SubCategoryRow[] {
  return rows.filter((row) => row.name.trim());
}

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
  return (
    <>
      {parentName ? (
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{parentName}</span> 밑에 소분류를
          만듭니다.
        </p>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">대분류 이름</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 음식"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
            <CustomSelect
              options={[
                { id: 'expense', name: '지출' },
                { id: 'income', name: '수입' },
              ]}
              value={type}
              onChange={(value) => onTypeChange(value as 'income' | 'expense')}
              placeholder="선택하세요"
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
                  placeholder="소분류 이름"
                />
                <button
                  type="button"
                  onClick={() => onSubCategoriesChange(subCategories.filter((_, i) => i !== index))}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                >
                  제거
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
          소분류 추가
        </button>
      </div>
    </>
  );
}
