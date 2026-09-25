import { Pressable, Text, View } from 'react-native';
import type { EntryBasis } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';

const BASES: EntryBasis[] = ['accrual', 'installment'];

/**
 * 무엇을 "그 달에 쓴 돈"으로 셀지 고르는 자리. 웹의 `BasisPicker` 를 옮긴 것이다.
 *
 * 거래 화면과 가계 화면의 더보기 안에 같은 모양으로 선다. 두 화면이 같은 물음에 다른
 * 낱말로 답하면 숫자가 왜 다른지 알 수 없으므로 한 곳에 둔다.
 */
export default function BasisPicker({
  value,
  onChange,
}: {
  value: EntryBasis;
  onChange: (basis: EntryBasis) => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="px-2 pb-3">
      <Text className="mb-2 text-sm font-medium text-gray-700">{t('tx.basis')}</Text>
      <View className="flex-row gap-2 rounded-lg bg-gray-100 p-1">
        {BASES.map((item) => (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            className={`flex-1 items-center rounded-md px-3 py-2 ${
              value === item ? 'bg-white' : ''
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                value === item ? 'text-blue-600' : 'text-gray-600'
              }`}
            >
              {t(item === 'accrual' ? 'tx.basis.accrual' : 'tx.basis.installment')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text className="mt-2 text-xs text-gray-500">{t('tx.basisHint')}</Text>
    </View>
  );
}
