/**
 * 옮긴 자리를 순서 값 하나로 바꾼다.
 *
 * 화면은 "이 항목을 몇 번째로 옮겼다"를 안다. 저장할 것은 그 자리의 값 하나뿐이다
 * (`rank.ts`). 목록 전체를 다시 쓰지 않는 것이 요점이다 -- 그래야 두 사람이 각자 다른
 * 항목을 옮겨도 둘 다 남는다 (설계 문서의 D5).
 *
 * 웹과 앱이 같은 함수를 쓴다. 한쪽만 다르게 계산하면 같은 드래그가 기기마다 다른 자리로
 * 간다. 순수 함수라 여기(types)에 산다 -- 수렴 검사가 서버 쪽에서 이 함수를 그대로 부른다.
 */
import { rankBetween } from './rank';

/** 순서를 가진 줄. 목록에 그려진 차례 그대로 넘긴다. */
export interface RankedRow {
  id: string;
  sortRank?: string | null;
}

/**
 * `id` 를 `toIndex` 자리로 옮겼을 때의 새 순서 값.
 *
 * `toIndex` 는 **옮긴 뒤의 자리**다 (화면이 보여 주는 그 자리). 옮기는 항목을 목록에서
 * 빼고 나서 앞뒤 이웃을 고르므로, 아래로 옮길 때와 위로 옮길 때를 따로 다루지 않아도 된다.
 *
 * 자리가 그대로면 null 을 돌려준다. 그때는 아무것도 보내지 않는다 -- 값을 새로 찍으면
 * 그 필드의 시계만 올라가, 그 사이 남이 옮긴 것을 이유 없이 되돌린다.
 */
export function rankForMove(
  rows: readonly RankedRow[],
  id: string,
  toIndex: number,
): string | null {
  const from = rows.findIndex((row) => row.id === id);
  if (from < 0) return null;

  const target = Math.max(0, Math.min(toIndex, rows.length - 1));
  if (target === from) return null;

  const rest = rows.filter((row) => row.id !== id);
  const before = target > 0 ? rest[target - 1]?.sortRank ?? null : null;
  const after = rest[target]?.sortRank ?? null;

  return rankBetween(before, after);
}

/**
 * `id` 를 한 칸 위(-1)나 아래(+1)로 옮겼을 때의 새 순서 값.
 *
 * 드래그가 없는 화면(앱)이 쓴다. 목록의 끝에서 더 밀면 자리가 그대로라 null 이 나오고,
 * 그때는 아무것도 보내지 않는다.
 */
export function rankForStep(
  rows: readonly RankedRow[],
  id: string,
  step: 1 | -1,
): string | null {
  const from = rows.findIndex((row) => row.id === id);
  if (from < 0) return null;
  return rankForMove(rows, id, from + step);
}
