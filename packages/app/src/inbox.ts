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
 * **사진과 알림 문구는 서버로 가지 않는다.** 서버에 담기는 것은 읽어 낸 값과 그
 * 근거가 된 원문 한 줄이고, 그것도 사용자가 보관함에서 보고 지울 수 있다. 사진 자체는
 * 기기를 떠나지 않는다.
 */
import { draftPort } from '@money/core/data/draft-port';
import { homeDataPort } from '@money/core/data/home-port';
import { notificationDedupeKey, parseNotification } from '@money/core/lib/draft-parse';
import {
  captureItems,
  draftItemFrom,
  NO_HINTS,
  type CollectHints,
} from '@money/core/lib/draft-collect';
import type { EntryDraftDto } from '@money/types';

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
 * 이 기기에 쌓인 알림을 후보로 담는다.
 *
 * 앱이 열릴 때와 보관함 화면에서 "지금 확인하기"를 누를 때 부른다. 담긴 것이 확인된
 * 알림만 버퍼에서 지운다 -- 올리다 끊기면 그대로 남아 다음에 다시 올라간다.
 */
export async function collectNotifications(projectId: string): Promise<CollectResult> {
  if (!InboxNative.isAvailable) return EMPTY;

  const captured = InboxNative.readNotifications();
  if (captured.length === 0) return EMPTY;

  const hints = await loadHints(projectId);
  const items: EntryDraftDto.CreateItem[] = [];
  /** 후보가 된 알림의 열쇠. 담긴 뒤 이 열쇠들만 버퍼에서 지운다. */
  const usedKeys: string[] = [];
  /** 금융 알림이 아니어서 후보가 되지 못한 것. 이쪽도 버퍼에서 지운다. */
  const droppedKeys: string[] = [];

  for (const notification of captured) {
    const parsed = parseNotification(notification);
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

    items.push(
      draftItemFrom(parsed, hints, {
        source: 'notification',
        dedupeKey: notificationDedupeKey(notification),
        appPackage: notification.packageName,
        appTitle: notification.title,
        // 문구에서 시각을 못 읽으면 알림이 온 시각이 그 거래의 시각이다.
        occurredAt: new Date(notification.postedAt).toISOString(),
      }),
    );
    usedKeys.push(notification.key);
  }

  if (items.length === 0) {
    InboxNative.clearNotifications(droppedKeys);
    return EMPTY;
  }

  // 창구가 서버에 올리고 사본에도 넣는다 (화면이 읽는 자리가 사본이다).
  const result = await draftPort().add(projectId, items);
  // 서버가 받아들인 뒤에 지운다. 여기까지 오지 못하면 알림은 버퍼에 그대로 남는다.
  InboxNative.clearNotifications([...usedKeys, ...droppedKeys]);

  return { added: result.created, skipped: result.skipped };
}

/**
 * 고른 사진에서 거래를 읽어 후보로 담는다.
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
    return { accounts, cards, history };
  } catch {
    return NO_HINTS;
  }
}
