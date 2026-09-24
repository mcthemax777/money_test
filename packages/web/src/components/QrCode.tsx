'use client';

import { useMemo } from 'react';

import { qrMatrix } from '@money/core/lib/invite';

/**
 * QR 한 판. 칸을 SVG 사각형으로 그린다.
 *
 * 이미지로 만들지 않는다. SVG 는 어느 크기로 키워도 또렷하고, 인쇄해도 흐려지지 않는다
 * (초대 QR 을 종이에 적어 붙이는 자리가 있다). 칸을 세는 일은 core 가 하므로 앱의 같은
 * 그림과 늘 같은 판이 나온다.
 *
 * 가장자리 여백(quiet zone)을 네 칸 둔다. 없으면 흰 바탕과 QR 이 맞닿아, 어두운 화면에서
 * 읽는 쪽이 판의 끝을 찾지 못한다.
 */
const QUIET_ZONE = 4;

export default function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  // 판을 세는 값이 제법 든다. 같은 글이면 다시 세지 않는다.
  const cells = useMemo(() => qrMatrix(text), [text]);
  const span = cells.length + QUIET_ZONE * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      // 읽어 주는 자리에서는 그림이 아니라 그 안의 글이 뜻이다. 글은 옆에 함께 적는다.
      role="img"
      aria-hidden
      className="rounded bg-white"
      shapeRendering="crispEdges"
    >
      {cells.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
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
    </svg>
  );
}
