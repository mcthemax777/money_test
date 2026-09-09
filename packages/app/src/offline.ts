/*
 * 이 기기의 오프라인 준비.
 *
 * 하는 일은 다섯이다.
 *   1. 사본을 연다.
 *   2. 읽기 창구(홈·가계)를 사본으로 갈아 끼운다.
 *   3. 프로젝트를 고를 때마다 쓰기 창구를 그 프로젝트의 사본으로 갈아 끼운다.
 *   4. 서버와 맞춘다 -- 쌓인 명령을 밀어 올린 뒤 바뀐 것을 받는다.
 *   5. 서버가 "바뀌었다"고 알려 오면 곧바로 4번을 다시 돈다.
 *
 * 동기화가 실패해도 화면을 막지 않는다. 사본이 이미 읽을 수 있는 상태이고, 오프라인은
 * 오류가 아니라 상태다.
 */
import { fetch as streamingFetch } from 'expo/fetch';

import { apiClient } from '@money/core/lib/api-client';
import { getAccessToken } from '@money/core/lib/auth-tokens';
import { apiErrorCode } from '@money/core/lib/api-error';
import { setSettingsWritePort } from '@money/core/data/settings-write-port';
import { entryWritePort, setEntryWritePort } from '@money/core/data/entry-write-port';
import { httpHomePort, setHomeDataPort } from '@money/core/data/home-port';
import { createLocalSettingsWriter } from '@money/core/data/local-settings-writer';
import { createLocalEntryWriter } from '@money/core/data/local-entry-writer';
import { createLocalHomePort } from '@money/core/data/local-home-port';
import { setDraftPort } from '@money/core/data/draft-port';
import { createLocalDraftPort, flushDraftOps } from '@money/core/data/local-draft-port';
import type { HeldMutation, LocalStore } from '@money/core/data/local-store';
import { notifyMirrorChanged } from '@money/core/data/mirror-events';
import { setMirrorOwnership, setMirrorTeardown } from '@money/core/data/mirror-teardown';
import {
  openSyncEvents,
  type StreamingFetch,
  type SyncEventsHandle,
} from '@money/core/data/sync-events';
import { syncProject, type SyncResult } from '@money/core/data/sync-engine';
import {
  newId,
  type EntryDto,
  type EntryMutationPayload,
  type Mutation,
} from '@money/types';

import { claimMirrorOwner, mirrorOwner } from './mirror-key';
import { deleteLocalStore, openLocalStore } from './sqlite';

let store: LocalStore | null = null;

/**
 * 지금 돌고 있는 동기화. 겹치지 않게 이어 붙이는 데 쓴다.
 *
 * 동기화는 세 갈래에서 시작한다 -- 프로젝트를 고를 때, 서버가 알림을 보낼 때, 거래를
 * 적자마자. 겹치면 같은 명령을 두 번 밀어 올리고(서버가 멱등으로 걸러 주지만 헛일이다)
 * 무엇보다 사본에 두 트랜잭션이 겹쳐 열린다. 한 줄로 세우면 둘 다 사라진다.
 */
let running: Promise<unknown> = Promise.resolve();

/**
 * 사본을 열고 홈 창구를 그것으로 바꾼다. 앱이 시작할 때 한 번 부른다.
 *
 * 사본을 열지 못하면(기기 저장소 문제) 서버 창구를 그대로 둔다. 오프라인만 못 하고
 * 앱은 지금까지처럼 돈다.
 */
export async function setupOffline(): Promise<boolean> {
  try {
    store = await openLocalStore();
    setHomeDataPort(createLocalHomePort(store, { fallback: httpHomePort }));
    /*
     * 보관함도 사본에서 읽는다.
     *
     * 알림으로 담은 후보는 이 기기에서 만든 것이라 오프라인에서도 보여야 하고, 무시·
     * 등록도 그때 눌려야 한다. 서버에 알리는 일은 대기 큐를 지나 동기화가 맡는다.
     */
    setDraftPort(createLocalDraftPort(store));
    /*
     * 기기 이름. 한 번 만들고 계속 쓴다.
     *
     * 새로 만들면 서버가 보기에 다른 기기가 되어 (기기, 순번) 멱등이 끊긴다. 그러면
     * 응답을 못 받고 다시 보낸 지출이 두 번 적힌다.
     */
    await store.ensureClient(newId);
    // 세션이 끝날 때 core 가 사본을 버릴 수 있게 방법을 등록한다.
    setMirrorTeardown(clearOffline);
    /*
     * 사본의 주인을 읽고 적는 방법도 함께 등록한다.
     *
     * 로그인 스토어의 사용자는 401 을 받는 순간 비워지므로, 주인이 바뀌었는지는 사본
     * 쪽에 적어 둔 값으로만 알 수 있다 (D10).
     */
    setMirrorOwnership({ get: mirrorOwner, claim: claimMirrorOwner });
    return true;
  } catch (error) {
    console.error('기기 사본을 열지 못했습니다. 서버에서 바로 읽습니다:', error);
    store = null;
    setHomeDataPort(null);
    setDraftPort(null);
    return false;
  }
}

/**
 * 거래 쓰기를 이 프로젝트의 사본으로 돌린다.
 *
 * 프로젝트가 바뀔 때마다 다시 부른다. 쓰기 창구는 프로젝트와 타임존을 알아야 하는데,
 * 그 둘은 앱이 도는 동안 바뀐다.
 */
export function useLocalWrites(projectId: string, timeZone: string): void {
  if (!store) return;

  // 쌓자마자 한 번 보내 본다. 온라인이면 여기서 나가고, 아니면 큐에 남는다.
  const onQueued = () => void syncNow(projectId, timeZone);

  setEntryWritePort(createLocalEntryWriter({ store, projectId, timeZone, onQueued }));
  // 설정 엔티티(구성원·통장·카드·분류·태그)도 같은 길로 간다. 병합 규칙만 다르다 (필드별).
  setSettingsWritePort(createLocalSettingsWriter({ store, projectId, onQueued }));
}

/**
 * 이 가맹점을 지난번에 무슨 분류로 적었는가. 보관함이 후보의 분류를 짐작할 때 쓴다.
 *
 * 사본에서 읽는다. 서버에 묻지 않는 이유는 알림 한 뭉치를 담을 때 그만큼 요청이
 * 늘고, 오프라인에서도 짐작은 되어야 하기 때문이다. 사본이 없으면 빈 목록이다.
 */
export async function merchantHistory(
  projectId: string,
): Promise<Array<{ merchant: string | null; description: string; categoryId: string | null }>> {
  if (!store) return [];
  return store.merchantHistory(projectId);
}

/** 보류 칸. 충돌과 거절이 여기 모인다. 화면이 사용자에게 보여 준다. */
export async function heldMutations(projectId: string): Promise<HeldMutation[]> {
  if (!store) return [];
  return store.heldMutations(projectId);
}

/**
 * 아직 서버에 닿지 못하고 줄을 선 명령.
 *
 * 오프라인에서 적은 거래가 여기 있다. 보류 칸과 달리 사람이 할 일은 없지만, 보이지
 * 않으면 "보내지 못한 거래"를 열어 놓고도 아무것도 없다고 읽게 된다.
 */
export async function queuedMutations(projectId: string): Promise<Mutation[]> {
  if (!store) return [];
  return store.pendingMutations(projectId);
}

/** 보류 칸에서 하나를 버린다. 사용자가 "그만두겠다"를 고른 자리다. */
export async function discardMutation(mutationId: string): Promise<void> {
  await store?.discardMutation(mutationId);
}

/**
 * 막혔던 명령을 다시 낸다.
 *
 * 저장소가 짐만 물려받아 **새 명령**으로 만든다. 같은 id 로 다시 보내면 서버가 그때의
 * 판정(충돌·거절)을 그대로 돌려주어 영영 나가지 못한다.
 */
export async function retryMutation(mutationId: string): Promise<void> {
  await store?.retryMutation(mutationId, newId);
}

/**
 * 고치려던 거래가 사라진 명령을 **새 거래로** 다시 낸다.
 *
 * 그 사이 다른 사람이 지웠다는 뜻이고, 삭제는 언제나 이기므로(D5) 다시 보내도 영영
 * 거절된다. 지금까지는 버리는 길밖에 없어 오프라인에서 적은 내용이 사라졌다.
 *
 * 되살리지 않고 **새로 적는다.** 지운 사람의 뜻을 뒤집지 않으면서, 적은 내용을 잃지도
 * 않는 자리다. 고르는 것은 사람이다 -- 이 함수는 사용자가 그 버튼을 눌렀을 때만 돈다.
 *
 * 만들기를 먼저 하고 큐에서 뺀다. 그 사이에 앱이 죽으면 보류 칸에 한 줄이 남을 뿐이고,
 * 순서를 뒤집으면 적은 내용이 사라진다.
 */
export async function reissueAsNewEntry(mutation: HeldMutation): Promise<void> {
  if (!store) return;
  if (mutation.kind !== 'entry.replace') return;

  // 짐에서 옛 전표 id 만 뺀다. 나머지는 만들기 요청과 같은 모양이다.
  const { id: _replaced, ...rest } = mutation.payload as EntryMutationPayload;
  await entryWritePort().createEntry({
    ...rest,
    projectId: mutation.projectId,
  } as unknown as EntryDto.CreateRequest);

  await store.discardMutation(mutation.mutationId);
}

/**
 * 이 프로젝트에 더 갈 수 없게 되었는가.
 *
 * 서버가 붙인 코드로만 판단한다. 맨 403 을 그렇게 보면 안 된다 -- **editor 에서 viewer
 * 로 내려간 기기**도 명령을 올릴 때 403 을 받는데, 그쪽은 아직 구성원이라 사본을 지우면
 * 볼 수 있는 것까지 잃고 아직 못 보낸 명령도 함께 사라진다.
 */
function isAccessLost(error: unknown): boolean {
  const code = apiErrorCode(error);
  return code === 'PROJECT_FORBIDDEN' || code === 'NOT_PROJECT_MEMBER';
}

/** 접근이 끊겼다는 것을 화면에 알리는 방법. 앱 껍데기가 등록한다. */
type AccessLostHandler = (projectId: string) => void;

let onAccessLost: AccessLostHandler | null = null;

/**
 * 접근이 끊겼을 때 부를 곳을 등록한다.
 *
 * 사본을 지우는 일은 여기서 하고, 사람에게 알리고 다른 프로젝트로 옮기는 일은 화면이
 * 한다. 이 파일은 화면을 모른다 (사본을 버리는 방법을 core 가 아니라 앱이 등록하는
 * 것과 같은 이유다).
 */
export function setAccessLostHandler(handler: AccessLostHandler | null): void {
  onAccessLost = handler;
}

/**
 * 고른 프로젝트를 서버와 맞춘다.
 *
 * 프로젝트를 고른 뒤와 화면을 다시 열 때 부른다. 쌓인 명령을 먼저 밀어 올리고, 그다음
 * 사본이 비어 있으면 처음부터, 이미 있으면 그 뒤의 변경만 받는다.
 */
export function syncNow(projectId: string, timeZone: string): Promise<SyncResult | null> {
  const task = async (): Promise<SyncResult | null> => {
    /*
     * 사본은 시작할 때가 아니라 **차례가 되었을 때** 본다.
     *
     * 앞의 동기화를 기다리는 동안 로그아웃이 사본을 버렸을 수 있다. 그때는 이미 닫힌
     * 연결을 쓰지 않고 그대로 그만둔다.
     */
    const mine = store;
    if (!mine) return null;

    try {
      const result = await syncProject(
        mine,
        (query) => apiClient.pullSync(query),
        projectId,
        timeZone,
        (request) => apiClient.pushSync(request),
        /*
         * 보관함 처리를 받기 전에 올린다. 순서가 뒤집히면 오프라인에서 등록한 후보가
         * 서버의 대기 상태에 덮여 되살아난다 (sync-engine 의 주석에 이유를 적었다).
         */
        (id) => flushDraftOps(mine, id),
      );
      // 사본이 채워졌으면 화면이 다시 읽게 알린다.
      if (result.changed) notifyMirrorChanged();
      return result;
    } catch (error) {
      /*
       * 이 프로젝트에 더 갈 수 없게 되었는가.
       *
       * 내보내졌거나, 탈퇴했거나, 프로젝트 자체가 지워진 경우다. 지금까지는 이것도
       * 그냥 삼켜서, 기기에는 남의 가계부가 **최신인 것처럼** 남아 있었다. 오류가 나지
       * 않으니 사용자는 며칠 지난 사본을 그대로 믿는다.
       *
       * 그래서 사본을 버리고 그 사실을 알린다. 아직 보내지 못한 명령도 함께 사라지는데,
       * 어차피 그 프로젝트에는 쓸 수 없으므로 보낼 곳이 없다.
       */
      if (isAccessLost(error)) {
        console.warn('이 프로젝트에 더 접근할 수 없습니다. 기기 사본을 버립니다.');
        /*
         * 버리는 일은 이 동기화가 끝난 뒤에 한다. **여기서 기다리면 안 된다** --
         * `clearOffline` 은 돌고 있는 동기화가 끝나기를 기다리는데, 지금 돌고 있는 것이
         * 바로 이 동기화라 서로를 기다리며 멈춘다.
         */
        void Promise.resolve().then(async () => {
          await clearOffline();
          onAccessLost?.(projectId);
        });
        return null;
      }

      // 인증이 끊긴 경우이거나, 도는 동안 사본이 닫힌 경우다. 어느 쪽도 화면을 막지 않는다.
      console.error('동기화 실패:', error);
      return null;
    }
  };

  const started = running.then(task, task);
  running = started.catch(() => undefined);
  return started;
}

/**
 * 사본을 지운다. 로그아웃하거나 다른 사용자가 로그인할 때 부른다.
 *
 * 표를 비우는 것으로는 모자라다. 파일이 남으면 그 안에 지난 사용자의 거래가 그대로 있다.
 */
export async function clearOffline(): Promise<void> {
  store = null;
  setHomeDataPort(null);
  setEntryWritePort(null);
  setSettingsWritePort(null);
  // 보관함도 서버 창구로 되돌린다. 사본이 없으면 읽을 자리가 없다.
  setDraftPort(null);

  /*
   * 돌고 있는 동기화가 끝나기를 기다린다.
   *
   * 기다리지 않고 파일을 지우면 그 동기화가 닫힌 연결을 쓴다. 위에서 `store` 를 이미
   * 비웠으므로 여기서 기다리는 것은 마지막 한 번뿐이고, 그다음 것은 시작하지 않는다.
   */
  await running.catch(() => undefined);

  try {
    await deleteLocalStore();
  } catch (error) {
    console.error('기기 사본을 지우지 못했습니다:', error);
    return;
  }

  /*
   * 빈 사본을 다시 연다.
   *
   * 여기서 멈추면 다음 사용자는 앱을 껐다 켤 때까지 오프라인 없이 지낸다. setupOffline
   * 은 앱이 시작할 때 한 번만 도는데, 로그아웃과 로그인은 앱을 켠 채로 일어나기 때문이다.
   */
  await setupOffline();
}

/**
 * 서버의 알림에 귀를 연다. 돌려주는 것으로 닫거나(`close`) 다시 붙일 수 있다(`wake`).
 *
 * 알림에는 번호만 실려 온다. 그것을 신호로 평소의 동기화를 한 번 더 돌릴 뿐이라,
 * 실시간이 되어도 값이 오는 길은 하나 그대로다. 알림이 끊긴 동안에도 화면이 틀리지
 * 않는 이유가 이것이다 -- 늦게 따라붙을 뿐이다.
 *
 * 스트리밍 fetch 를 expo 에서 받아 넣는다. 리액트 네이티브의 기본 fetch 는 응답을
 * 끝까지 받아야 돌려주고, EventSource 는 아예 없다.
 */
export function listenForChanges(projectId: string, timeZone: string): SyncEventsHandle {
  if (!store) return { close: () => {}, wake: () => {} };

  return openSyncEvents({
    baseUrl: apiClient.baseUrl,
    projectId,
    // 붙을 때마다 부른다. 만료가 코앞이면 여기서 갱신되어 401 로 끊기지 않는다.
    getToken: async () => {
      await apiClient.ensureFreshToken();
      return getAccessToken();
    },
    fetchFn: streamingFetch as unknown as StreamingFetch,
    onVersion: () => {
      void syncNow(projectId, timeZone);
    },
    onError: (error) => {
      // 다시 붙는 일은 core 가 맡는다. 여기서는 남기기만 한다.
      console.log('알림 연결 오류:', error instanceof Error ? error.message : error);
    },
  });
}

/**
 * 이 기기에 아직 서버로 못 보낸 것이 몇 건인가. 프로젝트를 가리지 않는다.
 *
 * 로그인 화면이 쓴다. 토큰이 만료되면(리프레시 수명 7일) 세션만 끊기고 사본과 큐는
 * 그대로 남는데(D10), 화면에는 그냥 로그인 창이 뜰 뿐이라 오프라인에서 적어 둔 것이
 * 사라진 것처럼 보인다. **사라지지 않았다는 사실을 그 자리에서 말해 주는 것**이
 * 이 함수가 있는 이유다.
 *
 * 프로젝트를 묻지 않는 까닭은 그 자리에 고른 프로젝트가 없기 때문이다. 세션이 끊기면
 * 프로젝트 스토어도 비워질 수 있어, 있는 것을 다 세는 편이 맞다.
 */
export async function unsentCount(): Promise<{ pending: number; held: number }> {
  if (!store) return { pending: 0, held: 0 };

  try {
    return await store.outboxCount();
  } catch (error) {
    // 세지 못한 것을 오류로 올리지 않는다. 로그인 화면이 이것 때문에 막히면 안 된다.
    console.error('보내지 못한 기록을 세지 못했습니다:', error);
    return { pending: 0, held: 0 };
  }
}

/** 사본을 쓸 수 있는 상태인가. 화면이 "오프라인에서도 볼 수 있다"를 알릴 때 쓴다. */
export function hasLocalStore(): boolean {
  return store !== null;
}
