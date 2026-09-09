// 도메인 엔티티 - packages/api/prisma/schema.prisma 와 동기화

import type { Locale } from './locale';
import type { RecurringFrequency } from './recurring';

/**
 * JSON으로 오갈 때 날짜는 ISO 8601 문자열이다. Date 객체가 아니다.
 *
 * 금액을 문자열로 정한 것과 같은 이유로 타입에 사실을 적는다.
 * `Date`라고 써 두면 화면에서 `.getTime()` 같은 호출이 컴파일은 되고 런타임에 깨진다.
 */
export type IsoDateString = string;

// ===== Enum =====

export type AccountType =
  | 'deposit'
  | 'savings'
  | 'investment'
  | 'cash'
  | 'credit_card'    // 카드 사용액을 담는 부채 계정. 통장 목록에 노출하지 않는다
  | 'loan'
  | 'real_estate'
  | 'opening_balance'; // 기초잔액 자본 계정. 순자산 합계에서 제외한다

export type CardType = 'debit' | 'credit';

/** bank는 은행뿐 아니라 증권사/저축은행/상호금융까지 포함한 "계좌 개설 기관"이다. */
export type FinancialInstitutionType = 'bank' | 'card_issuer';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type CategoryType = 'income' | 'expense';

// ===== 엔티티 =====

// 앱 사용자 (계정) - 구글 로그인으로만 생성된다
export interface User {
  id: string;
  email: string;
  googleId: string; // Google ID 토큰의 sub 클레임
  name: string;
  avatar: string | null;
  defaultProjectId: string | null;
  locale: Locale; // 화면 언어. 고른 적이 없으면 'ko'
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 프로젝트 (가계부 단위)
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 프로젝트 멤버
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: IsoDateString;
}

// 프로젝트 초대
export interface ProjectInvitation {
  id: string;
  projectId: string;
  email: string;
  invitationCode: string;
  role: ProjectRole;
  status: InvitationStatus;
  invitedByUserId: string;
  expiresAt: IsoDateString | null;
  acceptedAt: IsoDateString | null;
  acceptedByUserId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 사람 (가족 구성원)
export interface Person {
  id: string;
  projectId: string;
  name: string;
  relationship: string | null;
  isActive: boolean;
  /** 목록에서의 자리 (분수 색인). 사전순 비교가 곧 목록 순서다. */
  sortRank: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 은행/카드사. 기본 제공 항목과 사용자 추가 항목이 같은 타입이다.
export interface FinancialInstitution {
  id: string;
  /** null이면 모든 프로젝트가 공유하는 기본 제공 항목 */
  projectId: string | null;
  type: FinancialInstitutionType;
  name: string;
  sortOrder: number;
  iconPath: string | null;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 계좌. 은행 통장뿐 아니라 현금/투자/부동산/카드부채까지 포함한다.
export interface Account {
  id: string;
  projectId: string;
  type: AccountType;
  /** Person ID (통장 주인). opening_balance 같은 시스템 계정은 null */
  ownerId: string | null;
  name: string;
  /** 개설 기관 (FinancialInstitution). 현금/부동산 계정은 null */
  institutionId: string | null;
  accountNumber: string | null;
  /** 금액은 정밀도 손실을 막기 위해 문자열로 오간다 */
  balance: string;
  currency: string;
  isActive: boolean;
  /** 목록에서의 자리 (분수 색인). 사전순 비교가 곧 목록 순서다. */
  sortRank: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 카드 (체크/신용)
export interface Card {
  id: string;
  projectId: string;
  /** 사용자가 고른 실제 통장. 체크카드는 즉시 출금, 신용카드는 결제일 출금. */
  paymentAccountId: string;
  /**
   * 신용카드 사용액을 담는 부채 계정. 카드 등록 시 자동 생성된다.
   * 은행 통장이 아니라 "카드사에 갚아야 할 돈"을 기록하는 칸이라 통장 목록에는 노출하지 않는다.
   * 체크카드는 null.
   */
  liabilityAccountId: string | null;
  name: string;
  cardNumber: string | null;
  cardType: CardType;
  /** 카드사 (FinancialInstitution, type = card_issuer) */
  issuerId: string;
  expiryDate: IsoDateString | null;
  /** 금액은 정밀도 손실을 막기 위해 문자열로 오간다 (Prisma Decimal 기본 직렬화) */
  creditLimit: string | null;
  /**
   * 혜택 조건이 되는 한 주기 사용액 기준. 카드사가 말하는 "실적".
   *
   * 세는 구간이 카드 종류마다 다르다. 신용카드는 마감일 기준 청구 주기(마감일이
   * 15일이면 8/16~9/15), 체크카드는 달력 월이다. null이면 조건이 없는 카드다.
   */
  performanceAmount: string | null;
  statementClosingDay: number | null; // 마감일 1~31. credit만
  paymentDueDay: number | null;       // 결제일 1~31. credit만
  /** 카드 앞면 색 (CardColor). null이면 카드 종류의 기본색으로 그린다. */
  color: string | null;
  isActive: boolean;
  /** 목록에서의 자리 (분수 색인). 사전순 비교가 곧 목록 순서다. */
  sortRank: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 전표 (하나의 경제적 사건). 소속 Posting.amount 합은 항상 0이다.
export interface JournalEntry {
  id: string;
  projectId: string;
  personId: string;
  date: IsoDateString;
  description: string;
  merchant: string | null;     // 거래처 (가맹점, 송금 계좌주 등)
  detailedNote: string | null; // 상세설명
  createdByUserId: string | null; // 입력자 추적용. 조회 필터로 쓰지 않는다
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 전표의 개별 다리. accountId와 categoryId 중 정확히 하나만 채워진다.
export interface Posting {
  id: string;
  entryId: string;
  accountId: string | null;
  categoryId: string | null;
  /** 금액은 문자열. 부호 규칙은 schema.prisma 상단 참고 */
  amount: string;
  quantity: string | null;
  currency: string;
  baseAmount: string;
  exchangeRate: string;
  cardId: string | null;
}

/**
 * 화면에 한 줄로 보여주기 위해 전표를 평평하게 편 것.
 * 서버가 postings를 해석해 만들어 준다 (클라이언트가 다리를 직접 다루지 않게).
 */
export type EntryKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'card_payment' // 카드대금 결제 (부채 상환)
  | 'adjustment';  // 기초잔액/잔액 조정

/** 카드사와 통장 사이 자금 이동의 방향 */
export type CardTransferDirection = 'payment' | 'refund';

export interface EntryListItem {
  id: string;
  kind: EntryKind;
  date: IsoDateString;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  personName: string;
  /** 표시용 금액. 항상 양수 */
  amount: string;
  /**
   * 이 거래의 카테고리 다리 수. 분할이면 2 이상이다.
   *
   * 목록 한 줄은 대표 분류 하나만 담는다. 그 줄을 폼으로 되돌려 저장하면 분할의 나머지
   * 줄이 사라지므로, 편집 화면은 이 값을 보고 그 거래를 자기가 다룰 수 있는지 정한다.
   */
  splitCount: number;
  /**
   * 분할의 줄들. 카테고리 다리가 둘 이상일 때만 실린다.
   *
   * 대표 분류(`categoryId`)는 그중 첫 줄이라, 그것만 보고 폼을 되돌리면 나머지가 조용히
   * 사라진다. 편집 화면이 분할을 그대로 되살리려면 줄 전부가 필요하다.
   *
   * 한 줄짜리 거래에는 싣지 않는다. 목록 한 쪽이 200줄이라 늘 실으면 쓰이지 않는 배열이
   * 200개 오간다.
   */
  splits?: Array<{ categoryId: string; amount: string }>;
  /**
   * 이 거래에 붙은 태그. 없으면 빈 배열이다.
   *
   * 카테고리와 달리 여럿이라 배열이고, 목록이 칩으로 그릴 만큼만(이름과 색) 담는다.
   * 전표에 붙으므로 분할 거래도 태그는 하나의 묶음이다.
   */
  tags: EntryTag[];
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  toAccountId: string | null;   // 이체 대상
  toAccountName: string | null;
  cardId: string | null;
  cardName: string | null;
  /** 할부 개월수. 일시불이거나 카드 거래가 아니면 null. */
  installmentMonths: number | null;
  /**
   * 이체에 붙은 수수료. 이체가 아니면 null, 수수료가 없는 이체면 "0".
   * 이체 자체는 소비가 아니지만 수수료는 지출이라 따로 보여준다.
   */
  feeAmount: string | null;
  feeCategoryId: string | null;
  feeCategoryName: string | null;
  /**
   * 카드사 이체의 방향. 그 외 거래는 null.
   *   payment 대금 결제  통장 -> 카드
   *   refund  환불 입금  카드 -> 통장
   *
   * 전표에는 부호로만 남으므로 화면이 되돌려 보낼 수 있도록 풀어서 실어 준다.
   */
  cardTransferDirection: CardTransferDirection | null;

  /**
   * 이 거래의 표시 통화와 금액.
   *
   * `amount`는 언제나 프로젝트 기준통화로 환산한 값이다. 통화별로 쪼개지면
   * 목록 소계와 상단 합계가 어긋나기 때문이다. 외화가 얽힌 거래는 아래 두 값으로
   * 원래 금액을 함께 보여 준다. `₩68,000 ($50.00)` 처럼.
   *
   * 두 경우 모두 여기에 담긴다.
   *   - 외화 통장에서 쓴 거래 (계좌 다리의 통화)
   *   - 원화 카드로 한 외화 결제 (전표에 적어 둔 원 통화 금액)
   */
  originalCurrency: string | null;
  originalAmount: string | null;
  /** 적용된 환율. 1 originalCurrency = exchangeRate 기준통화. 외화가 없으면 null. */
  exchangeRate: string | null;

  /**
   * 위 환산액이 아직 추정이라는 표시.
   *
   * 원화 카드로 외화를 결제하면 실제 청구액은 결제일에야 정해진다. 화면은
   * 이 값이 true인 거래에 "잠정"을 붙이고, 카드 화면의 대조 목록에 모아 준다.
   */
  rateProvisional: boolean;

  /**
   * 이체에서 받는 계좌에 실제로 들어온 금액과 그 통화. 이체가 아니면 null.
   *
   * `amount`는 기준통화 환산액이라 통화가 다른 환전을 수정할 때 그대로 되돌려
   * 보내면 안 된다. 예를 들어 원화에서 달러로 100달러를 보낸 이체의 `amount`는
   * 138,000원인데, 그 값을 "받은 금액(USD)" 칸에 넣으면 138,000달러를 받은
   * 것으로 저장된다. 수정 폼은 이 값을 쓴다.
   */
  toAmount: string | null;
  toCurrency: string | null;

  /**
   * 이 줄을 만든 편집의 시계. 아직 시계가 없는 옛 전표는 null 이다.
   *
   * **수정 요청에 `baseHlc` 로 그대로 실어 보낸다.** 서버는 그 값과 지금 값을 견주어,
   * 폼을 열어 둔 사이에 다른 사람이 같은 거래를 고쳤으면 저장을 거절한다
   * (`ENTRY_MODIFIED`). 그러지 않으면 늦게 누른 쪽이 조용히 이기고, 진 편집은 아무
   * 흔적도 남기지 않는다 -- 돈은 말없이 사라지면 안 된다 (설계 문서의 D6).
   *
   * 기기의 아웃박스는 이 값을 쓰지 않는다. 그쪽은 사본이 아는 시계를 스스로 읽어
   * 명령의 시계를 그 뒤로 발급받는다.
   */
  updatedHlc: string | null;
}

// 카테고리 (대분류/소분류)
export interface Category {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null; // 대분류는 null, 소분류는 대분류 ID (level은 여기서 유도한다)
  type: CategoryType;
  icon: string | null;
  isDefault: boolean;      // 기본 카테고리 (삭제 불가)
  isActive: boolean;
  /**
   * 목록에서의 자리 (분수 색인). 사전순 비교가 곧 목록 순서다.
   *
   * 같은 묶음 안에서만 뜻을 가진다 -- 대분류끼리, 또는 한 부모 아래 소분류끼리다.
   */
  sortRank: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}




/**
 * 거래에 자유롭게 붙이는 이름표.
 *
 * 카테고리와 나란히 서지만 **계층이 없고 전표 하나에 여럿 붙는다.** 카테고리는 "이
 * 돈이 무엇에 쓰였나"를 한 갈래로 정하는 것이라 대분류/소분류로 좁혀 가고, 태그는
 * 그와 직교하는 이름표라 "여행이면서 경조사"가 성립한다.
 *
 * 수입/지출 구분(type)도 없다. 같은 여행에 항공권 지출과 환불 수입이 함께 든다.
 */
export interface Tag {
  id: string;
  projectId: string;
  name: string;
  /** 목록에서 알아보는 색 "#RRGGBB". 정하지 않았으면 null. */
  color: string | null;
  isActive: boolean;
  /** 목록에서의 자리 (분수 색인). 사전순 비교가 곧 목록 순서다. */
  sortRank: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** 거래 한 줄에 붙어 오는 태그. 목록이 칩으로 그리는 최소한만 담는다. */
export interface EntryTag {
  id: string;
  name: string;
  color: string | null;
}

// 예산 (기본 규칙)
export interface Budget {
  id: string;
  projectId: string;
  categoryId: string | null;  // null=전체, 값=대분류/소분류
  type: CategoryType | null;  // categoryId가 null일 때만 사용
  monthlyAmount: string;
  effectiveFrom: string | null; // "YYYY-MM"
  effectiveTo: string | null;   // "YYYY-MM"
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 예산 월별 직접 오버라이드
export interface BudgetOverride {
  id: string;
  budgetId: string;
  year: number;
  month: number;
  amount: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/**
 * 보관함에 담긴 거래 후보. **아직 거래가 아니다.**
 *
 * 두 곳에서 들어온다. 하나는 기기로 오는 알림(카드 승인 문구)이고, 다른 하나는
 * 사용자가 올린 화면 캡처에서 글자를 읽어 낸 것이다. 둘 다 "이런 거래를 적을
 * 수 있다"는 제안일 뿐이라 합계·잔액·예산에 들지 않는다. 사용자가 보관함에서
 * 눌러 저장하는 순간에야 전표가 만들어진다.
 *
 * 값이 비어 있을 수 있다. 알림 문구에 분류가 적혀 있을 리 없고, 캡처에서 금액만
 * 읽히는 경우도 있다. 그래서 후보는 전표의 불변식(합계 0, 결제수단 필수)을 지지
 * 않는다 -- 지게 하면 반쯤 읽힌 것을 버려야 하는데, 사람이 한 칸만 채우면 되는
 * 것을 버리는 편이 늘 더 나쁘다.
 */
export interface EntryDraft {
  id: string;
  projectId: string;
  /** 어디서 왔는가. 보관함의 두 탭이 이 값으로 갈린다. */
  source: EntryDraftSource;
  status: EntryDraftStatus;

  /**
   * 읽은 원문. 알림 한 줄이거나 캡처에서 뽑은 글자 덩어리다.
   *
   * 파싱이 틀렸을 때 사람이 무엇을 보고 그렇게 됐는지 알 수 있는 유일한 근거이고,
   * 규칙을 고친 뒤 다시 읽어 볼 재료이기도 하다.
   */
  rawText: string;
  /** 알림을 보낸 앱. 캡처에서 온 후보는 null 이다. */
  appPackage: string | null;
  /** 알림 제목. 카드사 앱은 여기에 카드 이름을 적는 일이 많다. */
  appTitle: string | null;

  // ── 읽어 낸 값. 확실하지 않으면 비운다 ──
  kind: EntryKind | null;
  amount: string | null;
  currency: string | null;
  /** 거래 시각. 문구에서 못 읽으면 알림이 온 시각이다. */
  occurredAt: IsoDateString | null;
  merchant: string | null;
  description: string | null;
  installmentMonths: number | null;

  // ── 짐작한 연결. 사람이 바꿀 수 있다 ──
  personId: string | null;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;

  /**
   * 얼마나 믿을 수 있는가 (0~100).
   *
   * 목록에서 순서를 정하는 값이 아니다. 낮은 것을 감추지도 않는다 -- 사람이
   * "이건 손봐야 한다"를 한눈에 알아보게 하는 표시일 뿐이다.
   */
  confidence: number;
  /** 어느 규칙이 읽었는가. 규칙을 고칠 때 어느 문구가 어디로 갔는지 짚는 자리다. */
  parser: string | null;

  /**
   * 같은 것을 두 번 담지 않기 위한 열쇠. 프로젝트 안에서 유일하다.
   *
   * 알림은 (앱, 온 시각, 문구)로, 캡처는 (사진, 그 안의 몇 번째 줄)로 만든다.
   * 알림 하나가 두 번 도착하거나 같은 캡처를 두 번 올려도 후보는 하나로 남는다.
   */
  dedupeKey: string;

  /** 등록해서 만들어진 거래. 등록 전에는 null 이다. */
  registeredEntryId: string | null;
  /** 이 후보를 만든 반복 등록. 알림·캡처에서 온 것은 null 이다. */
  recurringRuleId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/**
 * 후보가 어디서 왔는가.
 *
 * `recurring` 은 사람이 미리 만들어 둔 반복 등록이 정해진 날에 만든 것이다. 앞의 둘과
 * 달리 읽어 낸 값이 아니라 **사용자가 적어 둔 값** 이라, 확신이 언제나 100 이다.
 */
export type EntryDraftSource = 'notification' | 'capture' | 'recurring';

/**
 * 후보의 처지.
 *
 * `dismissed` 를 따로 두는 이유가 있다. 무시한 후보를 지워 버리면 같은 알림이
 * 다시 도착했을 때(재전송, 다른 기기) 유일 열쇠가 비어 있어 되살아난다. 무시한
 * 표시를 남겨 두면 그 자리에서 조용히 걸린다.
 */
export type EntryDraftStatus = 'pending' | 'registered' | 'dismissed';

/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보를 만든다.
 *
 * **거래를 만들지 않는다.** 만드는 것은 후보이고, 사용자가 보관함에서 눌러야 전표가
 * 된다. 자동으로 장부에 적히면 그 달의 합계가 사람 모르게 움직인다 -- 반복은 "적는
 * 것을 잊지 않게" 하는 장치이지 "대신 적는" 장치가 아니다.
 *
 * 날짜는 프로젝트 타임존의 달력 날짜("YYYY-MM-DD")다. 일정 셈은 `recurring.ts` 가 한다.
 */
export interface RecurringRule {
  id: string;
  projectId: string;
  isActive: boolean;

  frequency: RecurringFrequency;
  everyDays: number | null;
  dayOfMonth: number | null;
  month: number | null;
  startDate: string;
  endDate: string | null;
  /** "HH:mm". 만들어질 후보의 거래 시각. 없으면 그 날 정오다. */
  timeOfDay: string | null;

  // 후보에 그대로 담길 값
  kind: EntryKind;
  amount: string | null;
  currency: string | null;
  description: string;
  merchant: string | null;
  personId: string | null;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  installmentMonths: number | null;

  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}
