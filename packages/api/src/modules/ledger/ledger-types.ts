/**
 * 원장 계층이 주고받는 입력의 모양 (ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 다른 모듈은 지금처럼 `ledger.service` 에서 가져다 쓴다 -- 그쪽이 이 파일을 다시 내보낸다.
 */
import type { Prisma } from '@prisma/client';
import type { InstallmentAdjust } from '@money/types';
import type { PrismaService } from '@/config/prisma.service';

export type Tx = Prisma.TransactionClient;

/**
 * 읽기에 쓸 수 있는 클라이언트. 트랜잭션 안에서는 반드시 그 트랜잭션의
 * 클라이언트를 써야 한다. 바깥의 prisma로 읽으면 같은 트랜잭션이 방금 만든
 * 행(예: 기초잔액용 자본 계정)이 보이지 않아 검증이 헛돈다.
 */
export type Db = Tx | PrismaService;

/**
 * 전표의 개별 다리. accountId와 categoryId 중 정확히 하나만 채운다.
 *
 * 통화가 둘 있다는 점이 핵심이다.
 *   - `amount`/`currency`: 이 다리가 가리키는 대상의 통화로 본 금액.
 *     계좌 다리는 그 계좌의 통화, 카테고리 다리는 프로젝트 기준통화다.
 *   - `baseAmount`: 기준통화로 환산한 값. 전표의 균형은 이 값으로 판정한다.
 *     통화가 섞이면 `amount` 합계는 0이 될 수 없기 때문이다.
 *
 * baseAmount는 빌더가 반드시 채운다. 예전처럼 amount × rate로 그때그때 계산하면
 * 다리마다 반올림이 달라져 합계가 0에서 미세하게 벗어난다.
 */
export interface PostingInput {
  accountId?: string;
  categoryId?: string;
  amount: Prisma.Decimal;
  quantity?: Prisma.Decimal;
  currency: string;
  /** 1 currency = exchangeRate 기준통화 */
  exchangeRate: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  cardId?: string;
  /**
   * 이 줄의 신원. 분류 다리에만 있다 (schema.prisma 의 Posting.lineKey).
   *
   * 조립이 화면에서 받은 값을 그대로 실어 온다. 원장은 다시 만들지 않고 받은 값을
   * 써 넣기만 한다 -- 수정마다 다리를 지우고 새로 만들어도 줄의 신원이 이어진다.
   */
  lineKey?: string;
  /** 이 줄에서 깎인 금액 (입력 통화, 양수). */
  discountAmount?: Prisma.Decimal | null;
  /**
   * 이 줄에 붙일 태그.
   *
   * **주면 그 목록이 그대로 줄의 태그가 된다.** 주지 않으면(`undefined`) 손대지 않는다.
   */
  tagIds?: string[];
}

export interface EntryInput {
  /**
   * 기기가 만든 전표 식별자. 없으면 서버가 만든다.
   *
   * 형식 검사는 부르는 쪽(entries.service)이 이미 했다. 원장은 받은 값을 그대로 쓴다.
   */
  id?: string;
  projectId: string;
  /** 거래한 사람. 미지정이면 null 이다 (2026-10-10 사용자 요청). */
  personId: string | null;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
  postings: PostingInput[];
  /**
   * 원화 카드로 외화 결제를 했을 때의 원 통화 금액. 표시 전용이다.
   * 계좌 자체가 외화면 posting.currency 가 외화이므로 여기는 비운다.
   */
  originalCurrency?: string | null;
  originalAmount?: Prisma.Decimal | null;
  /**
   * 환산액이 서버 추정 환율로 만들어졌다는 표시. 명세서로 확정하면 false가 된다.
   * 빌더가 정하므로 호출자가 넘길 일은 없다.
   */
  rateProvisional?: boolean;
  /**
   * 이 편집의 하이브리드 논리 시계.
   *
   * 기기가 보낸 명령을 재생할 때만 실린다. 온라인 REST 경로는 비워 두는데, 그러면
   * 서버가 "지금"으로 채운다 -- 서버를 거친 편집도 순서에 자리를 잡아야 뒤에 도착한
   * 오프라인 편집과 견줄 수 있다.
   */
  updatedHlc?: string;
  /**
   * 이 수정이 딛고 선 판. 화면이 폼을 열 때 본 시계다.
   *
   * 주면 잠근 뒤 지금 값과 견주고, 다르면 저장하지 않고 `ENTRY_MODIFIED` 로 거절한다.
   * 그 사이 다른 사람이 같은 거래를 고쳤다는 뜻이다. 생략하면 검사하지 않는다 --
   * 옛 화면과, 원장이 스스로 만드는 전표(잔액 조정)가 그 자리다.
   *
   * 재생 경로는 이것을 쓰지 않는다. 그쪽은 명령의 시계와 전표의 시계를 견주어
   * **늦은 쪽이 이기는** 규칙이고(D5), 여기는 "내가 본 판이 그대로인가"를 묻는다.
   * 오프라인 명령에는 사람이 답할 자리가 없어 자동 병합이 필요하고, 지금 누른
   * 사람에게는 최신 값을 보여 주고 다시 고르게 하는 편이 낫다.
   */
  baseHlc?: string | null;
  /**
   * 할부 개월수. 신용카드 지출에만 의미가 있고 2 이상일 때 일정이 생긴다.
   *
   * 원금과 지출은 구매 시점에 전액 잡히므로 posting은 달라지지 않는다.
   * "언제 청구되는지"만 InstallmentPlan에 남고, 회차 금액과 귀속 주기는
   * 저장하지 않고 읽을 때 계산한다.
   */
  installmentMonths?: number;
  /**
   * 수수료가 붙는 할부인가. 개월수가 2 이상일 때만 읽는다.
   *
   * 수수료 금액은 여기 담기지 않는다. 회차마다 조금씩 달라 계산으로 맞출 수 없어,
   * 마감된 회차가 카드 상세에 떠오르고 사용자가 명세서를 보고 적으면 그때 수수료
   * 전표가 하나 생긴다.
   */
  installmentInterest?: boolean;
  /**
   * 사용자가 적어 둔 회차별 원금. 없으면 총액을 개월수로 나눈다.
   *
   * 끝수를 어느 회차에 몰아주는지가 카드사마다 달라, 계산만으로는 명세서와 맞출 수
   * 없는 자리가 있다. 조립이 개수와 합을 이미 검사했다.
   */
  installmentShares?: string[];
  /** 회차별 이자. 유이자 할부에만 있고, 조립이 개수를 이미 검사했다. */
  installmentInterestShares?: string[];
  /** 고정형 유이자 할부의 월 납입액. 회차 표를 다시 계산할 때 쓴다. */
  installmentMonthlyPayment?: string;
  /** 변동형 유이자 할부의 연이율 (퍼센트). */
  installmentAnnualRate?: string;
  /** 이 거래를 카드 실적에 세는가. 분할해도 하나다. 조립이 갈래의 기본값까지 정해서 넘긴다. */
  countsPerformance?: boolean;
  /** 차감액을 실적에서도 뺄지. 분할해도 하나다. 조립이 정해서 넘긴다. */
  discountCountsPerformance?: boolean;
  /**
   * **거래 자체에 붙일** 태그의 id. 분류 줄이 없는 전표에만 쓴다 (이체, 카드 대금 결제).
   *
   * 지출·수입의 태그는 줄에 붙으므로 `PostingInput.tagIds` 로 온다. 주면 그 목록이
   * 그대로 태그가 되고, 주지 않으면 손대지 않는다 -- 잔액 조정처럼 원장이 스스로
   * 만드는 전표가 그 자리다.
   */
  tagIds?: string[];
  /**
   * 페이백의 원거래와 그 줄. 조립이 정해서 넘긴다(`BuiltEntry.paybackOfEntryId`).
   *
   * 저장할 때 잠근 뒤 원거래를 다시 본다 (`paybackLink`). 조립과 저장 사이에 원거래가
   * 지워졌으면 외래 키가 500 으로 튀는 대신 링크를 비운다.
   */
  paybackOfEntryId?: string | null;
  paybackOfLineKey?: string | null;
  /** 돌아온 돈의 종류 ('payback' | 'refund'). 페이백이 아니면 null 이다. */
  paybackType?: string | null;
  /** 할부 환불이 회차마다 줄인 금액 (installment-refund). 그 밖에는 null 이다. */
  installmentAdjust?: InstallmentAdjust | null;
  /**
   * 한 줄에 돌려받은 합이 그 줄 금액을 넘어도 받는다. **기기 명령의 재생에서만** 켠다.
   *
   * 끊긴 두 기기가 같은 원거래에 따로 적은 환불·페이백은 서버에 닿아서야 합이 넘는 것을
   * 안다. 그때 거절하면 이미 들어온 돈의 기록이 사라진다 -- 기기가 저마다 상한을 이미 보았다.
   */
  allowOverPayback?: boolean;
}

/** 지출/수입에서 카테고리별로 금액을 쪼갤 때 쓰는 항목 */
export interface CategoryLine {
  categoryId: string;
  amount: Prisma.Decimal;
  /** 이 줄의 신원. 부르는 쪽이 만든다 (화면이면 uuid). */
  lineKey: string;
}

export interface CommonInput {
  projectId: string;
  /** 거래한 사람. 비우면(null·빈 글자·생략) 미지정이다. */
  personId?: string | null;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  createdByUserId?: string | null;
  /**
   * 사용자가 금액을 입력한 통화. 생략하면 결제/입금 계좌의 통화로 본다.
   * 원화 카드로 달러를 결제한 경우처럼 계좌 통화와 다를 수 있다.
   */
  currency?: string;
  /**
   * 1 currency = exchangeRate 기준통화.
   *
   * 생략하면 서버가 들고 있는 환율을 쓴다. 카드사가 실제로 적용한 환율이
   * 명세서에 찍혀 나오면 그 값을 넣어 덮어쓴다.
   */
  exchangeRate?: Prisma.Decimal;
  /**
   * 기준통화로 실제 청구된(또는 입금된) 총액.
   *
   * 환율 대신 이것을 받는다. 사용자가 아는 값은 대개 환율이 아니라 통장에서
   * 빠진 금액이기 때문이다. 주면 환율은 무시하고 이 금액을 그대로 쓴다.
   * 곱셈이 없으므로 합계가 청구액에서 벗어나지 않는다.
   *
   * 기준통화 계좌로 외화를 결제한 경우에만 쓸 수 있다. 외화 계좌 거래는 계좌
   * 통화 금액이 이미 사실이라 따로 받을 것이 없다.
   */
  billedAmount?: Prisma.Decimal;
}

export interface ExpenseInput extends CommonInput {
  lines: CategoryLine[];
  /** accountId와 cardId 중 정확히 하나. 카드면 카드 종류에 따라 자금 출처가 결정된다. */
  accountId?: string;
  cardId?: string;
  /** 할부 개월수. 신용카드일 때만 쓴다. */
  installmentMonths?: number;
  /** 수수료가 붙는 할부인가. 할부일 때만 쓴다. */
  installmentInterest?: boolean;
  /** 사용자가 적어 둔 회차별 원금. 없으면 개월수로 나눈다. */
  installmentShares?: string[];
  /** 회차별 이자. 유이자 할부에만 쓴다. */
  installmentInterestShares?: string[];
  /** 고정형 유이자 할부의 월 납입액. */
  installmentMonthlyPayment?: string;
  /** 변동형 유이자 할부의 연이율 (퍼센트). */
  installmentAnnualRate?: string;
  /**
   * 카드 실적에 셀지. 생략하면 조립이 갈래의 기본값(지출은 포함)을 쓴다.
   *
   * 서버가 스스로 만드는 전표에서 쓴다. 할부 수수료가 그렇다 -- 청구는 되지만 카드사가
   * 혜택을 정할 때 세는 것은 결제액이지 수수료가 아니다.
   */
  countsPerformance?: boolean;
}

export interface IncomeInput extends CommonInput {
  lines: CategoryLine[];
  /** 수입이 들어오는 계좌 */
  accountId: string;
}

export interface TransferInput extends CommonInput {
  fromAccountId: string;
  toAccountId: string;
  amount: Prisma.Decimal;
  /**
   * 받는 계좌에 실제로 들어온 금액 (받는 계좌 통화).
   *
   * 통화가 다른 환전에서 쓴다. 보낸 $50과 받은 ₩67,500을 그대로 적으면
   * 실제 적용된 환율이 저절로 기록된다. 생략하면 서버 환율로 계산한다.
   */
  toAmount?: Prisma.Decimal;
  /** 이체 수수료. 보내는 계좌에서 함께 빠진다. */
  feeAmount?: Prisma.Decimal;
  feeCategoryId?: string;
  /** 수수료 줄의 신원. 수수료도 분류 다리라 키를 갖는다. */
  feeLineKey?: string;
}

/**
 * 카드사와 통장 사이의 자금 이동.
 *
 * 두 방향이 있고 전표 모양은 부호만 다르다.
 *   payment 대금 결제  : 통장 -X, 부채 +X
 *   refund  환불 입금  : 통장 +X, 부채 -X
 *
 * 청구서에 붙이지 않는다. 결제 대상은 카드의 부채 총액 하나뿐이다.
 */
export type CardTransferDirection = 'payment' | 'refund';

export interface CardTransferInput extends CommonInput {
  cardId: string;
  /** 대금이 빠져나가거나 환불이 들어오는 통장 */
  accountId: string;
  amount: Prisma.Decimal;
  direction: CardTransferDirection;
}

/** 저장할 페이백 링크. 원장 잠금 아래에서 원거래를 다시 보고 정한다 (`paybackLink`). */
export interface PaybackLink {
  paybackOfEntryId: string | null;
  paybackOfLineKey: string | null;
}
