/**
 * 사본을 서버와 맞추는 일.
 *
 * 하는 일은 둘이다.
 *   1. **먼저 밀어 올린다.** 아웃박스에 쌓인 명령을 보내고 결과를 반영한다.
 *   2. 그다음 커서를 들고 변경 피드를 부르고, 받은 것을 사본에 적는다.
 *
 * 순서가 중요하다. 받기를 먼저 하면 방금 만든 전표가 아직 서버에 없어서, 서버가 보낸
 * 그 자리의 값(없음)이 로컬 커밋을 덮을 여지가 생긴다. 밀어 올린 뒤 받으면 서버가 찍은
 * 번호와 시계가 그대로 사본에 실린다.
 *
 * 오프라인은 오류가 아니다. 네트워크가 없으면 그대로 두고 다음 기회에 다시 부른다.
 * 사본은 이미 화면이 쓸 수 있는 상태이므로 실패가 화면을 막지 않아야 한다.
 */

import type { PushRequest, PushResponse, SyncDto } from '@money/types';

import { isOfflineError } from '../lib/offline-error';
import type { LocalStore } from './local-store';

/** 변경 피드를 부르는 함수. apiClient 를 그대로 넣어도 되고 검증용으로 갈아 끼워도 된다. */
export type PullFn = (query: SyncDto.PullQuery) => Promise<SyncDto.PullResponse>;

/** 명령을 밀어 올리는 함수. */
export type PushFn = (request: PushRequest) => Promise<PushResponse>;

export interface SyncResult {
  /** 사본이 따라간 마지막 번호 */
  version: number;
  /** 서버를 부른 횟수 */
  rounds: number;
  /** 적용한 변경이 있었는가 */
  changed: boolean;
  /** 네트워크가 없어 멈췄는가. 오류가 아니라 상태다. */
  offline: boolean;
  /** 밀어 올린 명령 수 */
  pushed: number;
  /** 그중 보류 칸으로 간 것 (충돌·거절·보류) */
  held: number;
}

/** 한 번의 동기화에서 서버를 부를 최대 횟수. 서버가 커서를 밀지 못할 때 무한히 돌지 않게 한다. */
const MAX_ROUNDS = 50;

/**
 * 사본을 지금까지의 서버 상태로 맞춘다.
 *
 * `hasMore` 가 참이면 서버가 안전한 자리에서 끊은 것이므로 이어서 받는다. 커서가
 * 전진하지 않으면 그 자리에서 멈춘다. 같은 응답을 무한히 받는 것보다 낫고, 다음
 * 기회에 다시 시도한다.
 */
export async function syncProject(
  store: LocalStore,
  pull: PullFn,
  projectId: string,
  timeZone: string,
  push?: PushFn,
): Promise<SyncResult> {
  const cursor = await store.init(projectId, timeZone);

  let version = cursor.version;
  let rounds = 0;
  let changed = false;

  const outbox = push
    ? await pushOutbox(store, push, projectId)
    : { pushed: 0, held: 0, offline: false };

  // 밀어 올리다 네트워크가 끊겼으면 받기도 되지 않는다. 큐는 그대로 남는다.
  if (outbox.offline) {
    return { version, rounds, changed, offline: true, pushed: 0, held: outbox.held };
  }
  if (outbox.pushed > 0) changed = true;

  for (;;) {
    let response: SyncDto.PullResponse;
    try {
      response = await pull({ projectId, since: version });
    } catch (error) {
      // 네트워크가 없으면 여기서 끝낸다. 사본은 그대로 쓸 수 있다.
      if (isOfflineError(error)) {
        return { version, rounds, changed, pushed: outbox.pushed, held: outbox.held, offline: true };
      }
      throw error;
    }

    rounds += 1;
    await store.applyPull(response, timeZone);

    if (countChanges(response) > 0) changed = true;

    const advanced = response.version > version;
    version = response.version;

    if (!response.hasMore) break;
    if (!advanced) break;
    if (rounds >= MAX_ROUNDS) break;
  }

  return { version, rounds, changed, pushed: outbox.pushed, held: outbox.held, offline: false };
}

/**
 * 아웃박스를 비운다.
 *
 * 한 번에 한 묶음만 보낸다. 일주일치를 한 요청에 밀면 끊기고(요청 시간 제한), 부분 성공을
 * 다루기도 어렵다. 남은 것은 다음 동기화가 가져간다.
 *
 * 결과를 반영하는 일은 저장소가 한다 -- 끝난 것은 큐에서 빠지고, 충돌과 거절은 이유를 달고
 * 보류 칸에 남는다. 조용히 지우지 않는 것이 요점이다. 돈은 말없이 사라지면 안 된다 (D6).
 */
async function pushOutbox(
  store: LocalStore,
  push: PushFn,
  projectId: string,
): Promise<{ pushed: number; held: number; offline: boolean }> {
  const mutations = await store.pendingMutations(projectId);
  if (mutations.length === 0) {
    const counts = await store.outboxCount(projectId);
    return { pushed: 0, held: counts.held, offline: false };
  }

  try {
    const response = await push({
      projectId,
      clientId: mutations[0].clientId,
      mutations,
    });
    await store.settleMutations(response.results);
  } catch (error) {
    // 오프라인은 오류가 아니다. 큐를 그대로 두고 다음 기회에 다시 보낸다.
    if (isOfflineError(error)) {
      const counts = await store.outboxCount(projectId);
      return { pushed: 0, held: counts.held, offline: true };
    }
    throw error;
  }

  const counts = await store.outboxCount(projectId);
  return { pushed: mutations.length - counts.pending, held: counts.held, offline: false };
}

/** 응답에 실제로 담긴 변경 수. "바뀐 것이 있었는가"를 화면에 알릴 때 쓴다. */
export function countChanges(response: SyncDto.PullResponse): number {
  const { changes, tombstones } = response;
  return (
    (changes.project ? 1 : 0) +
    changes.members.length +
    changes.people.length +
    changes.accounts.length +
    changes.categories.length +
    changes.cards.length +
    changes.entries.length +
    changes.budgets.length +
    changes.budgetOverrides.length +
    changes.exchangeRates.length +
    tombstones.length
  );
}


