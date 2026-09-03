/**
 * 아웃박스에 쌓이는 명령의 계약.
 *
 * 기기는 서버에 요청을 보내는 것이 아니라 **자기 저장소에 커밋한 다음** 그 사실을 명령
 * 으로 알린다(설계 문서의 D3). 그래서 화면은 언제나 로컬 커밋을 보고, 온라인과
 * 오프라인의 코드 경로가 하나가 된다.
 *
 * 행이 아니라 명령을 보내는 이유가 있다. 행을 그대로 밀어 넣으면 전표의 균형 검증과
 * 잔액 반영을 우회한다. 명령으로 보내면 서버가 온라인 요청과 **똑같은 도메인 서비스**로
 * 재생하므로 검증이 한 자리에 남는다.
 *
 * 2단계가 다루는 것은 전표 명령뿐이다. 설정 엔티티(이름·색·순서)는 3단계다.
 */

import type { CardTransferDirection, EntryKind } from './entities';

/** 2단계가 다루는 명령. 화면의 개념 그대로다. */
export type MutationKind = 'entry.create' | 'entry.replace' | 'entry.delete';

/**
 * 명령 하나.
 *
 * `clientSeq` 는 한 기기 안에서 1씩 오르는 번호다. 서버는 (clientId, clientSeq) 를 유일
 * 제약으로 두어 같은 명령이 두 번 적히지 않게 하고, 기기는 이 순서대로만 보낸다.
 * 순서를 지키지 않으면 "만들고 고친" 명령이 뒤집혀 없는 전표를 고치게 된다.
 */
export interface Mutation {
  /** 이 명령의 이름. 기기가 UUIDv7 로 만든다. 재전송해도 같은 값이다. */
  mutationId: string;
  clientId: string;
  clientSeq: number;
  /** 병합 순서를 정하는 시계 (hlc.ts) */
  hlc: string;
  kind: MutationKind;
  projectId: string;
  /**
   * 이 명령이 건드리는 대상 id.
   *
   * 앞 명령이 거절되면 **그 대상을 건드리는 뒤 명령만** 함께 보류한다. 큐 전체를 막으면
   * 관계없는 거래까지 멈추고, 그냥 흘려보내면 없는 전표를 고치거나 더 나쁘게는 다른
   * 전표에 적용된다.
   */
  targets: string[];
  payload: unknown;
}

/** 전표를 만들거나 통째로 바꾸는 명령의 짐. 화면이 쓰는 모양 그대로다. */
export interface EntryMutationPayload {
  /** 기기가 만든 전표 id. 만들 때도 고칠 때도 이 값이 대상이다. */
  id: string;
  kind: EntryKind | string;
  personId: string;
  /** ISO 문자열. 명령은 JSON 으로 오가므로 Date 를 담지 않는다. */
  date: string;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  amount?: string;
  categoryId?: string;
  extraAmount?: string;
  splits?: Array<{ categoryId: string; amount: string; extraAmount?: string }>;
  accountId?: string;
  toAccountId?: string;
  cardId?: string;
  installmentMonths?: number;
  toAmount?: string;
  transferFee?: string;
  transferFeeCategoryId?: string;
  cardTransferDirection?: CardTransferDirection;
  /**
   * 이 거래에 붙일 태그. 서버의 `EntryDto.CreateRequest.tagIds` 와 같은 규칙이다.
   *
   * 목록이 그대로 그 전표의 태그가 되고, 생략은 "비운다"다.
   */
  tagIds?: string[];
  /**
   * 오프라인에서 쓴 환율. 명령에 실어 보낸다.
   *
   * 그러지 않으면 며칠 뒤 재생할 때 그날 환율로 값이 다시 매겨져, 기기가 보여 준 금액과
   * 서버에 남는 금액이 달라진다 (D7).
   */
  currency?: string;
  exchangeRate?: string;
  billedAmount?: string;
}

/** 전표를 지우는 명령의 짐. */
export interface EntryDeletePayload {
  id: string;
}

/**
 * 명령 하나의 결과.
 *
 *   applied   적용했다.
 *   duplicate 이미 적용한 명령이다. 결과는 그때 것을 그대로 돌려준다.
 *   conflict  다른 기기의 더 늦은 편집이 이겼다. 기기는 충돌 목록에 남긴다.
 *   rejected  서버가 거절했다(권한, 규칙 위반). 보류 칸으로 간다.
 *   blocked   앞 명령이 막혀 같은 대상의 이 명령도 미뤘다. 서버까지 가지 않는다.
 *   deferred  서버가 아직 판정하지 못했다. **큐에 그대로 두고 다음에 다시 보낸다.**
 *
 * deferred 가 나머지와 다른 점은 사람이 할 일이 없다는 것이다. 같은 명령을 다른 요청이
 * 이미 재생하고 있을 때(기기가 응답을 못 받아 다시 보냈고 두 요청이 서로 다른 인스턴스에
 * 닿았을 때) 서버는 결과를 아직 모른다. 여기서 거절로 답하면 성공한 명령이 보류 칸에
 * 뜨고, 적용으로 답하면 실패한 명령이 조용히 사라진다. 그래서 판정을 미룬다.
 */
export type MutationStatus =
  | 'applied'
  | 'duplicate'
  | 'conflict'
  | 'rejected'
  | 'blocked'
  | 'deferred';

export interface MutationResult {
  mutationId: string;
  status: MutationStatus;
  /** 사람이 읽을 이유. rejected·conflict 일 때 채운다. */
  error?: string;
  /** 분기에 쓰는 코드 (entry-build 의 LedgerBuildError.code 등) */
  code?: string;
  /** 적용 뒤의 프로젝트 번호. 기기가 pull 커서를 앞당기는 데 쓴다. */
  appliedVersion?: number;
}

export interface PushRequest {
  projectId: string;
  clientId: string;
  mutations: Mutation[];
}

export interface PushResponse {
  results: MutationResult[];
  /** 이 응답 시점의 프로젝트 번호 */
  version: number;
}

/**
 * 이 명령이 서버까지 갈 필요가 없는가.
 *
 * 앞에서 막힌 대상을 건드리면 보낸들 없는 전표를 고치게 된다. 그래서 기기가 먼저 걸러
 * 보류 칸에 둔다.
 */
export function isBlockedBy(mutation: Mutation, blockedTargets: ReadonlySet<string>): boolean {
  return mutation.targets.some((target) => blockedTargets.has(target));
}

/** 이 명령이 끝난 상태인가. 큐에서 빼도 되는지 판단한다. */
export function isSettled(status: MutationStatus): boolean {
  return status === 'applied' || status === 'duplicate';
}

/**
 * 판정이 나지 않아 다시 보내야 하는가.
 *
 * 큐에서 빼지도, 보류 칸에 올리지도 않는다. 사용자가 볼 것이 없기 때문이다.
 * 다음 동기화가 같은 명령을 그대로 다시 보내면 그때는 저장된 결과를 받는다.
 */
export function isDeferred(status: MutationStatus): boolean {
  return status === 'deferred';
}
