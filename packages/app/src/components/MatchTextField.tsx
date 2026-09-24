/*
 * 알림·캡처에서 이 통장·카드를 알아보는 말. 웹의 MatchTextField 와 같은 칸이다.
 *
 * 보관함이 문구를 읽어 후보를 만들 때 가장 먼저 보는 단서다(`draft-match`). 끝 네 자리도
 * 카드 이름도 적히지 않는 알림이 있고, 같은 카드사 카드가 둘이면 기기는 어느 것인지 알
 * 수 없다 -- 그 글에 늘 함께 오는 말을 사람이 한 번 적어 두면 그 뒤로는 저절로 채워진다.
 *
 * 알림을 읽는 것은 앱뿐이라(안드로이드) 이 칸이 가장 쓸모 있는 자리도 여기다. 그래도
 * 웹에 같은 칸을 두는 것은, 적어 두는 일은 큰 화면에서 하고 읽는 일만 폰에서 하는 것이
 * 자연스럽기 때문이다.
 */
import { Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';

export default function MatchTextField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{t('match.label')}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        /*
         * 줄바꿈이 뜻을 갖는 칸이라 여러 줄을 받는다. 높이를 못 박는 것은 안드로이드의
         * multiline 이 한 줄 높이에서 시작해, 적는 동안 모달 안의 다른 칸이 밀리기 때문이다.
         */
        multiline
        numberOfLines={2}
        textAlignVertical="top"
        placeholder={t('match.placeholder')}
        placeholderTextColor="#9ca3af"
        className="h-16 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
      />
      <Text className="mt-1 text-xs text-gray-500">{t('match.hint')}</Text>
    </View>
  );
}
