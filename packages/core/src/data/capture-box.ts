/**
 * 캡처 후보를 이 기기에만 두는 자리.
 *
 * 캡처는 사람이 **그 기기에서** 방금 고른 사진이다. 다른 기기나 다른 구성원이 볼 까닭이
 * 없으므로 서버에 올리지 않는다. 등록할 때만 기존 거래 추가 경로로 거래가 만들어지고,
 * 후보는 여기서 사라진다. 알림·반복 후보는 여전히 서버에 담긴다(`draft-port`).
 *
 * 저장소는 다른 스토어와 같은 `persistStorage` 다. 웹은 그 브라우저의 localStorage,
 * 앱은 AsyncStorage 이고, 앱은 시작할 때 다시 읽는다(`persistence.ts`).
 *
 * **처리한 열쇠를 잠시 남긴다.** 같은 사진을 다시 올렸을 때 이미 등록·무시한 줄이
 * 되살아나지 않게 한다. 서버의 dismissed 자리표와 같은 뜻이고, 지우기는 그 표시까지
 * 없앤다(같은 사진을 다시 올리면 다시 담긴다).
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { newId, type EntryDraftDto } from '@money/types';

import { persistStorage } from '../lib/persist-storage';
import type { DraftAction } from './draft-port';

/** 처리한 열쇠를 이만큼 기억한다. 그보다 오래된 사진을 다시 올리면 다시 담긴다. */
const HANDLED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

/** 가계부마다 기억하는 처리한 열쇠의 상한. 오래된 것부터 버린다. */
const HANDLED_MAX = 1000;

interface HandledKey {
  key: string;
  /** 처리한 시각 (ms). */
  at: number;
}

interface CaptureBoxState {
  /** 가계부별 대기 중인 캡처 후보. */
  drafts: Record<string, EntryDraftDto.Response[]>;
  /** 가계부별로 등록·무시한 후보의 열쇠. */
  handled: Record<string, HandledKey[]>;
}

const useCaptureBox = create<CaptureBoxState>()(
  persist(() => ({ drafts: {}, handled: {} }) as CaptureBoxState, {
    name: 'capture-box',
    storage: createJSONStorage(() => persistStorage),
  }),
);

/** 앱이 시작할 때 다른 스토어와 함께 다시 읽는다. */
export const captureBoxStore = useCaptureBox;

/**
 * 캡처 후보를 담는다. 이미 있거나 처리한 열쇠는 건너뛴다.
 *
 * 서버의 `POST /entry-drafts` 와 같은 모양으로 답한다 -- 화면은 어느 쪽에 담겼는지
 * 모르고 "n건을 담았다"고 적는다.
 */
export function addCaptureDrafts(
  projectId: string,
  items: EntryDraftDto.CreateItem[],
): EntryDraftDto.CreateResponse {
  const state = useCaptureBox.getState();
  const current = state.drafts[projectId] ?? [];
  const taken = new Set([
    ...current.map((draft) => draft.dedupeKey),
    ...liveHandled(state.handled[projectId]).map((entry) => entry.key),
  ]);

  const now = new Date().toISOString();
  const created: EntryDraftDto.Response[] = [];
  for (const item of items) {
    if (taken.has(item.dedupeKey)) continue;
    // 한 요청 안에서 같은 열쇠가 둘이면 앞의 것만 담는다 (서버의 유일 제약과 같다).
    taken.add(item.dedupeKey);
    created.push(toDraft(projectId, item, now));
  }

  if (created.length > 0) {
    useCaptureBox.setState({
      drafts: { ...state.drafts, [projectId]: [...created, ...current] },
    });
  }
  return { created: created.length, skipped: items.length - created.length, drafts: created };
}

/** 이 가계부의 대기 중인 캡처 후보. */
export function captureDrafts(projectId: string): EntryDraftDto.Response[] {
  return useCaptureBox.getState().drafts[projectId] ?? [];
}

/** 이 기기에 있는 캡처 후보인가. 처리 요청을 어디로 보낼지 가른다. */
export function isCaptureDraft(projectId: string, draftId: string): boolean {
  return captureDrafts(projectId).some((draft) => draft.id === draftId);
}

/**
 * 캡처 후보를 처리한다. 어느 쪽이든 목록에서 빠진다.
 *
 * 등록·무시는 열쇠를 남기고, 지우기는 남기지 않는다. 없는 후보면 아무 일도 없다
 * (두 번 눌린 버튼).
 */
export function markCaptureDraft(projectId: string, draftId: string, action: DraftAction): void {
  const state = useCaptureBox.getState();
  const current = state.drafts[projectId] ?? [];
  const target = current.find((draft) => draft.id === draftId);
  if (!target) return;

  const handled = liveHandled(state.handled[projectId]);
  const nextHandled =
    action === 'deleted'
      ? handled.filter((entry) => entry.key !== target.dedupeKey)
      : [...handled, { key: target.dedupeKey, at: Date.now() }].slice(-HANDLED_MAX);

  useCaptureBox.setState({
    drafts: { ...state.drafts, [projectId]: current.filter((draft) => draft.id !== draftId) },
    handled: { ...state.handled, [projectId]: nextHandled },
  });
}

/**
 * 캡처 후보의 값을 손본다. 서버의 PATCH 와 같이 준 칸만 바꾼다.
 *
 * 이 기기의 캡처 후보면 true. 아니면 아무것도 하지 않고 false 다(서버 후보다).
 */
export function patchCaptureDraft(draftId: string, patch: EntryDraftDto.UpdateRequest): boolean {
  const state = useCaptureBox.getState();
  const projectId = Object.keys(state.drafts).find((id) =>
    state.drafts[id].some((draft) => draft.id === draftId),
  );
  if (!projectId) return false;

  // 처지는 이 길로 바꾸지 않는다 (`markCaptureDraft`). 값만 덮는다.
  const { status: _status, registeredEntryId: _entryId, ...values } = patch;
  useCaptureBox.setState({
    drafts: {
      ...state.drafts,
      [projectId]: state.drafts[projectId].map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              ...values,
              tagIds: values.tagIds ?? draft.tagIds,
              updatedAt: new Date().toISOString(),
            }
          : draft,
      ),
    },
  });
  return true;
}

/**
 * 이 기기의 캡처 후보를 모두 버린다. 로그아웃하거나 다른 사용자가 들어올 때 부른다.
 *
 * 사진에서 읽은 가맹점과 금액이 다음 사람에게 남으면 안 된다.
 */
export function clearCaptureBox(): void {
  useCaptureBox.setState({ drafts: {}, handled: {} });
}

/** 기억할 기간이 지난 열쇠를 걷어낸다. */
function liveHandled(entries: HandledKey[] | undefined): HandledKey[] {
  const cutoff = Date.now() - HANDLED_KEEP_MS;
  return (entries ?? []).filter((entry) => entry.at >= cutoff);
}

/** 읽어 낸 값을 목록이 그리는 모양으로. 서버가 채우던 칸은 여기서 채운다. */
function toDraft(
  projectId: string,
  item: EntryDraftDto.CreateItem,
  now: string,
): EntryDraftDto.Response {
  return {
    id: item.id ?? newId(),
    projectId,
    source: 'capture',
    status: 'pending',
    rawText: item.rawText,
    appPackage: item.appPackage ?? null,
    appTitle: item.appTitle ?? null,
    kind: item.kind ?? null,
    amount: item.amount ?? null,
    currency: item.currency ?? null,
    occurredAt: item.occurredAt ?? null,
    merchant: item.merchant ?? null,
    description: item.description ?? null,
    installmentMonths: item.installmentMonths ?? null,
    personId: item.personId ?? null,
    categoryId: item.categoryId ?? null,
    accountId: item.accountId ?? null,
    cardId: item.cardId ?? null,
    confidence: item.confidence ?? 0,
    parser: item.parser ?? null,
    dedupeKey: item.dedupeKey,
    tagIds: item.tagIds ?? [],
    registeredEntryId: null,
    recurringRuleId: null,
    createdAt: now,
    updatedAt: now,
  };
}
