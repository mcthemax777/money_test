/**
 * 고양이 그림과 걸음의 공용 규칙 (2026-10-28). 웹(svg)과 앱(react-native-svg)이 같은 모양·같은 걸음을 그린다.
 *
 * **지금 그림은 시험용이다.** 품종마다 색과 무늬·귀·꼬리만 바꾼 한 몸이다. 실제 그림 파일로 바꿀 때는 각 플랫폼의
 * `CatArt` 가 이 표 대신 파일을 그리면 된다 -- 부르는 쪽(걷기 줄·도감·알림)은 `CatArt` 의 모양(품종·자세·발 차례·
 * 실루엣)만 안다.
 */
import { type CatBreedDef, type CatMission, type CatRarity } from '@money/types';

import type { MessageKey } from './i18n';

// ─────────────────────────────────────────────
// 사전 열쇠
// ─────────────────────────────────────────────

export function catNameKey(breedId: string): MessageKey {
  return `cats.breed.${breedId}` as MessageKey;
}

export function catMissionKey(mission: CatMission): MessageKey {
  return `cats.mission.${mission}` as MessageKey;
}

export const CAT_RARITY_KEY: Record<CatRarity, MessageKey> = {
  common: 'cats.rarity.common',
  popular: 'cats.rarity.popular',
  uncommon: 'cats.rarity.uncommon',
  rare: 'cats.rarity.rare',
};

/** 희귀도 표의 색. 웹은 tailwind 클래스, 앱은 같은 색의 값이다. */
export const CAT_RARITY_COLOR: Record<CatRarity, { className: string; text: string; background: string }> = {
  common: { className: 'bg-gray-100 text-gray-600', text: '#4b5563', background: '#f3f4f6' },
  popular: { className: 'bg-blue-50 text-blue-700', text: '#1d4ed8', background: '#eff6ff' },
  uncommon: { className: 'bg-violet-50 text-violet-700', text: '#6d28d9', background: '#f5f3ff' },
  rare: { className: 'bg-amber-50 text-amber-700', text: '#b45309', background: '#fffbeb' },
};

/** 비율을 적는 모양. 1% 아래는 소수 둘째 자리까지. */
export function catShareLabel(breed: CatBreedDef): string {
  return `${breed.share >= 1 ? breed.share : breed.share.toFixed(2)}%`;
}

// ─────────────────────────────────────────────
// 시험용 그림 (실제 파일로 바꿀 자리)
// ─────────────────────────────────────────────

export type CatPattern = 'solid' | 'tabby' | 'point' | 'bicolor' | 'spotted' | 'van' | 'hairless';
export type CatEars = 'normal' | 'folded' | 'curled' | 'large';
export type CatTail = 'long' | 'fluffy' | 'bob' | 'none' | 'thin';

export interface CatLook {
  base: string;
  /** 무늬·포인트의 색 */
  accent: string;
  eye: string;
  pattern: CatPattern;
  ears: CatEars;
  tail: CatTail;
  /** 1 이 보통. 그림 상자 안에서의 크기다. */
  scale: number;
}

const look = (
  base: string,
  accent: string,
  pattern: CatPattern,
  extra: Partial<Pick<CatLook, 'eye' | 'ears' | 'tail' | 'scale'>> = {},
): CatLook => ({ base, accent, eye: '#3f6212', pattern, ears: 'normal', tail: 'long', scale: 1, ...extra });

const BLUE_EYE = '#2563eb';
const COPPER_EYE = '#c2410c';
const GOLD_EYE = '#ca8a04';

export const CAT_LOOKS: Record<string, CatLook> = {
  'maine-coon': look('#8b6b4a', '#4e3a28', 'tabby', { tail: 'fluffy', scale: 1.12, eye: GOLD_EYE }),
  ragdoll: look('#f1e9dc', '#6b5444', 'point', { tail: 'fluffy', scale: 1.08, eye: BLUE_EYE }),
  persian: look('#f5f2ee', '#d6cfc6', 'solid', { tail: 'fluffy', eye: COPPER_EYE }),
  exotic: look('#e8c9a0', '#c9a375', 'solid', { eye: COPPER_EYE }),
  'devon-rex': look('#b9a48c', '#8c7a66', 'solid', { ears: 'large', tail: 'thin' }),
  abyssinian: look('#c27a43', '#8a4f25', 'tabby', { ears: 'large', eye: GOLD_EYE }),
  'british-shorthair': look('#8e98a6', '#6f7987', 'solid', { eye: COPPER_EYE, scale: 1.05 }),
  siberian: look('#9c8a72', '#5f523f', 'tabby', { tail: 'fluffy', scale: 1.08 }),
  'american-shorthair': look('#c4c8cc', '#4b4f55', 'tabby'),
  sphynx: look('#e9c3b5', '#d9a796', 'hairless', { ears: 'large', tail: 'thin', eye: '#65a30d' }),
  'russian-blue': look('#7d8c9e', '#66768a', 'solid', { eye: '#16a34a' }),
  siamese: look('#efe3cf', '#4a3a30', 'point', { ears: 'large', tail: 'thin', eye: BLUE_EYE }),
  bengal: look('#d39b55', '#6a4320', 'spotted', { eye: '#65a30d' }),
  'norwegian-forest': look('#a08566', '#5e4a36', 'tabby', { tail: 'fluffy', scale: 1.1 }),
  'scottish-fold': look('#c9c2b8', '#a49c90', 'solid', { ears: 'folded', eye: COPPER_EYE }),
  birman: look('#f3ebdd', '#7a6152', 'point', { tail: 'fluffy', eye: BLUE_EYE }),
  oriental: look('#3e3a36', '#2a2724', 'solid', { ears: 'large', tail: 'thin', eye: '#16a34a' }),
  burmese: look('#6b4a35', '#4e3424', 'solid', { eye: GOLD_EYE }),
  'cornish-rex': look('#d8cfc5', '#b5aa9d', 'solid', { ears: 'large', tail: 'thin' }),
  tonkinese: look('#cdb39a', '#6e5440', 'point', { eye: '#0d9488' }),
  ocicat: look('#cdb08a', '#5d4630', 'spotted', { eye: GOLD_EYE }),
  somali: look('#c9773e', '#7f4520', 'tabby', { tail: 'fluffy', ears: 'large' }),
  manx: look('#e3a35c', '#b8763a', 'tabby', { tail: 'none', eye: COPPER_EYE }),
  ragamuffin: look('#cbb9a5', '#ffffff', 'bicolor', { tail: 'fluffy', scale: 1.08 }),
  'selkirk-rex': look('#e7dccf', '#c7b8a6', 'solid', { tail: 'fluffy', eye: COPPER_EYE }),
  chartreux: look('#7f8a96', '#66717d', 'solid', { eye: COPPER_EYE, scale: 1.05 }),
  'egyptian-mau': look('#c9cdd1', '#4d5157', 'spotted', { eye: '#65a30d' }),
  'american-curl': look('#e8c59a', '#c49a68', 'solid', { ears: 'curled' }),
  'american-bobtail': look('#b08d6a', '#5e4630', 'tabby', { tail: 'bob' }),
  'japanese-bobtail': look('#ffffff', '#e0904a', 'bicolor', { tail: 'bob', eye: GOLD_EYE }),
  'turkish-angora': look('#fafafa', '#e5e5e5', 'solid', { tail: 'fluffy', eye: BLUE_EYE }),
  singapura: look('#c8a47e', '#8a6a48', 'tabby', { ears: 'large', scale: 0.88 }),
  bombay: look('#2a2725', '#1c1a19', 'solid', { eye: COPPER_EYE }),
  'colorpoint-shorthair': look('#f4e6d6', '#d27c42', 'point', { ears: 'large', tail: 'thin', eye: BLUE_EYE }),
  'european-burmese': look('#8a6347', '#5f4230', 'solid', { eye: GOLD_EYE }),
  'turkish-van': look('#ffffff', '#c7783e', 'van', { tail: 'fluffy', eye: GOLD_EYE }),
  korat: look('#8c99a6', '#74818f', 'solid', { eye: '#16a34a' }),
  'havana-brown': look('#6b3f2a', '#52301f', 'solid', { eye: '#16a34a' }),
  balinese: look('#f0e6d6', '#574536', 'point', { tail: 'fluffy', ears: 'large', eye: BLUE_EYE }),
  'khao-manee': look('#ffffff', '#ececec', 'solid', { eye: BLUE_EYE }),
  lykoi: look('#8c8884', '#3a3633', 'point', { tail: 'thin', eye: GOLD_EYE }),
  laperm: look('#d9b48a', '#b18c62', 'solid', { tail: 'fluffy' }),
  burmilla: look('#dadcdf', '#8f949a', 'tabby', { tail: 'fluffy', eye: '#16a34a' }),
  'american-wirehair': look('#c2a27e', '#7d6448', 'tabby'),
  toybob: look('#eee2d2', '#7b624e', 'point', { tail: 'bob', scale: 0.78, eye: BLUE_EYE }),
};

/** 표에서 빠진 품종(새로 더한 것을 그림이 아직 모를 때)은 이 모양으로 그린다. */
export const FALLBACK_CAT_LOOK: CatLook = look('#c9c2b8', '#8c857b', 'solid');

export function catLookOf(breedId: string): CatLook {
  return CAT_LOOKS[breedId] ?? FALLBACK_CAT_LOOK;
}

/** 밝은 털의 외곽선. 흰 고양이가 흰 바탕(카드·팝업)에 묻히지 않게 몸과 머리에만 두른다. */
const LIGHT_OUTLINE = '#d1d5db';

function isLight(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 225;
}

/** 실루엣의 색. 얻지 않은 고양이는 모두 이 색 하나다. */
export const CAT_SILHOUETTE = '#9ca3af';

export type CatPose = 'stand' | 'walk' | 'sleep';

/** 그림 상자. 옆모습, 오른쪽을 본다. 걸음이 왼쪽이면 부르는 쪽이 뒤집는다. */
export const CAT_VIEWBOX = { width: 48, height: 32 } as const;

/** 그림 한 조각. 웹과 앱이 같은 조각을 각자의 svg 요소로 옮긴다. */
export type CatShape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; stroke?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string }
  | { kind: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number };

/** 걷는 발의 두 차례. 앞뒤 다리가 엇갈린다. 서 있으면 0 이다. */
export type CatFrame = 0 | 1;

/**
 * 한 자세의 그림 조각들. `silhouette` 이면 눈·무늬 없이 한 색이다.
 *
 * 다리는 따로 돌려준다 -- 걷는 동안 두 차례를 겹쳐 두고 번갈아 보이게 하면(투명도), 그릴 때마다 조각을 다시
 * 만들지 않아도 발이 움직인다 (앱은 UI 실에서만 돈다).
 */
export function catShapes(
  breedId: string,
  pose: CatPose,
  silhouette = false,
): { body: CatShape[]; legs: [CatShape[], CatShape[]] } {
  const l = catLookOf(breedId);
  const base = silhouette ? CAT_SILHOUETTE : l.base;
  const accent = silhouette ? CAT_SILHOUETTE : l.accent;
  /** 머리·귀·꼬리·발에 쓰는 색. 포인트 무늬는 끝이 짙다. */
  const tip = !silhouette && (l.pattern === 'point' || l.pattern === 'van') ? l.accent : base;
  const head = !silhouette && l.pattern === 'van' ? base : tip;
  const paw = !silhouette && l.pattern === 'bicolor' ? l.accent : !silhouette && l.pattern === 'point' ? l.accent : base;
  const tailWidth = l.tail === 'fluffy' ? 5 : l.tail === 'thin' ? 2 : 3.2;
  const bodyLine = isLight(base) ? LIGHT_OUTLINE : undefined;
  const headLine = isLight(head) ? LIGHT_OUTLINE : undefined;

  if (pose === 'sleep') {
    const body: CatShape[] = [
      // 꼬리가 몸을 감는다.
      ...(l.tail === 'none'
        ? []
        : [{ kind: 'path', d: l.tail === 'bob' ? 'M11 26 Q9 24 10 22' : 'M11 27 Q14 32 30 30', stroke: tip, strokeWidth: tailWidth } as CatShape]),
      { kind: 'ellipse', cx: 23, cy: 24, rx: 13, ry: 6.5, fill: base, stroke: bodyLine },
      ...patternShapes(l, accent, silhouette, 'sleep'),
      ...earShapes(l.ears, head, 33, 19),
      { kind: 'circle', cx: 34, cy: 23, r: 5.5, fill: head, stroke: headLine },
    ];
    if (!silhouette) {
      // 감은 눈
      body.push({ kind: 'path', d: 'M34.5 23 Q36 24.2 37.5 23', stroke: '#1f2937', strokeWidth: 0.8 });
    }
    return { body, legs: [[], []] };
  }

  const body: CatShape[] = [
    ...tailShapes(l.tail, tip, tailWidth),
    { kind: 'ellipse', cx: 22, cy: 18, rx: 12.5, ry: 6.5, fill: base, stroke: bodyLine },
    ...patternShapes(l, accent, silhouette, 'stand'),
    ...earShapes(l.ears, head, 36, 8),
    { kind: 'circle', cx: 36.5, cy: 12.5, r: 6.5, fill: head, stroke: headLine },
  ];
  if (!silhouette) {
    if (l.pattern === 'bicolor') body.push({ kind: 'ellipse', cx: 23, cy: 21.5, rx: 8, ry: 3, fill: l.accent });
    body.push(
      { kind: 'circle', cx: 39, cy: 11.5, r: 1.3, fill: l.eye },
      { kind: 'circle', cx: 39.3, cy: 11.3, r: 0.5, fill: '#111827' },
      { kind: 'circle', cx: 42.6, cy: 13.8, r: 0.8, fill: '#f472b6' },
    );
  }

  const leg = (x: number, shift: number): CatShape => ({
    kind: 'path',
    d: `M${x} 21 L${x + shift} 29`,
    stroke: paw,
    strokeWidth: 3,
  });
  const legs: [CatShape[], CatShape[]] =
    pose === 'walk'
      ? [
          [leg(13, -2), leg(17, 2), leg(28, 2), leg(32, -2)],
          [leg(13, 2), leg(17, -2), leg(28, -2), leg(32, 2)],
        ]
      : [[leg(13, 0), leg(17, 0), leg(28, 0), leg(32, 0)], []];
  return { body, legs };
}

function tailShapes(tail: CatTail, color: string, width: number): CatShape[] {
  switch (tail) {
    case 'none':
      return [];
    case 'bob':
      return [{ kind: 'circle', cx: 9.5, cy: 15.5, r: 2.6, fill: color, stroke: isLight(color) ? LIGHT_OUTLINE : undefined }];
    default:
      return [{ kind: 'path', d: 'M10.5 16 Q3 15 4.5 5', stroke: color, strokeWidth: width }];
  }
}

function earShapes(ears: CatEars, color: string, cx: number, top: number): CatShape[] {
  // cx 는 머리의 가운데, top 은 귀 밑동의 높이다. 흰 귀는 몸처럼 외곽선을 두른다.
  const outline = isLight(color) ? { stroke: LIGHT_OUTLINE, strokeWidth: 0.7 } : {};
  return earPaths(ears, color, cx, top).map((shape) => ({ ...shape, ...outline }));
}

function earPaths(ears: CatEars, color: string, cx: number, top: number): CatShape[] {
  switch (ears) {
    case 'folded':
      return [
        { kind: 'path', d: `M${cx - 5} ${top - 1} Q${cx - 3} ${top - 4} ${cx - 1} ${top - 2} Z`, fill: color },
        { kind: 'path', d: `M${cx + 1} ${top - 2} Q${cx + 3} ${top - 4} ${cx + 5} ${top - 1} Z`, fill: color },
      ];
    case 'curled':
      return [
        { kind: 'path', d: `M${cx - 5.5} ${top} L${cx - 5} ${top - 6} Q${cx - 2} ${top - 7} ${cx - 1.5} ${top - 4} Z`, fill: color },
        { kind: 'path', d: `M${cx + 1.5} ${top - 1} L${cx + 3} ${top - 7} Q${cx + 6} ${top - 7} ${cx + 5.5} ${top - 3} Z`, fill: color },
      ];
    case 'large':
      return [
        { kind: 'path', d: `M${cx - 6} ${top + 1} L${cx - 4.5} ${top - 8} L${cx - 0.5} ${top - 1} Z`, fill: color },
        { kind: 'path', d: `M${cx + 0.5} ${top - 1} L${cx + 4.5} ${top - 8} L${cx + 6} ${top + 1} Z`, fill: color },
      ];
    default:
      return [
        { kind: 'path', d: `M${cx - 5.5} ${top + 1} L${cx - 4} ${top - 6} L${cx - 0.5} ${top - 1} Z`, fill: color },
        { kind: 'path', d: `M${cx + 0.5} ${top - 1} L${cx + 4} ${top - 6} L${cx + 5.5} ${top + 1} Z`, fill: color },
      ];
  }
}

function patternShapes(l: CatLook, accent: string, silhouette: boolean, pose: 'stand' | 'sleep'): CatShape[] {
  if (silhouette) return [];
  const y = pose === 'sleep' ? 24 : 18;
  switch (l.pattern) {
    case 'tabby':
      return [14, 19, 24, 29].map((x) => ({
        kind: 'path',
        d: `M${x} ${y - 6} Q${x + 1} ${y - 2} ${x} ${y + 1}`,
        stroke: accent,
        strokeWidth: 1.6,
      }));
    case 'spotted':
      return [
        [15, y - 3],
        [20, y - 1],
        [25, y - 4],
        [29, y - 1],
        [18, y + 2],
      ].map(([cx, cy]) => ({ kind: 'circle', cx, cy, r: 1.4, fill: accent }));
    case 'hairless':
      return [{ kind: 'path', d: `M15 ${y - 2} Q22 ${y + 1} 29 ${y - 2}`, stroke: accent, strokeWidth: 0.8 }];
    case 'van':
      return [{ kind: 'circle', cx: 30, cy: y - 4, r: 2.4, fill: accent }];
    default:
      return [];
  }
}

// ─────────────────────────────────────────────
// 걸음
// ─────────────────────────────────────────────

/** 걷는 줄의 높이. 고양이가 가장 클 때도 이 안에 든다. 본문이 이만큼 비켜 준다. */
export const CAT_PARADE_HEIGHT = 44;

/** 줄 위의 고양이 그림 폭. `CAT_VIEWBOX` 의 비율을 따른다. */
export const CAT_SPRITE_WIDTH = 54;

/** 걷는 빠르기 (픽셀/초). */
const WALK_SPEED = 28;

export type CatAction =
  | { kind: 'walk'; toX: number; ms: number }
  | { kind: 'stand'; ms: number }
  | { kind: 'sleep'; ms: number };

/**
 * 다음에 할 일. 걷기가 가장 잦고, 가끔 서서 두리번거리거나 잠든다.
 *
 * `width` 는 걸을 수 있는 폭(줄 폭 − 그림 폭)이다. 한 번에 화면의 1/5 ~ 3/5 만큼 걷는다 -- 끝에서 끝까지 내달리면
 * 고양이보다 탁구공처럼 보인다.
 */
export function nextCatAction(fromX: number, width: number, random: () => number = Math.random): CatAction {
  const roll = random();
  if (roll < 0.15) return { kind: 'sleep', ms: 8000 + random() * 12000 };
  if (roll < 0.35 || width <= 0) return { kind: 'stand', ms: 1500 + random() * 3000 };
  const span = width * (0.2 + random() * 0.4);
  const goRight = fromX + span <= width && (fromX - span < 0 || random() < 0.5);
  const toX = Math.max(0, Math.min(width, goRight ? fromX + span : fromX - span));
  return { kind: 'walk', toX, ms: (Math.abs(toX - fromX) / WALK_SPEED) * 1000 };
}

/** 줄에 처음 설 자리. 고양이끼리 고르게 흩어진다. */
export function catStartX(index: number, count: number, width: number): number {
  if (width <= 0) return 0;
  return ((index + 0.5) / Math.max(1, count)) * width;
}

/** 걷는 동안 발을 바꾸는 간격. */
export const CAT_STEP_MS = 180;
