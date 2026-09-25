/**
 * 차례 바꾸기의 셈. 목록이 일부만 보일 때 쓴다.
 */

/**
 * 보이는 것만 끌어 옮겼을 때의 **전체** 차례.
 *
 * 자산 목록은 고른 자산주인만 보여 주는데, 차례를 저장하는 곳은 구성원 전부를 다룬다
 * (서버의 `reorderPeople` 은 받은 목록에만 차례 값을 고르게 다시 매긴다). 보이는
 * 것들만 늘어놓아 보내면 빠진 사람들의 자리가 그 사이로 뭉개져 들어간다.
 *
 * 보이는 것들이 앉아 있던 자리를 그대로 두고 그 자리에만 새 차례를 끼워 넣는다.
 * 보이지 않는 것은 제 자리에 남는다.
 *
 * @param allIds 지금의 전체 차례.
 * @param movedIds 보이는 것들의 새 차례. `allIds` 에 없는 것은 무시한다.
 */
export function mergeOrder(allIds: readonly string[], movedIds: readonly string[]): string[] {
  const moving = new Set(movedIds);
  const queue = movedIds.filter((id) => allIds.includes(id));

  let next = 0;
  return allIds.map((id) => (moving.has(id) ? (queue[next++] ?? id) : id));
}
