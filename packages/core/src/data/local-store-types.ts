/**
 * 기기 사본(`LocalStore`)이 주고받는 모양.
 *
 * 화면·조립·동기화가 이 이름으로 읽는다. 바깥에서는 `local-store` 를 거쳐 가져간다.
 */

import type { Mutation, ParsedEntrySearch } from '@money/types';

import type { SqlValue } from './sql-driver';

/** 사본이 어디까지 따라왔는지. */
export interface SyncCursor {
  projectId: string;
  version: number;
  /** 달력 키를 계산할 때 쓴 타임존. 프로젝트 타임존이 바뀌면 키를 다시 계산해야 한다. */
  timeZone: string;
  syncedAt: string | null;
  /**
   * 이 사본을 처음부터 받기 시작할 때의 서버 자리표 바닥.
   *
   * 서버가 알려 주는 바닥이 이 값보다 더 올랐을 때만 사본을 버린다. 처음부터 받는
   * 중인 기기는 커서가 바닥보다 낮은 것이 정상이라, 그것까지 버리면 큰 사본을 영영
   * 다 받지 못한다.
   */
  mirrorFloor: number;
}

/** 사본에 담긴 계좌 한 줄. 화면과 순자산 계산이 함께 쓴다. */
export interface StoredAccount {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  type: string;
  name: string;
  currency: string;
  balance: string;
  isActive: boolean;
  sortRank: string;
}

/** 사본에 담긴 예산 규칙 한 줄. 그 달의 조정값을 함께 실어 준다. */
export interface StoredBudget {
  id: string;
  categoryId: string | null;
  /** 태그 예산이면 그 태그 */
  tagId: string | null;
  type: string | null;
  monthlyAmount: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** 그 달만 따로 잡아 둔 금액. 없으면 null */
  overrideAmount: string | null;
  overrideId: string | null;
}

/** 결제수단 집계가 보는 카드 한 장. 실적 기준액은 아직 통장 통화다. */
export interface StoredPaymentCard {
  id: string;
  name: string;
  cardType: string;
  isActive: boolean;
  color: string | null;
  statementClosingDay: number | null;
  performanceAmount: string | null;
  paymentCurrency: string;
  ownerId: string | null;
  ownerName: string | null;
}

/** 실적 계산이 보는 카드 한 장. */
export interface StoredPerformanceCard {
  id: string;
  projectId: string;
  name: string;
  cardType: string;
  statementClosingDay: number | null;
  paymentDueDay: number | null;
  performanceAmount: string | null;
  liabilityAccountId: string | null;
  paymentCurrency: string;
  liabilityCurrency: string | null;
  liabilityBalance: string | null;
}

/** 보류 칸의 명령 하나. 화면이 이유와 시각을 함께 보여 준다. */
export interface HeldMutation extends Mutation {
  status: 'conflict' | 'rejected' | 'blocked';
  error: string | null;
  createdAt: string;
  /**
   * 이 명령이 고치려던 거래가 사본에서 사라졌는가.
   *
   * 그 사이 다른 사람이 지웠다는 뜻이다. 다시 보내 봐야 영영 거절되므로(삭제가 언제나
   * 이긴다) 화면은 그때 **새 거래로 다시 적기**를 내놓는다. 그러지 않으면 오프라인에서
   * 적은 내용을 버리는 길밖에 없다.
   *
   * 전표를 고치는 명령에만 뜻이 있다. 나머지는 언제나 false 다.
   */
  targetMissing: boolean;
}

/**
 * 실적 원장 한 줄의 재료. 주기별 사용액이 보는 값에 화면에 적을 것이 붙었다.
 *
 * 서버의 `performanceLedgerEntrySelect` 와 같은 자리다.
 */
export interface StoredCardLedgerPosting extends StoredCardPosting {
  postingId: string;
  entryId: string;
  description: string;
  merchant: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
}

/** 계좌 원장 한 줄의 재료. 잔액 누적은 읽는 쪽이 붙인다. */
export interface StoredLedgerRow {
  postingId: string;
  entryId: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: string;
  cardId: string | null;
  cardName: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
  countsPerformance: boolean;
}

/** 주기별 사용액이 보는 다리 하나. */
export interface StoredCardPosting {
  amount: string;
  date: string;
  installmentMonths: number | null;
  /** 사용자가 적어 둔 회차별 원금. 없으면 개월수로 나눈다. */
  installmentShares: string[] | null;
  /**
   * 적어 둔 회차별 이자. 다리 금액에 이미 들어 있는 값이다.
   *
   * 청구는 회차마다 원금에 이 값을 더해 세고, 실적은 반대로 이 합을 뺀다.
   */
  installmentInterestShares: string[] | null;
  /** 실적에 세는가. 분할해도 하나다. 청구액에는 어느 쪽이든 들어간다. */
  countsPerformance: boolean;
  /** 실적을 정가로 셀 때 되살릴 차감액. 줄마다의 값을 더한 것이고, 안 되살리면 null 이다. */
  discountAmount: string | null;
  /** 차감액을 실적에서도 뺄지. 분할해도 하나다. */
  discountCountsPerformance: boolean;
  /** 할부 원거래면 걸린 할부 환불이 회차마다 줄인 것 (원금 + 이자). 청구 회차에서 뺀다. */
  installmentCuts: string[] | null;
  /** 할부 환불이면 그 환불이 줄인 것의 합. */
  refundCut: { total: string; interest: string } | null;
}

/** 사본 한 줄. 컬럼 이름 -> 값이다. */
export type Row = Record<string, SqlValue>;

/** 사본에서 셈한 청구액 확정. 전표마다 다시 쓸 다리 금액이다 (`planRestate`). */
export type RestatePlan = Array<{
  entryId: string;
  postings: Array<{ id: string; amount: string }>;
}>;

/**
 * 커서 자리에 적는 "처음부터 다시 받아야 한다"는 표시. 번호는 0 이상이라 겹치지 않는다.
 * 동기화가 보낼 것을 먼저 보낸 뒤 사본을 비우고 0 부터 받는다 (`syncProject`).
 */
export const REBUILD_PENDING = -1;

/**
 * 설정 엔티티가 사는 표. 필드별 병합과 순서 값을 갖는다.
 *
 * 예산 조정(budget_override)은 순서가 없지만 같은 길로 쓴다 -- 키가 (예산, 년, 월)이라
 * 순서 값이 필요 없을 뿐, 시계와 커밋 절차는 같다.
 */
export type SettingTable =
  | 'person'
  | 'account'
  | 'card'
  | 'category'
  | 'tag'
  | 'budget'
  | 'budget_override'
  | 'recurring_rule';

/**
 * 목록 질의가 보는 범위. 사람 필터와 거래 화면의 검색이 함께 걸린다.
 *
 * `search` 는 `@money/types` 의 `parseEntrySearch` 가 읽어 준 것을 그대로 받는다.
 * 무엇을 고른 것으로 볼지는 서버와 한 벌이어야 하고, 그것을 **문장으로 옮기는 일**만
 * 저장소마다 다르다.
 */
export interface MirrorEntryScope {
  fromDateKey: string;
  toDateKey: string;
  /**
   * 한 달만 볼 때 ("YYYY-MM"). 주면 위 달력 키 범위 대신 이것을 쓴다.
   *
   * 동기화할 때 프로젝트 타임존으로 계산해 박아 둔 컬럼이라, 달의 길이도 시차도 다시
   * 따질 것이 없다. 부르는 쪽이 `-01 ~ -31` 같은 구간을 만들면 30일 이하인 달에서
   * 다음 달 초하루가 함께 들어온다.
   */
  yearMonth?: string;
  ownerIds?: string[];
  search?: ParsedEntrySearch;
  /** 이 카드로 낸 거래만. 카드 상세의 결제 내역이 쓴다. */
  cardId?: string;
  /**
   * 분류 하나로 좁힌다. 분석 창의 거래 목록이 쓴다 (서버 목록의 `categoryId` 와 같은 규칙).
   * 대분류면 소분류 다리도 걸리고, `exact` 면 그 분류에 바로 적은 다리만이다("미분류").
   */
  category?: { id: string; exact: boolean };
  /**
   * 그 유형의 분류 다리를 가진 전표만 (서버 목록의 `categoryType`). 전체 지출 분석이 쓴다 --
   * kind 로 거르면 수수료가 붙은 이체가 빠져 12개월 막대와 어긋난다.
   */
  categoryType?: 'income' | 'expense';
  /**
   * 회차 기준으로 셀 때 켠다. 할부 계획을 줄에 함께 실어 온다.
   *
   * 늘 싣지 않는 까닭은 값이다 -- 전표마다 딸림질의가 넷 붙는다. 발생 기준에서는
   * 읽히지 않는 값이라 켤 때만 붙인다.
   */
  withInstallment?: boolean;
  /**
   * 기간을 어느 날짜로 볼지 (PAYBACK_DESIGN.md).
   *
   *   own       전표 날짜. 목록(`viewEntries`·`viewEntriesPage`)의 기본이다.
   *   analysis  연결된 페이백은 원거래 날짜. 분석 행(`categoryPostings`)의 기본이다.
   *
   * 서버의 `dateBasis`·`ownDate` 와 같은 갈림이다.
   */
  dateBasis?: 'own' | 'analysis';
  /** 이 원거래에 걸린 페이백만 (서버 목록의 `paybackOf`). */
  paybackOf?: string;
}
