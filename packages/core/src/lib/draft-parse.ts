/**
 * 알림 문구와 캡처에서 읽은 글자를 거래 후보로 바꾸는 자리.
 *
 * **순수 함수만 둔다.** 기기 API 도 서버 호출도 없다. 그래서 알림에서 온 문구와
 * 캡처에서 뽑은 글자가 **같은 규칙**을 지나고, 규칙을 고칠 때 검사(scripts 의
 * `draft-parse-smoke`)만으로 확인할 수 있다.
 *
 * 해석을 기기에서 하는 까닭이 있다. 알림 문구는 카드 번호 끝자리와 가맹점이 담긴
 * 사적인 글이고, 캡처는 화면 사진이다. 서버로 보내 읽게 하면 그 사진과 문구가
 * 남의 컴퓨터를 거친다. 규칙 파서는 그것을 기기 안에서 끝낸다.
 *
 * 읽지 못한 칸은 비워 둔다. 억지로 채우는 것보다 사람이 한 칸 채우는 편이 낫다 --
 * 틀린 값이 채워져 있으면 사람은 그것을 검사하지 않고 저장한다.
 */

import type { EntryKind } from '@money/types';

/** 문구에서 읽어 낸 값. 비어 있는 칸은 못 읽은 것이다. */
export interface ParsedDraft {
  kind: EntryKind | null;
  /** 소수점 없는 문자열. 통화의 최소 단위까지 그대로 담는다. */
  amount: string | null;
  currency: string | null;
  /** 거래 시각(ISO). 문구에 없으면 부르는 쪽이 알림이 온 시각을 넣는다. */
  occurredAt: string | null;
  merchant: string | null;
  description: string | null;
  installmentMonths: number | null;
  /** 문구에 적힌 카드사·은행 이름. 자산 맞추기(`draft-match`)가 쓴다. */
  issuer: string | null;
  /** 카드 번호 끝 네 자리. 어느 카드인지 가리는 가장 확실한 단서다. */
  cardTail: string | null;
  /**
   * 카드 이름이 적힌 글. 이 가계부에 등록한 카드 이름과 견주는 재료다.
   *
   * 알림은 문구 전체가 이 자리다. 캡처는 거래 줄과 **그 아래 카드 줄**이 온다 --
   * 카드 앱의 이용내역은 거래마다 "nori 체크카드(2395)" 같은 줄을 따로 적는다.
   */
  cardText: string | null;
  /** 0~100. 몇 칸을 읽었는지와 어느 규칙이 걸렸는지로 정한다. */
  confidence: number;
  /** 어느 규칙이 읽었는가. 틀렸을 때 짚는 자리다. */
  parser: string;
  /** 읽은 원문. 화면이 후보 아래에 접어 두고, 규칙을 고칠 때 재료가 된다. */
  rawText: string;
}

/** 알림 하나. 기기의 네이티브 쪽이 이 모양으로 넘긴다. */
export interface NotificationInput {
  packageName: string;
  title: string | null;
  text: string;
  /** 알림이 온 시각 (epoch ms). 문구에 날짜가 없을 때 이 값을 쓴다. */
  postedAt: number;
}

/**
 * 금액이 아닌 숫자가 붙는 낱말.
 *
 * 카드 알림은 승인 금액 뒤에 "누적 1,234,567원"을 함께 적는 일이 많다. 그 줄을
 * 걸러내지 않으면 한 달 사용액이 커피 한 잔 값으로 들어온다 -- 이 파서에서 가장
 * 자주 틀리는 자리다.
 */
const NOT_AMOUNT = [
  '누적',
  '누계',
  '합계',
  '잔액',
  '한도',
  '남은',
  '가용',
  '총액',
  '월간',
  '이달',
  '당월',
  '잔여',
  '적립',
  '포인트',
  '할인',
  '실적',
  /*
   * 카드사 앱의 이용내역 머리에 붙는 합계다.
   *
   * "국내 이용금액 579,190원 / 해외 이용금액 USD 1.20" 이 그 자리인데, 걸러내지 않으면
   * 한 달 사용액이 거래 하나로 들어온다 (2026-09-09, 실제 캡처에서 확인).
   */
  '이용금액',
  '이용액',
  '사용액',
  '결제예정',
  '청구금액',
];

/** 지출로 읽는 낱말. */
const EXPENSE_WORDS = ['승인', '결제', '사용', '출금', '지출', '납부', '이용'];
/** 수입으로 읽는 낱말. */
const INCOME_WORDS = ['입금', '급여', '환급', '지급', '수입', '이자'];
/** 이체로 읽는 낱말. */
const TRANSFER_WORDS = ['이체', '송금', '보냄', '자동이체'];
/** 되돌린 거래. 지출 낱말과 함께 오므로 먼저 본다. */
const CANCEL_WORDS = ['취소', '환불', '반품'];

/**
 * 알림을 보내는 앱 중 우리가 아는 것.
 *
 * 여기 없는 앱도 문구만 맞으면 읽는다(generic). 이 표는 "이 앱이면 금융 알림이
 * 맞다"는 확신을 더해 주는 값이고, 카드사 이름을 문구에서 못 읽었을 때 채우는
 * 자리이기도 하다.
 */
const KNOWN_APPS: Array<{ match: string; issuer: string }> = [
  { match: 'kbcard', issuer: 'KB국민카드' },
  { match: 'kbstar', issuer: 'KB국민은행' },
  { match: 'shinhancard', issuer: '신한카드' },
  { match: 'shinhan', issuer: '신한은행' },
  { match: 'hyundaicard', issuer: '현대카드' },
  { match: 'samsungcard', issuer: '삼성카드' },
  { match: 'lottecard', issuer: '롯데카드' },
  { match: 'hanacard', issuer: '하나카드' },
  { match: 'hanabank', issuer: '하나은행' },
  { match: 'wooricard', issuer: '우리카드' },
  { match: 'wooribank', issuer: '우리은행' },
  { match: 'nhcard', issuer: 'NH농협카드' },
  { match: 'nonghyup', issuer: 'NH농협은행' },
  { match: 'kakaobank', issuer: '카카오뱅크' },
  { match: 'kakaopay', issuer: '카카오페이' },
  { match: 'toss', issuer: '토스' },
  { match: 'naverpay', issuer: '네이버페이' },
  { match: 'ibk', issuer: 'IBK기업은행' },
  { match: 'citibank', issuer: '씨티카드' },
  { match: 'bccard', issuer: 'BC카드' },
  /** 문자 앱. 카드 승인 문구는 대개 이쪽으로 온다. */
  { match: 'messaging', issuer: '' },
  { match: 'mms', issuer: '' },
  { match: 'sms', issuer: '' },
];

/** 문구 안에 적히는 카드사·은행 이름. 앱 이름보다 이쪽이 정확하다. */
const ISSUER_WORDS = [
  'KB국민카드',
  'KB국민',
  '국민카드',
  '신한카드',
  '신한은행',
  '현대카드',
  '삼성카드',
  '롯데카드',
  '하나카드',
  '하나은행',
  '우리카드',
  '우리은행',
  'NH농협카드',
  '농협카드',
  '농협',
  '카카오뱅크',
  '카카오페이',
  '토스뱅크',
  '토스',
  '네이버페이',
  '기업은행',
  '씨티카드',
  'BC카드',
  '케이뱅크',
  '새마을금고',
  '우체국',
];

/**
 * 통화 표기. 외화와 **원화 기호**를 함께 본다.
 *
 * 원화는 "12,000원"이 기본이지만 화면에는 "₩12,000"으로 적히는 일이 많다(앱 목록,
 * 영수증). 캡처를 읽을 때 그 표기를 모르면 금액이 하나도 걸리지 않는다.
 */
const CURRENCY_MARKS: Array<{ pattern: RegExp; code: string; symbol?: boolean }> = [
  { pattern: /₩\s*([0-9][0-9,]*)/, code: 'KRW' },
  { pattern: /KRW\s*([0-9][0-9,]*)/i, code: 'KRW' },
  { pattern: /(?:USD|US\$)\s*([0-9][0-9,]*\.?[0-9]*)/i, code: 'USD' },
  { pattern: /([0-9][0-9,]*\.?[0-9]*)\s*(?:USD|달러)/i, code: 'USD' },
  { pattern: /\$\s*([0-9][0-9,]*\.?[0-9]*)/, code: 'USD', symbol: true },
  { pattern: /JPY\s*([0-9][0-9,]*)/i, code: 'JPY' },
  { pattern: /([0-9][0-9,]*)\s*JPY/i, code: 'JPY' },
  { pattern: /¥\s*([0-9][0-9,]*)/, code: 'JPY', symbol: true },
  { pattern: /(?:EUR)\s*([0-9][0-9,]*\.?[0-9]*)/i, code: 'EUR' },
  { pattern: /([0-9][0-9,]*\.?[0-9]*)\s*(?:EUR|유로)/i, code: 'EUR' },
  { pattern: /€\s*([0-9][0-9,]*\.?[0-9]*)/, code: 'EUR', symbol: true },
  { pattern: /(?:CNY|위안)\s*([0-9][0-9,]*\.?[0-9]*)/i, code: 'CNY' },
  { pattern: /([0-9][0-9,]*\.?[0-9]*)\s*(?:CNY|위안)/i, code: 'CNY' },
];

/**
 * 이 알림이 금융 알림인가.
 *
 * 두 조건을 함께 본다 -- 금액으로 읽을 숫자가 있고, 무엇을 한 것인지 아는 낱말이
 * 있어야 한다. 하나만 보면 배달 알림("3,900원 할인")과 채팅("입금했어요")이 줄줄이
 * 후보로 들어온다.
 */
export function looksFinancial(input: NotificationInput): boolean {
  const text = `${input.title ?? ''}\n${input.text}`;
  return amountOf(text) !== null && kindOf(text) !== null;
}

/**
 * 알림 하나를 후보로. 금융 알림이 아니면 null 이다.
 *
 * `postedAt` 은 문구에 날짜가 없을 때만 쓴다. 카드 승인 알림은 결제 직후에 오므로
 * 그 시각이 거래 시각과 사실상 같다.
 */
export function parseNotification(input: NotificationInput): ParsedDraft | null {
  const title = (input.title ?? '').trim();
  const body = input.text.trim();
  const text = `${title}\n${body}`.trim();
  if (!looksFinancial(input)) return null;

  const app = KNOWN_APPS.find((row) => input.packageName.toLowerCase().includes(row.match));
  const parsed = parseText(text, {
    now: input.postedAt,
    parser: app ? `app:${app.match}` : 'notification',
    issuerFallback: app?.issuer || null,
  });

  // 아는 금융 앱에서 왔으면 그만큼 더 믿는다. 문구만 보고 고른 것과는 근거가 다르다.
  if (app && app.issuer) parsed.confidence = Math.min(100, parsed.confidence + 10);
  return parsed;
}

/**
 * 사진에서 읽은 글자를 다듬는다. **캡처에만 쓴다.**
 *
 * OCR 은 숫자 사이에 없는 기호를 넣고 자릿점을 점으로 읽는다. 실제 카드 앱 캡처에서
 * 이런 것들이 왔다 (2026-09-09).
 *
 *   "2'7,000원"  -> 27,000원   (자릿점 자리에 작은 따옴표)
 *   "5'79,190원" -> 579,190원
 *   "2.900원"    -> 2,900원    (자릿점을 점으로)
 *
 * 다듬지 않으면 27,000원이 7,000원으로 들어간다 -- 금액이 조용히 작아지는 종류의
 * 오류라 사람이 알아채기 어렵다.
 *
 * 줄 안의 여백도 하나로 줄인다. 표처럼 벌어진 칸("국내 이용금액        579,190원")은
 * 낱말과 숫자가 멀어져, 금액 앞의 낱말을 보는 규칙(`isNotAmount`)이 닿지 못한다.
 */
export function normalizeCaptureText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        // 숫자 사이에 낀 기호. 자릿점 자리다.
        .replace(/(\d)\s*['｜|‘’`]\s*(\d)/g, '$1$2')
        // 자릿점을 점으로 읽은 것. 소수점(예: USD 1.20)은 세 자리가 아니라 남는다.
        .replace(/(\d)\.(\d{3})(?!\d)/g, '$1,$2')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n');
}

/**
 * 캡처에서 읽은 글자 덩어리를 여러 후보로.
 *
 * 캡처는 목록 화면인 경우가 대부분이다(카드사 앱의 이용 내역, 은행 거래 내역).
 * 그래서 줄 하나가 곧 거래 하나이고, **금액이 있는 줄마다 후보를 만든다.**
 *
 * 줄 하나에 날짜가 없는 목록도 많다(맨 위에 "9월 8일"이 한 번 적히고 아래로 줄이
 * 이어지는 모양). 그런 경우 바로 앞에서 본 날짜를 이어 쓴다.
 */
export function parseCaptureText(
  text: string,
  options: { now?: number } = {},
): ParsedDraft[] {
  const now = options.now ?? Date.now();
  const lines = normalizeCaptureText(text)
    .split(/\r?\n/)
    .filter(Boolean);

  const drafts: ParsedDraft[] = [];
  /** 앞선 줄에서 본 날짜. 줄에 날짜가 없으면 이것을 쓴다. */
  let carriedDate: string | null = null;
  /** 앞선 줄에서 본 카드사·은행. 목록 캡처는 맨 위에 한 번만 적힌다. */
  let carriedIssuer: string | null = null;
  /**
   * 목록 머리에 적힌 카드 이름. 그 목록의 모든 거래가 이 카드로 결제된 것이다.
   *
   * 카드사 앱은 맨 위에 "이용수단 KB국민카드 전체" 처럼 적고, 거래마다 아래에
   * 카드 줄을 또 적는다. 거래별 줄이 있으면 그것이 이기고, 없으면 이 값을 쓴다.
   */
  let carriedCardText: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const money = amountOf(line, { bare: true });

    /*
     * 날짜 머리 줄. 그 아래 거래들이 이 날짜를 쓴다.
     *
     * 머리를 읽는 규칙은 `headerDateOf` 한 곳이다 -- 그대로 읽히는 머리, 월·일 글자를
     * 숫자로 읽은 머리("09803"), 그리고 아무것도 못 읽는 머리를 함께 다룬다. 못 읽으면
     * 앞서 본 날짜를 그대로 이어 쓴다("08월2'/일" 을 8월 2일로 읽으면 25일 어긋나므로,
     * 이웃한 날짜를 쓰는 편이 낫다).
     *
     * 형을 적어 둔다 -- `carriedDate` 에 이 값을 넣고 이 값이 그 `carriedDate` 를 보아,
     * 적지 않으면 타입이 자기를 물어 any 로 떨어진다(TS7022).
     */
    const dateOnly: string | null = money === null ? headerDateOf(line, now, carriedDate) : null;
    if (dateOnly) {
      carriedDate = dateOnly;
      continue;
    }
    /*
     * 카드 줄. 이 가계부에 등록한 카드 이름과 견줄 글이다.
     *
     * **거래 줄 아래에 온다.** 카드사 앱의 이용내역은 한 거래를 세 줄로 적는다 --
     * 가맹점·금액 / 시각·일시불 / 카드 이름·끝자리. 그래서 방금 만든 후보에 붙인다.
     * 금액이 없는 줄이므로 후보가 되지는 않는다.
     */
    if (money === null && isCardLine(line)) {
      /*
       * 카드 줄에 적힌 카드사도 기억한다.
       *
       * 카드 줄과 카드사 줄이 같은 줄일 수 있다("KB국민카드 전체 (신용+체크)").
       * 여기서 continue 하면서 카드사를 챙기지 않으면, 그 아래 거래들이 카드사를
       * 잃어 통장 맞춤까지 함께 못 하게 된다.
       */
      carriedIssuer = issuerOf(line) ?? carriedIssuer;

      const last = drafts[drafts.length - 1];
      if (last) {
        last.cardText = line;
        // 끝자리를 못 읽었으면 이 줄에서 가져온다. 어느 카드인지 가리는 가장 센 단서다.
        last.cardTail = last.cardTail ?? cardTailOf(line);
      } else {
        // 아직 거래가 없다면 목록 머리에 적힌 카드다. 그 뒤 거래들이 쓴다.
        carriedCardText = line;
      }
      continue;
    }

    const issuerOnly = issuerOf(line);
    if (issuerOnly && money === null) {
      carriedIssuer = issuerOnly;
      continue;
    }

    if (money === null) continue;

    /*
     * 줄 하나만 보지 않고 앞뒤 한 줄을 함께 본다.
     *
     * 목록 캡처는 가맹점과 금액이 다른 줄에 있는 경우가 흔하다. 줄만 보면 금액은
     * 읽히는데 가맹점이 늘 비어, 사람이 모든 후보에 이름을 적어야 한다.
     */
    const window = [lines[index - 1] ?? '', line, lines[index + 1] ?? '']
      .filter(Boolean)
      .join('\n');

    const parsed = parseText(window, {
      now,
      parser: 'capture',
      issuerFallback: carriedIssuer,
      amountFrom: line,
      // 사진에서 읽은 글자는 단위를 잃는다. 자릿점이 있는 숫자를 금액으로 본다.
      bareAmount: true,
      /*
       * 가맹점은 이 줄에서 먼저 찾고, 없으면 **앞 줄**을 본다.
       *
       * 목록 캡처는 이름을 위에 적고 금액을 아래에 적는 모양이 대부분이다
       * ("스타벅스" 다음 줄에 "12,000원"). 뒤 줄은 이미 다음 거래의 이름이라
       * 마지막에 본다.
       */
      merchantOrder: [line, lines[index - 1] ?? '', lines[index + 1] ?? ''],
      /*
       * 카드 이름은 이 줄이나 목록 머리에서 온다.
       *
       * 앞뒤 줄을 함께 넘기지 않는다 -- 뒤 줄이 다음 거래의 카드 줄일 수 있어서,
       * 그대로 두면 남의 카드가 이 거래에 붙는다. 이 거래의 카드 줄은 아래에서
       * 따로 붙인다(`isCardLine`).
       */
      cardText: isCardLine(line) ? line : carriedCardText,
    });
    if (!parsed.amount) continue;

    /*
     * 날짜는 **이 줄** 아니면 앞서 본 머리에서만 온다.
     *
     * 앞뒤 줄을 함께 넘겼으므로(가맹점을 찾기 위해) 그대로 두면 옆 줄의 날짜가 이
     * 거래의 날짜가 된다. 읽다 만 머리 바로 아래 줄이 그 머리의 잘못 읽은 날짜를
     * 물려받는 자리가 그것이다.
     */
    const dateBase = (isCleanDateLine(line) ? dateOf(line, now) : null) ?? carriedDate;
    /*
     * **시각은 이 줄, 없으면 뒤 줄에서 읽는다.**
     *
     * 카드사 앱의 이용내역은 한 거래를 세 줄로 적는다 -- 가맹점·금액 / 시각·일시불 /
     * 카드 이름. 그래서 거래 줄에 시각이 없는 것이 정상이고, 읽지 않으면 모든 후보가
     * 그날 정오로 담겨(`atLocal`) 사람이 폼에서 시각을 다시 적어야 한다.
     *
     * 뒤 줄은 **금액이 없을 때만** 본다. 금액이 있으면 그것은 다음 거래의 줄이고, 그
     * 시각을 가져오면 한 칸 밀린 시각이 붙는다(카드 줄을 뒤 줄에서 받지 않는 것과 같은
     * 이유다).
     */
    const next = lines[index + 1] ?? '';
    const time = timeOf(line) ?? (amountOf(next, { bare: true }) === null ? timeOf(next) : null);
    /*
     * 날짜를 못 읽었으면 **비워 둔다.** 시각만 읽었어도 오늘을 채우지 않는다.
     *
     * 채워 넣으면 그 후보는 "날짜를 아는 후보"로 보이고, 사람은 채워진 칸을 검사하지
     * 않고 저장한다. 비워 두면 폼이 오늘로 열리는 것은 같지만, 보관함 줄에 날짜가
     * 없어 손볼 자리라는 것이 보인다.
     */
    parsed.occurredAt = dateBase ? withTime(dateBase, time) : null;
    /*
     * 카드 단서도 **이 줄**에서만 읽는다.
     *
     * 앞뒤 줄을 함께 넘겼으므로 그대로 두면 앞 거래의 카드 줄에 적힌 끝 네 자리가
     * 이 거래의 카드가 된다 -- 목록에서 카드가 섞여 있으면 한 칸씩 밀린 카드가
     * 붙는다("버스"에 앞 거래의 카드가 붙는 것을 실제 캡처에서 확인했다).
     *
     * 이 거래의 카드 줄은 아래에 오므로, 그 줄을 만날 때 비어 있는 이 칸을 채운다.
     */
    parsed.cardTail = cardTailOf(line);
    parsed.issuer = issuerOf(line) ?? carriedIssuer;
    // 원문은 이 줄만 남긴다. 앞뒤 줄은 다른 후보의 원문이라 함께 적으면 겹쳐 보인다.
    parsed.rawText = line;
    /*
     * 캡처는 알림보다 덜 믿는다.
     *
     * 글자를 사진에서 읽은 것이라 0 과 O, 1 과 l 이 섞이고, 목록의 어느 줄이 무엇인지도
     * 문구의 규칙성이 알림만큼 강하지 않다.
     */
    parsed.confidence = Math.max(10, parsed.confidence - 20);
    drafts.push(parsed);
  }

  return drafts;
}

/**
 * 문구 한 덩어리를 읽는다. 알림과 캡처가 함께 쓰는 몸통이다.
 *
 * `amountFrom` 을 주면 금액만 그 줄에서 찾는다. 캡처에서 앞뒤 줄을 함께 볼 때,
 * 옆 줄의 금액을 이 후보의 금액으로 가져오지 않기 위한 장치다.
 */
function parseText(
  text: string,
  options: {
    now: number;
    parser: string;
    issuerFallback?: string | null;
    amountFrom?: string;
    /** 단위를 잃은 숫자도 금액으로 볼지. 캡처에서만 켠다. */
    bareAmount?: boolean;
    /** 카드 이름을 찾을 글. 주지 않으면 문구 전체에서 찾는다. */
    cardText?: string | null;
    /** 가맹점을 찾을 순서. 주지 않으면 문구 전체에서 찾는다. */
    merchantOrder?: string[];
  },
): ParsedDraft {
  const money = amountOf(options.amountFrom ?? text, { bare: options.bareAmount });
  const kind = kindOf(text);
  const occurredAt = dateOf(text, options.now);
  const merchant = options.merchantOrder
    ? firstMerchant(options.merchantOrder)
    : merchantOf(text);
  const installmentMonths = installmentOf(text);
  const issuer = issuerOf(text) ?? options.issuerFallback ?? null;
  const cardTail = cardTailOf(text);

  /*
   * 얼마나 믿을 수 있는가.
   *
   * 금액과 갈래는 이것이 거래라는 근거이고, 나머지는 사람이 손볼 칸이 몇 개인지를
   * 말한다. 값을 순서에 쓰지 않는다 -- 화면에서 "손봐야 한다"는 표시로만 쓴다.
   */
  let confidence = 0;
  if (money) confidence += 35;
  if (kind) confidence += 25;
  if (occurredAt) confidence += 10;
  if (merchant) confidence += 15;
  if (issuer || cardTail) confidence += 15;

  return {
    kind,
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    occurredAt,
    merchant,
    // 설명은 가맹점 이름으로 시작한다. 거래 목록에 그 이름이 뜨는 것이 가장 읽기 좋다.
    description: merchant,
    installmentMonths,
    issuer,
    cardTail,
    /*
     * 카드 이름을 찾을 글.
     *
     * `??` 가 아니라 `undefined` 검사다 -- 캡처는 "이 거래에는 카드 줄이 없다"를
     * null 로 말하고, 그때 문구 전체로 되돌리면 **옆 거래의 카드 줄**이 이 거래의
     * 카드가 된다(앞뒤 줄을 함께 넘기기 때문이다).
     */
    cardText: options.cardText !== undefined ? options.cardText : text,
    confidence: Math.min(100, confidence),
    parser: options.parser,
    rawText: text,
  };
}

/**
 * 금액과 통화. 원화가 기본이고 외화 표기가 있으면 그것을 따른다.
 *
 * `bare` 는 캡처에서만 켠다. 사진에서 읽은 글자는 단위를 잃는 일이 흔해서
 * ("12,000원"이 "12,000" 이나 "12,000l" 로 온다) 단위를 요구하면 목록 캡처에서
 * 금액이 하나도 걸리지 않는다. 그때는 자릿점이 단위 구실을 한다 -- 아래를 볼 것.
 */
function amountOf(
  text: string,
  options: { bare?: boolean } = {},
): { amount: string; currency: string } | null {
  for (const mark of CURRENCY_MARKS) {
    /*
     * 사진에서 읽은 글자에서는 통화 **기호**를 믿지 않는다.
     *
     * OCR 이 없는 기호를 만들어 낸다. 실제로 "엔코바(40084) 원" 이 "...) ¥ 2,900" 으로
     * 와서 2,900원이 2,900엔이 되었다(2026-09-09). 글자 코드(USD·JPY)는 그런 식으로
     * 생기지 않으므로 그대로 믿는다. ₩ 는 어차피 기본값과 같아 남겨 둔다.
     */
    if (options.bare && mark.symbol) continue;

    const match = text.match(mark.pattern);
    if (match && !isNotAmount(text, match.index ?? 0)) {
      const amount = normalizeAmount(match[1]);
      if (amount) return { amount, currency: mark.code };
    }
  }

  /*
   * 원화. "12,000원" 처럼 단위가 붙은 것만 금액으로 본다.
   *
   * 단위 없는 숫자까지 금액으로 읽으면 카드 끝자리와 시각이 금액이 된다. 사람이
   * 문구에서 금액을 알아보는 근거도 이 단위다.
   */
  const pattern = /([0-9][0-9,]*)\s*원/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (isNotAmount(text, match.index)) continue;
    const amount = normalizeAmount(match[1]);
    if (amount) return { amount, currency: 'KRW' };
  }

  /*
   * 단위를 잃은 숫자. 캡처에서만 본다.
   *
   * **자릿점을 요구한다.** "12,000"은 금액이지만 "1234"는 카드 끝자리이고 "2026"은
   * 연도다. 자릿점이 있는 숫자는 사람이 금액으로 적은 것이라, 그 하나로 대부분의
   * 헛것이 걸러진다. 천 원 미만(자릿점이 없는 금액)은 놓치지만, 없는 거래를 만들어
   * 내는 편보다 낫다.
   */
  if (options.bare) {
    const bare = /([0-9]{1,3}(?:,[0-9]{3})+)/g;
    while ((match = bare.exec(text)) !== null) {
      if (isNotAmount(text, match.index)) continue;
      const amount = normalizeAmount(match[1]);
      if (amount) return { amount, currency: 'KRW' };
    }
  }
  return null;
}

/**
 * 그 자리의 숫자가 금액이 아닌가.
 *
 * 숫자 **바로 앞** 열 글자만 본다. "누적 1,234,567원"과 "잔액 3,120,000원"은 둘 다
 * 그 낱말이 숫자 앞에 붙는다.
 *
 * 줄 전체를 보지 않는 이유가 있다. 문자로 오는 알림은 한 줄에 다 적혀서
 * ("국민은행 출금 550,000원 잔액 3,120,000원") 줄로 보면 출금액까지 함께 버린다.
 * 반대로 창을 더 넓히면 카드 알림의 승인 금액이 뒤따르는 누적 낱말에 걸린다.
 */
const NOT_AMOUNT_WINDOW = 10;

function isNotAmount(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const start = Math.max(lineStart, index - NOT_AMOUNT_WINDOW);
  const before = text.slice(start, index);
  return NOT_AMOUNT.some((word) => before.includes(word));
}

/** "12,000" -> "12000". 자릿점만 떼고 소수점은 남긴다. */
function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '').replace(/\.$/, '');
  if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null;
  if (Number(cleaned) <= 0) return null;
  return cleaned;
}

/**
 * 무엇을 한 것인가.
 *
 * 취소·환불을 먼저 본다. "승인취소"에는 승인이 함께 들어 있어 순서를 뒤집으면
 * 되돌린 거래가 지출로 들어온다.
 *
 * 취소를 수입으로 둔다. 돈이 돌아온 것은 맞고, 이 파서는 어느 거래를 되돌린 것인지
 * 알 수 없다. 원래 지출을 찾아 지우는 일은 사람이 보관함에서 판단한다.
 */
function kindOf(text: string): EntryKind | null {
  if (CANCEL_WORDS.some((word) => text.includes(word))) return 'income';
  if (TRANSFER_WORDS.some((word) => text.includes(word))) return 'transfer';
  if (INCOME_WORDS.some((word) => text.includes(word))) return 'income';
  if (EXPENSE_WORDS.some((word) => text.includes(word))) return 'expense';
  return null;
}

/**
 * 거래 시각. 여러 표기를 받는다.
 *
 * 연도가 없는 표기("09/08 14:23")가 가장 흔하다. 그때는 알림이 온 시각의 연도를
 * 쓰고, 그렇게 만든 날짜가 미래로 튀면 지난해로 본다 -- 12월 31일 결제 알림을
 * 1월 1일에 처리하는 경우가 있다.
 *
 * **자리 표기(로컬 시각)로 만든다.** 문구의 시각은 그 나라의 벽시계이고, 기기의
 * 시간대가 곧 그 벽시계다.
 */
function dateOf(text: string, now: number): string | null {
  const reference = new Date(now);
  const time = timeOf(text);
  const hour = time?.hour ?? null;
  const minute = time?.minute ?? null;

  const full = text.match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
  if (full) {
    return atLocal(Number(full[1]), Number(full[2]), Number(full[3]), hour, minute);
  }

  /*
   * 연도 없는 표기. 어긋나는 자리를 만나면 멈추지 않고 다음을 본다.
   *
   * 첫 자리에서 포기하면 "USD 49.99 09/06" 의 날짜를 잃는다 -- 금액의 소수점이
   * "49.99" 처럼 읽혀 먼저 걸리기 때문이다. 그런 자리는 달·날이 범위를 벗어나므로
   * 걸러 내고 계속 찾으면 뒤에 있는 진짜 날짜에 닿는다.
   */
  const short = /(?:^|[^\d:.])(\d{1,2})[.\-/월]\s*(\d{1,2})(?:일)?(?![\d:])/g;
  let match: RegExpExecArray | null;
  while ((match = short.exec(text)) !== null) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const iso = atLocal(reference.getFullYear(), month, day, hour, minute);
    if (!iso) continue;
    // 미래로 튀면 지난해다. 하루치 여유를 둔다 (기기 시계가 조금 앞설 수 있다).
    if (new Date(iso).getTime() - now > 24 * 60 * 60 * 1000) {
      return atLocal(reference.getFullYear() - 1, month, day, hour, minute);
    }
    return iso;
  }

  return null;
}

/**
 * 날짜 머리로 믿을 수 있는 줄인가.
 *
 * 두 가지를 막는다.
 *
 *   - **기간 줄.** "26.08.09 ~ 26.09.08" 은 조회 기간이고 거래 날짜가 아니다.
 *   - **읽다 만 줄.** 숫자 옆에 OCR 이 남긴 기호(' | / [ ])가 붙어 있으면 그 숫자를
 *     믿을 수 없다. "08월2'/일" 을 8월 2일로 읽는 것이 그 자리다.
 */
function isCleanDateLine(line: string): boolean {
  if (line.includes('~')) return false;

  /*
   * 합계 줄도 날짜가 아니다.
   *
   * "해외 이용금액 USD 1.20" 은 금액 쪽에서 이미 걸러지는데(합계라서), 그 줄이 날짜
   * 자리로 넘어오면 "1.20" 을 1월 20일로 읽는다. 실제로 그 줄 아래의 첫 거래가
   * 1월 20일로 담겼다 (2026-09-09).
   */
  if (NOT_AMOUNT.some((word) => line.includes(word))) return false;
  // 통화가 적힌 줄은 금액 줄이다. 날짜 머리에는 통화가 붙지 않는다.
  if (/원|USD|JPY|EUR|CNY|₩|\$|달러/i.test(line)) return false;

  /*
   * 숫자 옆의 따옴표는 OCR 이 잃은 숫자 자리다. 그런 줄의 날짜는 믿을 수 없다.
   *
   * **슬래시와 괄호는 여기 넣지 않는다.** "09/08" 은 흔한 날짜 표기이고, 괄호는
   * 카드 번호 줄("...카드(6039)")에 붙는데 그 줄에는 날짜 구분자가 없어 어차피
   * 날짜로 읽히지 않는다.
   */
  return !/\d\s*['｜|‘’`]|['｜|‘’`]\s*\d/.test(line);
}

/**
 * 이 줄이 날짜 머리인가. 머리라면 그 날짜다.
 *
 * 캡처의 목록은 "09월05일" 같은 머리 아래로 거래가 이어지는 모양이고, 그 머리를 못
 * 읽으면 아래 거래들이 **앞 머리의 날짜를 이어 쓴다.** 그 자리에서 날짜가 조용히
 * 어긋나므로(실제로 9월 3일이 9월 5일로 담겼다) 되살릴 수 있는 모양은 되살린다.
 */
function headerDateOf(line: string, now: number, carried: string | null): string | null {
  if (!isCleanDateLine(line)) return null;

  const read = dateOf(line, now);
  if (read) return read;

  const repaired = repairedDateHeader(line);
  const guessed = repaired ? dateOf(repaired, now) : null;
  if (!guessed) return null;

  /*
   * 되살린 머리가 **앞서 본 날짜보다 새것이면 버린다.**
   *
   * 이용내역은 날짜가 내려가는 순서라 새 날짜가 나올 자리가 아니다. 그렇다면 그
   * 숫자는 날짜가 아니었다는 뜻이고(끝자리·건수 같은 것), 그것을 날짜로 쓰면 그
   * 아래 거래 전체가 엉뚱한 날로 간다. 비워 두는 편이 낫다.
   */
  if (carried && new Date(guessed).getTime() > new Date(carried).getTime()) return null;
  return guessed;
}

/**
 * 월·일 글자를 잃은 날짜 머리를 되살린다. **캡처에만 쓴다.**
 *
 * OCR 은 "09월03일" 의 `월` 을 숫자로 읽고 `일` 을 잃는 일이 있다 -- 실제 캡처에서
 * "09803"(09월03일)과 "098012"(09월01일)가 왔다(2026-09-09). 구분자가 없어 `dateOf`
 * 가 날짜로 읽지 못하는 줄이다.
 *
 * 앞 두 자리를 달, 한 자리를 건너뛰고(`월` 이 있던 자리) 두 자리를 날로 본다. 마지막
 * 한 자리는 `일` 이 있던 자리이고 없을 수도 있다. 달·날의 범위는 `dateOf` 가 본다.
 */
function repairedDateHeader(line: string): string | null {
  const match = line.replace(/\s/g, '').match(/^(\d{2})\d(\d{2})\d?$/);
  return match ? `${match[1]}월${match[2]}일` : null;
}

/**
 * 시·분. 문구에 시각이 없으면 null 이다.
 *
 * **범위를 본다.** OCR 이 만든 자리("59:800", "1:99")를 그대로 쓰면 `Date` 가 그것을
 * 다음 시간·다음 날로 넘겨, 시각뿐 아니라 날짜까지 밀린다.
 */
function timeOf(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * 날짜에 시각을 얹는다. 시각이 없으면 그대로다(그날 정오).
 *
 * 로컬 벽시계로 얹는다 -- 받는 값은 `atLocal` 이 로컬 자리로 만든 것이라, 같은
 * 시간대에서 시·분만 갈아 끼우면 날짜는 그대로 남는다.
 */
function withTime(iso: string, time: { hour: number; minute: number } | null): string {
  if (!time) return iso;

  const date = new Date(iso);
  date.setHours(time.hour, time.minute, 0, 0);
  return date.toISOString();
}

/** 로컬 벽시계로 만든 인스턴트. 시각을 못 읽으면 그날 정오로 둔다. */
function atLocal(
  year: number,
  month: number,
  day: number,
  hour: number | null,
  minute: number | null,
): string | null {
  /*
   * 시각을 모를 때 정오로 두는 이유.
   *
   * 자정으로 두면 시간대가 다른 곳에서 하루가 밀린다(한국 자정은 UTC 로 전날
   * 15시다). 정오는 어느 시간대로 옮겨도 같은 날에 남는다.
   */
  const date = new Date(year, month - 1, day, hour ?? 12, minute ?? 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
}

/**
 * 가맹점 이름.
 *
 * 문구에서 숫자·날짜·낱말을 걷어내고 남는 줄 중 가장 그럴듯한 것을 고른다. 카드
 * 알림은 가맹점을 마지막 줄이나 금액 뒤에 적는 일이 많다.
 *
 * 사람 이름(승인자)과 가맹점을 함께 적는 카드사가 있어 두 줄이 남는 경우가 있다.
 * 그때는 뒤에 있는 것을 고른다 -- 승인자가 먼저 오는 서식이 흔하다.
 */
function merchantOf(text: string): string | null {
  const candidates = text
    .split(/\r?\n/)
    .map((line) => cleanMerchantLine(line))
    .filter((line): line is string => line !== null);

  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

/** 준 순서대로 보아 처음 읽히는 가맹점. 캡처가 쓴다. */
function firstMerchant(lines: string[]): string | null {
  for (const line of lines) {
    const cleaned = cleanMerchantLine(line);
    if (cleaned) return cleaned;
  }
  return null;
}

/** 한 줄에서 가맹점만 남긴다. 남을 것이 없으면 null 이다. */
function cleanMerchantLine(line: string): string | null {
  let rest = line
    // 문자 발신 표시와 대괄호로 묶은 발신자
    .replace(/\[[^\]]*\]/g, ' ')
    // 금액과 단위
    .replace(/[0-9][0-9,]*\.?[0-9]*\s*(?:원|달러|엔|유로|위안|USD|JPY|EUR|CNY)/gi, ' ')
    .replace(/(?:USD|US\$|\$|¥|€|₩)\s*[0-9][0-9,]*\.?[0-9]*/gi, ' ')
    /*
     * 단위를 잃은 금액. 자릿점이 있는 숫자와 그 뒤에 붙은 글자 하나까지 뗀다.
     *
     * 캡처에서 "이마트 성수점 45,300l" 처럼 온다. 숫자만 떼면 "l" 이 가맹점 이름에
     * 남고, 그 이름으로 다음 거래의 분류를 짐작하게 된다.
     */
    /*
     * 단위를 잃은 금액과 그 뒤에 붙은 한 글자.
     *
     * 뒤 한 글자는 OCR 이 "원" 자리에 남긴 것이다 -- 실제로 "59,800워", "13,0008" 로
     * 왔다. 한 글자만 뗀다: 두 글자부터는 가맹점 이름일 수 있다.
     */
    .replace(/[0-9]{1,3}(?:,[0-9]{3})+\s*[a-zA-Z%|0-9'워원웜]?/g, ' ')
    // 날짜와 시각
    .replace(/(20\d{2})[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}(?:일)?/g, ' ')
    .replace(/\d{1,2}[.\-/월]\s*\d{1,2}(?:일)?/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    // 카드 끝자리와 마스킹
    .replace(/\(\s*\d{4}\s*\)/g, ' ')
    .replace(/\*+\s*\d{4}/g, ' ')
    // 할부와 일시불
    .replace(/\d{1,2}\s*개월(?:\s*할부)?/g, ' ')
    .replace(/일시불/g, ' ')
    /*
     * 건수 표기. 카드 앱은 같은 곳에서 여러 번 쓴 것을 "지하철 3건" 으로 묶는다.
     *
     * 떼지 않으면 가맹점이 "지하철 3 건" 이 되어, 다음에 같은 곳에서 4건이 묶이면
     * 다른 가게로 보인다 (분류 짐작이 그만큼 빗나간다).
     */
    .replace(/\d+\s*건/g, ' ');

  for (const word of [
    ...EXPENSE_WORDS,
    ...INCOME_WORDS,
    ...TRANSFER_WORDS,
    ...CANCEL_WORDS,
    ...NOT_AMOUNT,
    ...ISSUER_WORDS,
    'Web발신',
    '체크카드',
    '신용카드',
    '카드',
    '고객님',
    '님',
  ]) {
    rest = rest.split(word).join(' ');
  }

  /*
   * 남은 기호를 뗀다.
   *
   * 따옴표도 뗀다 -- 가맹점 이름에 쓰이는 일은 드물고, OCR 이 금액 앞에 남긴 것이
   * 이름 끝에 붙는 일은 흔하다("지에스25 구로행운점 '").
   */
  const cleaned = rest
    .replace(/[^\p{L}\p{N}\s.&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /*
   * 남은 것이 가맹점인가.
   *
   * 두 글자 미만은 버린다. 조사나 낱말 조각이 남은 것이고, 그것이 거래 이름이 되면
   * 목록에서 무엇인지 알 수 없다. 숫자만 남은 것도 버린다(잔여 금액 조각).
   */
  if (cleaned.length < 2) return null;
  if (!/[\p{L}]/u.test(cleaned)) return null;
  return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
}

/** 할부 개월수. 일시불이거나 1개월이면 null 이다. */
function installmentOf(text: string): number | null {
  if (text.includes('일시불')) return null;
  const match = text.match(/(\d{1,2})\s*개월/);
  if (!match) return null;
  const months = Number(match[1]);
  return months >= 2 && months <= 60 ? months : null;
}

/**
 * 카드를 가리키는 줄인가. 금액이 없는 줄에서만 묻는다.
 *
 * 카드사 앱의 이용내역은 거래마다 "nori 체크카드(2395)" 나 "ktMmobile카드(6039)" 를
 * 적는다. 그 줄에서 얻을 것이 둘이다 -- 카드 이름과 끝 네 자리.
 *
 * **끝 네 자리만 있어도 카드 줄로 본다.** OCR 이 이름을 잃는 일이 흔해서
 * ("nori 체크카드(2395)" 가 "nori M=7t=(RF(2395)" 로 온다) "카드"라는 낱말을
 * 요구하면 그런 줄을 통째로 버린다. 이름은 못 읽어도 끝자리는 남고, 끝자리가
 * 어느 카드인지 가리는 가장 센 단서다.
 *
 * 카드대금·청구 줄은 뺀다. 그쪽은 결제할 금액을 적은 줄이라 거래의 카드가 아니다.
 */
function isCardLine(line: string): boolean {
  if (/대금|결제일|청구|한도/.test(line)) return false;
  if (cardTailOf(line) !== null) return true;
  return line.includes('카드') && issuerOf(line) !== null;
}

/** 문구에 적힌 카드사·은행. 긴 이름을 먼저 보아 "국민카드"가 "국민"에 먹히지 않게 한다. */
function issuerOf(text: string): string | null {
  const found = ISSUER_WORDS.filter((word) => text.includes(word)).sort(
    (a, b) => b.length - a.length,
  );
  return found[0] ?? null;
}

/** 카드 번호 끝 네 자리. "(1234)", "*1234", "카드1234" 를 읽는다. */
function cardTailOf(text: string): string | null {
  const paren = text.match(/\(\s*(\d{4})\s*\)/);
  if (paren) return paren[1];
  const masked = text.match(/[*·•]\s*(\d{4})/);
  if (masked) return masked[1];
  const trailing = text.match(/카드\s*[^\d]{0,4}(\d{4})(?!\d)/);
  if (trailing) return trailing[1];
  return null;
}

/**
 * 같은 것을 두 번 담지 않기 위한 열쇠.
 *
 * 알림은 (앱, 온 시각을 분으로 자른 값, 문구)로 만든다. 초까지 넣으면 재전송된
 * 알림이 다른 것으로 보이고, 분으로 자르면 같은 알림의 재전송은 하나로 모인다.
 * 같은 분에 같은 가게에서 같은 금액을 두 번 결제하는 일은 드물고, 그때는 사람이
 * 보관함에서 한 건을 더 적는 편이 낫다 -- 두 번 적히는 쪽이 알아채기 어렵다.
 */
export function notificationDedupeKey(input: NotificationInput): string {
  const minute = Math.floor(input.postedAt / 60000);
  const body = `${input.title ?? ''}|${input.text}`.replace(/\s+/g, ' ').trim();
  return `n:${input.packageName}:${minute}:${hash(body)}`;
}

/**
 * 캡처에서 나온 후보의 열쇠.
 *
 * 사진의 글자 전체를 해시해 사진을 가리고, 그 안의 몇 번째 줄인지와 읽은 값으로
 * 줄을 가린다. 같은 캡처를 두 번 올려도 후보가 늘지 않는다.
 */
export function captureDedupeKey(fullText: string, index: number, draft: ParsedDraft): string {
  const shot = hash(fullText.replace(/\s+/g, ' ').trim());
  return `c:${shot}:${index}:${draft.amount ?? '0'}`;
}

/**
 * 짧은 해시 (FNV-1a 32비트).
 *
 * 암호용이 아니다. 같은 문구가 같은 열쇠가 되는 것만 필요하다. 기기와 웹이 같은
 * 값을 내야 하므로 자바스크립트 밖의 것(네이티브 해시)에 기대지 않는다.
 */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}
