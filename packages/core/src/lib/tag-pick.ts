/**
 * 여러 거래의 태그를 한 번에 손보는 창의 규칙.
 *
 * 알약 하나는 세 갈래로 열린다.
 *
 *   켜짐   고른 거래가 **전부** 가진 태그. 끄면 전부에서 뗀다.
 *   일부   **일부만** 가진 태그. 켜면 전부에 붙는다. 그대로 두면 아무 일도 없다.
 *   꺼짐   아무도 가지지 않았다. 켜면 전부에 붙는다.
 *
 * 웹과 앱이 같은 창을 그리므로 규칙을 여기 한 벌 둔다. 화면마다 따로 두면 한쪽만
 * 고쳤을 때 같은 창이 기기에 따라 다르게 움직인다.
 */

/** 알약 하나가 놓인 자리. */
export type TagPickState = 'on' | 'partial' | 'off';

/**
 * 사용자가 켜고 끈 것. 여기 없는 태그는 처음 상태 그대로다.
 *
 * **처음 상태에서 달라진 것만 보낸다**는 규칙이 이 모양에서 나온다. 켜진 채로 둔 것도,
 * 꺼진 채로 둔 것도 이 표에 없으므로 손대지 않는다.
 */
export type TagPickChanges = Record<string, boolean>;

export function tagPickState(
  tagId: string,
  changed: TagPickChanges,
  /** 고른 거래가 모두 가진 태그 */
  commonTagIds: readonly string[],
  /** 일부만 가진 태그 */
  partialTagIds: readonly string[],
): TagPickState {
  const touched = changed[tagId];
  if (touched !== undefined) return touched ? 'on' : 'off';
  if (commonTagIds.includes(tagId)) return 'on';
  if (partialTagIds.includes(tagId)) return 'partial';
  return 'off';
}

/**
 * 알약을 한 번 누른 결과.
 *
 * 처음이 "일부"였던 태그는 **켜짐과 일부 사이만** 오간다. 셋째 자리가 없기 때문이다 --
 * 일부만 붙은 태그를 끄는 것은 "가진 것들에서 떼라"는 뜻인데, 어느 거래가 그것을
 * 가졌는지 화면에 보이지 않아 이 창이 하지 않는 일이다.
 *
 * 그래서 되돌리는 한 번은 꺼짐이 아니라 처음의 "일부"로 간다. 꺼짐으로 보내면 빗금만
 * 사라지고 확인해도 아무 일이 없어, 뗀 것으로 읽은 사용자와 결과가 어긋난다.
 */
export function toggleTagPick(
  tagId: string,
  changed: TagPickChanges,
  commonTagIds: readonly string[],
  partialTagIds: readonly string[],
): TagPickChanges {
  const state = tagPickState(tagId, changed, commonTagIds, partialTagIds);

  if (partialTagIds.includes(tagId)) {
    const next = { ...changed };
    // 손댄 적이 없는 상태로 되돌린다. tagPickState 가 다시 "일부"로 읽는다.
    if (state === 'on') delete next[tagId];
    else next[tagId] = true;
    return next;
  }

  return { ...changed, [tagId]: state !== 'on' };
}

/** 서버로 보낼 것. 더하는 것과 떼는 것 모두 처음 상태에서 달라진 것뿐이다. */
export function tagPickResult(
  tagIds: readonly string[],
  changed: TagPickChanges,
  commonTagIds: readonly string[],
): { addTagIds: string[]; removeTagIds: string[] } {
  return {
    addTagIds: tagIds.filter((id) => changed[id] === true && !commonTagIds.includes(id)),
    removeTagIds: tagIds.filter((id) => changed[id] === false && commonTagIds.includes(id)),
  };
}
