/**
 * 거래 폼에서 함께 적는 페이백 (PAYBACK_DESIGN.md 7단계 보강).
 *
 * 지출을 적거나 고치는 폼 안에서 "이 지출의 페이백"을 줄로 적어 두고, 지출을 저장한 직후
 * 그 지출에 걸어 함께 저장한다. 새 지출은 저장해야 id 가 생기므로 그 전까지는 적어 둔
 * 값(초안)으로만 든다. 웹과 앱의 편집기가 같은 규칙을 쓴다.
 *
 * 이미 받은 페이백은 여기서 다루지 않는다. 그것은 이미 전표라 페이백 편집기로 고친다.
 */
import { type EntryDto, type PaybackType, newLineKey, zonedFormValueToUtc } from '@money/types';
import { isTimeKey, parseMethod, type PaymentMethodValue } from '../data/entry-form';
import { isDateKey, nowTimeKey, todayKey } from './datetime';

/** 폼에 적어 둔 페이백 한 줄. */
export interface PaybackDraft {
  /** 화면의 줄 이름. 저장과는 상관없다. */
  key: string;
  amount: string;
  /** 들어온 날 (프로젝트 타임존의 'YYYY-MM-DD'). */
  dateKey: string;
  /** 'HH:mm'. 비면 정오다 (`zonedFormValueToUtc`). */
  timeKey: string;
  /** 들어온 곳. 거래 폼과 같은 값('account:id' / 'card:id'). 비면 미지정 계정이다. */
  method: PaymentMethodValue;
  /** 원거래의 어느 줄인지. 줄이 하나면 그 줄로 저장한다. */
  lineKey: string;
  /** 환불인가 페이백인가. 카드 실적의 기본값이 갈린다 (조립이 정한다). */
  paybackType: PaybackType;
}

/** 원거래의 분류 줄 하나. 폼이 지금 들고 있는 값이다. */
export interface PaybackLine {
  lineKey: string;
  categoryId: string;
}

export function newPaybackDraft(
  timeZone: string,
  defaults: { method: PaymentMethodValue; lineKey?: string },
): PaybackDraft {
  return {
    key: newLineKey(),
    amount: '',
    dateKey: todayKey(timeZone),
    timeKey: nowTimeKey(timeZone),
    method: defaults.method,
    lineKey: defaults.lineKey ?? '',
    paybackType: 'payback',
  };
}

/** 이 초안이 저장할 줄. 원거래 줄이 하나면 고르지 않아도 그 줄이다. */
function lineOf(draft: PaybackDraft, lines: readonly PaybackLine[]): PaybackLine | null {
  if (lines.length === 1) return lines[0];
  return lines.find((line) => line.lineKey === draft.lineKey) ?? null;
}

export interface PaybackDraftViolation {
  key: string;
  code: 'AMOUNT_INVALID' | 'DATE_INVALID' | 'TIME_INVALID' | 'PAYBACK_LINE_REQUIRED' | 'CATEGORY_REQUIRED';
}

/**
 * 저장할 수 있는 초안들인지. 맞으면 null.
 *
 * **지출을 저장하기 전에 본다.** 지출만 저장되고 페이백이 거절되면 사용자는 반쯤 저장된
 * 상태를 받는다. 막을 수 있는 것은 미리 막는다. 금액이 비어 있는 줄은 적다 만 줄로 보고
 * 건너뛴다(`filledDrafts`) -- "페이백 추가"를 눌러 둔 것만으로 저장이 막히면 안 된다.
 */
export function checkPaybackDrafts(
  drafts: readonly PaybackDraft[],
  lines: readonly PaybackLine[],
): PaybackDraftViolation | null {
  for (const draft of filledDrafts(drafts)) {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { key: draft.key, code: 'AMOUNT_INVALID' };
    if (!isDateKey(draft.dateKey)) return { key: draft.key, code: 'DATE_INVALID' };
    if (draft.timeKey && !isTimeKey(draft.timeKey)) return { key: draft.key, code: 'TIME_INVALID' };
    const line = lineOf(draft, lines);
    if (!line) return { key: draft.key, code: 'PAYBACK_LINE_REQUIRED' };
    // 분류를 아직 고르지 않은 줄이다. 지출 자신도 그때는 저장되지 않는다.
    if (!line.categoryId) return { key: draft.key, code: 'CATEGORY_REQUIRED' };
  }
  return null;
}

/** 금액을 적은 초안만. 비어 있는 줄은 적다 만 것이라 저장하지 않는다. */
export function filledDrafts(drafts: readonly PaybackDraft[]): PaybackDraft[] {
  return drafts.filter((draft) => draft.amount.trim() !== '');
}

/**
 * 초안 하나를 페이백 만들기 요청으로. 원거래를 저장한 뒤에 부른다.
 *
 * 분류는 원거래 줄의 것이다 -- 조립도 그 줄의 분류로 덮는다(entry-build 의 buildPayback).
 * 설명과 사람은 원거래의 것을 쓴다. 페이백 편집기의 새 페이백과 같은 기본이다(`paybackFormFrom`).
 */
export function paybackDraftRequest(
  draft: PaybackDraft,
  original: { id: string; personId: string | null; description: string; lines: readonly PaybackLine[] },
  timeZone: string,
): EntryDto.CreateRequest {
  const line = lineOf(draft, original.lines);
  if (!line) throw new Error('페이백을 받은 줄을 찾을 수 없습니다.');
  const method = parseMethod(draft.method);
  return {
    kind: 'payback',
    personId: original.personId,
    date: zonedFormValueToUtc(draft.dateKey, draft.timeKey, timeZone).toISOString(),
    description: original.description,
    amount: draft.amount.trim(),
    categoryId: line.categoryId,
    lineKey: newLineKey(),
    ...(method.accountId ? { accountId: method.accountId } : {}),
    ...(method.cardId ? { cardId: method.cardId } : {}),
    tagIds: [],
    paybackOfEntryId: original.id,
    paybackOfLineKey: line.lineKey,
    // 실적은 싣지 않는다. 조립이 종류의 기본값으로 정한다 -- 바꾸려면 페이백 편집기에서 고친다.
    paybackType: draft.paybackType,
  };
}
