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
import { setEntryWritePort } from '@money/core/data/entry-write-port';
import { httpHomePort, setHomeDataPort } from '@money/core/data/home-port';
import { createLocalEntryWriter } from '@money/core/data/local-entry-writer';
import { createLocalHomePort } from '@money/core/data/local-home-port';
import type { HeldMutation, LocalStore } from '@money/core/data/local-store';
import { notifyMirrorChanged } from '@money/core/data/mirror-events';
import { setMirrorTeardown } from '@money/core/data/mirror-teardown';
import { openSyncEvents, type StreamingFetch } from '@money/core/data/sync-events';
import { syncProject, type SyncResult } from '@money/core/data/sync-engine';
import { newId } from '@money/types';

import { deleteLocalStore, openLocalStore } from './sqlite';

let store: LocalStore | null = null;

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
     * 기기 이름. 한 번 만들고 계속 쓴다.
     *
     * 새로 만들면 서버가 보기에 다른 기기가 되어 (기기, 순번) 멱등이 끊긴다. 그러면
     * 응답을 못 받고 다시 보낸 지출이 두 번 적힌다.
     */
    await store.ensureClient(newId);
    // 세션이 끝날 때 core 가 사본을 버릴 수 있게 방법을 등록한다.
    setMirrorTeardown(clearOffline);
    return true;
  } catch (error) {
    console.error('기기 사본을 열지 못했습니다. 서버에서 바로 읽습니다:', error);
    store = null;
    setHomeDataPort(null);
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

  setEntryWritePort(
    createLocalEntryWriter({
      store,
      projectId,
      timeZone,
      // 쌓자마자 한 번 보내 본다. 온라인이면 여기서 나가고, 아니면 큐에 남는다.
      onQueued: () => void syncNow(projectId, timeZone),
    }),
  );
}

/** 보류 칸. 충돌과 거절이 여기 모인다. 화면이 사용자에게 보여 준다. */
export async function heldMutations(projectId: string): Promise<HeldMutation[]> {
  if (!store) return [];
  return store.heldMutations(projectId);
}

/** 보류 칸에서 하나를 버린다. 사용자가 "그만두겠다"를 고른 자리다. */
export async function discardMutation(mutationId: string): Promise<void> {
  await store?.discardMutation(mutationId);
}

/** 막혔던 명령을 다시 줄에 세운다. */
export async function retryMutation(mutationId: string): Promise<void> {
  await store?.retryMutation(mutationId);
}

/**
 * 고른 프로젝트를 서버와 맞춘다.
 *
 * 프로젝트를 고른 뒤와 화면을 다시 열 때 부른다. 쌓인 명령을 먼저 밀어 올리고, 그다음
 * 사본이 비어 있으면 처음부터, 이미 있으면 그 뒤의 변경만 받는다.
 */
export async function syncNow(projectId: string, timeZone: string): Promise<SyncResult | null> {
  if (!store) return null;

  try {
    const result = await syncProject(
      store,
      (query) => apiClient.pullSync(query),
      projectId,
      timeZone,
      (request) => apiClient.pushSync(request),
    );
    // 사본이 채워졌으면 화면이 다시 읽게 알린다.
    if (result.changed) notifyMirrorChanged();
    return result;
  } catch (error) {
    // 인증이 끊긴 경우다. 세션 처리는 apiClient 의 인터셉터가 이미 한다.
    console.error('동기화 실패:', error);
    return null;
  }
}

/**
 * 사본을 지운다. 로그아웃하거나 다른 사용자가 로그인할 때 부른다.
 *
 * 표를 비우는 것으로는 모자라다. 파일이 남으면 그 안에 지난 사용자의 거래가 그대로 있다.
 */
export async function clearOffline(): Promise<void> {
  store = null;
  setHomeDataPort(null);
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
 * 서버의 알림에 귀를 연다. 돌려주는 함수를 부르면 닫는다.
 *
 * 알림에는 번호만 실려 온다. 그것을 신호로 평소의 동기화를 한 번 더 돌릴 뿐이라,
 * 실시간이 되어도 값이 오는 길은 하나 그대로다. 알림이 끊긴 동안에도 화면이 틀리지
 * 않는 이유가 이것이다 -- 늦게 따라붙을 뿐이다.
 *
 * 스트리밍 fetch 를 expo 에서 받아 넣는다. 리액트 네이티브의 기본 fetch 는 응답을
 * 끝까지 받아야 돌려주고, EventSource 는 아예 없다.
 */
export function listenForChanges(projectId: string, timeZone: string): () => void {
  if (!store) return () => {};

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

/** 사본을 쓸 수 있는 상태인가. 화면이 "오프라인에서도 볼 수 있다"를 알릴 때 쓴다. */
export function hasLocalStore(): boolean {
  return store !== null;
}
