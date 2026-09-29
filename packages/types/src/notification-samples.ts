/**
 * 다른 금융 앱이 보낸 알림의 원문(표본)과, 그 표본으로 배운 앱별 문구 규칙.
 *
 * 표본은 기기가 알림을 모을 때 **돈 표기가 있는 알림**을 그대로 서버에 올린 것이다. 후보가
 * 되지 못한 것도 올린다 -- 파서가 놓친 문구를 찾는 것이 표본을 모으는 까닭이다.
 *
 * 규칙은 관리 도구(`/admin/notification-rules`)에서 같은 앱의 표본을 맞대어 뽑고 사람이
 * 칸 이름을 확인해 저장한다. 기기는 규칙을 내려받아 알림을 읽을 때 먼저 대 본다
 * (`@money/core` 의 `notification-rule`). 서버·웹·앱이 이 모양 하나를 쓴다.
 */
import type { EntryKind } from './entities';

/** 규칙의 칸이 담는 값. `ignore` 는 바뀌는 자리지만 쓰지 않는 값(누적액, 이름 가림 등)이다. */
export const NOTIFICATION_RULE_FIELDS = [
  'amount',
  'merchant',
  'datetime',
  'cardTail',
  'installment',
  'ignore',
] as const;
export type NotificationRuleField = (typeof NOTIFICATION_RULE_FIELDS)[number];

/**
 * 규칙의 한 토막. 늘 같은 글(`literal`)이거나, 알림마다 바뀌는 칸(`field`)이다.
 *
 * 정규식을 저장하지 않고 이 토막을 저장한다. 사람이 칸 이름만 바꿀 수 있고, 정규식은
 * 기기가 토막에서 만든다 -- 저장된 정규식을 그대로 돌리면 한 줄 실수로 기기마다
 * 되돌이(backtracking)에 갇힐 수 있다.
 */
export type NotificationRuleSegment = { literal: string } | { field: NotificationRuleField };

export interface NotificationRule {
  id: string;
  /** 이 규칙을 댈 앱. 알림의 packageName 과 똑같아야 한다. */
  packageName: string;
  name: string;
  segments: NotificationRuleSegment[];
  /** 갈래. null 이면 문구의 낱말로 정한다(기존 규칙). */
  kind: EntryKind | null;
  /** 금액의 통화. null 이면 문구에서 읽고, 그것도 없으면 원화다. */
  currency: string | null;
  enabled: boolean;
  /** 사람이 남긴 말. 어느 서식인지, 무엇을 고쳤는지. */
  note: string | null;
  /** 몇 건의 표본에서 배웠는가. */
  learnedFrom: number;
  createdAt: string;
  updatedAt: string;
}

/** 한 규칙이 가질 수 있는 토막 수와 한 토막의 글자 수. 기기의 정규식이 길어지지 않게 한다. */
export const NOTIFICATION_RULE_LIMITS = {
  segments: 60,
  fields: 12,
  literalLength: 300,
  nameLength: 100,
  noteLength: 2000,
} as const;

/**
 * 토막이 규칙으로 쓸 만한가. 잘못이면 그 까닭을, 괜찮으면 null 을 준다.
 *
 * 서버가 저장할 때와 관리 도구가 저장 단추를 막을 때 같이 부른다.
 *
 *   - **금액 칸이 꼭 하나 있어야 한다.** 금액 없는 후보는 거래가 될 수 없다.
 *   - **칸이 둘 붙어 있으면 안 된다.** 사이에 글이 없으면 어디서 끊을지 정할 수 없다.
 *   - 비어 있는 글 토막은 뜻이 없다(줄바꿈 하나는 글로 친다).
 */
export function notificationRuleProblem(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return '토막이 없습니다.';
  if (segments.length > NOTIFICATION_RULE_LIMITS.segments) {
    return `토막은 ${NOTIFICATION_RULE_LIMITS.segments}개까지입니다.`;
  }

  let fields = 0;
  let amounts = 0;
  let previousWasField = false;
  for (const segment of segments) {
    if (segment && typeof segment === 'object' && 'field' in segment) {
      if (!NOTIFICATION_RULE_FIELDS.includes(segment.field)) return `모르는 칸입니다: ${String(segment.field)}`;
      if (previousWasField) return '칸 둘이 붙어 있습니다. 사이에 늘 같은 글이 있어야 끊을 수 있습니다.';
      fields += 1;
      if (segment.field === 'amount') amounts += 1;
      previousWasField = true;
    } else if (segment && typeof segment === 'object' && 'literal' in segment) {
      const literal = segment.literal;
      // 줄바꿈만 있는 토막은 뜻이 있다 -- 시각 줄과 가맹점 줄을 가르는 유일한 글일 수 있다.
      if (typeof literal !== 'string' || literal.replace(/[^\S\n]/g, '') === '') return '빈 글 토막이 있습니다.';
      if (literal.length > NOTIFICATION_RULE_LIMITS.literalLength) {
        return `글 토막은 ${NOTIFICATION_RULE_LIMITS.literalLength}자까지입니다.`;
      }
      previousWasField = false;
    } else {
      return '토막 모양이 올바르지 않습니다.';
    }
  }

  if (fields > NOTIFICATION_RULE_LIMITS.fields) return `칸은 ${NOTIFICATION_RULE_LIMITS.fields}개까지입니다.`;
  if (amounts !== 1) return '금액 칸이 꼭 하나 있어야 합니다.';
  return null;
}

/** 기기가 알림을 읽은 그 자리의 결과. 관리 도구가 "지금 다시 읽은 결과"와 견준다. */
export interface NotificationSampleParsed {
  parser: string;
  kind: EntryKind | null;
  amount: string | null;
  currency: string | null;
  occurredAt: string | null;
  merchant: string | null;
  cardTail: string | null;
  installmentMonths: number | null;
  issuer: string | null;
}

export namespace NotificationSampleDto {
  export interface CreateItem {
    packageName: string;
    title: string | null;
    text: string;
    /** 알림이 온 시각 (epoch ms). */
    postedAt: number;
    /** 같은 알림을 두 번 담지 않는 열쇠. 후보의 dedupeKey 와 같은 값이다. */
    sampleKey: string;
    /** 기기가 읽은 결과. 거래로 읽히지 않았으면 null. */
    parsed: NotificationSampleParsed | null;
    deviceName?: string | null;
    appVersion?: string | null;
  }

  export interface CreateRequest {
    samples: CreateItem[];
  }

  export interface CreateResponse {
    created: number;
    skipped: number;
  }

  /** 관리 도구가 보는 표본 하나. */
  export interface Response {
    id: string;
    packageName: string;
    title: string | null;
    text: string;
    postedAt: string;
    parsed: NotificationSampleParsed | null;
    deviceName: string | null;
    appVersion: string | null;
    userName: string | null;
    createdAt: string;
  }

  export interface ListQuery {
    packageName?: string;
    /** 제목·본문에 들어 있는 글. */
    q?: string;
    /** 'yes' 기기가 거래로 읽은 것, 'no' 못 읽은 것. */
    parsed?: 'yes' | 'no';
    cursor?: string;
    limit?: number;
  }

  export interface ListResponse {
    samples: Response[];
    nextCursor: string | null;
  }

  /** 앱별 표본 수. 관리 도구의 앱 고르기가 쓴다. */
  export interface PackageSummary {
    packageName: string;
    count: number;
    parsedCount: number;
    ruleCount: number;
    lastPostedAt: string;
  }
}

export namespace NotificationRuleDto {
  export interface SaveRequest {
    packageName: string;
    name: string;
    segments: NotificationRuleSegment[];
    kind: EntryKind | null;
    currency: string | null;
    enabled?: boolean;
    note?: string | null;
    learnedFrom?: number;
  }
}
