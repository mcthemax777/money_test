import { useEffect } from 'react';
import type { Person } from '../lib/types';
import { useUserFilter } from '../store/user-filter';

/**
 * 저장된 자산주인 선택을 이 프로젝트의 구성원에 맞춘다.
 *
 *   - 다른 프로젝트의 선택이 남아 있으면 전체 선택으로 새로 시작한다.
 *     사람 id는 프로젝트마다 다르므로 그대로 두면 "아무도 안 고름"이 되어
 *     화면이 통째로 빈다.
 *   - 이 프로젝트에서 한 번도 건드리지 않았어도 전체 선택으로 시작한다.
 *   - 건드린 적이 있으면 사라진 구성원의 id만 걷어내고 나머지는 존중한다.
 *     (전부 해제한 상태는 사용자의 의도이므로 되살리지 않는다)
 *
 * 가계와 자산이 같은 선택을 쓰므로 맞추는 자리도 하나여야 한다. 한쪽에만 두면
 * 그 화면을 거치지 않고 들어온 경우 선택이 남의 프로젝트 것으로 남는다.
 */
export function usePersonFilterSync(projectId: string | null, people: Person[]) {
  const setPeople = useUserFilter((state) => state.setPeople);

  useEffect(() => {
    if (!projectId) return;
    /*
     * 아직 못 받았거나 구성원이 없는 프로젝트다. 맞출 대상이 없다.
     * 빈 목록으로 맞추면 저장해 둔 선택을 "사라진 구성원"으로 보고 지워 버린다.
     */
    if (people.length === 0) return;

    setPeople(people);

    const allIds = people.map((person) => person.id);
    const state = useUserFilter.getState();

    if (state.filterProjectId !== projectId || !state.personFilterTouched) {
      state.resetPersonFilterFor(projectId, allIds);
      return;
    }

    const validIds = new Set(allIds);
    const stillValid = state.selectedPersonIds.filter((id) => validIds.has(id));
    if (stillValid.length !== state.selectedPersonIds.length) {
      state.setSelectedPersonIds(stillValid);
    }
  }, [projectId, people, setPeople]);
}
