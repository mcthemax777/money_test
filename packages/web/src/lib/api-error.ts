/**
 * 서버 오류를 고른 언어의 문장으로 바꾼다.
 *
 * 서버는 무슨 일이 일어났는지를 코드로 말하고(`error.code`), 문구는 화면이 고른다.
 * 서버가 문장을 세 언어로 들고 있을 필요가 없고, 화면은 코드마다 다르게 반응할
 * 여지를 갖는다.
 *
 * 코드가 없는 오류가 훨씬 많다. 서버가 스스로 지키는 규칙을 어겼거나(사용자가
 * 손댈 수 없다) 아직 코드를 붙이지 않은 것이다. 그런 오류는 부르는 쪽이 넘긴
 * 기본 문구로 덮는다. 코드 문자열이나 한국어 원문이 화면에 그대로 나오면 안 된다.
 */
import { isErrorCode, type ErrorCode } from '@money/types';

import { translate, type MessageKey } from '@/lib/i18n';
import { useLocaleStore } from '@/store/locale';

/** 코드마다 화면이 쓸 문구. 코드를 더하면 여기가 비어 빌드가 막힌다. */
const MESSAGE_KEY: Record<ErrorCode, MessageKey> = {
  NAME_REQUIRED: 'error.NAME_REQUIRED',
  NAME_TOO_LONG: 'error.NAME_TOO_LONG',
  NOTHING_TO_UPDATE: 'error.NOTHING_TO_UPDATE',
  UNSUPPORTED_LOCALE: 'error.UNSUPPORTED_LOCALE',

  PROJECT_NOT_FOUND: 'error.PROJECT_NOT_FOUND',
  PROJECT_FORBIDDEN: 'error.PROJECT_FORBIDDEN',
  PROJECT_OWNER_ONLY: 'error.PROJECT_OWNER_ONLY',
  NOT_PROJECT_MEMBER: 'error.NOT_PROJECT_MEMBER',

  ACCOUNT_HAS_BALANCE: 'error.ACCOUNT_HAS_BALANCE',
  ACCOUNT_HAS_CARDS: 'error.ACCOUNT_HAS_CARDS',
  CARD_HAS_UNPAID: 'error.CARD_HAS_UNPAID',
  PERSON_HAS_ACCOUNTS: 'error.PERSON_HAS_ACCOUNTS',

  CATEGORY_NAME_REQUIRED: 'error.CATEGORY_NAME_REQUIRED',
  CATEGORY_IN_USE: 'error.CATEGORY_IN_USE',
  CATEGORY_DEFAULT_LOCKED: 'error.CATEGORY_DEFAULT_LOCKED',

  PROJECT_KEY_NOT_FOUND: 'error.PROJECT_KEY_NOT_FOUND',
  ALREADY_MEMBER: 'error.ALREADY_MEMBER',
  JOIN_REQUEST_PENDING: 'error.JOIN_REQUEST_PENDING',
  JOIN_REQUEST_HANDLED: 'error.JOIN_REQUEST_HANDLED',
  INVITATION_NOT_FOUND: 'error.INVITATION_NOT_FOUND',
  INVITATION_EXPIRED: 'error.INVITATION_EXPIRED',
  INVITATION_HANDLED: 'error.INVITATION_HANDLED',
  LAST_OWNER_CANNOT_LEAVE: 'error.LAST_OWNER_CANNOT_LEAVE',
  CANNOT_KICK_OWNER: 'error.CANNOT_KICK_OWNER',
  CANNOT_KICK_SELF: 'error.CANNOT_KICK_SELF',

  ENTRY_NOT_FOUND: 'error.ENTRY_NOT_FOUND',
  CARD_NOT_FOUND: 'error.CARD_NOT_FOUND',
  INSTALLMENT_CREDIT_ONLY: 'error.INSTALLMENT_CREDIT_ONLY',
  TRANSFER_SAME_ACCOUNT: 'error.TRANSFER_SAME_ACCOUNT',
  EXTRA_EXCEEDS_AMOUNT: 'error.EXTRA_EXCEEDS_AMOUNT',
};

/** 서버 오류 응답에서 꺼낸 값. 코드가 없으면 코드가 붙지 않은 오류다. */
interface ApiError {
  code?: ErrorCode;
  details?: Record<string, string | number>;
}

function readApiError(error: unknown): ApiError {
  const body = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (!body || typeof body !== 'object') return {};

  const { code, details } = body as { code?: unknown; details?: unknown };

  return {
    // 모르는 코드는 없는 것으로 친다. 화면이 새 코드를 모르는 채 배포돼 있을 수 있다.
    code: isErrorCode(code) ? code : undefined,
    details:
      details && typeof details === 'object'
        ? (details as Record<string, string | number>)
        : undefined,
  };
}

/**
 * 서버가 붙인 코드. 모르는 코드와 코드 없는 오류는 undefined다.
 *
 * 문구가 아니라 흐름이 갈리는 자리에서 쓴다. 예전에는 오류 문장에 특정 낱말이
 * 들었는지로 갈랐는데, 문장이 바뀌거나 언어가 달라지면 그대로 깨졌다.
 */
export function apiErrorCode(error: unknown): ErrorCode | undefined {
  return readApiError(error).code;
}

/**
 * 오류를 화면에 적을 문장으로.
 *
 * `fallbackKey`는 코드가 없거나 모르는 코드일 때 쓸 그 화면의 기본 문구다.
 * "저장에 실패했습니다"처럼 무엇을 하다 실패했는지 아는 쪽이 정해야 한다.
 */
export function apiErrorMessage(
  locale: Parameters<typeof translate>[0],
  error: unknown,
  fallbackKey: MessageKey,
): string {
  const { code, details } = readApiError(error);
  if (!code) return translate(locale, fallbackKey);

  return translate(locale, MESSAGE_KEY[code], details);
}

/** 화면에서 쓰는 통로. 언어가 바뀌면 이 훅을 쓰는 화면도 다시 그려진다. */
export function useApiError() {
  const locale = useLocaleStore((state) => state.locale);

  return {
    messageOf: (error: unknown, fallbackKey: MessageKey) =>
      apiErrorMessage(locale, error, fallbackKey),
  };
}
