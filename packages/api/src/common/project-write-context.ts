/**
 * 이번 요청이 어느 프로젝트를 고쳤는가.
 *
 * 실시간 신호를 보내려면 요청이 끝난 뒤에 프로젝트 id 를 알아야 하는데, 요청 본문만
 * 보고는 알 수 없다. `PATCH /entries/:id` 처럼 전표 id 만 들고 오는 경로가 있기 때문이다.
 *
 * 그래서 **권한 확인을 거치는 자리**에서 받아 적는다. 데이터를 바꾸는 경로는 예외 없이
 * editor 이상을 요구하며 ProjectAccessService 를 지나간다(그러지 않으면 읽기 전용
 * 구성원이 거래를 고칠 수 있다). 그 길목 하나만 잡으면 새로 붙는 엔드포인트도 빠지지
 * 않는다. 컨트롤러마다 신호를 손으로 넣는 방식은 언젠가 한 곳을 빠뜨리고, 그 한 곳은
 * 아무 오류도 내지 않은 채 화면만 늦게 따라붙는다.
 *
 * 값은 AsyncLocalStorage 로 나른다. 요청 하나가 통째로 그 안에서 돌기 때문에 서비스는
 * 요청 객체를 몰라도 적을 수 있다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ProjectWriteContext {
  /** 이번 요청이 쓰기 권한으로 연 프로젝트들. 보통 하나다. */
  projects: Set<string>;
}

const storage = new AsyncLocalStorage<ProjectWriteContext>();

export function createWriteContext(): ProjectWriteContext {
  return { projects: new Set<string>() };
}

/**
 * 이 문맥 안에서 나머지 요청 처리를 돌린다.
 *
 * 문맥 객체를 밖에서 만들어 넘기는 이유는, 요청이 끝난 뒤(res 의 finish 이벤트)에는
 * 이 저장소를 읽을 수 없기 때문이다. 이벤트 콜백은 다른 비동기 문맥에서 돈다.
 * 객체를 손에 들고 있으면 그때도 그대로 읽는다.
 */
export function runWithWriteContext<T>(context: ProjectWriteContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** 쓰기 권한으로 프로젝트를 열었다고 적는다. 문맥 밖(스크립트, 배치)이면 아무 일도 없다. */
export function recordProjectWrite(projectId: string): void {
  storage.getStore()?.projects.add(projectId);
}
