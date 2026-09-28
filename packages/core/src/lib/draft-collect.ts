/**
 * 읽어 낸 값을 서버에 담을 모양으로 만드는 자리.
 *
 * 파서(`draft-parse`)와 맞춤(`draft-match`) 사이를 잇는다. **앱과 웹이 함께 쓴다** --
 * 앱은 기기 OCR(ML Kit)로, 웹은 브라우저 OCR(tesseract.js)로 글자를 얻지만, 그 뒤의
 * 일(문구를 값으로 읽고, 이 가계부의 카드·통장·분류와 맞추고, 중복 열쇠를 붙이는 것)은
 * 같아야 한다. 두 곳에 따로 두면 같은 캡처가 웹과 앱에서 다른 후보가 된다.
 *
 * 글자를 **얻는** 방법만 플랫폼이 정한다. 그 앞은 각자, 그 뒤는 여기다.
 */

import type { EntryDraftDto, EntryListItem } from '@money/types';

import {
  captureDedupeKey,
  parseCaptureText,
  type ParsedDraft,
} from './draft-parse';
import { guessCategoryId, matchPaymentMethod } from './draft-match';
import type { Account, Card } from './types';

/** 맞춤에 쓰는 재료. 후보를 담기 전에 한 번 읽어 나눠 쓴다. */
export interface CollectHints {
  accounts: Account[];
  cards: Card[];
  /** 지난 거래. 가맹점으로 분류를 짐작하는 데 쓴다 (최근 것이 앞이어야 한다). */
  history: MerchantHistoryRow[];
}

export interface MerchantHistoryRow {
  merchant: string | null;
  description: string;
  categoryId: string | null;
}

export const NO_HINTS: CollectHints = { accounts: [], cards: [], history: [] };

/**
 * 그 사람의 통장·카드만 남긴다. 알림을 받은 사람, 캡처를 올린 사람의 자산에서만
 * 결제수단을 찾게 한다.
 *
 * 알림은 그 폰 주인의 카드·통장에서 나고, 캡처도 대개 자기 카드 앱 화면이다. 가계부의 모든 자산과 견주면 같은 카드사
 * 카드를 가진 다른 구성원의 카드가 붙는다 -- 남편 폰에 온 신한카드 알림이 아내의
 * 신한카드로 적힌다. 카드는 주인 칸이 없어 **결제 통장의 주인**으로 가린다.
 *
 * "나"를 정하지 않았으면(null) 누구의 것인지 알 수 없으니 아무것도 남기지 않는다.
 * 결제수단이 빈 후보가 되고, 사람이 고른다. 분류 짐작(history)은 그대로 둔다.
 */
export function hintsOwnedBy(hints: CollectHints, personId: string | null): CollectHints {
  if (!personId) return { ...hints, accounts: [], cards: [] };

  const owned = new Set(
    hints.accounts.filter((account) => account.ownerId === personId).map((account) => account.id),
  );
  return {
    ...hints,
    accounts: hints.accounts.filter((account) => owned.has(account.id)),
    cards: hints.cards.filter((card) => owned.has(card.paymentAccountId)),
  };
}

/**
 * 이체·카드대금에는 분류가 없다.
 *
 * 돈이 통장 사이를 옮겨 다닌 것뿐이라 "무엇에 썼는가"가 없다. 후보를 만들 때
 * `categoryId` 를 일부러 비우고(아래 `collectItem`), 폼도 그 칸을 감춘다. 그래서
 * "빈 칸이 있다"고 셀 때도 이 둘은 빼야 한다 -- 넣으면 이체 후보가 채울 것도 없이
 * 늘 경고를 달고 있게 된다.
 */
function needsCategory(kind: EntryDraftDto.Response['kind']): boolean {
  return kind !== 'transfer' && kind !== 'card_payment';
}

/**
 * 사람이 채워야 할 칸이 남았는가. 보관함의 "빈 칸이 있습니다" 가 이것을 본다.
 *
 * 셋을 본다. **금액**·**결제수단**(이체는 받는 통장까지)·**대분류**. 알림이나 캡처에서 못 읽거나 짐작이
 * 빗나가면 비는 칸들이고, 비어 있으면 폼을 열었을 때 사람이 고르지 않고 지나칠 수
 * 있다.
 *
 * 웹과 앱이 함께 쓴다. 두 곳에 따로 두면 같은 후보가 한쪽에서만 경고를 단다.
 */
/**
 * 누가, 어느 기기에서 담았는가. "홍길동 · Galaxy S21". 둘 다 모르면 null.
 *
 * 이름은 담은 사용자가 그 가계부에서 "나"로 고른 구성원이다. 고르지 않았으면 기기만 보인다.
 */
export function draftAddedBy(
  draft: Pick<EntryDraftDto.Response, 'createdByName' | 'deviceName'>,
): string | null {
  const parts = [draft.createdByName, draft.deviceName].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * 후보에 붙은 결제수단의 이름. 못 찾았으면 null 이고 화면이 적지 않는다.
 *
 * 이체는 "보내는 통장 → 받는 통장" 이다. 받는 쪽이 카드 부채 계정이면 그 카드 이름을
 * 적는다 -- 부채 계정은 통장 목록에 없어 이름을 찾을 수 없다. 받는 쪽을 모르면 보내는
 * 쪽만 적는다.
 */
export function draftMethodName(
  draft: Pick<EntryDraftDto.Response, 'kind' | 'cardId' | 'accountId' | 'toAccountId'>,
  lists: { accounts: Account[]; cards: Card[] },
): string | null {
  const accountName = (id: string | null) =>
    id
      ? (lists.accounts.find((account) => account.id === id)?.name ??
        lists.cards.find((card) => card.liabilityAccountId === id)?.name ??
        null)
      : null;

  if (draft.cardId) return lists.cards.find((card) => card.id === draft.cardId)?.name ?? null;

  const from = accountName(draft.accountId);
  const to = draft.kind === 'transfer' ? accountName(draft.toAccountId ?? null) : null;
  if (from && to) return `${from} → ${to}`;
  return from ?? to;
}

export function draftNeedsFix(draft: EntryDraftDto.Response): boolean {
  return missingFields(draft).length > 0;
}

/** 거래로 적기 전에 사람이 채워야 할 칸. 화면이 이 차례대로 이름을 적는다. */
export type MissingField = 'amount' | 'method' | 'toAccount' | 'category';

/**
 * 비어 있는 칸들. 후보의 "빈 칸이 있습니다"와 반복 저장 때의 확인이 함께 쓴다.
 *
 * 반복이 비워 둔 칸은 그대로 회차 후보의 빈 칸이 된다. 두 곳이 다른 규칙을 쓰면 저장할
 * 때는 묻지 않았는데 후보에는 경고가 붙는다.
 */
export function missingFields(values: {
  kind: EntryDraftDto.Response['kind'];
  amount?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  cardId?: string | null;
  categoryId?: string | null;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!values.amount) missing.push('amount');
  if (!values.cardId && !values.accountId) missing.push('method');
  // 이체는 받는 통장도 있어야 적힌다. 알림 이체는 문구에서 알 수 없어 늘 비어 온다.
  if (values.kind === 'transfer' && !values.toAccountId) missing.push('toAccount');
  if (needsCategory(values.kind) && !values.categoryId) missing.push('category');
  return missing;
}

/**
 * 읽어 낸 값 하나를 서버가 받는 모양으로.
 *
 * 결제수단은 맞춤이 찾은 것을 넣고, 못 찾으면 비운다. 분류는 지출·수입에만 붙인다 --
 * 이체와 카드대금 전표에는 분류가 없어서, 채워 보내면 폼이 열릴 때 버려야 한다.
 */
export function draftItemFrom(
  parsed: ParsedDraft,
  hints: CollectHints,
  extra: {
    source: EntryDraftDto.CreateItem['source'];
    dedupeKey: string;
    appPackage?: string | null;
    appTitle?: string | null;
    /** 문구에서 시각을 못 읽었을 때 쓸 값. 알림이 온 시각이 그 자리다. */
    occurredAt?: string | null;
  },
): EntryDraftDto.CreateItem {
  const matched = matchPaymentMethod(parsed, {
    accounts: hints.accounts,
    cards: hints.cards,
  });

  return {
    source: extra.source,
    dedupeKey: extra.dedupeKey,
    rawText: parsed.rawText,
    appPackage: extra.appPackage ?? null,
    appTitle: extra.appTitle ?? null,
    kind: parsed.kind,
    amount: parsed.amount,
    currency: parsed.currency,
    occurredAt: parsed.occurredAt ?? extra.occurredAt ?? null,
    merchant: parsed.merchant,
    description: parsed.description,
    installmentMonths: parsed.installmentMonths,
    accountId: matched.accountId,
    cardId: matched.cardId,
    /*
     * 분류는 지난 거래에서 짐작한다.
     *
     * 이체와 카드대금에는 붙이지 않는다 -- 그 갈래의 전표에는 분류가 없어서, 채워
     * 보내면 폼이 열릴 때 버려야 한다.
     *
     * **갈래를 못 읽은 후보(null)에는 붙인다.** 캡처의 목록 줄에는 "승인" 같은 낱말이
     * 없어 갈래가 비는 것이 정상이고, 폼은 그때 지출로 연다. 여기서 빼면 캡처에서는
     * 분류 짐작이 아예 없어진다.
     */
    categoryId:
      parsed.kind === 'transfer' || parsed.kind === 'card_payment'
        ? null
        : guessCategoryId(parsed.merchant, hints.history),
    confidence: parsed.confidence,
    parser: parsed.parser,
  };
}

/**
 * 캡처에서 읽은 글자 덩어리를 후보 목록으로.
 *
 * 사진 한 장에서 여러 건이 나온다(카드사 앱의 이용 내역). 중복 열쇠는 사진의 글자
 * 전체와 그 안의 몇 번째인지로 만들므로, 같은 사진을 두 번 올려도 후보가 늘지 않는다.
 */
export function captureItems(
  text: string,
  hints: CollectHints,
  options: { now?: number } = {},
): EntryDraftDto.CreateItem[] {
  return parseCaptureText(text, options).map((parsed, index) =>
    draftItemFrom(parsed, hints, {
      source: 'capture',
      dedupeKey: captureDedupeKey(text, index, parsed),
    }),
  );
}

/**
 * 거래 목록을 분류 짐작의 재료로.
 *
 * 목록 한 줄(`EntryListItem`)에는 가맹점과 분류가 이미 들어 있다. 웹은 서버 목록을,
 * 앱은 사본을 읽어 이 모양으로 만든다.
 */
export function historyFromEntries(entries: EntryListItem[]): MerchantHistoryRow[] {
  return entries.map((entry) => ({
    merchant: entry.merchant,
    description: entry.description,
    categoryId: entry.categoryId,
  }));
}

/**
 * 같은 결제로 보는 시각의 폭. 알림이 온 시각(또는 문구의 시각)이 이 안이면 같은 때다.
 *
 * 한 번의 결제에 알림이 여럿 온다 -- 카드사 앱, 문자, 은행 앱이 저마다 몇 초 사이를
 * 두고 보낸다. 폭을 넓히면 연달아 긁은 같은 금액의 다른 결제가 하나로 합쳐지므로 1분으로
 * 좁게 둔다.
 */
export const NOTIFICATION_DUPLICATE_WINDOW_MS = 60 * 1000;

/** 겹침을 가리는 데 쓰는 칸. 새로 담을 것(`CreateItem`)과 이미 담긴 것(`Response`)이 함께 가진다. */
type DuplicateShape = Pick<
  EntryDraftDto.CreateItem,
  | 'kind'
  | 'amount'
  | 'currency'
  | 'occurredAt'
  | 'merchant'
  | 'description'
  | 'installmentMonths'
  | 'cardId'
  | 'accountId'
  | 'rawText'
>;

/**
 * 두 알림 후보가 같은 결제인가.
 *
 * 금액과 통화가 같고, 시각이 폭 안이고, 갈래가 서로 어긋나지 않아야 한다. 갈래는
 * **수입과 수입 아닌 것**만 가른다 -- 같은 카드 결제를 카드사는 "승인"(지출)으로, 은행은
 * "출금"(이체)으로 적어 갈래가 달리 읽히기 때문이다. 같은 때 같은 금액이 들어오고
 * 나간 것은 서로 다른 거래다.
 *
 * 금액이나 시각을 못 읽은 후보는 무엇과도 겹치지 않는다. 모르는 것끼리 묶으면 서로 다른
 * 결제가 사라진다.
 */
function isSameNotificationPayment(left: DuplicateShape, right: DuplicateShape): boolean {
  if (!left.amount || left.amount !== right.amount) return false;
  if ((left.currency ?? 'KRW') !== (right.currency ?? 'KRW')) return false;
  if ((left.kind === 'income') !== (right.kind === 'income')) return false;

  const leftAt = left.occurredAt ? Date.parse(left.occurredAt) : NaN;
  const rightAt = right.occurredAt ? Date.parse(right.occurredAt) : NaN;
  if (Number.isNaN(leftAt) || Number.isNaN(rightAt)) return false;
  return Math.abs(leftAt - rightAt) <= NOTIFICATION_DUPLICATE_WINDOW_MS;
}

/**
 * 겹친 알림 가운데 무엇이 더 많이 알려 주는가. 양수면 왼쪽이 낫다.
 *
 * 1. **결제수단을 찾았는가.** 카드·통장이 채워진 쪽이 사람이 손볼 칸이 적다.
 * 2. **채워진 칸의 수.** 갈래·가맹점·내용·할부.
 * 3. **원문의 길이.** 위가 같으면 더 긴 문구가 대개 카드 이름·끝자리를 더 적는다.
 */
function compareRichness(left: DuplicateShape, right: DuplicateShape): number {
  const paid = (row: DuplicateShape) => (row.cardId || row.accountId ? 1 : 0);
  const filled = (row: DuplicateShape) =>
    [row.kind, row.merchant, row.description, row.installmentMonths].filter(
      (value) => value !== null && value !== undefined && value !== '',
    ).length;
  return (
    paid(left) - paid(right) ||
    filled(left) - filled(right) ||
    (left.rawText?.length ?? 0) - (right.rawText?.length ?? 0)
  );
}

/** 겹침을 걸러 낸 결과. */
export interface NotificationDedupe<T> {
  /** 담을 것. 겹친 무리마다 가장 많이 알려 주는 하나만 남는다. */
  keep: T[];
  /**
   * 새 것에 밀려 지울, 이미 담긴 대기 중 후보의 id.
   *
   * 먼저 온 알림이 이미 보관함에 있는데 나중 알림이 카드를 더 잘 가리키면 그쪽으로
   * 갈아 끼운다. 등록·무시한 것은 사람이 이미 손댄 것이라 건드리지 않고 새 것을 버린다.
   */
  replace: string[];
}

/**
 * 한 결제로 온 알림 여러 건을 하나로 줄인다.
 *
 * 먼저 이번에 읽은 것끼리 묶어 무리마다 하나를 남기고, 남은 것을 이미 담긴 알림
 * 후보와 견준다. 이미 담긴 것이 등록·무시됐거나 더 낫다면 새 것을 버리고, 대기 중인데
 * 새 것이 더 나으면 새 것을 담고 옛 것을 지운다.
 *
 * `T` 에 알림 열쇠 같은 것을 함께 실어 부르는 쪽이 버퍼 정리에 쓴다.
 */
export function dedupeNotificationItems<T extends { item: EntryDraftDto.CreateItem }>(
  incoming: T[],
  existing: EntryDraftDto.Response[],
): NotificationDedupe<T> {
  const groups: T[][] = [];
  for (const candidate of incoming) {
    const group = groups.find((members) =>
      members.some((member) => isSameNotificationPayment(member.item, candidate.item)),
    );
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }

  const keep: T[] = [];
  const replace = new Set<string>();
  for (const group of groups) {
    const best = group.reduce((winner, member) =>
      compareRichness(member.item, winner.item) > 0 ? member : winner,
    );

    const already = existing.filter(
      (draft) => draft.source === 'notification' && isSameNotificationPayment(draft, best.item),
    );
    if (already.some((draft) => draft.status !== 'pending')) continue;
    if (already.some((draft) => compareRichness(draft, best.item) >= 0)) continue;

    keep.push(best);
    for (const draft of already) replace.add(draft.id);
  }

  return { keep, replace: [...replace] };
}
