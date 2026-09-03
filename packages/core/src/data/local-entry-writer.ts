/**
 * 기기가 거래를 자기 저장소에 커밋하는 자리.
 *
 * 하는 일은 한 번에 둘이고, **둘이 한 트랜잭션 안에 있어야 한다.**
 *   1. 조립한 전표를 사본에 적는다 (화면이 곧바로 본다).
 *   2. 같은 내용을 명령으로 아웃박스에 쌓는다 (나중에 서버가 재생한다).
 *
 * 하나만 되면 둘 중 하나가 벌어진다 -- 화면에는 있는데 서버에 영영 가지 않는 거래,
 * 또는 화면에 없는데 서버에는 생기는 거래. 둘 다 사용자가 알아챌 방법이 없다.
 *
 * 조립 규칙은 서버와 같은 함수를 쓴다(`@money/types` 의 entry-build). 그래서 오프라인에서
 * 만든 전표와 서버가 재생한 전표가 같은 모양이 된다. 여기서 미리 조립하는 이유는 두
 * 가지다. 하나는 화면에 보여 줄 다리를 만들어야 해서이고, 다른 하나는 **서버가 영구히
 * 거절할 명령을 큐에 넣지 않기 위해서다.** 규칙 위반은 여기서 그 자리에 알린다.
 */

import {
  type EntryDto,
  type EntryMutationPayload,
  type Mutation,
  buildEntry,
  newId,
} from '@money/types';

import type { EntryWritePort } from './entry-write-port';
import { localLedgerLookup } from './local-lookup';
import type { LocalStore } from './local-store';
import { notifyMirrorChanged } from './mirror-events';

export interface LocalEntryWriterOptions {
  store: LocalStore;
  /** 지금 보고 있는 프로젝트. 화면이 프로젝트를 갈 때 다시 만든다. */
  projectId: string;
  timeZone: string;
  /** 명령을 쌓은 뒤 곧바로 보내 볼 기회. 온라인이면 여기서 나간다. */
  onQueued?: (mutation: Mutation) => void;
}

export function createLocalEntryWriter({
  store,
  projectId,
  timeZone,
  onQueued,
}: LocalEntryWriterOptions): EntryWritePort {
  const lookup = localLedgerLookup(store);

  /** 화면이 보낸 값을 명령의 짐으로. 금액은 문자열로만 담는다(JSON 으로 오간다). */
  const toPayload = (
    id: string,
    data: EntryDto.CreateRequest | EntryDto.UpdateRequest,
  ): EntryMutationPayload => ({
    id,
    kind: data.kind,
    personId: data.personId,
    date: new Date(data.date).toISOString(),
    description: data.description,
    merchant: data.merchant,
    detailedNote: data.detailedNote,
    amount: text(data.amount),
    categoryId: data.categoryId,
    extraAmount: text(data.extraAmount),
    splits: data.splits?.map((split) => ({
      categoryId: split.categoryId,
      amount: String(split.amount),
      extraAmount: text(split.extraAmount),
    })),
    accountId: data.accountId,
    toAccountId: data.toAccountId,
    cardId: data.cardId,
    installmentMonths: data.installmentMonths,
    toAmount: text(data.toAmount),
    transferFee: text(data.transferFee),
    transferFeeCategoryId: data.transferFeeCategoryId,
    cardTransferDirection: data.cardTransferDirection,
    tagIds: data.tagIds,
    currency: data.currency,
    exchangeRate: text(data.exchangeRate),
    billedAmount: text(data.billedAmount),
  });

  /**
   * 사본에 적고 명령을 쌓는다.
   *
   * 조립을 먼저 한다. 규칙에 어긋나면 여기서 던지고 큐에는 아무것도 남지 않는다.
   */
  const commit = async (
    entryId: string,
    payload: EntryMutationPayload,
    kind: 'entry.create' | 'entry.replace',
  ): Promise<{ id: string }> => {
    const built = await buildEntry(
      { ...payload, projectId, date: new Date(payload.date) },
      lookup,
    );

    // 수정이면 사본이 아는 시계보다 뒤에 놓는다. "그 편집을 보고 고쳤다"가 순서에 남는다.
    const observed = kind === 'entry.replace' ? await store.entryHlc(entryId) : null;

    const mutation = await store.enqueue({
      projectId,
      mutationId: newId(),
      kind,
      targets: [entryId],
      payload,
      observed,
    });

    await store.writeEntry(entryId, built, {
      timeZone,
      hlc: mutation.hlc,
      makeId: newId,
      // 태그는 조립 규칙이 다루지 않는다(다리를 바꾸지 않는다). 짐에서 그대로 가져온다.
      tagIds: payload.tagIds ?? [],
    });

    notifyMirrorChanged();
    onQueued?.(mutation);
    return { id: entryId };
  };

  return {
    async createEntry(data) {
      // id 는 기기가 만든다(0단계). 그래야 만든 그 자리에서 고치고 지울 수 있다.
      const entryId = data.id ?? newId();
      return commit(entryId, toPayload(entryId, data), 'entry.create');
    },

    updateEntry(id, data) {
      return commit(id, toPayload(id, data), 'entry.replace');
    },

    async deleteEntry(id) {
      const mutation = await store.enqueue({
        projectId,
        mutationId: newId(),
        kind: 'entry.delete',
        targets: [id],
        payload: { id },
      });

      await store.removeEntry(id);
      notifyMirrorChanged();
      onQueued?.(mutation);
    },
  };
}

/** 숫자로 와도 문자열로 담는다. 명령은 JSON 으로 오가고 금액은 문자열이어야 정확하다. */
function text(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}
