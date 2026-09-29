/*
 * 보관함의 기기 쪽 일을 이어 붙이는 자리.
 *
 * 두 갈래가 여기서 만난다.
 *
 *   - **알림.** 네이티브 서비스가 버퍼에 적어 둔 문구를 읽어 후보로 만든다. 앱이
 *     꺼져 있는 동안 온 알림이 그 버퍼에 쌓여 있다.
 *   - **캡처.** 사용자가 고른 사진에서 기기 OCR 로 글자를 읽어 후보로 만든다.
 *
 * 해석은 core 의 규칙(`draft-parse`)이 하고, 이 파일은 그 앞뒤를 잇는다 -- 목록을
 * 읽어 자산을 맞추고(`draft-match`), 이미 담은 것을 걸러내고, 서버에 올린다.
 *
 * **사진은 기기를 떠나지 않는다.** 캡처로 서버에 담기는 것은 없다(캡처 후보는 기기에만 둔다).
 *
 * **돈 표기가 있는 알림은 원문을 서버에 올린다** (2026-09-29, 사용자 결정). 후보가 되지
 * 못한 것도 올린다 -- 관리 도구가 그 원문으로 앱별 문구 규칙을 배우고, 기기는 그 규칙을
 * 내려받아 기존 규칙보다 먼저 대 본다(`notification-rule`). 돈 표기가 없는 알림(채팅·뉴스)은
 * 올리지 않는다.
 */
import { draftPort } from '@money/core/data/draft-port';
import { homeDataPort } from '@money/core/data/home-port';
import { apiClient } from '@money/core/lib/api-client';
import { hasMoneyMark, notificationDedupeKey, type ParsedDraft } from '@money/core/lib/draft-parse';
import { parseNotificationWithRules, sampleParsedOf } from '@money/core/lib/notification-rule';
import { persistStorage } from '@money/core/lib/persist-storage';
import {
  captureItems,
  dedupeNotificationItems,
  draftItemFrom,
  hintsOwnedBy,
  NO_HINTS,
  type CollectHints,
} from '@money/core/lib/draft-collect';
import { myPersonIdOf } from '@money/core/store/project';
import type { EntryDraftDto, NotificationRule, NotificationSampleDto } from '@money/types';
import * as Application from 'expo-application';

import * as InboxNative from '../modules/inbox-native';
import { merchantHistory } from './offline';

/** 담은 결과. 화면이 "몇 건을 담았다"고 알려 준다. */
export interface CollectResult {
  /** 서버에 새로 담긴 수 */
  added: number;
  /** 이미 있어서 건너뛴 수 */
  skipped: number;
}

const EMPTY: CollectResult = { added: 0, skipped: 0 };

/**
 * 알림이 온 뒤 모으기까지 기다리는 시간.
 *
 * 한 결제에 알림이 여럿 온다(카드사 앱·문자·은행 앱이 몇 초 사이로). 첫 알림에 곧바로
 * 올리면 뒤따른 알림이 다음 차례에 따로 견줘져, 담고 지우기를 한 번 더 한다. 잠깐 기다려
 * 한 번에 올린다. 푸시는 이보다 길게 서버가 기다린다(`PushService`) --
 * 1분 뒤에 온 중복까지 갈아 끼워진 다음 남은 후보만 알린다.
 */
const SETTLE_MS = 5_000;

/** 지금 도는 모으기. 백그라운드 작업과 "지금 확인하기"가 겹치지 않게 한 줄로 세운다. */
let running: Promise<unknown> = Promise.resolve();
/** 기다리는 중인 모으기. 그 사이에 온 알림은 이 차례에 함께 실린다. */
let settling: Promise<CollectResult> | null = null;

/**
 * 알림이 왔을 때 부른다(백그라운드 작업 `inbox-task`). 잠깐 기다렸다가 모은다.
 *
 * 기다리는 동안 또 부르면 같은 차례를 돌려준다 -- 알림 셋이면 작업도 셋이 뜨지만
 * 올리기는 한 번이다.
 */
export function collectNotificationsSoon(projectId: string): Promise<CollectResult> {
  settling ??= new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))
    .then(() => {
      settling = null;
      return collectNotifications(projectId);
    })
    .catch((error) => {
      settling = null;
      throw error;
    });
  return settling;
}

/**
 * 이 기기에 쌓인 알림을 후보로 담는다.
 *
 * 알림이 올 때(백그라운드 작업)와 보관함 화면에서 "지금 확인하기"를 누를 때 부른다.
 * 담긴 것이 확인된 알림만 버퍼에서 지운다 -- 올리다 끊기면 그대로 남아 다음에 다시
 * 올라간다.
 *
 * **한 번에 하나만 돈다.** 둘이 겹치면 같은 버퍼를 함께 읽어, 서로의 후보를 "이미
 * 담긴 것"으로 보지 못한 채 같은 결제를 둘 다 올린다.
 */
export function collectNotifications(projectId: string): Promise<CollectResult> {
  const next = running.then(() => collectNotificationsNow(projectId));
  running = next.catch(() => {});
  return next;
}

async function collectNotificationsNow(projectId: string): Promise<CollectResult> {
  if (!InboxNative.isAvailable) return EMPTY;

  const captured = InboxNative.readNotifications();
  if (captured.length === 0) return EMPTY;

  const [hints, rules] = await Promise.all([loadHints(projectId), loadNotificationRules()]);
  // 담은 기기. 보관함과 다른 구성원의 화면에 "어느 기기에서 담았는지"로 보인다.
  const deviceName = InboxNative.getDeviceName();
  /** 알림마다 읽은 결과. 표본에 "그때 읽은 것"으로 함께 올린다. */
  const parsedByKey = new Map<string, ParsedDraft | null>();
  const candidates: Array<{ item: EntryDraftDto.CreateItem; key: string }> = [];
  /** 금융 알림이 아니어서 후보가 되지 못한 것. 이쪽도 버퍼에서 지운다. */
  const droppedKeys: string[] = [];

  for (const notification of captured) {
    const parsed = parseNotificationWithRules(notification, rules);
    parsedByKey.set(notification.key, parsed);
    if (!parsed) {
      /*
       * 거래로 읽히지 않는 알림은 버린다.
       *
       * 남겨 두면 버퍼가 채팅과 뉴스로 차서, 정작 결제 알림이 상한에 밀려 사라진다.
       * 규칙을 고친 뒤 다시 읽을 수 있으면 좋겠지만, 그것을 위해 남의 알림을 기기에
       * 계속 쌓아 두는 것은 이 기능이 받을 값이 아니다.
       */
      droppedKeys.push(notification.key);
      continue;
    }

    candidates.push({
      item: {
        ...draftItemFrom(parsed, hints, {
          source: 'notification',
          dedupeKey: notificationDedupeKey(notification),
          appPackage: notification.packageName,
          appTitle: notification.title,
          // 문구에서 시각을 못 읽으면 알림이 온 시각이 그 거래의 시각이다.
          occurredAt: new Date(notification.postedAt).toISOString(),
        }),
        deviceName,
      },
      key: notification.key,
    });
  }

  /*
   * 한 결제에 온 알림 여럿(카드사 앱·문자·은행 앱)을 하나로 줄인다.
   *
   * 같은 때 같은 금액이면 같은 결제로 보고, 카드를 찾았거나 문구가 더 자세한 하나만
   * 담는다. 밀려난 알림도 **후보가 된 것과 같이** 버퍼에서 지운다 -- 남기면 다음에 다시
   * 읽혀 또 견줘야 한다.
   */
  const { keep, replace } = dedupeNotificationItems(
    candidates,
    await loadNotificationDrafts(projectId),
  );
  const usedKeys = candidates.map((candidate) => candidate.key);

  /*
   * 원문 표본을 올린다. 후보를 담기 **전에** 하고, 실패해도 후보 담기는 그대로 간다.
   * 못 올린 알림은 버퍼에서 지우지 않는다 -- 다음 차례에 다시 읽혀 표본이 올라가고,
   * 후보는 서버의 열쇠(dedupeKey)가 두 번 담기지 않게 막는다.
   */
  const unsent = await sendSamples(projectId, captured, parsedByKey, deviceName);
  const clearBuffer = (keys: string[]) =>
    InboxNative.clearNotifications(keys.filter((key) => !unsent.has(key)));

  if (keep.length === 0) {
    clearBuffer([...usedKeys, ...droppedKeys]);
    return { added: 0, skipped: candidates.length };
  }

  // 창구가 서버에 올리고 사본에도 넣는다 (화면이 읽는 자리가 사본이다).
  const result = await draftPort().add(
    projectId,
    keep.map((candidate) => candidate.item),
  );
  // 서버가 받아들인 뒤에 지운다. 여기까지 오지 못하면 알림은 버퍼에 그대로 남는다.
  clearBuffer([...usedKeys, ...droppedKeys]);

  /*
   * 새 것이 더 자세해서 밀려난 대기 중 후보를 지운다. **담은 뒤에** 한다 -- 먼저 지우고
   * 담기가 끊기면 그 결제의 후보가 하나도 남지 않는다. 지우다 실패해도 담기는 이미
   * 끝났으므로 겹친 후보가 하나 남을 뿐이고, 사람이 보고 지울 수 있다.
   */
  for (const draftId of replace) {
    try {
      await draftPort().mark(projectId, draftId, 'deleted');
    } catch {
      // 위의 까닭으로 삼킨다.
    }
  }

  return {
    added: result.created,
    skipped: result.skipped + (candidates.length - keep.length),
  };
}

/** 규칙을 기기에 남겨 두는 자리. 서버에 닿지 못할 때 마지막으로 받은 규칙을 쓴다. */
const RULES_KEY = 'money-notification-rules';
/** 받은 규칙을 믿는 시간. 관리 도구에서 규칙을 고치면 기기마다 이만큼 뒤에 먹는다. */
const RULES_TTL_MS = 10 * 60_000;
let rulesCache: { at: number; rules: NotificationRule[] } | null = null;

/**
 * 앱별 알림 문구 규칙. 관리 도구에서 만든 것을 서버에서 받는다.
 *
 * 받지 못하면 기기에 남겨 둔 것을, 그것도 없으면 빈 목록을 쓴다 -- 규칙이 없으면 기존
 * 규칙으로 읽을 뿐이라 알림 모으기를 멈출 까닭이 없다. 받지 못한 것은 기억하지 않는다
 * (다음 차례에 다시 묻는다).
 */
async function loadNotificationRules(): Promise<NotificationRule[]> {
  if (rulesCache && Date.now() - rulesCache.at < RULES_TTL_MS) return rulesCache.rules;
  try {
    const rules = await apiClient.getNotificationRules();
    rulesCache = { at: Date.now(), rules };
    try {
      await persistStorage.setItem(RULES_KEY, JSON.stringify(rules));
    } catch {
      // 남기지 못해도 이번 차례는 받은 규칙으로 읽는다.
    }
    return rules;
  } catch {
    try {
      const saved = await persistStorage.getItem(RULES_KEY);
      const rules: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(rules) ? (rules as NotificationRule[]) : [];
    } catch {
      return [];
    }
  }
}

/**
 * 돈 표기가 있는 알림의 원문을 서버에 올린다. 못 올려 버퍼에 남겨 둘 열쇠를 돌려준다.
 *
 * 서버가 4xx 로 답하면(옛 서버의 404 등) 다시 보내도 같은 답이므로 남기지 않는다 --
 * 남기면 그 알림들이 버퍼를 차지한 채 매번 다시 읽힌다. 연결이 끊겼거나 5xx 면 남긴다.
 */
async function sendSamples(
  projectId: string,
  captured: InboxNative.CapturedNotification[],
  parsedByKey: Map<string, ParsedDraft | null>,
  deviceName: string | null,
): Promise<Set<string>> {
  const money = captured.filter((notification) => hasMoneyMark(notification));
  if (money.length === 0) return new Set();

  const samples: NotificationSampleDto.CreateItem[] = money.map((notification) => ({
    packageName: notification.packageName,
    title: notification.title,
    text: notification.text,
    postedAt: notification.postedAt,
    sampleKey: notificationDedupeKey(notification),
    parsed: sampleParsedOf(parsedByKey.get(notification.key) ?? null),
    deviceName,
    appVersion: Application.nativeApplicationVersion,
  }));

  try {
    await apiClient.addNotificationSamples(samples, projectId);
    return new Set();
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status !== undefined && status >= 400 && status < 500) return new Set();
    return new Set(money.map((notification) => notification.key));
  }
}

/**
 * 이미 담긴 알림 후보. 겹침을 가리는 데 쓴다.
 *
 * 대기 중인 것뿐 아니라 등록·무시한 것도 읽는다 -- 등록한 결제에 늦게 온 알림이 다시
 * 후보가 되면 같은 거래가 두 번 적힌다. 읽지 못하면 이번에 읽은 것끼리만 견준다.
 */
async function loadNotificationDrafts(projectId: string): Promise<EntryDraftDto.Response[]> {
  try {
    const lists = await Promise.all(
      (['pending', 'registered', 'dismissed'] as const).map((status) =>
        draftPort().list(projectId, { source: 'notification', status }),
      ),
    );
    return lists.flat();
  } catch {
    return [];
  }
}

/**
 * 고른 사진에서 거래를 읽어 후보로 담는다. 후보는 이 기기에만 남는다(`capture-box`).
 *
 * 사진 한 장에서 여러 건이 나온다(카드사 앱의 이용 내역 목록). 한 건도 못 찾으면
 * 담지 않고 그 사실을 돌려준다 -- 화면이 "이 사진에서 거래를 찾지 못했다"고 적는다.
 */
export async function collectCapture(
  projectId: string,
  imageUri: string,
): Promise<CollectResult & { found: number }> {
  if (!InboxNative.isAvailable) return { ...EMPTY, found: 0 };

  const text = await InboxNative.recognizeText(imageUri);
  if (!text.trim()) return { ...EMPTY, found: 0 };

  const items = captureItems(text, await loadHints(projectId));
  if (items.length === 0) return { ...EMPTY, found: 0 };

  const result = await draftPort().add(projectId, items);
  return { added: result.created, skipped: result.skipped, found: items.length };
}

/** 알림 접근이 켜져 있는가. 화면이 이 값으로 안내를 그린다. */
export function isNotificationAccessGranted(): boolean {
  return InboxNative.isNotificationAccessGranted();
}

/** 알림 접근 설정을 연다. 사용자가 그 화면에서 이 앱을 켠다. */
export function openNotificationAccessSettings(): void {
  InboxNative.openNotificationAccessSettings();
}

/** 이 빌드가 알림 듣기와 기기 OCR 을 들고 있는가. */
export const isInboxNativeAvailable = InboxNative.isAvailable;

/**
 * 맞춤에 쓸 목록을 읽는다.
 *
 * 알림 여러 건을 담을 때 목록을 건마다 읽으면 같은 질의가 수십 번 돈다. 한 번 읽어
 * 나눠 쓴다. 읽지 못해도 담기는 멈추지 않는다 -- 결제수단과 분류가 빈 후보가 되고,
 * 사람이 그 칸을 고른다.
 */
async function loadHints(projectId: string): Promise<CollectHints> {
  const port = homeDataPort();
  try {
    const [accounts, cards, history] = await Promise.all([
      port.getAccountsV2(projectId),
      port.getCards(projectId),
      merchantHistory(projectId),
    ]);
    // 알림을 받은 사람, 캡처를 올린 사람("나")의 통장·카드에서만 찾는다.
    return hintsOwnedBy({ accounts, cards, history }, myPersonIdOf(projectId));
  } catch {
    return NO_HINTS;
  }
}
