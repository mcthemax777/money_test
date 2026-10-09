/**
 * 사용 통계 (Firebase Analytics). 웹과 앱이 같은 이벤트를 보낸다.
 *
 * 이벤트의 이름과 값은 여기서만 정한다(`AnalyticsEvent`). 실제로 보내는 일은 플랫폼이 꽂는
 * `AnalyticsSink` 가 한다 -- 앱은 @react-native-firebase, 웹은 firebase JS SDK 다. 꽂기
 * 전에 부른 것은 버린다(쌓아 두었다 보내지 않는다).
 *
 * **가계부의 내용은 보내지 않는다.** 금액, 메모, 가맹점, 자산·카드·분류 이름, 이메일은
 * 이벤트 값에 넣지 않는다. 값은 아래 타입에 적힌 갈래(문자열 상수, 0/1)만 받는다. 사용자는
 * 서버의 내부 id 로만 묶는다.
 *
 * **끄기.** 사용자가 설정에서 끄면(`useAnalyticsPrefs`) 플랫폼에 수집을 끄라고 알린다. 이
 * 기기에만 남는 값이다(계정이 아니다).
 */
import type { PlanId } from '@money/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { EntryFormKind } from '../data/entry-form';
import { persistStorage } from './persist-storage';

/** 보내는 이벤트 전부. 이름은 GA 규칙(영문 소문자·밑줄, 40자 이내)을 따른다. */
export type AnalyticsEvent =
  | { name: 'login'; params: { method: 'google' } }
  | { name: 'project_create' }
  | { name: 'invite_create'; params: { role: 'editor' | 'viewer' } }
  /** 초대 링크로 들어왔다. */
  | { name: 'project_join' }
  /** 소유자가 참여 요청을 받아 주었다. */
  | { name: 'join_request_approve'; params: { role: 'editor' | 'viewer' } }
  | {
      name: 'entry_save';
      params: {
        mode: 'create' | 'edit';
        kind: EntryFormKind;
        /** 직접 적었는가, 보관함의 후보(알림·캡처·반복)에서 왔는가. */
        origin: 'manual' | 'draft';
      };
    }
  | { name: 'entry_sheet_import'; params: { created: number; skipped: number } }
  | { name: 'paywall_view'; params: { plan_status: 'free' | 'period' | 'lifetime' } }
  | { name: 'plan_purchase_start'; params: { plan: PlanId } }
  | {
      name: 'plan_purchase_result';
      params: {
        plan: PlanId;
        outcome: 'purchased' | 'cancelled' | 'already-subscribed' | 'product-missing' | 'failed';
        /** 결제 뒤 서버가 이용권을 적은 것을 확인했는가(1) 아닌가(0). 결제가 아니면 0. */
        applied: 0 | 1;
      };
    }
  | {
      name: 'sync_held';
      params: { status: 'conflict' | 'rejected' | 'blocked'; code: string };
    };

/** 플랫폼이 꽂는 보내는 쪽. */
export interface AnalyticsSink {
  logEvent(name: string, params?: Record<string, string | number>): void;
  logScreen(name: string): void;
  /** null 이면 로그아웃이다. */
  setUserId(userId: string | null): void;
  setEnabled(enabled: boolean): void;
}

let sink: AnalyticsSink | null = null;
/** 꽂기 전에 정해진 사용자. 꽂는 순간 넘긴다(앱은 사용자를 읽은 뒤에 꽂힐 수 있다). */
let userId: string | null = null;

interface AnalyticsPrefs {
  /** 사용 통계를 보내는가. 기본은 켬. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/**
 * 이 기기의 사용 통계 켜기·끄기.
 *
 * 앱은 저장소(AsyncStorage)를 이 스토어가 만들어진 뒤에 넣으므로, 앱의 persistence 가 이것을
 * 다시 읽어야 남긴 값이 붙는다. 그 목록에서 빠지면 켤 때마다 켬으로 돌아간다.
 */
export const useAnalyticsPrefs = create<AnalyticsPrefs>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: 'analytics-prefs',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);

useAnalyticsPrefs.subscribe((state, previous) => {
  if (state.enabled !== previous.enabled) sink?.setEnabled(state.enabled);
});

/**
 * 플랫폼이 보내는 쪽을 꽂는다. 스토어를 다시 읽은 뒤에 불러야 끈 사람의 값이 먼저 선다.
 * null 을 주면 뺀다.
 */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
  if (!next) return;
  next.setEnabled(useAnalyticsPrefs.getState().enabled);
  next.setUserId(userId);
}

/** 로그인·로그아웃. auth 스토어가 사용자가 바뀔 때 부른다. */
export function setAnalyticsUser(next: string | null): void {
  if (next === userId) return;
  userId = next;
  sink?.setUserId(next);
}

/**
 * 이벤트 하나. 보내다 실패해도 부른 쪽에 오류를 넘기지 않는다 -- 통계 때문에 저장이나
 * 결제가 실패한 것처럼 보이면 안 된다. 끈 상태면 보내지 않는다(플랫폼도 막지만 한 번 더).
 */
export function track(event: AnalyticsEvent): void {
  if (!sink || !useAnalyticsPrefs.getState().enabled) return;
  try {
    sink.logEvent(event.name, 'params' in event ? event.params : undefined);
  } catch {
    // 위의 이유로 삼킨다.
  }
}

/**
 * 화면 보기. 화면 이름은 주소에서 물음표 뒤를 뗀 것이다(`screenNameOf`) -- 초대 링크의
 * 코드 같은 값이 주소에 실려 오기 때문이다.
 */
export function trackScreen(path: string): void {
  if (!sink || !useAnalyticsPrefs.getState().enabled) return;
  try {
    sink.logScreen(screenNameOf(path));
  } catch {
    // track 과 같은 이유로 삼킨다.
  }
}

/** '/transactions?month=2026-10#top' → '/transactions'. 빈 값은 '/'. */
export function screenNameOf(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  return bare === '' ? '/' : bare;
}
