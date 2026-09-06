/**
 * 필드별 병합.
 *
 * 전표는 통째로 이기고 지지만, 설정 엔티티(구성원·통장·카드·분류)는 **필드마다** 늦은
 * 값이 이긴다 (설계 문서의 D5). 이름과 색 사이에는 서로 얽힌 불변식이 없어서, 한 사람이
 * 이름을 고치고 다른 사람이 색을 고른 두 편집을 굳이 다투게 할 이유가 없다.
 *
 * 그래서 행마다 **필드 이름 -> 시계**를 함께 둔다. 행 하나에 시계 하나만 두면 나중에
 * 도착한 편집이 자기가 건드리지도 않은 필드까지 이기거나(덮어쓰기) 자기 필드마저 지는
 * 일이 생긴다 -- 어느 쪽도 사용자가 한 일과 다르다.
 *
 * 시계가 없는 필드는 3단계 이전에 쓰인 값이다. 그때는 어떤 명령이든 이긴다. 시계가 없는
 * 쪽이 언제나 이르다는 `compareHlc` 규칙과 같은 자리다.
 */
import { isAfterHlc } from './hlc';

/** 필드 이름 -> 그 필드를 마지막으로 바꾼 시계. 행에 함께 저장한다. */
export type FieldClocks = Record<string, string>;

export interface FieldMergeResult<T> {
  /** 실제로 적용할 필드만 남은 값. 비어 있으면 이 명령은 아무것도 바꾸지 못했다. */
  apply: Partial<T>;
  /** 적용한 필드의 시계를 반영한 새 지도. 그대로 저장한다. */
  clocks: FieldClocks;
  /** 시계가 밀려 버린 필드 이름. 화면에 "무엇이 반영되지 않았는가"를 적을 때 쓴다. */
  lost: string[];
}

/**
 * 들어온 편집에서 **이긴 필드만** 고른다.
 *
 * `patch` 에 담긴 필드만 본다. 담기지 않은 필드는 이 편집이 건드리지 않은 것이라
 * 지도에서도 그대로 둔다.
 *
 * `undefined` 값은 "안 보냈다"는 뜻이라 건너뛴다. 값을 비우는 것은 `null` 이다.
 */
export function mergeFields<T extends object>(
  patch: Partial<T>,
  hlc: string,
  clocks: FieldClocks | null | undefined,
): FieldMergeResult<T> {
  const before: FieldClocks = { ...(clocks ?? {}) };
  const apply: Partial<T> = {};
  const next: FieldClocks = { ...before };
  const lost: string[] = [];

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    /*
     * 같은 시계면 진 것으로 본다.
     *
     * 같은 값이 두 번 오는 경우(재전송)라 적용하지 않아도 결과가 같고, 두 기기가 정말로
     * 같은 밀리초·같은 순번을 냈다면 기기 이름까지 견주는 `compareHlc` 가 이미 갈랐다.
     */
    if (!isAfterHlc(hlc, before[field] ?? null)) {
      lost.push(field);
      continue;
    }

    (apply as Record<string, unknown>)[field] = value;
    next[field] = hlc;
  }

  return { apply, clocks: next, lost };
}

/**
 * 이 행의 마지막 편집 시각.
 *
 * 기기가 "내가 본 값"의 시계로 쓴다. 필드마다 다르므로 그중 가장 늦은 것을 행의 시계로
 * 삼는다. 그 값을 보고 다음 편집의 시계를 매기면 반드시 지금 값보다 뒤가 된다.
 */
export function latestFieldClock(clocks: FieldClocks | null | undefined): string | null {
  let latest: string | null = null;
  for (const value of Object.values(clocks ?? {})) {
    if (isAfterHlc(value, latest)) latest = value;
  }
  return latest;
}
