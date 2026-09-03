/**
 * 화면이 그 언어로 다시 적을 수 있는 오류.
 *
 * 서버가 내려보내는 `error.message`는 한국어 한 벌이다. 화면이 세 언어를 쓰는
 * 지금은 그 문장을 그대로 띄우면 고른 언어와 어긋나므로, 서버는 무슨 일이
 * 일어났는지를 코드로 말하고 문구는 화면이 고른다.
 *
 * 여기 있는 것은 "사용자가 읽고 무엇을 할지 정할 수 있는" 오류다. 서버가 스스로
 * 지키는 불변식(전표의 posting 수, 부호 규칙 등)은 사용자가 손댈 수 없으므로
 * 코드를 붙이지 않는다. 그런 오류는 화면이 자기 기본 문구로 덮는다.
 *
 * 코드의 알갱이는 "사용자가 다르게 행동해야 하는 단위"다. 더 잘게 쪼개면 화면의
 * 사전만 늘고 읽는 사람에게 달라지는 것이 없다.
 *
 * 코드는 계약이다. 한 번 내보낸 코드의 뜻을 바꾸지 말고, 새 상황이면 새 코드를
 * 더한다. 오래된 화면이 새 코드를 모를 수 있으므로 화면은 모르는 코드를 만나면
 * 일반 문구로 되돌아간다.
 */

export const ERROR_CODES = [
  // 내 정보
  'NAME_REQUIRED',
  'NAME_TOO_LONG',
  'NOTHING_TO_UPDATE',
  'UNSUPPORTED_LOCALE',

  // 프로젝트 접근
  'PROJECT_NOT_FOUND',
  'PROJECT_FORBIDDEN',
  'PROJECT_OWNER_ONLY',
  'NOT_PROJECT_MEMBER',

  // 숨기기를 막는 사정들
  'ACCOUNT_HAS_BALANCE',
  'ACCOUNT_HAS_CARDS',
  'CARD_HAS_UNPAID',
  'PERSON_HAS_ACCOUNTS',

  // 카테고리
  'CATEGORY_NAME_REQUIRED',
  'CATEGORY_IN_USE',
  'CATEGORY_DEFAULT_LOCKED',

  // 태그
  'TAG_NAME_REQUIRED',
  'TAG_NAME_DUPLICATE',
  'TAG_NOT_IN_PROJECT',
  'TAG_TARGETS_REQUIRED',
  'TAG_TARGETS_TOO_MANY',
  'TAG_ADD_AND_REMOVE',

  // 프로젝트 참여와 초대
  'PROJECT_KEY_NOT_FOUND',
  'ALREADY_MEMBER',
  'JOIN_REQUEST_PENDING',
  'JOIN_REQUEST_HANDLED',
  'INVITATION_NOT_FOUND',
  'INVITATION_EXPIRED',
  'INVITATION_HANDLED',
  'LAST_OWNER_CANNOT_LEAVE',
  'CANNOT_KICK_OWNER',
  'CANNOT_KICK_SELF',

  // 거래
  'ENTRY_NOT_FOUND',
  'CARD_NOT_FOUND',
  'INSTALLMENT_CREDIT_ONLY',
  'TRANSFER_SAME_ACCOUNT',
  'EXTRA_EXCEEDS_AMOUNT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * 문구에 값이 들어가는 오류가 함께 보내는 값.
 *
 * "이름은 50자 이하"의 50처럼 문장 안에 박히는 숫자는 서버가 아는 값이다.
 * 문장째로 내려보내는 대신 값만 보내면 화면이 자기 말로 문장을 만든다.
 */
export type ErrorDetails = Record<string, string | number>;
