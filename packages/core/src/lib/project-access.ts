/**
 * 이 가계부에서 내보내졌을 때.
 *
 * 소유자가 구성원을 내보내면(또는 가계부를 지우면) 그 사람의 기기는 아무 예고 없이
 * 403 을 받기 시작한다. 그대로 두면 화면은 며칠 지난 값을 그대로 보여 주고, 사람은
 * 그것을 최신으로 믿고 계속 적는다.
 *
 * **알아채는 자리는 여럿이고, 처리하는 자리는 하나다.** 웹은 아무 조회나 403 으로
 * 돌아올 때(`api-client` 의 인터셉터), 앱은 그 위에 동기화가 거절될 때도 알아챈다
 * (`offline.ts`). 어느 쪽이든 여기로 모여 같은 일을 한다 -- 목록을 다시 받고, 남은
 * 가계부로 옮기고, 남은 것이 없으면 고른 것을 비운다(화면은 시작 화면으로 간다).
 *
 * 사람에게 알리는 일은 화면이 한다. 여기서는 스토어에 이름만 적어 두고(`accessLostName`),
 * 웹은 팝업으로, 앱은 Alert 로 그린다.
 */
import { apiClient } from './api-client';
import { useProject, type Project } from '../store/project';

/**
 * 한 번에 하나만 돈다.
 *
 * 화면 하나가 조회를 여럿 보내므로 403 도 여럿 온다. 그때마다 목록을 다시 받으면 같은
 * 일이 수십 번 겹치고, 알림도 그만큼 쌓인다.
 */
let running: Promise<void> | null = null;

/**
 * 내보내졌다는 소식을 처리한다.
 *
 * `lostProjectId` 는 어느 가계부가 막혔는지 아는 쪽(앱의 동기화)이 넘긴다. 모르면
 * 지금 고른 가계부로 본다 -- 화면이 보는 것이 그것이기 때문이다.
 */
export function reportProjectAccessLost(lostProjectId?: string | null): Promise<void> {
  if (running) return running;

  running = handle(lostProjectId ?? null).finally(() => {
    running = null;
  });
  return running;
}

async function handle(lostProjectId: string | null): Promise<void> {
  const { projects, selectedProjectId, setProjects, setSelectedProjectId, setAccessLostName } =
    useProject.getState();

  const target = lostProjectId ?? selectedProjectId;
  if (!target) return;

  /*
   * 서버에 다시 물어 확인한다. **403 하나로 단정하지 않는다** -- 소유자가 남의 가계부를
   * 들여다보다 받은 403 일 수도 있고, 그때 보던 가계부를 빼앗으면 안 된다.
   *
   * 못 물으면(오프라인) 손에 든 목록에서 그 가계부만 뺀다. 이 소식은 서버가 거절해서
   * 온 것이라, 닿지 못한다고 없던 일이 되지는 않는다.
   */
  let rows: Project[];
  try {
    rows = ((await apiClient.getMyProjects()) ?? []) as Project[];
  } catch {
    rows = projects.filter((project) => project.id !== target);
  }

  // 여전히 들어갈 수 있으면 남의 이야기였다.
  if (rows.some((project) => project.id === target)) return;

  const name = projects.find((project) => project.id === target)?.name ?? '';

  setProjects(rows);
  // 보고 있던 것이 막힌 경우에만 옮긴다. 남은 것이 없으면 null 이고, 화면이 시작 화면으로 간다.
  if (selectedProjectId === target) setSelectedProjectId(rows[0]?.id ?? null);

  setAccessLostName(name);
}
