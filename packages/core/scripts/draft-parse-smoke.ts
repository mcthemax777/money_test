/**
 * 보관함 파서 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/draft-parse-smoke.ts
 *
 * 실제로 오는 문구를 그대로 넣어 본다. 이 파서는 규칙 덩어리라 한 줄을 고치면 엉뚱한
 * 서식이 함께 틀어진다. 기기에 올려 알림을 기다려서는 그것을 알 수 없어서, 문구를
 * 표로 모아 두고 여기서 돌린다.
 *
 * **금액 자리가 가장 자주 틀린다.** 카드 알림은 승인 금액과 누적 사용액을 함께 적고,
 * 누적을 집어 오면 커피 한 잔이 한 달 사용액으로 들어온다. 그 사례를 여러 개 둔다.
 */
import {
  captureDedupeKey,
  looksFinancial,
  notificationDedupeKey,
  parseCaptureText,
  parseNotification,
  type NotificationInput,
} from '../src/lib/draft-parse';
import { guessCategoryId, matchPaymentMethod } from '../src/lib/draft-match';
import { captureItems } from '../src/lib/draft-collect';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 2026-09-08 14:30 (기기 로컬). 문구에 연도가 없을 때의 기준이다. */
const NOW = new Date(2026, 8, 8, 14, 30, 0).getTime();

function notify(text: string, options: Partial<NotificationInput> = {}) {
  return parseNotification({
    packageName: options.packageName ?? 'com.samsung.android.messaging',
    title: options.title ?? null,
    text,
    postedAt: options.postedAt ?? NOW,
  });
}

/** 로컬 벽시계로 읽은 날짜. 인스턴트를 사람이 보는 값으로 되돌려 견준다. */
function localKey(iso: string | null): string {
  if (!iso) return '(없음)';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

console.log('── 카드 승인 알림 ──');
{
  const draft = notify(
    '[Web발신]\nKB국민카드 승인\n김용찬님\n12,000원 일시불\n09/08 14:23\n스타벅스강남2호점\n누적 1,234,567원',
    { packageName: 'com.kbcard.cxh.appcard', title: 'KB국민카드' },
  );
  eq('갈래는 지출', draft?.kind, 'expense');
  eq('금액은 승인액 (누적이 아니다)', draft?.amount, '12000');
  eq('통화는 원화', draft?.currency, 'KRW');
  eq('시각을 문구에서 읽는다', localKey(draft?.occurredAt ?? null), '2026-09-08 14:23');
  eq('가맹점', draft?.merchant, '스타벅스강남2호점');
  eq('일시불은 할부가 아니다', draft?.installmentMonths, 'null');
  eq('카드사', draft?.issuer, 'KB국민카드');
}

{
  const draft = notify('신한카드(1234) 승인 45,000원 09/07 19:02 이마트성수점 3개월 할부', {
    packageName: 'com.shcard.smartpay',
  });
  eq('금액', draft?.amount, '45000');
  eq('카드 끝자리', draft?.cardTail, '1234');
  eq('할부 개월수', draft?.installmentMonths, 3);
  eq('가맹점', draft?.merchant, '이마트성수점');
  eq('날짜', localKey(draft?.occurredAt ?? null), '2026-09-07 19:02');
}

{
  const draft = notify('[현대카드] 승인취소 12,900원 09/08 15:10 배달의민족');
  eq('취소는 돌아온 돈이다', draft?.kind, 'income');
  eq('금액', draft?.amount, '12900');
}

{
  const draft = notify('삼성카드 해외승인 USD 49.99 09/06 AMAZON.COM', {
    packageName: 'kr.co.samsungcard.mpocket',
  });
  eq('외화 금액', draft?.amount, '49.99');
  eq('외화 통화', draft?.currency, 'USD');
  eq('시각이 없으면 정오', localKey(draft?.occurredAt ?? null), '2026-09-06 12:00');
}

console.log('\n── 통장 알림 ──');
{
  const draft = notify('카카오뱅크 입금 2,500,000원 09/05 급여 (주)컴투스', {
    packageName: 'com.kakaobank.channel',
  });
  eq('갈래는 수입', draft?.kind, 'income');
  eq('금액', draft?.amount, '2500000');
  eq('은행', draft?.issuer, '카카오뱅크');
}

{
  const draft = notify('국민은행 출금 550,000원 잔액 3,120,000원 09/08 관리비');
  eq('금액은 출금액 (잔액이 아니다)', draft?.amount, '550000');
  eq('갈래는 지출', draft?.kind, 'expense');
}

{
  const draft = notify('토스 이체 300,000원 09/08 김보민');
  eq('갈래는 이체', draft?.kind, 'transfer');
  eq('금액', draft?.amount, '300000');
}

console.log('\n── 원화 기호 표기 ──');
{
  /*
   * 앱 목록과 영수증은 "₩12,000"으로 적는다.
   *
   * 캡처를 읽을 때 이 표기를 모르면 금액이 하나도 걸리지 않는다. 알림에도 이렇게
   * 적는 앱이 있다.
   */
  const draft = notify('결제 완료 ₩12,000 09/08 스타벅스');
  eq('원화 기호를 읽는다', draft?.amount, '12000');
  eq('통화는 원화', draft?.currency, 'KRW');

  const minus = parseCaptureText('태그 스모크\n-₩12,000', { now: NOW });
  eq('부호가 붙어도 금액은 그대로', minus[0]?.amount, '12000');
}

console.log('\n── 금융 알림이 아닌 것 ──');
{
  eq(
    '배달 앱 할인 알림은 거른다',
    looksFinancial({
      packageName: 'com.sampleapp.delivery',
      title: '오늘의 쿠폰',
      text: '3,900원 할인 쿠폰이 도착했어요',
      postedAt: NOW,
    }),
    false,
  );
  eq(
    '금액이 없는 채팅은 거른다',
    looksFinancial({
      packageName: 'com.kakao.talk',
      title: '엄마',
      text: '입금했어',
      postedAt: NOW,
    }),
    false,
  );
  eq('거른 알림은 후보가 되지 않는다', notify('3,900원 할인 쿠폰이 도착했어요'), 'null');
}

console.log('\n── 지난해 결제 ──');
{
  // 1월 2일에 도착한 12월 31일 결제 알림. 연도를 그대로 쓰면 미래가 된다.
  const january = new Date(2027, 0, 2, 9, 0, 0).getTime();
  const draft = notify('신한카드 승인 8,000원 12/31 23:50 편의점', { postedAt: january });
  eq('미래로 튀면 지난해로 읽는다', localKey(draft?.occurredAt ?? null), '2026-12-31 23:50');
}

console.log('\n── 같은 알림을 두 번 받았을 때 ──');
{
  const input: NotificationInput = {
    packageName: 'com.kbcard.cxh.appcard',
    title: 'KB국민카드',
    text: '12,000원 승인 스타벅스',
    postedAt: NOW,
  };
  eq(
    '재전송은 같은 열쇠가 된다',
    notificationDedupeKey(input),
    notificationDedupeKey({ ...input, postedAt: NOW + 12_000 }),
  );
  eq(
    '다른 금액은 다른 열쇠다',
    notificationDedupeKey({ ...input, text: '13,000원 승인 스타벅스' }) ===
      notificationDedupeKey(input),
    false,
  );
}

console.log('\n── 캡처 (목록 화면) ──');
{
  const text = [
    'KB국민카드 이용내역',
    '9월 8일',
    '스타벅스강남2호점',
    '12,000원',
    '이마트성수점',
    '45,000원',
    '9월 7일',
    '배달의민족',
    '23,500원',
    '누적 1,234,567원',
  ].join('\n');

  const drafts = parseCaptureText(text, { now: NOW });
  eq('금액이 있는 줄마다 후보', drafts.length, 3);
  eq('첫 후보 금액', drafts[0]?.amount, '12000');
  eq('첫 후보 가맹점', drafts[0]?.merchant, '스타벅스강남2호점');
  eq('앞선 줄의 날짜를 이어 쓴다', localKey(drafts[0]?.occurredAt ?? null), '2026-09-08 12:00');
  eq('날짜가 바뀌면 그 뒤 후보에 적용된다', localKey(drafts[2]?.occurredAt ?? null), '2026-09-07 12:00');
  eq('누적 줄은 후보가 아니다', drafts.some((draft) => draft.amount === '1234567'), false);
  eq('캡처는 알림보다 덜 믿는다', drafts[0]!.confidence < 80, true);

  const keys = drafts.map((draft, index) => captureDedupeKey(text, index, draft));
  eq('후보마다 다른 열쇠', new Set(keys).size, 3);
  const again = parseCaptureText(text, { now: NOW }).map((draft, index) =>
    captureDedupeKey(text, index, draft),
  );
  eq('같은 캡처를 두 번 올려도 같은 열쇠', String(keys), String(again));
}

console.log('\n── 캡처 (기기 OCR 이 단위를 잃은 경우) ──');
{
  /*
   * 사진에서 읽은 글자는 "원"을 자주 잃는다. 실제로 에뮬레이터에서 읽어 보면
   * "12,000원"이 "12,000", "45,300l", "4,800%" 로 온다 (2026-09-08).
   *
   * 그래서 캡처에서는 자릿점이 있는 숫자를 금액으로 본다. 알림에는 그 규칙을 쓰지
   * 않는다 -- 문구가 깨끗하고, 거기서 자릿점 없는 숫자까지 금액으로 읽으면 카드
   * 끝자리와 시각이 금액이 된다.
   */
  const text = [
    'KB국민카드 이용내역',
    '9월 8일',
    '스타벅스 강남2호점 12,000',
    '이마트 성수점 45,300l',
    '배달의민족 23,500l',
    '누적 사용액 1,234,567원',
  ].join('\n');

  const drafts = parseCaptureText(text, { now: NOW });
  eq('단위를 잃은 금액도 읽는다', drafts.length, 3);
  eq('첫 후보 금액', drafts[0]?.amount, '12000');
  eq('첫 후보 가맹점', drafts[0]?.merchant, '스타벅스 강남2호점');
  eq('꼬리 글자가 붙어도 금액은 그대로', drafts[1]?.amount, '45300');
  eq('누적 줄은 여전히 후보가 아니다', drafts.some((draft) => draft.amount === '1234567'), false);

  // 알림에서는 단위 없는 숫자를 금액으로 읽지 않는다.
  eq('알림의 단위 없는 숫자는 금액이 아니다', notify('신한카드 승인 12,000 스타벅스'), 'null');
}

console.log('\n── 실제 카드 앱 캡처 (브라우저 OCR 이 읽어 온 글자) ──');
{
  /*
   * KB국민카드 이용내역 화면을 브라우저 OCR 로 읽은 글자를 그대로 넣는다
   * (2026-09-09). 사람이 만든 표본이 아니라 기계가 틀린 자리를 담은 표본이다.
   */
  const text = [
    '이용내역 조회',
    '이용수단 KB국민카드 전체 (신용+체크)',
    '26.08.09 ~ 26.09.08',
    '국내 이용금액                                 5\'79,190원',
    '해외 이용금액                                usD 1.20',
    '총 54건',
    '09월07일',
    '쿠팡(쿠페이)                               15,090원',
    '어향                                     2\'7,000원',
    '엔코바(40082) ¥                         2.900원',
    '지하철 1 건                                        1,650원',
  ].join('\n');

  const drafts = parseCaptureText(text, { now: NOW });
  const amounts = drafts.map((draft) => draft.amount);

  eq('합계 줄(국내 이용금액)은 후보가 아니다', amounts.includes('579190'), false);
  eq('합계 줄(해외 이용금액)도 아니다', amounts.includes('1.20'), false);
  eq('자릿점 자리의 기호를 걷어낸다', amounts.includes('27000'), true);
  eq('자릿점을 점으로 읽은 것도 읽는다', amounts.includes('2900'), true);
  eq('쿠팡 금액', amounts.includes('15090'), true);
  eq('건수 표기는 가맹점에서 뗀다', drafts.find((d) => d.amount === '1650')?.merchant, '지하철');
  eq('총 건수 줄은 후보가 아니다', amounts.includes('54'), false);
}

{
  /*
   * 날짜 머리를 읽다 만 경우. 그 줄을 믿으면 거래가 엉뚱한 날로 간다.
   *
   * "08월27일" 이 "08월2'/일" 로 온다. 그대로 읽으면 8월 2일이 되어 25일 어긋난다.
   * 그럴 때는 앞서 본 날짜를 이어 쓴다.
   */
  const text = [
    '08월28일',
    '스마트로 대표비인증 25,000원',
    "08월2'/일",
    '지에스25 구로행운점 4,500원',
  ].join('\n');

  const drafts = parseCaptureText(text, { now: NOW });
  eq('깨끗한 머리는 그대로 쓴다', localKey(drafts[0]?.occurredAt ?? null), '2026-08-28 12:00');
  eq('읽다 만 머리는 앞 날짜를 이어 쓴다', localKey(drafts[1]?.occurredAt ?? null), '2026-08-28 12:00');
}

{
  /*
   * 캡처에서는 통화 기호를 믿지 않는다.
   *
   * "엔코바(40084) 원 2,900" 이 "...) ¥ 2,900" 으로 와서 원화가 엔화로 바뀌었다.
   * 알림에서는 기호를 그대로 믿는다 -- 문구가 깨끗하고 해외 승인 알림에 실제로 붙는다.
   */
  const capture = parseCaptureText('QAITHHENCOBA) ¥ 2,900', { now: NOW });
  eq('캡처의 ¥ 는 무시한다', capture[0]?.currency, 'KRW');
  eq('금액은 그대로', capture[0]?.amount, '2900');
  eq('알림의 ¥ 는 엔화로 읽는다', notify('신한카드 해외승인 ¥ 2,900 09/08 도쿄')?.currency, 'JPY');
  eq(
    '캡처의 글자 코드는 그대로 믿는다',
    parseCaptureText('AMAZON.COM USD 49.99', { now: NOW })[0]?.currency,
    'USD',
  );
}

{
  /*
   * 슬래시 날짜는 그대로 읽는다. 따옴표만 "읽다 만 것"으로 본다.
   *
   * 이 자리를 막아 두면 "09/08 스타벅스 12,000원" 같은 줄이 날짜를 잃는다.
   */
  const text = ['09/08', '스타벅스 12,000원', "08/2'", '이마트 45,000원'].join('\n');
  const drafts = parseCaptureText(text, { now: NOW });
  eq('슬래시 날짜는 읽는다', localKey(drafts[0]?.occurredAt ?? null), '2026-09-08 12:00');
  eq('따옴표가 낀 날짜는 앞 날짜를 이어 쓴다', localKey(drafts[1]?.occurredAt ?? null), '2026-09-08 12:00');
}

{
  /*
   * 합계 줄을 날짜로 읽지 않는다.
   *
   * "해외 이용금액 USD 1.20" 은 금액 쪽에서 걸러지는데, 그 줄이 날짜 자리로 넘어가면
   * "1.20" 이 1월 20일이 된다. 실제로 첫 거래가 1월 20일로 담겼다.
   */
  const text = ['해외 이용금액 USD 1.20', '쿠팡(쿠페이) 15,090원'].join('\n');
  const drafts = parseCaptureText(text, { now: NOW });
  eq('합계 줄은 날짜가 아니다', drafts[0]?.occurredAt, 'null');
  eq('합계 줄 자신도 후보가 아니다', drafts.length, 1);
}

{
  // 조회 기간 줄은 날짜 머리가 아니다. 그것을 날짜로 쓰면 첫 거래가 엉뚱한 달로 간다.
  const text = ['26.08.09 ~ 26.09.08', '쿠팡(쿠페이) 15,090원'].join('\n');
  const drafts = parseCaptureText(text, { now: NOW });
  eq('기간 줄은 날짜로 쓰지 않는다', drafts[0]?.occurredAt, 'null');
  eq('금액은 그대로 읽는다', drafts[0]?.amount, '15090');
}

{
  // OCR 이 금액 뒤에 남긴 글자·숫자와 앞에 남긴 따옴표는 가맹점에서 뗀다.
  const text = ['텐진라멘가산디지털단지점 13,0008', "지에스25 구로행운점 '700원"].join('\n');
  const drafts = parseCaptureText(text, { now: NOW });
  eq('금액 뒤의 글자를 뗀다', drafts[0]?.merchant, '텐진라멘가산디지털단지점');
  eq(
    '원을 워로 읽은 것도 뗀다',
    parseCaptureText('(주)피에스에이 59,800워', { now: NOW })[0]?.merchant,
    '주 피에스에이',
  );
  eq('금액 앞의 따옴표를 뗀다', drafts[1]?.merchant, '지에스25 구로행운점');
}

console.log('\n── 캡처에 적힌 카드 이름으로 카드 찾기 ──');
{
  /*
   * 카드사 앱의 이용내역은 거래마다 카드 줄을 따로 적는다.
   *
   *   nori 체크카드(2395)      <- 이 줄이 그 거래의 카드다
   *
   * 그 이름을 이 가계부에 그대로 등록해 두었다면 어느 카드인지 의심할 자리가 없다.
   */
  const cards = [
    { id: 'nori', name: 'nori 체크카드', cardNumberMasked: null, isActive: true },
    { id: 'ktm', name: 'ktMmobile카드', cardNumberMasked: null, isActive: true },
  ] as never;
  const hints = { accounts: [] as never, cards, history: [] };

  const text = [
    '09월07일',
    '쿠팡(쿠페이) 15,090원',
    '17:35 일시불 전표매입',
    'nori 체크카드(2395)',
    '09월06일',
    '쿠팡이츠 23,500원',
    '12:19 일시불 전표매입',
    'ktMmobile카드(6039)',
  ].join('\n');

  const items = captureItems(text, hints, { now: NOW });
  eq('후보 수', items.length, 2);
  eq('첫 거래의 카드', items[0]?.cardId, 'nori');
  eq('둘째 거래의 카드', items[1]?.cardId, 'ktm');
  eq('카드 줄은 후보가 아니다', items.some((item) => item.amount === '2395'), false);
  eq('끝자리도 함께 읽는다', parseCaptureText(text, { now: NOW })[0]?.cardTail, '2395');

  /*
   * 카드 줄이 다음 거래의 것으로 새면 안 된다.
   *
   * 카드 줄은 거래 **아래**에 오므로, 위에서 아래로 읽으며 방금 만든 후보에만 붙인다.
   */
  const oneCard = captureItems(
    ['커피 3,000원', 'nori 체크카드(2395)', '식당 9,000원'].join('\n'),
    hints,
    { now: NOW },
  );
  eq('카드 줄 위의 거래가 그 카드다', oneCard[0]?.cardId, 'nori');
  eq('카드 줄 아래의 거래에는 붙지 않는다', oneCard[1]?.cardId, 'null');

  /*
   * 카드가 섞인 목록. 한 칸 밀리면 안 된다.
   *
   * 실제 캡처에서 "버스" 거래에 앞 거래("씨유")의 카드가 붙었다. 앞뒤 줄을 함께
   * 보면서 앞 거래의 카드 줄에 적힌 끝자리를 이 거래의 것으로 읽었기 때문이다.
   */
  const mixed = captureItems(
    [
      '씨유 4,500원',
      '08:02 일시불',
      'nori 체크카드(2395)',
      '버스 1,650원',
      '05:45 일시불',
      'ktMmobile카드(6039)',
    ].join('\n'),
    hints,
    { now: NOW },
  );
  eq('앞 거래의 카드', mixed[0]?.cardId, 'nori');
  eq('뒤 거래는 자기 카드', mixed[1]?.cardId, 'ktm');
}

{
  /*
   * 이름을 잃은 카드 줄에서도 끝 네 자리는 건진다.
   *
   * OCR 이 "nori 체크카드(2395)" 를 "nori M=7t=(RF(2395)" 로 읽는다. 이름으로는
   * 못 찾지만 끝자리로 찾을 수 있다.
   */
  const cards = [
    { id: 'c1', name: '주카드', cardNumberMasked: '**** **** **** 2395', isActive: true },
  ] as never;
  const items = captureItems(
    ['커피 3,000원', '12:00 일시불', 'nori M=7t=(RF(2395)'].join('\n'),
    { accounts: [] as never, cards, history: [] },
    { now: NOW },
  );
  eq('끝자리로 카드를 찾는다', items[0]?.cardId, 'c1');
}

{
  // 목록 머리에만 카드가 적힌 모양. 그 아래 거래들이 그 카드를 쓴다.
  const cards = [
    { id: 'com2us', name: 'com2us 신용카드', cardNumberMasked: null, isActive: true },
  ] as never;
  const items = captureItems(
    ['com2us 신용카드(1234) 이용내역', '9월 8일', '스타벅스 12,000원'].join('\n'),
    { accounts: [] as never, cards, history: [] },
    { now: NOW },
  );
  eq('머리의 카드를 이어 쓴다', items[0]?.cardId, 'com2us');
}

{
  // 알림 문구에 카드 이름이 적힌 경우도 같다.
  const cards = [
    { id: 'com2us', name: 'com2us 신용카드', cardNumberMasked: null, isActive: true },
    { id: 'other', name: '외화카드', cardNumberMasked: null, isActive: true },
  ] as never;
  const draft = notify('com2us 신용카드 승인 5,000원 09/08 카페');
  eq('알림의 카드 이름도 본다', matchPaymentMethod(draft!, { accounts: [] as never, cards }).cardId, 'com2us');

  // 이름이 없으면 그대로 비운다. 엉뚱한 카드를 채우지 않는다.
  const unknown = notify('현대카드 승인 5,000원 09/08 카페');
  eq(
    '모르는 카드는 비운다',
    matchPaymentMethod(unknown!, { accounts: [] as never, cards }).cardId,
    'null',
  );
}

console.log('\n── 담을 모양으로 만들기 (앱·웹이 함께 쓰는 자리) ──');
{
  /*
   * `captureItems` 는 파싱·맞춤·중복 열쇠를 한 번에 한다. 앱(기기 OCR)과 웹(브라우저
   * OCR)이 이 함수를 함께 쓰므로, 같은 글자에서 같은 후보가 나와야 한다.
   */
  const text = ['신한카드 이용내역', '9월 8일', '스타벅스 강남2호점 12,000', '이마트 성수점 45,300'].join('\n');
  const cards = [
    { id: 'c1', name: '신한 체크', cardNumberMasked: '**** **** **** 1234', isActive: true },
  ] as never;
  const hints = {
    accounts: [] as never,
    cards,
    history: [{ merchant: '스타벅스 강남2호점', description: '커피', categoryId: 'cat-cafe' }],
  };

  const items = captureItems(text, hints, { now: NOW });
  eq('후보 수', items.length, 2);
  eq('출처', items[0]?.source, 'capture');
  eq('카드사 이름으로 카드를 채운다', items[0]?.cardId, 'c1');
  /*
   * 갈래를 못 읽은 캡처 줄에도 분류를 붙인다. 폼이 그때 지출로 열기 때문이다.
   * 모르는 가맹점(이마트)은 그대로 비어 있어야 한다.
   */
  eq('갈래가 비어도 분류를 짐작한다', items[0]?.categoryId, 'cat-cafe');
  eq('모르는 가맹점은 비운다', items[1]?.categoryId, 'null');
  eq('열쇠가 서로 다르다', new Set(items.map((item) => item.dedupeKey)).size, 2);
  eq(
    '같은 글자를 다시 읽으면 같은 열쇠',
    String(captureItems(text, hints, { now: NOW }).map((item) => item.dedupeKey)),
    String(items.map((item) => item.dedupeKey)),
  );
}

console.log('\n── 이 가계부의 것과 맞추기 ──');
{
  const cards = [
    { id: 'c1', name: '신한 체크', cardNumberMasked: '**** **** **** 1234', isActive: true },
    { id: 'c2', name: '국민 신용', cardNumberMasked: '**** **** **** 9876', isActive: true },
  ] as never;
  const accounts = [
    { id: 'a1', name: '카카오뱅크 통장', isActive: true },
    { id: 'a2', name: '국민은행 통장', isActive: true },
  ] as never;

  const byTail = notify('현대카드(1234) 승인 5,000원 09/08 카페');
  eq('끝자리로 카드를 찾는다', matchPaymentMethod(byTail!, { accounts, cards }).cardId, 'c1');

  const byIssuer = notify('국민카드 승인 5,000원 09/08 카페');
  eq('카드사 이름으로 찾는다', matchPaymentMethod(byIssuer!, { accounts, cards }).cardId, 'c2');

  const deposit = notify('카카오뱅크 입금 5,000원 09/08 이자');
  const matched = matchPaymentMethod(deposit!, { accounts, cards });
  eq('입금은 통장에서 찾는다', matched.accountId, 'a1');
  eq('입금에는 카드를 채우지 않는다', matched.cardId, 'null');

  /*
   * 카드사 알림에 맞는 카드가 없을 때. 통장으로 내려가면 안 된다.
   *
   * "국민카드"로 쓴 돈을 "국민은행 통장"에서 빠진 것으로 적으면 카드 사용액과 통장
   * 잔액이 함께 틀린다. 비워 두고 사람이 고르게 한다.
   *
   * 이름이 맞는 카드를 목록에서 빼고 본다 -- 이 가계부에 국민카드를 등록하지 않은
   * 상태다. 그때 "국민은행 통장"이 걸리는 것이 이 검사가 막는 자리다.
   */
  const unknownCard = notify('국민카드 승인 5,000원 09/08 카페');
  const noFallback = matchPaymentMethod(unknownCard!, {
    accounts,
    cards: [{ id: 'c3', name: '신한 체크', cardNumberMasked: null, isActive: true }] as never,
  });
  eq('모르는 카드사는 카드를 비운다', noFallback.cardId, 'null');
  eq('모르는 카드사는 통장으로 내려가지 않는다', noFallback.accountId, 'null');

  eq(
    '지난 거래의 분류를 이어 쓴다',
    guessCategoryId('스타벅스강남2호점', [
      { merchant: '스타벅스강남2호점', description: '커피', categoryId: 'cat-cafe' },
    ]),
    'cat-cafe',
  );
  eq(
    '모르는 가맹점은 비워 둔다',
    guessCategoryId('처음가는가게', [
      { merchant: '스타벅스강남2호점', description: '커피', categoryId: 'cat-cafe' },
    ]),
    'null',
  );
}

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
