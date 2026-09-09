/**
 * 보관함을 기기 사본에서 읽고, 처리는 사본에 먼저 적는 창구.
 *
 * 앱이 이것을 꽂는다. 목록은 사본에서 나므로 서버를 기다리지 않고 그려지고, 처리는
 * 사본에 먼저 남아 오프라인에서도 눌린다. 서버에 알리는 일은 대기 큐(`draft_op`)를
 * 지나 동기화가 맡는다.
 *
 * 담기(`add`)는 서버로 곧바로 올린 뒤 **받은 행을 사본에 넣는다.** 다음 동기화를
 * 기다리면 "담았습니다"라는 말과 빈 목록이 함께 보이고, 사용자는 담기지 않은 것으로
 * 읽는다. 담기 자체에는 큐를 두지 않는다 -- 알림은 실패하면 네이티브 버퍼에 그대로
 * 남고, 캡처와 반복은 다음에 열 때 같은 것을 다시 셈해 올린다.
 */

import type { EntryDraftDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { isOfflineError } from '../lib/offline-error';
import { notifyMirrorChanged } from './mirror-events';
import type { DraftPort } from './draft-port';
import type { LocalStore } from './local-store';

/** 사본을 읽는 창구를 만든다. 앱이 시작할 때 `setDraftPort` 로 꽂는다. */
export function createLocalDraftPort(store: LocalStore): DraftPort {
  return {
    add: async (projectId, items) => {
      const result = await apiClient.addEntryDrafts(items, projectId);

      /*
       * 서버가 준 행을 그대로 넣는다(기기가 만든 값이 아니다).
       *
       * 다음 델타가 같은 행을 변경 번호와 함께 다시 덮으므로 어긋날 자리가 없다.
       */
      for (const draft of result.drafts) await store.putDraft(draft);
      if (result.drafts.length > 0) notifyMirrorChanged();

      return result;
    },

    list: (projectId, filter) =>
      store.draftRows(projectId, {
        source: filter?.source,
        status: filter?.status ?? 'pending',
      }),

    mark: async (projectId, draftId, action, entryId) => {
      // 사본에 먼저 적는다. 화면은 이 값을 보고 곧바로 줄을 지운다.
      await store.markDraft(projectId, draftId, action, entryId ?? null);

      /*
       * 이어서 서버에 알린다. 실패는 오류로 올리지 않는다.
       *
       * 큐에 남아 다음 동기화가 다시 보낸다. 여기서 던지면 화면은 "처리하지
       * 못했다"고 말하는데, 사본에는 이미 처리가 남아 있어 말과 화면이 어긋난다.
       */
      await flushDraftOps(store, projectId);
    },

    patch: async (draftId, patch) => {
      /*
       * 값 손질은 서버로만 보낸다.
       *
       * 사본의 후보 값은 델타가 덮어쓰는 자리라 여기서 고쳐도 다음 동기화에 지워진다.
       * 손질은 화면이 폼에서 하고 저장은 거래로 나가므로, 이 길로 들어오는 일은
       * 드물다 -- 그래서 큐를 만들지 않고 연결됐을 때만 되게 둔다.
       */
      await apiClient.updateEntryDraft(draftId, patch);
    },
  };
}

/**
 * 아직 서버에 알리지 못한 후보 처리를 비운다.
 *
 * 동기화가 **받기 전에** 부른다(`sync-engine`). 순서가 뒤집히면 서버의 pending 이
 * 사본의 registered 를 덮어써서 같은 거래를 두 번 적을 자리가 생긴다.
 *
 * 서버가 "그런 후보가 없다"고 답하면 큐에서 뺀다. 이미 다른 기기가 지웠거나 정리된
 * 것이고, 그 처리를 영원히 다시 보내 봐야 같은 답이 온다.
 */
export async function flushDraftOps(store: LocalStore, projectId: string): Promise<void> {
  const ops = await store.pendingDraftOps(projectId);
  if (ops.length === 0) return;

  for (const op of ops) {
    try {
      if (op.op === 'deleted') {
        await apiClient.deleteEntryDraft(op.draftId);
      } else {
        await apiClient.updateEntryDraft(op.draftId, {
          status: op.op as EntryDraftDto.Response['status'],
          registeredEntryId: op.op === 'registered' ? op.entryId ?? null : null,
        });
      }
      await store.forgetDraftOp(op.draftId);
    } catch (error) {
      // 연결이 없으면 큐를 그대로 두고 멈춘다. 다음 동기화가 이어서 한다.
      if (isOfflineError(error)) return;

      /*
       * 서버에 그 후보가 없다. 큐에서 뺀다.
       *
       * 남겨 두면 동기화마다 404 를 한 번씩 부르고, 그 사이 다른 처리도 이 자리에서
       * 막힌다. 사본의 행은 그대로 두어도 다음 델타가 정리한다.
       */
      if (isMissing(error)) {
        await store.forgetDraftOp(op.draftId);
        continue;
      }
      // 그 밖의 오류(권한, 서버 오류)는 다음 기회에 다시 시도한다.
      return;
    }
  }
}

/** 서버가 "없다"고 답했는가. 404 만 그렇게 본다. */
function isMissing(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}
