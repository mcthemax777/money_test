/*
 * QR 한 판. 웹의 QrCode 와 같은 그림이다.
 *
 * 칸을 세는 일은 core 가 한다(`qrMatrix`). 여기서는 그 칸을 네모로 그릴 뿐이라 두
 * 화면이 같은 판을 내놓는다 -- 웹에서 띄운 QR 과 앱에서 띄운 QR 이 같은 초대를
 * 가리키면 모양도 같아야, 사람이 둘을 견주다 헷갈리지 않는다.
 *
 * 가장자리 여백(quiet zone)을 네 칸 둔다. 없으면 어두운 바탕 위에서 읽는 쪽이 판의
 * 끝을 찾지 못한다.
 */
import { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';

import { qrMatrix } from '@money/core/lib/invite';

const QUIET_ZONE = 4;

export default function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  // 판을 세는 값이 제법 든다. 같은 글이면 다시 세지 않는다.
  const cells = useMemo(() => qrMatrix(text), [text]);
  const span = cells.length + QUIET_ZONE * 2;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
      {/* 흰 바탕을 깐다. 화면이 어두워도 QR 자체는 늘 밝아야 읽힌다. */}
      <Rect x={0} y={0} width={span} height={span} fill="#ffffff" />
      {cells.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <Rect
              key={`${y}-${x}`}
              x={x + QUIET_ZONE}
              y={y + QUIET_ZONE}
              width={1}
              height={1}
              fill="#111827"
            />
          ) : null,
        ),
      )}
    </Svg>
  );
}
