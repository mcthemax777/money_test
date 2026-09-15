/*
 * 분류 하나를 적는 칸들 -- 이름, 유형, 소분류 줄들.
 *
 * 분류를 만드는 자리가 둘이다. 설정의 분류 화면과, 거래를 적다가 그 자리에서 만드는 창.
 * 두 벌로 두면 한쪽에만 칸이 생겨 같은 일이 화면마다 다르게 보인다 -- 실제로 거래 폼
 * 쪽에는 소분류 줄이 없어, 거기서 만든 분류는 늘 대분류 하나뿐이었다.
 *
 * 창(Modal)과 저장은 부르는 쪽이 갖는다. 두 자리의 저장 규칙이 다르기 때문이다 --
 * 분류 화면은 고치기까지 하고, 거래 폼은 만들기만 한 뒤 그 값을 곧바로 고른다
 * (웹의 같은 이름 컴포넌트와 같은 나눔이다).
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import type { SubCategoryRow } from '@money/core/hooks/useCategoryManager';
import { useTranslation } from '@money/core/lib/i18n';

const INPUT = 'rounded-lg border border-gray-300 px-3 py-2 text-gray-900';

export default function CategoryFormFields({
  name,
  onNameChange,
  type,
  onTypeChange,
  subCategories,
  onSubCategoriesChange,
  /**
   * 유형을 고를 수 있는가.
   *
   * 고친 뒤 유형을 바꾸면 그 분류의 거래가 갈 곳을 잃으므로 만들 때만 고른다. 거래를
   * 적다가 여는 창에서도 잠근다 -- 거기서는 거래의 갈래가 이미 유형을 정했고, 그 갈래에서
   * 고를 수 없는 분류를 만들어 봐야 방금 만든 것이 목록에 나타나지 않는다.
   */
  canPickType = true,
  parentName,
}: {
  name: string;
  onNameChange: (name: string) => void;
  type: 'income' | 'expense';
  onTypeChange: (type: 'income' | 'expense') => void;
  subCategories: SubCategoryRow[];
  onSubCategoriesChange: (rows: SubCategoryRow[]) => void;
  canPickType?: boolean;
  /**
   * 대분류가 이미 정해져 있을 때 그 이름.
   *
   * 주면 소분류만 만드는 모드가 된다. 이름과 유형은 대분류에서 정해지므로 물을 것이
   * 없고, 소분류 줄만 남는다 (웹의 같은 이름 컴포넌트와 같은 규칙이다).
   */
  parentName?: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      {parentName ? (
        <Text className="text-sm text-gray-600">
          {t('categories.subHint', { parent: parentName })}
        </Text>
      ) : (
        <View>
          <Text className="mb-1 text-sm font-medium text-gray-700">{t('categories.name')}</Text>
          <TextInput
            value={name}
            onChangeText={onNameChange}
            placeholder={t('categories.parentPlaceholder')}
            className={INPUT}
          />
        </View>
      )}

      {canPickType && !parentName ? (
        <View>
          <Text className="mb-1 text-sm font-medium text-gray-700">{t('account.type')}</Text>
          <View className="flex-row gap-2">
            {(['expense', 'income'] as const).map((option) => {
              const isSelected = type === option;

              return (
                <Pressable
                  key={option}
                  onPress={() => onTypeChange(option)}
                  className={`flex-1 items-center rounded-lg border px-4 py-2 ${
                    isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                  }`}
                >
                  <Text className={isSelected ? 'text-blue-600' : 'text-gray-700'}>
                    {t(option === 'expense' ? 'home.tab.expense' : 'home.tab.income')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View>
        <Text className="mb-1 text-sm font-medium text-gray-700">
          {t('categories.subcategories')}
        </Text>
        <View className="gap-2">
          {subCategories.map((row, index) => (
            <View key={row.id || `new-${index}`} className="flex-row items-center gap-2">
              <TextInput
                value={row.name}
                placeholder={t('categories.subPlaceholder')}
                onChangeText={(value) => {
                  const next = [...subCategories];
                  next[index] = { ...row, name: value };
                  onSubCategoriesChange(next);
                }}
                className={`flex-1 ${INPUT}`}
              />
              <Pressable
                onPress={() => onSubCategoriesChange(subCategories.filter((_, i) => i !== index))}
                className="rounded-lg border border-gray-300 px-3 py-2"
              >
                <Text className="text-gray-600">×</Text>
              </Pressable>
            </View>
          ))}

          <Pressable
            onPress={() => onSubCategoriesChange([...subCategories, { id: '', name: '' }])}
            className="items-center rounded-lg border border-gray-300 px-4 py-2"
          >
            <Text className="text-sm text-gray-700">{t('categories.addSub')}</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
