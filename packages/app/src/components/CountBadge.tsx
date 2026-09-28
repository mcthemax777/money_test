import { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';

/**
 * 아이콘 오른쪽 위에 얹는 빨간 건수 배지.
 *
 * 다른 앱들이 "볼 것이 있다"를 알리는 모양을 그대로 쓴다 -- 파란 글자는 옆 단추들 사이에
 * 묻혀 눈에 들어오지 않았다. 부르는 쪽이 아이콘을 `relative` 인 자리에 두고 이것을
 * 그 안에 넣는다. 0 이하면 그리지 않는다.
 *
 * 나타날 때 튀어 오른다. 화면에 들어와 처음 그릴 때와 건수가 늘 때마다 같은 움직임이다.
 * 크기만 바꾸므로 UI 스레드에 맡긴다.
 */
export default function CountBadge({ count }: { count: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const prevRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = count;
    // 줄어들 때는 움직이지 않는다. 처리해서 줄어든 것을 다시 알릴 까닭이 없다.
    if (count <= 0 || count <= prev) return;
    scale.setValue(prev > 0 ? 0.6 : 0);
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [count, scale]);

  if (count <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      className="absolute -right-2 -top-1.5 h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1"
      style={{ transform: [{ scale }] }}
    >
      <Text className="text-[10px] font-bold leading-[12px] text-white">
        {count > 99 ? '99+' : count}
      </Text>
    </Animated.View>
  );
}
