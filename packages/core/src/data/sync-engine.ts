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

import { newId, type PushRequest, type PushResponse, type SyncDto } from '@money/types';

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
  /**
   * 사본을 버리고 처음부터 다시 받았는가.
   *
   * 서버가 보관 기간이 지난 자리표를 지운 뒤라 델타로는 따라잡을 수 없었다는 뜻이다.
   * 드문 일이고, 드물기 때문에 일어났을 때 로그에 남아야 한다.
   */
  rebuilt: boolean;
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
  let mirrorFloor = cursor.mirrorFloor;
  let rounds = 0;
  let changed = false;
  let rebuilt = false;

  const outbox = push
    ? await pushOutbox(store, push, projectId)
    : { pushed: 0, held: 0, offline: false };

  // 밀어 올리다 네트워크가 끊겼으면 받기도 되지 않는다. 큐는 그대로 남는다.
  if (outbox.offline) {
    return { version, rounds, changed, offline: true, pushed: 0, held: outbox.held, rebuilt };
  }
  if (outbox.pushed > 0) changed = true;

  for (;;) {
    let response: SyncDto.PullResponse;
    try {
      response = await pull({ projectId, since: version });
    } catch (error) {
      // 네트워크가 없으면 여기서 끝낸다. 사본은 그대로 쓸 수 있다.
      if (isOfflineError(error)) {
        return {
          version,
          rounds,
          changed,
          pushed: outbox.pushed,
          held: outbox.held,
          offline: true,
          rebuilt,
        };
      }
      throw error;
    }

    rounds += 1;

    /*
     * 델타로 따라잡을 수 없는 자리인가.
     *
     * 서버는 보관 기간이 지난 자리표를 지우고 그 바닥(`tombstoneFloor`)을 알려 준다.
     * 커서가 그 아래면 그 사이의 삭제를 받을 길이 없다 -- 지운 거래가 이 기기에 영영
     * 남는다. 그때는 사본을 버리고 처음부터 받는다. **아웃박스는 그대로 둔다.**
     *
     * 바닥을 커서하고만 견주면 안 된다. 처음부터 받는 중인 기기도 커서가 바닥보다
     * 낮아서, 큰 사본은 받다가 되돌리기를 되풀이하며 영영 끝나지 않는다. 그래서 사본에
     * 적어 둔 "그때의 바닥"과도 견주고, 바닥이 실제로 더 오른 경우에만 버린다.
     *
     * 한 번의 동기화에서 한 번만 한다. 서버가 어떤 값을 주든 여기서 맴돌지 않는다.
     */
    const floor = response.tombstoneFloor ?? 0;
    if (floor > mirrorFloor) {
      if (!rebuilt && version > 0 && floor > version) {
        await store.resetForRebuild(projectId, timeZone, floor);
        rebuilt = true;
        changed = true;
        version = 0;
        mirrorFloor = floor;
        // 이 응답은 버린다. 커서 뒤의 델타라 처음부터가 아니다.
        continue;
      }

      /*
       * 버릴 이유가 없는 두 경우. 커서가 이미 바닥을 넘어섰거나(따라붙어 있는 기기),
       * 아직 아무것도 담기지 않았거나(처음 쓰는 기기)다. 둘 다 이 사본에는 그 바닥보다
       * 전에 지워진 행이 없다는 뜻이라, 바닥만 적어 두고 그대로 간다.
       *
       * 빈 사본까지 버리면 첫 동기화가 첫 쪽을 두 번 받는다. 버릴 것이 없는데도.
       */
      await store.setMirrorFloor(projectId, floor);
      mirrorFloor = floor;
    }

    await store.applyPull(response, timeZone);

    if (countChanges(response) > 0) changed = true;

    const advanced = response.version > version;
    version = response.version;

    if (!response.hasMore) break;
    if (!advanced) break;
    if (rounds >= MAX_ROUNDS) break;
  }

  return {
    version,
    rounds,
    changed,
    pushed: outbox.pushed,
    held: outbox.held,
    offline: false,
    rebuilt,
  };
}

/**
 * 순번이 어긋났을 때 다시 보내 볼 횟수.
 *
 * 한 번이면 충분하다 -- 서버가 알려 준 마지막 번호 다음으로 앞당겨 다시 내므로 그 자리에서
 * 통과한다. 그래도 한 번을 더 두는 것은 그 사이 같은 기기의 다른 요청이 번호를 더 쓴
 * 경우다(같은 앱의 두 화면이 동시에 저장하는 자리). 끝없이 돌지는 않는다.
 */
const SEQ_RETRY_ROUNDS = 2;

/**
 * 아웃박스를 비운다.
 *
 * 한 번에 한 묶음만 보낸다. 일주일치를 한 요청에 밀면 끊기고(요청 시간 제한), 부분 성공을
 * 다루기도 어렵다. 남은 것은 다음 동기화가 가져간다.
 *
 * 결과를 반영하는 일은 저장소가 한다 -- 끝난 것은 큐에서 빠지고, 충돌과 거절은 이유를 달고
 * 보류 칸에 남는다. 조용히 지우지 않는 것이 요점이다. 돈은 말없이 사라지면 안 된다 (D6).
 *
 * **순번 충돌만 여기서 한 번 더 돈다.** 저장소가 번호를 앞당겨 다시 내 두었으므로(그쪽에
 * 왜인지 적어 두었다) 곧바로 보내면 그 자리에서 통과한다. 다음 동기화를 기다리게 하면
 * 사용자가 방금 옮긴 것이 다른 기기에 늦게 나타난다.
 */
async function pushOutbox(
  store: LocalStore,
  push: PushFn,
  projectId: string,
): Promise<{ pushed: number; held: number; offline: boolean }> {
  let sent = 0;

  for (let round = 0; round < SEQ_RETRY_ROUNDS; round += 1) {
    const mutations = await store.pendingMutations(projectId);
    if (mutations.length === 0) break;

    let requeued = 0;
    try {
      const response = await push({
        projectId,
        clientId: mutations[0].clientId,
        mutations,
      });
      ({ requeued } = await store.settleMutations(response.results, newId));
    } catch (error) {
      // 오프라인은 오류가 아니다. 큐를 그대로 두고 다음 기회에 다시 보낸다.
      if (isOfflineError(error)) {
        const counts = await store.outboxCount(projectId);
        return { pushed: sent, held: counts.held, offline: true };
      }
      throw error;
    }

    const counts = await store.outboxCount(projectId);
    sent += mutations.length - counts.pending;
    if (requeued === 0) break;
  }

  const counts = await store.outboxCount(projectId);
  return { pushed: sent, held: counts.held, offline: false };
}

/** 응답에 실제로 담긴 변경 수. "바뀐 것이 있었는가"를 화면에 알릴 때 쓴다. */
export function countChanges(response: SyncDto.PullResponse): number {
  const { changes, tombstones } = response;
  /*
   * **Changes 의 칸을 하나라도 빠뜨리면 그 표는 화면에 늦게 닿는다.**
   *
   * 이 수가 0 이면 부르는 쪽이 "받은 것이 없다"로 보고 사본이 바뀌었다는 알림을 내지
   * 않는다(app 의 syncNow). 사본에는 이미 적혀 있으므로 화면을 다시 열면 나오지만, 열어
   * 둔 화면은 그대로 멈춘다. 태그가 실제로 그랬다 -- 웹에서 만든 태그가 앱의 태그 화면에
   * 아무리 기다려도 나오지 않고, 다른 탭에 다녀오면 그제서야 보였다.
   */
  return (
    (changes.project ? 1 : 0) +
    changes.members.length +
    changes.people.length +
    changes.accounts.length +
    changes.categories.length +
    (changes.tags?.length ?? 0) +
    changes.cards.length +
    changes.entries.length +
    changes.budgets.length +
    changes.budgetOverrides.length +
    changes.exchangeRates.length +
    (changes.assetValuations?.length ?? 0) +
    (changes.installmentPlans?.length ?? 0) +
    tombstones.length
  );
}


