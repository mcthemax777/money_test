/**
 * 고치기 폼이 보낼 칸만 고른다. 폼을 열 때의 모양(`base`)과 지금 모양(`next`)을 견주어 달라진 칸만 남긴다.
 *
 * 열 때 받은 값을 통째로 다시 보내면, 폼을 열어 둔 사이 다른 구성원이 바꾼 칸(마감일 등)을 옛 값으로
 * 되돌린다 -- 이름만 고쳤는데 남의 수정이 사라진다. 서버는 칸마다 시계를 두어 보낸 칸만 다룬다.
 *
 * 두 모양은 **같은 함수로 만든다.** 날짜·금액처럼 화면 값과 보낼 값의 꼴이 다른 칸도 같은 변환을 거쳐야
 * 그대로인 칸이 "바뀜"으로 보이지 않는다. null 과 undefined 는 같은 것으로 본다.
 */
export function changedPatch<T extends Record<string, unknown>>(next: T, base: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (JSON.stringify(next[key] ?? null) !== JSON.stringify(base[key] ?? null)) out[key] = next[key];
  }
  return out;
}
