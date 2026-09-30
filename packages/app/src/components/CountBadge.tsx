import { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';

/**
 * 아이콘 오른쪽 위에 얹는 빨간 건수 배지.
 *
 * 다른 앱들이 "볼 것이 있다"를 알리는 모양을 그대로 쓴다 -- 파란 글자는 옆 단추들 사이에
 * 묻혀 눈에 들어오지 않았다. 부르는 쪽이 아이콘을 `relative` 인 자리에 두고 이것을
 * 그 안에 넣는다. 0 이하면 그리지 않는다. 글 옆에 나란히 둘 때는 `inline` 을 준다.
 *
 * 나타날 때 튀어 오른다. 화면에 들어와 처음 그릴 때와 건수가 늘 때마다 같은 움직임이다.
 * 크기만 바꾸므로 UI 스레드에 맡긴다.
 */
export default function CountBadge({ count, inline }: { count: number; inline?: boolean }) {
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

  const badge = (
    <Animated.View
      pointerEvents="none"
      className="h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1"
      style={{ transform: [{ scale }] }}
    >
      <Text numberOfLines={1} className="text-[10px] font-bold leading-[12px] text-white">
        {count > 99 ? '99+' : count}
      </Text>
    </Animated.View>
  );
  if (inline) return badge;

  /*
   * 아이콘 위에 얹을 때는 넉넉한 투명 틀에 오른쪽으로 붙여 둔다.
   *
   * 절대 위치인 배지는 부모(18px 아이콘) 너비 안에서 재어져, 틀 없이 두면 두 자리부터
   * 글자가 줄바꿈되거나 잘린다. 틀의 오른쪽 끝이 예전 배지 자리(-right-2)라 한 자리일 때의
   * 모양은 그대로다.
   */
  return (
    <View pointerEvents="none" className="absolute -right-2 -top-1.5 w-10 items-end">
      {badge}
    </View>
  );
}
