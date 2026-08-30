import { useState } from 'react';
import { Image, Text, View } from 'react-native';

/**
 * 구글 프로필 사진. 없거나 못 받으면 이름 첫 글자로 대신한다.
 */
export function UserAvatar({
  name,
  avatar,
  size = 'md',
}: {
  name?: string | null;
  avatar?: string | null;
  size?: 'md' | 'lg';
}) {
  const [hasError, setHasError] = useState(false);
  const box = size === 'lg' ? 'h-14 w-14' : 'h-9 w-9';

  if (avatar && !hasError) {
    return (
      <Image
        source={{ uri: avatar }}
        onError={() => setHasError(true)}
        className={`${box} shrink-0 rounded-full`}
      />
    );
  }

  return (
    <View className={`${box} shrink-0 items-center justify-center rounded-full bg-blue-100`}>
      <Text className={`font-semibold text-blue-700 ${size === 'lg' ? 'text-xl' : 'text-sm'}`}>
        {name?.trim().charAt(0) || '?'}
      </Text>
    </View>
  );
}

export default UserAvatar;
