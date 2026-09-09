/**
 * 읽어 낸 후보를 이 가계부의 것들과 맞춰 보는 자리.
 *
 * 파서(`draft-parse`)는 문구만 본다. 문구에 "신한카드(1234)"가 적혀 있어도 그것이
 * 이 가계부의 어느 카드인지는 계좌·카드 목록을 보아야 안다. 그 일을 여기서 한다.
 *
 * **틀리게 채우지 않는다.** 짐작이 어긋나면 사람은 그것을 검사하지 않고 저장한다.
 * 그래서 근거가 하나뿐인 짐작(이름 일부가 겹친다)에는 손대지 않고, 끝 네 자리처럼
 * 확실한 단서가 있을 때만 채운다.
 */

import type { Account, Card } from './types';
import type { ParsedDraft } from './draft-parse';

/** 맞춰 본 결과. 못 찾은 것은 null 이고, 화면이 그 칸을 비워 둔다. */
export interface DraftMatch {
  cardId: string | null;
  accountId: string | null;
}

/**
 * 후보의 결제수단을 찾는다.
 *
 * 네 가지 단서를 순서대로 본다.
 *
 *   1. **카드 번호 끝 네 자리.** 가장 확실하다. 카드마다 다르고 문구에 그대로 적힌다.
 *   2. **등록해 둔 카드 이름이 그대로 적혀 있는가.** 캡처와 알림에는 카드 이름이
 *      함께 적히는 일이 많다(카드사 앱의 이용내역은 거래마다 "nori 체크카드(2395)"
 *      를 적는다). 그 이름이 이 가계부의 카드 이름과 같으면 그 카드다.
 *   3. **카드 이름 안의 카드사 이름.** "신한 체크"라고 등록해 둔 카드가 신한카드
 *      알림과 맞는다. 같은 카드사 카드가 둘 이상이면 손대지 않는다 -- 어느 것인지
 *      모르는 채로 하나를 고르면 다른 카드의 사용액이 조용히 틀린다.
 *   4. **통장 이름 안의 은행 이름.** 입금·출금 알림은 카드가 아니라 통장에서 난다.
 *
 * 지출 알림은 카드가 먼저다. 카드 결제가 통장 출금보다 훨씬 흔하고, 통장 출금
 * 알림에는 "출금"이라는 낱말이 함께 오므로 갈래로도 갈린다.
 */
export function matchPaymentMethod(
  draft: ParsedDraft,
  lists: { accounts: Account[]; cards: Card[] },
): DraftMatch {
  const empty: DraftMatch = { cardId: null, accountId: null };

  const cards = lists.cards.filter((card) => card.isActive);
  const accounts = lists.accounts.filter((account) => account.isActive);

  // 1) 끝 네 자리. 마스킹된 번호에서 숫자만 남겨 뒤 네 자리를 견준다.
  if (draft.cardTail) {
    const byTail = cards.filter((card) => tailOf(card.cardNumberMasked) === draft.cardTail);
    if (byTail.length === 1) return { cardId: byTail[0].id, accountId: null };
  }

  /*
   * 2) 등록해 둔 카드 이름이 글에 그대로 적혀 있는가.
   *
   * 카드사 앱은 거래마다 카드 이름을 적고("nori 체크카드(2395)"), 알림 문구에도
   * 카드 이름이 붙는 일이 많다. 그 이름을 이 가계부에 그대로 등록해 두었다면 어느
   * 카드인지 의심할 자리가 없다 -- 끝 네 자리 다음으로 센 단서다.
   *
   * 둘 이상 걸리면 손대지 않는다. 이름 하나가 다른 이름에 담기는 경우가 있다
   * ("체크"와 "국민 체크"). 그때는 사람이 고른다.
   */
  const named = cards.filter((card) => nameAppearsIn(card.name, draft.cardText));
  if (named.length === 1) return { cardId: named[0].id, accountId: null };

  const issuer = draft.issuer;
  if (!issuer) return empty;

  // 3) 카드사 이름. 등록한 카드 이름과 그 카드의 카드사 이름을 함께 본다.
  const isCardKind = draft.kind === 'expense' || draft.kind === null;
  if (isCardKind) {
    const byIssuer = cards.filter(
      (card) => nameMatches(card.name, issuer) || nameMatches(card.issuer?.name, issuer),
    );
    if (byIssuer.length === 1) return { cardId: byIssuer[0].id, accountId: null };
  }

  /*
   * 4) 통장 이름. 계좌의 기관 이름도 함께 본다.
   *
   * **카드사 알림은 통장으로 내려가지 않는다.** "국민카드 승인"에 맞는 카드가 없을 때
   * "국민은행 통장"을 골라 주면, 카드로 쓴 돈이 통장에서 빠진 것으로 적힌다 -- 카드
   * 사용액과 통장 잔액이 동시에 틀리고, 사람은 채워진 칸을 검사하지 않는다.
   * 그 경우에는 비워 두어 "빈 칸이 있습니다"가 뜨는 편이 낫다.
   */
  if (isCardIssuer(issuer)) return empty;

  const byBank = accounts.filter(
    (account) => nameMatches(account.name, issuer) || nameMatches(account.institution?.name, issuer),
  );
  if (byBank.length === 1) return { cardId: null, accountId: byBank[0].id };

  return empty;
}

/**
 * 이 가맹점을 지난번에 무슨 분류로 적었는가.
 *
 * 같은 가게에서 쓰는 돈의 분류는 거의 바뀌지 않는다("스타벅스"는 늘 카페다). 지난
 * 거래를 보고 채워 주면 사람이 손볼 칸이 하나 줄어든다.
 *
 * **가장 최근 것을 그대로 쓴다.** 가장 많이 쓴 분류를 세는 편이 그럴듯해 보이지만,
 * 분류를 바꾼 사람의 뜻을 옛 기록의 수가 이기게 된다.
 */
export function guessCategoryId(
  merchant: string | null,
  history: Array<{ merchant: string | null; description: string; categoryId: string | null }>,
): string | null {
  const key = normalizeName(merchant);
  if (!key) return null;

  for (const row of history) {
    if (!row.categoryId) continue;
    if (normalizeName(row.merchant) === key || normalizeName(row.description) === key) {
      return row.categoryId;
    }
  }
  return null;
}

/**
 * 등록한 이름이 그 글 안에 그대로 있는가.
 *
 * 견주기 전에 양쪽에서 같은 것을 뗀다(`normalizeName`) -- "nori 체크카드"와
 * "nori 체크카드(2395)" 는 사람이 보면 같은 카드이고, 괄호와 번호만 다르다.
 *
 * **두 글자 미만인 이름은 보지 않는다.** 한두 글자는 아무 글에나 들어 있어서, 그런
 * 이름의 카드가 있으면 엉뚱한 거래에 그 카드가 붙는다.
 */
function nameAppearsIn(name: string | null | undefined, text: string | null): boolean {
  if (!text) return false;

  const needle = normalizeName(name);
  if (needle.length < 2) return false;

  return normalizeName(text).includes(needle);
}

/**
 * 그 이름이 카드사인가.
 *
 * 이름에 "카드"가 들어 있으면 카드사로 본다. 카드사와 은행이 같은 그룹인 경우가
 * 많아(국민카드/국민은행) 이름의 앞부분만으로는 갈리지 않는다.
 */
function isCardIssuer(issuer: string): boolean {
  return issuer.includes('카드');
}

/**
 * 카드 번호에서 끝 네 자리.
 *
 * 서버는 실제 번호를 주지 않고 마스킹한 것을 준다("**** **** **** 1234"). 끝 네
 * 자리는 그 안에 남아 있어 이 짐작에는 충분하다.
 */
function tailOf(cardNumber: string | null | undefined): string | null {
  if (!cardNumber) return null;
  const digits = cardNumber.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * 이름이 그 카드사·은행의 것인가.
 *
 * 양쪽에서 "카드"·"은행"·공백을 떼고 견준다. 등록한 이름은 "신한 체크"이고 문구는
 * "신한카드"라, 그대로 비교하면 아무것도 걸리지 않는다.
 */
function nameMatches(name: string | null | undefined, issuer: string): boolean {
  const left = normalizeName(name);
  const right = normalizeName(issuer);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

/** 견줄 수 있는 모양으로. 공백과 기관 낱말을 떼고 소문자로 만든다. */
function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/카드|은행|뱅크|체크|신용|통장|계좌|\s|-/g, '')
    .trim();
}
