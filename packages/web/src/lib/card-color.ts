import { CARD_COLORS, isCardColor, type CardColor } from '@money/types';

import type { MessageKey } from '@/lib/i18n';

/**
 * 카드 한 색이 쓰는 색 묶음.
 *
 * 앞면 색과 그 위에 얹는 글씨 색을 한자리에 둔다. 따로 두면 앞면을 바꿀 때 글씨가
 * 묻히는 것을 알아채지 못한다. `positive`·`negative`는 남은 금액과 실적 막대가
 * 함께 쓰는 색이라 둘이 어긋나지 않게 text/bar를 짝으로 갖는다.
 */
export interface CardTone {
  text: string;
  bar: string;
}

export interface CardPalette {
  /** 색 이름의 사전 열쇠. 고르는 화면이 t()로 꺼낸다. */
  labelKey: MessageKey;
  /** 앞면 그라데이션 */
  face: string;
  /** 앞면 위 기본 글씨 색. 밝은 앞면은 검은 글씨여야 읽힌다. */
  ink: string;
  /** 실적 막대의 빈 부분과 아래 구분선. 앞면 밝기에 따라 흰 쪽/검은 쪽으로 깐다. */
  track: string;
  divider: string;
  /** 실적을 채우기까지 남았을 때 (양수) */
  positive: CardTone;
  /** 실적을 채웠거나 넘겼을 때 (0 이하) */
  negative: CardTone;
}

/** 어두운 앞면이 함께 쓰는 값. 흰 글씨에 흰 계열 트랙이다. */
const ON_DARK = {
  ink: 'text-white',
  track: 'bg-white/30',
  divider: 'border-white/25',
} as const;

/** 밝은 앞면이 함께 쓰는 값. 흰 글씨는 읽히지 않으므로 전부 뒤집는다. */
const ON_LIGHT = {
  ink: 'text-slate-900',
  track: 'bg-black/10',
  divider: 'border-black/15',
} as const;

/**
 * 고를 수 있는 카드 색.
 *
 * 앞면마다 잘 보이는 글씨 색이 다르다. 초록 앞면에 초록 글씨, 붉은 앞면에 붉은
 * 글씨는 묻힌다. 그래서 색마다 양수·음수 글씨 색을 따로 정해 둔다. tailwind는
 * 문자열을 조립한 클래스를 찾지 못하므로 전부 그대로 적는다
 * (이 파일도 tailwind.config.ts의 content에 들어 있어야 한다).
 */
export const CARD_PALETTE: Record<CardColor, CardPalette> = {
  blue: {
    labelKey: 'cardColor.blue',
    face: 'bg-gradient-to-br from-blue-700 to-sky-500',
    ...ON_DARK,
    positive: { text: 'text-green-300', bar: 'bg-green-300' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  sky: {
    labelKey: 'cardColor.sky',
    face: 'bg-gradient-to-br from-sky-400 to-sky-200',
    ...ON_LIGHT,
    positive: { text: 'text-emerald-700', bar: 'bg-emerald-700' },
    negative: { text: 'text-red-700', bar: 'bg-red-700' },
  },
  indigo: {
    labelKey: 'cardColor.indigo',
    face: 'bg-gradient-to-br from-indigo-800 to-blue-600',
    ...ON_DARK,
    positive: { text: 'text-green-300', bar: 'bg-green-300' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  violet: {
    labelKey: 'cardColor.violet',
    face: 'bg-gradient-to-br from-violet-800 to-purple-600',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  teal: {
    labelKey: 'cardColor.teal',
    face: 'bg-gradient-to-br from-teal-700 to-cyan-500',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  green: {
    labelKey: 'cardColor.green',
    face: 'bg-gradient-to-br from-emerald-700 to-teal-500',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  yellow: {
    /* 가장 밝은 앞면이다. 흰 글씨는 아예 보이지 않아 노랑 계열의 가장 짙은 쪽을 쓴다. */
    labelKey: 'cardColor.blue',
    face: 'bg-gradient-to-br from-yellow-300 to-yellow-100',
    ...ON_LIGHT,
    ink: 'text-yellow-950',
    positive: { text: 'text-emerald-700', bar: 'bg-emerald-700' },
    negative: { text: 'text-red-700', bar: 'bg-red-700' },
  },
  copper: {
    /* 구리. 금색보다 붉고 어두워 흰 글씨가 그대로 읽힌다. */
    labelKey: 'cardColor.copper',
    face: 'bg-gradient-to-br from-[#7c3f1d] via-[#c1743c] to-[#9a5327]',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  amber: {
    /* 따뜻하고 밝은 앞면이라 연한 색은 묻힌다. 양쪽 다 짙은 색으로 적는다. */
    labelKey: 'cardColor.amber',
    face: 'bg-gradient-to-br from-amber-600 to-orange-500',
    ...ON_DARK,
    positive: { text: 'text-emerald-900', bar: 'bg-emerald-900' },
    negative: { text: 'text-red-900', bar: 'bg-red-900' },
  },
  gold: {
    /* 금색은 밝아서 흰 글씨가 날아간다. 글씨를 전부 짙은 쪽으로 내린다. */
    labelKey: 'cardColor.gold',
    face: 'bg-gradient-to-br from-yellow-600 via-amber-400 to-yellow-500',
    ...ON_LIGHT,
    ink: 'text-amber-950',
    positive: { text: 'text-emerald-800', bar: 'bg-emerald-800' },
    negative: { text: 'text-red-800', bar: 'bg-red-800' },
  },
  tan: {
    /* 갈색은 tailwind 기본 팔레트에 없다. 값을 그대로 적는다. */
    labelKey: 'cardColor.tan',
    face: 'bg-gradient-to-br from-[#c89f6d] to-[#e6cfa9]',
    ...ON_LIGHT,
    ink: 'text-[#3f2a12]',
    positive: { text: 'text-emerald-800', bar: 'bg-emerald-800' },
    negative: { text: 'text-red-800', bar: 'bg-red-800' },
  },
  darkbrown: {
    labelKey: 'cardColor.darkbrown',
    face: 'bg-gradient-to-br from-[#3f2415] to-[#7a4a28]',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  rose: {
    labelKey: 'cardColor.rose',
    face: 'bg-gradient-to-br from-rose-700 to-pink-500',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-950', bar: 'bg-red-950' },
  },
  red: {
    /* 붉은 앞면에 붉은 글씨는 묻힌다. 넘긴 표시를 아주 짙은 빨강으로 내린다. */
    labelKey: 'cardColor.darkbrown',
    face: 'bg-gradient-to-br from-red-700 to-rose-500',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-950', bar: 'bg-red-950' },
  },
  burgundy: {
    /* 앞면이 짙은 붉은색이다. 붉은 계열이지만 어두워서 밝은 빨강이 오히려 잘 보인다. */
    labelKey: 'cardColor.burgundy',
    face: 'bg-gradient-to-br from-[#4a0d1c] to-[#8a1538]',
    ...ON_DARK,
    positive: { text: 'text-lime-200', bar: 'bg-lime-200' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  slate: {
    labelKey: 'cardColor.slate',
    face: 'bg-gradient-to-br from-slate-800 to-slate-600',
    ...ON_DARK,
    positive: { text: 'text-green-300', bar: 'bg-green-300' },
    negative: { text: 'text-red-300', bar: 'bg-red-300' },
  },
  black: {
    labelKey: 'cardColor.black',
    face: 'bg-gradient-to-br from-neutral-900 to-neutral-700',
    ...ON_DARK,
    positive: { text: 'text-green-300', bar: 'bg-green-300' },
    negative: { text: 'text-red-400', bar: 'bg-red-400' },
  },
  gray: {
    labelKey: 'cardColor.gray',
    face: 'bg-gradient-to-br from-slate-400 to-slate-300',
    ...ON_LIGHT,
    positive: { text: 'text-emerald-700', bar: 'bg-emerald-700' },
    negative: { text: 'text-red-700', bar: 'bg-red-700' },
  },
  silver: {
    /* 은. 가운데를 밝게 두어 금속처럼 번지게 한다. 회색보다 밝아 글씨는 짙은 쪽이다. */
    labelKey: 'cardColor.slate',
    face: 'bg-gradient-to-br from-[#aeb6c0] via-[#f1f3f6] to-[#98a1ad]',
    ...ON_LIGHT,
    positive: { text: 'text-emerald-700', bar: 'bg-emerald-700' },
    negative: { text: 'text-red-700', bar: 'bg-red-700' },
  },
  white: {
    /* 흰 카드는 테두리가 없으면 화면 바탕에 녹는다. 앞면에 옅은 테두리를 함께 준다. */
    labelKey: 'cardColor.white',
    face: 'bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-300',
    ...ON_LIGHT,
    positive: { text: 'text-emerald-600', bar: 'bg-emerald-600' },
    negative: { text: 'text-red-600', bar: 'bg-red-600' },
  },
};

/** 고를 수 있는 색을 화면에 늘어놓을 순서 그대로. */
export const CARD_COLOR_OPTIONS = CARD_COLORS.map((color) => ({
  color,
  ...CARD_PALETTE[color],
}));

/** 색을 고르지 않은 카드의 기본색. 종류만 보고 정한다. */
export const DEFAULT_CARD_COLOR: Record<'credit' | 'debit', CardColor> = {
  credit: 'blue',
  debit: 'green',
};

/**
 * 카드가 쓸 색.
 *
 * 저장된 값이 비었거나(고른 적 없음) 모르는 값이면(색 목록이 줄어든 뒤) 종류의
 * 기본색으로 떨어진다. 화면이 색 없이 그려지는 일은 없다.
 */
export function cardPaletteOf(
  color: string | null | undefined,
  cardType: 'credit' | 'debit',
): CardPalette {
  return CARD_PALETTE[isCardColor(color) ? color : DEFAULT_CARD_COLOR[cardType]];
}
