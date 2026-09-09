/**
 * 보관함이 값을 얻고 처리를 남기는 창구.
 *
 * 다른 창구(`home-port`)와 달리 **읽기와 쓰기가 함께 있다.** 후보의 처리(등록 표시,
 * 무시, 지우기)는 전표가 아니라 아웃박스를 쓰지 않는데, 그렇다고 화면이 서버를 직접
 * 부르게 두면 오프라인에서 무슨 일이 일어나는지가 화면마다 달라진다. 창구를 하나
 * 두어 웹은 서버로, 앱은 사본 + 대기 큐로 가게 한다.
 *
 * 후보를 **읽어 내는** 일은 여기 없다. 알림을 읽고 캡처에서 글자를 뽑고 반복의 회차를
 * 셈하는 일은 기기의 몫이다(앱의 `inbox.ts`, core 의 `recurring-drafts`).
 *
 * 그 결과를 **담는** 길은 여기 있다(`add`). 담기는 어느 쪽이든 서버로 곧바로 나가지만,
 * 화면이 읽는 자리는 웹과 앱이 다르다 -- 앱은 사본이라 서버에 담기는 것만으로는 목록이
 * 비어 있다. 그 뒤처리를 부르는 쪽마다 두면 한 곳이 빠지고, 그 화면만 "담았습니다"라는
 * 말과 빈 목록을 함께 보인다.
 */

import type { EntryDraftDto } from '@money/types';

import { apiClient } from '../lib/api-client';

/** 후보에 대해 할 수 있는 일. */
export type DraftAction = 'registered' | 'dismissed' | 'deleted';

export interface DraftPort {
  /**
   * 읽어 낸 후보를 담는다.
   *
   * 겹치는 것은 서버가 건너뛴다(프로젝트, dedupeKey). 돌려주는 것은 **새로 담긴 것만**
   * 이라, 화면은 그 수로 "n건을 담았습니다"라고 적을 수 있다.
   */
  add(
    projectId: string,
    items: EntryDraftDto.CreateItem[],
  ): Promise<EntryDraftDto.CreateResponse>;

  /**
   * 보관함 목록. 탭(source)마다 부른다.
   *
   * 처지를 주지 않으면 대기 중인 것만 온다. 등록·무시된 것은 같은 알림이 되살아나지
   * 못하게 막는 자리표에 가까워 목록의 본론이 아니다.
   */
  list(
    projectId: string,
    filter?: { source?: EntryDraftDto.Response['source']; status?: EntryDraftDto.Response['status'] },
  ): Promise<EntryDraftDto.Response[]>;

  /**
   * 후보를 처리한다.
   *
   * `entryId` 는 등록일 때만 준다. 등록으로 만들어진 거래를 후보에 적어 두면, 나중에
   * "이 거래가 어디서 왔는가"를 되짚을 수 있고 그 거래를 지웠을 때 연결만 풀린다.
   */
  mark(
    projectId: string,
    draftId: string,
    action: DraftAction,
    entryId?: string | null,
  ): Promise<void>;

  /** 후보의 값을 손본다. 화면에서 금액이나 분류를 고쳐 둘 때 쓴다. */
  patch(draftId: string, patch: EntryDraftDto.UpdateRequest): Promise<void>;
}

/** 서버에서 곧바로 읽고 쓰는 창구. 웹은 이것을 쓴다. */
export const httpDraftPort: DraftPort = {
  // 웹이 읽는 자리가 서버 자신이라 담고 나서 할 일이 없다.
  add: (projectId, items) => apiClient.addEntryDrafts(items, projectId),

  list: (projectId, filter) =>
    apiClient.getEntryDrafts({ source: filter?.source, status: filter?.status }, projectId),

  mark: async (_projectId, draftId, action, entryId) => {
    if (action === 'deleted') {
      await apiClient.deleteEntryDraft(draftId);
      return;
    }
    await apiClient.updateEntryDraft(draftId, {
      status: action,
      // 무시할 때는 연결을 비운다. 등록했다가 무시로 되돌리는 길이 있어서다.
      registeredEntryId: action === 'registered' ? entryId ?? null : null,
    });
  },

  patch: async (draftId, patch) => {
    await apiClient.updateEntryDraft(draftId, patch);
  },
};

let current: DraftPort = httpDraftPort;

/** 창구를 갈아 끼운다. 앱이 시작할 때 사본 창구를 넣는다. */
export function setDraftPort(port: DraftPort | null): void {
  current = port ?? httpDraftPort;
}

export function draftPort(): DraftPort {
  return current;
}
