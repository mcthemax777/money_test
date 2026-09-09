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
