/**
 * 거래를 만들고 고치고 지우는 창구.
 *
 * 읽기 창구(`home-port`)와 같은 자리다. 화면은 `entryWritePort()` 만 부르고, 그 뒤에
 * 서버가 있는지 기기 사본이 있는지 모른다. 웹은 서버 창구를, 앱은 사본 창구를 꽂는다.
 *
 * 사본 창구는 **먼저 사본에 커밋하고 그 사실을 아웃박스에 쌓는다**(설계 문서의 D3).
 * 그래서 화면은 언제나 로컬 커밋을 보고, 온라인이든 오프라인이든 같은 코드가 돈다.
 */

import type { EntryDto, TagTarget } from '@money/types';

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
   * 여러 **줄**의 태그를 한 번에 바꾼다. 더할 것과 뗄 것을 따로 받는다.
   *
   * 태그가 줄에 붙으므로 대상도 줄이다. 목록에서 분할 거래의 한 줄만 골라 표시할 수
   * 있어야 하고, 전표 단위로 두면 같은 결제의 다른 분류까지 함께 붙는다.
   *
   * 수정(`updateEntry`)과 갈라 둔다. 그쪽은 전표를 통째로 갈아 끼우므로 분할·외화까지
   * 온전한 값이 필요한데, 목록에서 여러 건을 고를 때 화면은 그것을 다 들고 있지 않다.
   *
   * 돌려주는 것은 실제로 달라진 **거래**의 수다. 이미 붙어 있던 태그를 다시 붙이면 0 이다.
   * `skipped` 에는 그 사이 사라져 적용하지 못한 줄이 담긴다.
   */
  changeEntryTags(input: {
    targets: TagTarget[];
    addTagIds: string[];
    removeTagIds: string[];
    /** 서버 창구가 쓴다. 사본 창구는 만들어질 때 정해진 프로젝트를 그대로 쓴다. */
    projectId?: string | null;
  }): Promise<{ entries: number; skipped: TagTarget[] }>;

  /**
   * 외화 결제의 추정 청구액을 명세서의 실제 청구액으로 확정한다.
   *
   * 건마다 금액을 받는다. 적용 환율 한 줄로 채웠더라도 화면이 건마다 금액을 정해 넘긴다
   * (`billedAmountFromRate`) -- 서버가 며칠 뒤에 다시 곱하지 않게 하려는 것이다.
   * 사본 창구는 사본에 먼저 적고 `entry.restate` 명령을 쌓는다.
   */
  settleForeignRates(
    cardId: string,
    items: Array<{ entryId: string; billedAmount: string }>,
  ): Promise<{ settled: number }>;
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
  async changeEntryTags({ targets, addTagIds, removeTagIds, projectId }) {
    const result = await apiClient.changeEntryTags(
      { targets, addTagIds, removeTagIds },
      projectId ?? undefined,
    );
    return { entries: result.entries, skipped: result.skipped ?? [] };
  },
  settleForeignRates: (cardId, items) => apiClient.settleCardRates(cardId, { items }),
};

let current: EntryWritePort = httpEntryWritePort;

/** 창구를 갈아 끼운다. null 을 주면 서버 창구로 되돌아간다. */
export function setEntryWritePort(port: EntryWritePort | null): void {
  current = port ?? httpEntryWritePort;
}

export function entryWritePort(): EntryWritePort {
  return current;
}
