import { activeLocale, translate, type MessageKey } from '../lib/i18n';

/**
 * 계좌 유형의 표시 이름.
 *
 * 계좌 추가 폼과 엑셀 내보내기가 각자 목록을 들고 있어 이름이 어긋나 있었다.
 * 유형은 자산 탭의 네 묶음을 가르는 기준이라(lib/net-worth 의 ASSET_TYPE_GROUPS)
 * 화면마다 다르게 불리면 안 된다.
 */
export const ACCOUNT_TYPE_KEY: Record<string, MessageKey> = {
  deposit: 'accountType.deposit',
  time_deposit: 'accountType.time_deposit',
  savings: 'accountType.savings',
  cma: 'accountType.cma',
  point_pay: 'accountType.point_pay',
  pension: 'accountType.pension',
  cash: 'accountType.cash',
  investment: 'accountType.investment',
  crypto: 'accountType.crypto',
  real_estate: 'accountType.real_estate',
  loan: 'accountType.loan',
  credit_card: 'accountType.credit_card',
  opening_balance: 'accountType.opening_balance',
  unassigned: 'accountType.unassigned',
};

/**
 * 사용자가 직접 만드는 계좌 유형. 자산 탭의 네 묶음 차례로 늘어선다.
 *
 * credit_card(카드 부채)와 opening_balance(자본)는 서버가 관리하므로 목록에 없다.
 * 마이너스통장은 따로 두지 않고 대출로 만든다 (2026-10-05, 사용자 결정).
 */
export const ACCOUNT_TYPE_OPTIONS: Array<{ id: string; nameKey: MessageKey }> = [
  'deposit',
  'cash',
  'cma',
  'point_pay',
  'time_deposit',
  'savings',
  'pension',
  'investment',
  'crypto',
  'real_estate',
  'loan',
].map((id) => ({ id, nameKey: ACCOUNT_TYPE_KEY[id] }));

/**
 * 개설 기관이 없는 유형.
 *
 * 현금과 부동산은 은행에 든 것이 아니다. 포인트·페이와 암호화폐도 은행이나 증권사가
 * 아니라 그 회사·거래소에 있다 -- 기관 목록이 그것을 모른다. 이 유형에 institutionId 를
 * 보내면 서버가 거부하므로, 폼은 그 칸을 아예 보여 주지 않는다.
 */
export const NO_BANK_TYPES: readonly string[] = ['cash', 'real_estate', 'point_pay', 'crypto'];

/** 목록에 붙이는 유형 이름. 모르는 값이면 그 값을 그대로 보여 준다. */
export function accountTypeLabel(type: string): string {
  const key = ACCOUNT_TYPE_KEY[type];
  return key ? translate(activeLocale(), key) : type;
}
