/**
 * 거래내역 엑셀의 모양. 내보내기와 가져오기가 같은 열을 쓴다.
 *
 * 첫 행이 열 이름이고 둘째 행부터 거래다. 가져올 때는 열 이름을 별칭으로도 알아보고
 * (`ENTRY_SHEET_COLUMNS[].aliases`), 차례는 상관없다. 모르는 열은 무시한다.
 *
 * **한 행이 분류 줄 하나다.** 분할 거래는 같은 `거래ID` 를 가진 여러 행으로 적고, 가져올 때
 * 그 행들을 한 거래로 묶는다. 거래ID 는 묶는 데만 쓴다 -- 가져온 거래는 늘 새 거래다
 * (2026-09-30, 사용자 결정: 같은 파일을 두 번 가져오면 두 번 들어간다).
 *
 * 값은 모두 글자로 오간다. 날짜·금액을 해석하는 일은 서버가 한다(`EntrySheetService`).
 */

export const ENTRY_SHEET_COLUMNS = [
  { key: 'group', label: '거래ID', aliases: ['id', '묶음', '거래번호'] },
  { key: 'date', label: '날짜', aliases: ['date', '일자', '거래일', '거래일자', '사용일', '날짜/시간'] },
  { key: 'time', label: '시각', aliases: ['time', '시간'] },
  { key: 'kind', label: '구분', aliases: ['kind', 'type', '유형', '종류', '수입/지출', '타입'] },
  { key: 'amount', label: '금액', aliases: ['amount', '거래금액', '이용금액', '사용금액', '결제금액'] },
  { key: 'currency', label: '통화', aliases: ['currency', '화폐'] },
  { key: 'billedAmount', label: '청구액', aliases: ['billed', '원화금액', '원화 청구액'] },
  { key: 'discount', label: '할인', aliases: ['discount', '할인금액', '차감'] },
  { key: 'parentCategory', label: '대분류', aliases: ['category', '분류', '카테고리'] },
  { key: 'category', label: '소분류', aliases: ['subcategory', '세부분류', '하위분류'] },
  { key: 'payment', label: '결제수단', aliases: ['account', 'payment', '자산', '계좌', '카드', '출금', '출금자산'] },
  { key: 'paymentType', label: '자산 종류', aliases: ['account type', '결제수단 종류'] },
  { key: 'toAsset', label: '받는 자산', aliases: ['to account', '입금자산', '입금 자산', '받는 계좌'] },
  { key: 'toAssetType', label: '받는 자산 종류', aliases: ['to account type'] },
  { key: 'fee', label: '수수료', aliases: ['fee', '이체수수료'] },
  { key: 'merchant', label: '가맹점', aliases: ['merchant', '사용처', '상호', '거래처'] },
  { key: 'description', label: '내용', aliases: ['description', '설명', '적요', '항목', '내역'] },
  { key: 'memo', label: '메모', aliases: ['memo', 'note', '비고'] },
  { key: 'tags', label: '태그', aliases: ['tags', 'tag'] },
  { key: 'person', label: '구성원', aliases: ['person', '사용자', '주인', '사람'] },
  { key: 'installmentMonths', label: '할부개월', aliases: ['installment', '할부', '할부 개월'] },
] as const;

export type EntrySheetColumn = (typeof ENTRY_SHEET_COLUMNS)[number]['key'];

/** 한 행. 빈 칸은 빠진다. `row` 는 엑셀의 행 번호(머리글이 1)로, 건너뛴 까닭을 알릴 때 쓴다. */
export type EntrySheetRow = Partial<Record<EntrySheetColumn, string>> & { row: number };

/** 열 이름을 견주는 모양. 빈칸·대소문자를 무시한다. */
function headerKey(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

const HEADER_INDEX = new Map<string, EntrySheetColumn>(
  ENTRY_SHEET_COLUMNS.flatMap((column) =>
    [column.label, ...column.aliases].map((name) => [headerKey(name), column.key] as const),
  ),
);

/** 머리글 한 칸이 어느 열인가. 모르면 null. */
export function entrySheetColumnOf(header: string): EntrySheetColumn | null {
  return HEADER_INDEX.get(headerKey(header)) ?? null;
}

/** 갈래 이름. 내보낼 때 왼쪽 값을 쓰고, 가져올 때는 모두 알아본다. */
export const ENTRY_SHEET_KINDS = {
  expense: ['지출', 'expense', '출금', '사용', '결제'],
  income: ['수입', 'income', '입금'],
  payback: ['페이백', 'payback', '캐시백'],
  // 환불도 장부에서는 페이백과 같은 모양이다. 종류만 다르다 (카드 실적의 기본값이 갈린다).
  refund: ['환불', 'refund', '결제취소', '결제 취소'],
  transfer: ['이체', 'transfer', '송금'],
  card_payment: ['카드대금', 'card_payment', '카드 대금', '카드결제'],
  card_refund: ['카드환불', 'card_refund', '카드 환불'],
  adjustment: ['잔액조정', 'adjustment', '잔액 조정'],
} as const;

export type EntrySheetKind = keyof typeof ENTRY_SHEET_KINDS;

export function entrySheetKindOf(value: string | undefined): EntrySheetKind | null {
  const key = headerKey(value ?? '');
  if (!key) return null;
  for (const [kind, names] of Object.entries(ENTRY_SHEET_KINDS)) {
    if (names.some((name) => headerKey(name) === key)) return kind as EntrySheetKind;
  }
  return null;
}

/**
 * 자산 종류 이름. 가계부에 없는 결제수단을 만들 때 무엇으로 만들지 정한다.
 *
 * 칸이 비었으면 이름으로 짐작한다(`guessEntrySheetAsset`): "카드"가 들어가면 체크카드,
 * "현금"이면 현금, 그 밖에는 통장이다 (2026-09-30, 사용자 결정).
 */
export const ENTRY_SHEET_ASSET_TYPES = {
  deposit: ['통장', 'deposit', '입출금', '예금', '계좌', '은행'],
  savings: ['적금', 'savings', '저축'],
  investment: ['투자', 'investment', '증권'],
  cash: ['현금', 'cash'],
  loan: ['대출', 'loan'],
  debit_card: ['체크카드', 'debit', '체크'],
  credit_card: ['신용카드', 'credit', '신용'],
} as const;

export type EntrySheetAssetType = keyof typeof ENTRY_SHEET_ASSET_TYPES;

export function entrySheetAssetTypeOf(value: string | undefined): EntrySheetAssetType | null {
  const key = headerKey(value ?? '');
  if (!key) return null;
  for (const [type, names] of Object.entries(ENTRY_SHEET_ASSET_TYPES)) {
    if (names.some((name) => headerKey(name) === key)) return type as EntrySheetAssetType;
  }
  return null;
}

/** 자산 종류 칸이 비었을 때 이름으로 짐작한다. */
export function guessEntrySheetAsset(name: string): EntrySheetAssetType {
  if (name.includes('카드') || /card/i.test(name)) return 'debit_card';
  if (name.includes('현금') || /cash/i.test(name)) return 'cash';
  return 'deposit';
}

export namespace EntrySheetDto {
  /** 한 번에 보낼 행 수의 상한. 화면이 이만큼씩 나눠 보낸다(분할 거래의 행은 한 번에). */
  export const MAX_ROWS = 300;

  export interface ImportRequest {
    rows: EntrySheetRow[];
  }

  export interface ImportResponse {
    /** 만든 거래 수 (분할 거래는 하나로 센다). */
    created: number;
    /** 넣지 못한 행과 그 까닭. */
    skipped: Array<{ rows: number[]; reason: string }>;
    /** 없어서 새로 만든 것의 이름. */
    createdNames: {
      people: string[];
      accounts: string[];
      cards: string[];
      categories: string[];
      tags: string[];
    };
  }

  export interface ExportQuery {
    /** "YYYY-MM-DD". 없으면 처음부터. */
    startDate?: string;
    /** "YYYY-MM-DD". 없으면 끝까지. */
    endDate?: string;
  }
}
