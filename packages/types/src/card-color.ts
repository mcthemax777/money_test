/**
 * 카드 앞면 색.
 *
 * 저장하는 것은 이 열쇠말뿐이고 실제 색(그라데이션, 글씨 색)은 화면이 정한다.
 * 색상값을 저장하면 배경이 어두워졌을 때 글씨 색까지 함께 바꿀 수 없다.
 *
 * 카드에 색을 고르지 않았으면 null이고, 화면은 카드 종류의 기본색으로 그린다
 * (신용카드는 파랑, 체크카드는 초록).
 */
export const CARD_COLORS = [
  'blue',
  'sky',
  'indigo',
  'violet',
  'teal',
  'green',
  'yellow',
  'gold',
  'copper',
  'amber',
  'tan',
  'darkbrown',
  'rose',
  'red',
  'burgundy',
  'slate',
  'black',
  'gray',
  'silver',
  'white',
] as const;

export type CardColor = (typeof CARD_COLORS)[number];

export function isCardColor(value: unknown): value is CardColor {
  return typeof value === 'string' && (CARD_COLORS as readonly string[]).includes(value);
}
