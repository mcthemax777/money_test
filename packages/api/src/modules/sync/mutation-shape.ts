/**
 * 기기가 보낸 명령의 모양을 보고 고치는 순수 함수들 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 데이터베이스를 읽지 않는다. 명령이 재생할 수 있는 모양인지, 시계가 믿을 만한지,
 * 같은 묶음의 별칭을 어떻게 갈아 끼우는지, 로그에 무엇을 남기는지만 정한다.
 */
import { HttpException } from '@nestjs/common';
import { HLC_MAX_COUNTER, decodeHlc, encodeHlc, type Mutation } from '@money/types';

/** 기기 시계가 서버보다 앞서도 받아 주는 폭. 이보다 앞선 시계는 서버의 지금으로 끌어내린다. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Postgres int 의 상한. 순번(clientSeq)이 이보다 크면 모양이 어긋난 명령으로 본다. */
const MAX_CLIENT_SEQ = 2_147_483_647;

/** 로그 한 줄에 싣는 짐의 최대 길이. 청구액 확정처럼 여러 건을 담는 명령이 로그를 덮지 않게 한다. */
const PAYLOAD_LOG_LIMIT = 2000;

/**
 * 명령의 시계(HLC)를 믿을 만한 값으로 맞춘다 (2026-10-16).
 *
 * 기기가 보낸 시계를 그대로 믿으면, 시계가 한 해 앞선 휴대폰이 그 한 해 동안 모든 병합을 이기고
 * 다른 기기의 편집은 충돌로 밀린다. 서버 시계는 그 값을 따라잡지 못한다. 그렇다고 거절하면 그
 * 기기의 적은 것이 보류 칸에 쌓이므로, 너무 앞선(또는 모양이 틀린) 시계만 서버의 지금으로 바꾼다.
 * 기기 이름(node)은 남겨 같은 시각의 승부를 가르는 데 그대로 쓴다.
 */
export function withSaneClock(mutation: Mutation): Mutation {
  const decoded = decodeHlc(mutation.hlc);
  const now = Date.now();
  /*
   * 모양까지 본다 (2026-10-16). 시계는 문자열로 견주므로 자릿수가 고정된 모양(`encodeHlc`)이어야 한다.
   * "9:0:x" 처럼 풀리기는 하지만 모양이 다른 값은 사전순으로 모든 진짜 시계보다 뒤에 서서, 그 줄의 이후
   * 편집을 영영 충돌로 밀어냈다. 다시 적은 값이 같을 때만 그대로 받는다.
   */
  if (
    decoded &&
    decoded.wall <= now + MAX_CLOCK_SKEW_MS &&
    decoded.counter <= HLC_MAX_COUNTER &&
    encodeHlc(decoded) === mutation.hlc
  ) {
    return mutation;
  }
  return {
    ...mutation,
    hlc: encodeHlc({ wall: now, counter: 0, node: decoded?.node || mutation.clientId || 'server' }),
  };
}

/** 재생할 수 있는 모양의 명령인가. 기기가 보낸 값이라 무엇이든 올 수 있다. */
export function isWellFormedMutation(value: unknown): boolean {
  const mutation = value as Partial<Mutation> | null;
  return (
    !!mutation &&
    typeof mutation === 'object' &&
    typeof mutation.mutationId === 'string' &&
    typeof mutation.kind === 'string' &&
    typeof mutation.hlc === 'string' &&
    // 순번은 DB 의 int 칸에 들어간다. 넘치면 보내기 전체가 일찍 실패해, 받기까지 멈췄다.
    Number.isInteger(mutation.clientSeq) &&
    (mutation.clientSeq as number) >= 0 &&
    (mutation.clientSeq as number) <= MAX_CLIENT_SEQ &&
    Array.isArray(mutation.targets) &&
    mutation.targets.every((target) => typeof target === 'string') &&
    !!mutation.payload &&
    typeof mutation.payload === 'object'
  );
}

/**
 * 명령의 대상과 짐에 든 id 를 별칭으로 갈아 끼운다. id 는 UUID 라 다른 값과 겹치지 않으므로 글자가 같은 자리를
 * 모두 바꾼다. 명령 id·순번·시계는 그대로다 -- 멱등의 열쇠라 건드리면 안 된다.
 */
export function withAliases(mutation: Mutation, aliases: ReadonlyMap<string, string>): Mutation {
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, swap(inner)]));
    }
    return value;
  };
  return {
    ...mutation,
    targets: mutation.targets.map((target) => aliases.get(target) ?? target),
    payload: swap(mutation.payload) as Mutation['payload'],
  };
}

/** 거절 로그에 실을 짐. 길면 자른다. */
export function payloadForLog(payload: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(payload) ?? String(payload);
  } catch {
    text = String(payload);
  }
  return text.length > PAYLOAD_LOG_LIMIT ? `${text.slice(0, PAYLOAD_LOG_LIMIT)}…(${text.length}자)` : text;
}

/** 잠금 아래에서 본 판이 견준 판과 달랐는가 (`LedgerService.replaceEntry` 의 `ENTRY_MODIFIED`). */
export function isEntryModified(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse() as { code?: string } | string;
  return typeof body === 'object' && body?.code === 'ENTRY_MODIFIED';
}
