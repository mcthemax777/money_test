import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { CAT_STEP_MS, CAT_VIEWBOX, catLookOf, catShapes, type CatPose, type CatShape } from '@money/core/lib/cats';

import { useReduceMotion } from './motion';

/**
 * 고양이 한 마리의 그림. 웹의 `components/cats/CatArt` 와 같은 짝이다.
 *
 * **시험용 그림이다.** 모양은 core 의 `catShapes` 가 정한다. 실제 그림 파일로 바꿀 때는 이 컴포넌트 안만 바꾸면
 * 된다 -- 부르는 쪽은 품종·자세·실루엣만 넘긴다.
 *
 * 세 겹이다: 다리 두 차례와 몸. 걷는 동안 두 다리 겹의 투명도만 네이티브 드라이버로 번갈아 바꾼다 -- 발을 바꿀 때마다
 * JS 가 다시 그리면 고양이 다섯 마리가 초에 열 번씩 그림을 새로 만든다. reanimated 를 쓰지 않는 까닭은 `motion.ts`.
 */
export default function CatArt({
  breedId,
  pose = 'stand',
  silhouette = false,
  width = 54,
}: {
  breedId: string;
  pose?: CatPose;
  silhouette?: boolean;
  width?: number;
}) {
  const { body, legs } = catShapes(breedId, pose, silhouette);
  const scale = catLookOf(breedId).scale;
  const { width: vw, height: vh } = CAT_VIEWBOX;
  const height = (width * vh) / vw;
  const reduceMotion = useReduceMotion();
  const walking = pose === 'walk' && !reduceMotion;

  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!walking) {
      phase.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: CAT_STEP_MS * 2, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [walking, phase]);
  // 반을 넘으면 다른 다리로 바뀐다. 사이를 섞지 않는다(두 다리가 겹쳐 보이지 않게).
  const stepA = { opacity: phase.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0] }) };
  const stepB = { opacity: phase.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [0, 0, 1, 1] }) };

  // 크기는 발밑(가운데 아래)을 기준으로 줄이고 늘인다. 작은 고양이도 바닥에 선다.
  const frame = `translate(${vw / 2} ${vh}) scale(${scale}) translate(${-vw / 2} ${-vh})`;
  const layer = (shapes: CatShape[]) => (
    <Svg viewBox={`0 0 ${vw} ${vh}`} width={width} height={height} style={{ overflow: 'visible' }}>
      <G transform={frame}>{shapes.map(renderShape)}</G>
    </Svg>
  );

  return (
    <View style={{ width, height }} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute' }, pose === 'walk' ? stepA : null]}>{layer(legs[0])}</Animated.View>
      {pose === 'walk' ? (
        <Animated.View style={[{ position: 'absolute' }, stepB]}>{layer(legs[1])}</Animated.View>
      ) : null}
      <View style={{ position: 'absolute' }}>{layer(body)}</View>
    </View>
  );
}

function renderShape(shape: CatShape, index: number) {
  switch (shape.kind) {
    case 'ellipse':
      return <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.stroke ? 0.7 : undefined} />;
    case 'circle':
      return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.stroke ? 0.7 : undefined} />;
    case 'path':
      return (
        <Path
          key={index}
          d={shape.d}
          fill={shape.fill ?? 'none'}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}
