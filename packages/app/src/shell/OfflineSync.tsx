/*
 * 고른 프로젝트를 서버와 맞추는 자리.
 *
 * 화면을 그리지 않는다. 동기화를 걸어 두는 일만 한다. 화면 안에 두지 않는 이유는
 * 화면마다 같은 코드를 두지 않기 위해서다.
 *
 * 맞추는 순간은 여섯이다. 프로젝트를 고를 때, 거래를 저장한 직후(`useLocalWrites`),
 * 서버가 알려 올 때, 앱이 앞으로 돌아올 때, **회선이 돌아올 때**, 그리고 못 보낸 것이
 * 남아 있는 동안 간격을 늘려 가며 두드릴 때. 앱을 여는 순간은 첫째에 들어간다.
 *
 * 실패는 조용히 넘긴다. 사본은 이미 읽을 수 있고, 오프라인은 오류가 아니다.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';

import { reportProjectAccessLost } from '@money/core/lib/project-access';
import { useProject, useProjectTimeZone } from '@money/core/store/project';

import {
  listenForChanges,
  setAccessLostHandler,
  syncNow,
  unsentCount,
  useLocalWrites,
} from '../offline';

/**
 * 못 보낸 것이 남아 있을 때 다시 시도하기까지 기다리는 시간. 곱절로 늘리되 여기서 멈춘다.
 *
 * 회선이 돌아온 것을 아는 길은 둘이다 -- 안드로이드가 알려 주는 연결 상태와, 이 시계다.
 * 앞의 것만으로는 모자라다. "연결됨"인데 서버에 닿지 못하는 자리가 흔하기 때문이다
 * (로그인이 필요한 공용 와이파이, 신호만 잡힌 셀룰러, 서버가 잠깐 죽은 동안).
 */
const RETRY_START_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export default function OfflineSync() {
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();

  /*
   * 동기화가 "더 갈 수 없다"로 돌아오면 그대로 넘긴다.
   *
   * 사본은 이미 버려졌다(`offline.ts`). 그 뒤에 할 일 -- 목록을 다시 받고, 남은 가계부로
   * 옮기고, 사람에게 알리는 것 -- 은 core 가 한 자리에서 한다(`reportProjectAccessLost`).
   * 웹도 같은 자리를 쓴다. 알림을 그리는 것은 App 의 `ProjectAccessLostAlert` 다.
   *
   * 조용히 넘기면 안 되는 자리다. 오류가 나지 않으니 사용자는 며칠 지난 사본을 최신으로
   * 믿고, 거기에 계속 적는다.
   */
  useEffect(() => {
    setAccessLostHandler((lostId) => void reportProjectAccessLost(lostId));
    return () => setAccessLostHandler(null);
  }, []);

  // 쓰기 창구를 이 프로젝트의 사본으로. 그려지기 전에 걸어 두어야 첫 입력이 새지 않는다.
  useLocalWrites(projectId ?? '', timeZone);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    /*
     * 다시 시도를 거는 시계. 하나만 둔다.
     *
     * 여러 자리에서 동기화가 시작되므로(시작·복귀·연결 복구·저장 직후) 시계가 여럿이면
     * 같은 일이 겹쳐 돈다.
     */
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = RETRY_START_MS;

    const stopRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryDelay = RETRY_START_MS;
    };

    /** 한 번 맞추고 결과를 남긴다. 어디서 시작했는지(`왜`)를 함께 적는다. */
    const run = async (why: string) => {
      const result = await syncNow(projectId, timeZone);
      if (cancelled || !result) return;

      if (result.offline) {
        console.log(`오프라인(${why}). 기기 사본으로 그린다.`);
        scheduleRetry();
        return;
      }
      // 사본을 처음부터 다시 받은 것은 드문 일이라 눈에 띄게 남긴다.
      const rebuilt = result.rebuilt ? ' [사본을 처음부터 다시 받음]' : '';
      console.log(
        `동기화 완료(${why}). 번호 ${result.version} (요청 ${result.rounds}회, 올림 ${result.pushed}건, 보류 ${result.held}건)${rebuilt}`,
      );

      /*
       * 올라가지 못하고 남은 것이 있으면 계속 두드린다.
       *
       * 서버에 닿았는데도 남았다면 묶음을 줄여 가며 보내는 중이거나(느린 회선) 큐가
       * 길어 한 번에 다 못 간 것이다. 보류 칸(held)은 사람이 손대야 풀리므로 세지 않는다.
       */
      const { pending } = await unsentCount(projectId);
      if (cancelled) return;
      if (pending > 0) scheduleRetry();
      else stopRetry();
    };

    /** 못 보낸 것이 남아 있는 동안 간격을 늘려 가며 다시 시도한다. */
    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;

      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void run('다시 시도');
      }, delay);
    };

    void run('시작');

    /*
     * 서버가 바뀐 것을 알려 오면 그때마다 다시 맞춘다.
     *
     * 다른 사람이 웹에서 고친 것이 이 길로 들어온다. 알림이 오지 않아도 위의 한 번과
     * 저장 직후의 동기화가 있으므로 화면이 틀리지는 않는다 -- 늦게 따라붙을 뿐이다.
     */
    const listener = listenForChanges(projectId, timeZone);

    /*
     * 앞으로 돌아올 때 한 번 맞춘다.
     *
     * 잠든 사이 알림 연결이 끊기면 다시 붙기까지 최대 1분을 기다리는데, 하필 사용자가
     * 화면을 보고 있는 그 1분이 가장 긴 기다림이 된다. 그래서 둘을 함께 한다 --
     * **밀린 것을 지금 받고**(syncNow), **기다리는 중이면 그만 기다리게 한다**(wake).
     * 붙어 있으면 wake 는 아무 일도 하지 않는다.
     *
     * `background`·`inactive` 에서 돌아올 때만이다. 안드로이드는 화면을 켤 때마다
     * `active` 를 다시 보내는 일이 있어, 이전 상태를 보지 않으면 그때마다 동기화가 돈다.
     */
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const returned = previous !== 'active' && next === 'active';
      previous = next;
      if (!returned || cancelled) return;

      stopRetry();
      listener.wake();
      void run('복귀');
    });

    /*
     * 회선이 돌아오면 그 자리에서 맞춘다.
     *
     * 앱을 켜 둔 채로 지하철에 들어갔다 나오는 자리다. 앞으로 돌아오는 것도 아니고 저장을
     * 누르는 것도 아니라, 이 신호가 없으면 알림 연결이 스스로 다시 붙을 때까지(최대 1분)
     * 아무 일도 일어나지 않는다 -- 그동안 적어 둔 거래는 기기에만 남아 있다.
     *
     * 간격 시계도 함께 되돌린다. 기다리던 것이 길어져 있었어도 회선이 돌아온 지금은
     * 곧바로 해 볼 자리다.
     */
    let wasOnline = true;
    const network = Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      // isInternetReachable 은 아직 모를 때 undefined 다. 그때는 연결 여부만 본다.
      const online = Boolean(isConnected) && isInternetReachable !== false;
      const returned = !wasOnline && online;
      wasOnline = online;
      if (!returned || cancelled) return;

      stopRetry();
      listener.wake();
      void run('연결 복구');
    });

    return () => {
      cancelled = true;
      stopRetry();
      subscription.remove();
      network.remove();
      listener.close();
    };
  }, [projectId, timeZone]);

  return null;
}
