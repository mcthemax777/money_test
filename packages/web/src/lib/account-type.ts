/**
 * 계좌 유형의 표시 이름.
 *
 * 계좌 추가 폼과 엑셀 내보내기가 각자 목록을 들고 있어 이름이 어긋나 있었다.
 * 유형은 총자산을 현금성·투자·부채로 나누는 기준이라(서버 reports.service.ts의
 * VALUED_TYPES / LIABILITY_TYPES) 화면마다 다르게 불리면 안 된다.
 */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  deposit: '예금',
  savings: '저축',
  cash: '현금',
  investment: '투자',
  real_estate: '부동산',
  loan: '대출',
  credit_card: '신용카드',
  opening_balance: '기초잔액',
};

/**
 * 사용자가 직접 만드는 계좌 유형.
 *
 * credit_card(카드 부채)와 opening_balance(자본)는 서버가 관리하므로 목록에 없다.
 * 예금은 입출금 통장까지 포함하므로 고를 때만 그 사실을 덧붙인다.
 */
export const ACCOUNT_TYPE_OPTIONS = [
  { id: 'deposit', name: '예금 / 입출금' },
  { id: 'savings', name: ACCOUNT_TYPE_LABEL.savings },
  { id: 'cash', name: ACCOUNT_TYPE_LABEL.cash },
  { id: 'investment', name: ACCOUNT_TYPE_LABEL.investment },
  { id: 'real_estate', name: ACCOUNT_TYPE_LABEL.real_estate },
  { id: 'loan', name: ACCOUNT_TYPE_LABEL.loan },
];

/** 목록에 붙이는 유형 이름. 모르는 값이면 그 값을 그대로 보여 준다. */
export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABEL[type] ?? type;
}
