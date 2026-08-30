import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

/**
 * 앱 표시. 파란 모서리 둥근 바탕에 흰 지갑이다.
 *
 * 웹의 것과 같은 도형이다. 작게 그려도 알아볼 수 있도록 넷으로 줄였고, 파랑은
 * 화면 곳곳에서 쓰는 강조색과 같은 값(tailwind blue-600)이다.
 */
export function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={1} y={1} width={22} height={22} rx={6.5} fill="#2563eb" />
      {/* 지갑 몸통 */}
      <Rect x={4.5} y={7.5} width={15} height={10} rx={2.5} fill="#ffffff" />
      {/* 카드 넣는 자리. 오른쪽 끝에 붙여 지갑처럼 보이게 한다. */}
      <Rect x={13} y={11} width={6.5} height={3} rx={1.5} fill="#bfdbfe" />
      <Circle cx={15.75} cy={12.5} r={0.9} fill="#2563eb" />
    </Svg>
  );
}

/**
 * 로고와 앱 이름을 나란히. 누르면 홈으로 간다.
 *
 * 좁은 화면의 위쪽 막대와 넓은 화면의 사이드바가 함께 쓴다.
 */
export function AppBrand({ size = 'sm', onPress }: { size?: 'sm' | 'md'; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="-mx-1 shrink-0 flex-row items-center gap-1.5 rounded-lg px-1 py-1 active:bg-gray-100"
    >
      <AppLogo size={size === 'md' ? 28 : 24} />
      <Text className={`font-semibold text-gray-900 ${size === 'md' ? 'text-base' : 'text-sm'}`}>
        bboyong
      </Text>
    </Pressable>
  );
}

export default AppLogo;
