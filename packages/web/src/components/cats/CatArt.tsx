'use client';

import { CAT_VIEWBOX, catLookOf, catShapes, type CatPose, type CatShape } from '@money/core/lib/cats';

/**
 * 고양이 한 마리의 그림. 앱의 `components/cats/CatArt` 와 같은 짝이다.
 *
 * **시험용 그림이다.** 모양은 core 의 `catShapes` 가 정한다. 실제 그림 파일로 바꿀 때는 이 컴포넌트 안만 바꾸면
 * 된다 -- 부르는 쪽은 품종·자세·실루엣·걷는 중인지만 넘긴다.
 *
 * 걷는 동안에는 두 차례의 다리를 겹쳐 두고 번갈아 보인다(globals.css 의 `cat-step`). 그릴 때마다 다리를 다시
 * 만들지 않는다.
 */
export default function CatArt({
  breedId,
  pose = 'stand',
  silhouette = false,
  width = 54,
  className = '',
}: {
  breedId: string;
  pose?: CatPose;
  silhouette?: boolean;
  width?: number;
  className?: string;
}) {
  const { body, legs } = catShapes(breedId, pose, silhouette);
  const scale = catLookOf(breedId).scale;
  const { width: vw, height: vh } = CAT_VIEWBOX;
  const height = (width * vh) / vw;

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      width={width}
      height={height}
      className={className}
      aria-hidden
      // 크기는 발밑(가운데 아래)을 기준으로 줄이고 늘인다. 작은 고양이도 바닥에 선다.
      style={{ overflow: 'visible' }}
    >
      <g transform={`translate(${vw / 2} ${vh}) scale(${scale}) translate(${-vw / 2} ${-vh})`}>
        {pose === 'walk' ? (
          <>
            <g className="cat-step-a">{legs[0].map(renderShape)}</g>
            <g className="cat-step-b">{legs[1].map(renderShape)}</g>
          </>
        ) : (
          <g>{legs[0].map(renderShape)}</g>
        )}
        {body.map(renderShape)}
      </g>
    </svg>
  );
}

function renderShape(shape: CatShape, index: number) {
  switch (shape.kind) {
    case 'ellipse':
      return <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.stroke ? 0.7 : undefined} />;
    case 'circle':
      return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.stroke ? 0.7 : undefined} />;
    case 'path':
      return (
        <path
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
