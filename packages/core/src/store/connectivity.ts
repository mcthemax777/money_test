/**
 * 지금 서버에 닿는가.
 *
 * 오프라인에서 할 수 있는 일과 할 수 없는 일이 갈리기 때문에 필요하다. 거래와 설정은
 * 사본에 적고 나중에 보내면 되지만, **범위를 질의해 여러 행을 고치는 조작**은 그럴 수
 * 없다 -- 며칠 뒤에 재생하면 그 사이 달라진 집합 위에서 다른 결과가 나온다
 * (설계 문서의 D12). 예산 구간 편집, 잔액 맞추기, 환율 설정, 프로젝트·멤버가 그것이다.
 *
 * 그런 자리는 큐에 담아 두었다가 엉뚱한 결과를 만드는 대신 **지금 막고 이유를 말한다.**
 *
 * 값은 서버를 부른 결과로만 바뀐다. 기기의 연결 상태를 따로 묻지 않는 이유는, 와이파이에
 * 붙어 있어도 서버에 닿지 못하는 경우가 흔하고 우리가 알고 싶은 것은 후자이기 때문이다.
 */
import { create } from 'zustand';

interface ConnectivityStore {
  /** 마지막으로 서버를 불렀을 때 닿지 못했는가. 처음에는 닿는다고 본다. */
  isOffline: boolean;
  setOffline: (value: boolean) => void;
}

export const useConnectivity = create<ConnectivityStore>()((set) => ({
  isOffline: false,
  /** 같은 값이면 그리기를 다시 시키지 않는다. 요청마다 부르는 자리라 값이 잦다. */
  setOffline: (value) =>
    set((state) => (state.isOffline === value ? state : { isOffline: value })),
}));

/** 스토어 밖(인터셉터)에서 쓰는 통로. */
export function markOffline(value: boolean): void {
  useConnectivity.getState().setOffline(value);
}
