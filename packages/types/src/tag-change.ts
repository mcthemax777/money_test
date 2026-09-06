/**
 * 전표 하나의 태그를 바꾸는 규칙.
 *
 * 서버(`EntriesService.changeTags`)와 기기 사본(`LocalStore.changeEntryTags`)이 함께 쓴다.
 * 두 곳이 각자 판단하면 오프라인에서 본 결과와 서버가 재생한 결과가 갈리는데, 그 어긋남은
 * 다음 동기화가 사본을 덮을 때에야 드러난다.
 *
 * 규칙은 셋이다.
 *
 *   1. **더할 것과 뗄 것만 건드린다.** 어느 쪽에도 없는 태그는 그대로 둔다. 목록 하나를
 *      "이것이 전부다"로 받으면 화면에 보이지 않던 태그가 사라진다.
 *   2. **이미 그런 상태면 아무 일도 하지 않는다.** 붙어 있는 것을 다시 붙이거나 없는
 *      것을 떼는 것은 달라짐이 아니다. 그래서 같은 명령을 두 번 재생해도 안전하다.
 *   3. **서로 다른 태그를 건드리는 두 명령은 순서를 바꿔도 결과가 같다.** 두 사람이
 *      각자 다른 태그를 붙였을 때 둘 다 남는다는 뜻이고, 이 갈래를 통째 교체(`entry.replace`)
 *      로 표현하지 않은 이유다.
 *
 * 같은 태그를 더하면서 떼라는 요청은 여기서 다루지 않는다. 어느 쪽을 먼저 적용하느냐로
 * 결과가 갈리는데 그 순서는 사용자가 정한 것이 아니다. 부르는 쪽이 미리 거절한다.
 */

/** 이 전표에서 실제로 달라지는 것. 아무것도 없으면 둘 다 빈 배열이다. */
export interface TagChange {
  /** 새로 붙일 태그. 이미 붙어 있던 것은 빠진다. */
  added: string[];
  /** 떼어 낼 태그. 붙어 있지 않던 것은 빠진다. */
  removed: string[];
  /** 바뀐 뒤의 전체 태그. */
  next: Set<string>;
  /** 하나라도 달라지는가. 전표의 시계와 번호를 올릴지 정하는 값이다. */
  changed: boolean;
}

export function applyTagChange(
  current: Iterable<string>,
  addTagIds: readonly string[],
  removeTagIds: readonly string[],
): TagChange {
  const next = new Set(current);
  const added: string[] = [];
  const removed: string[] = [];

  for (const tagId of addTagIds) {
    if (next.has(tagId)) continue;
    next.add(tagId);
    added.push(tagId);
  }

  for (const tagId of removeTagIds) {
    if (!next.delete(tagId)) continue;
    removed.push(tagId);
  }

  return { added, removed, next, changed: added.length > 0 || removed.length > 0 };
}
