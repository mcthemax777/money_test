/**
 * 거래를 만들고 고치고 지우는 창구.
 *
 * 읽기 창구(`home-port`)와 같은 자리다. 화면은 `entryWritePort()` 만 부르고, 그 뒤에
 * 서버가 있는지 기기 사본이 있는지 모른다. 웹은 서버 창구를, 앱은 사본 창구를 꽂는다.
 *
 * 사본 창구는 **먼저 사본에 커밋하고 그 사실을 아웃박스에 쌓는다**(설계 문서의 D3).
 * 그래서 화면은 언제나 로컬 커밋을 보고, 온라인이든 오프라인이든 같은 코드가 돈다.
 */

import type { EntryDto } from '@money/types';

import { apiClient } from '../lib/api-client';

export interface EntryWritePort {
  /**
   * 거래 하나를 만든다.
   *
   * 돌려주는 것은 그 거래의 id 다. 서버 창구는 응답에서, 사본 창구는 기기가 만든 값에서
   * 가져온다. 화면이 방금 만든 줄로 옮겨 갈 때 쓴다.
   */
  createEntry(data: EntryDto.CreateRequest): Promise<{ id: string }>;
  /** 수정은 전체 교체다. id 는 유지된다. */
  updateEntry(id: string, data: EntryDto.UpdateRequest): Promise<{ id: string }>;
  deleteEntry(id: string): Promise<void>;

  /**
   * 여러 거래의 태그를 한 번에 바꾼다. 더할 것과 뗄 것을 따로 받는다.
   *
   * 수정(`updateEntry`)과 갈라 둔다. 그쪽은 전표를 통째로 갈아 끼우므로 분할·외화까지
   * 온전한 값이 필요한데, 목록에서 여러 건을 고를 때 화면은 그것을 다 들고 있지 않다.
   *
   * 돌려주는 것은 실제로 달라진 거래의 수다. 이미 붙어 있던 태그를 다시 붙이면 0 이다.
   */
  changeEntryTags(input: {
    entryIds: string[];
    addTagIds: string[];
    removeTagIds: string[];
    /** 서버 창구가 쓴다. 사본 창구는 만들어질 때 정해진 프로젝트를 그대로 쓴다. */
    projectId?: string | null;
  }): Promise<{ entries: number }>;
}

/** 서버에 곧바로 쓰는 창구. 웹은 이것을 쓴다. */
export const httpEntryWritePort: EntryWritePort = {
  async createEntry(data) {
    const entry = await apiClient.createEntry(data);
    return { id: entry.id };
  },
  async updateEntry(id, data) {
    const entry = await apiClient.updateEntry(id, data);
    return { id: entry.id };
  },
  deleteEntry: (id) => apiClient.deleteEntry(id),
  async changeEntryTags({ entryIds, addTagIds, removeTagIds, projectId }) {
    const result = await apiClient.changeEntryTags(
      { entryIds, addTagIds, removeTagIds },
      projectId ?? undefined,
    );
    return { entries: result.entries };
  },
};

let current: EntryWritePort = httpEntryWritePort;

/** 창구를 갈아 끼운다. null 을 주면 서버 창구로 되돌아간다. */
export function setEntryWritePort(port: EntryWritePort | null): void {
  current = port ?? httpEntryWritePort;
}

export function entryWritePort(): EntryWritePort {
  return current;
}
