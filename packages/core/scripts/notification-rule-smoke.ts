/**
 * 앱별 알림 규칙 검사 (배우기 · 칸 짐작 · 대 보기 · 읽기).
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/notification-rule-smoke.ts
 */
import { notificationRuleProblem, type NotificationRule } from '@money/types';

import {
  collectValues,
  groupSamples,
  learnRule,
  literalToField,
  matchSegments,
  parseNotificationWithRules,
} from '../src/lib/notification-rule';
import { notificationText, parseNotification, hasMoneyMark } from '../src/lib/draft-parse';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)})`);
}

const NOW = new Date(2026, 8, 8, 14, 30, 0).getTime();
const PKG = 'com.kbcard.cxh.appcard';

const kb = (merchant: string, amount: string, when: string, total: string) =>
  notificationText({
    title: 'KB국민카드',
    text: `KB국민카드1234승인\n홍*동님\n${amount}원 일시불\n${when}\n${merchant}\n누적${total}원`,
  });

const samples = [
  kb('스타벅스 성수점', '4,500', '09/08 14:23', '1,234,567'),
  kb('GS25 역삼', '12,000', '09/07 09:01', '1,230,067'),
  kb('교보문고', '15,800', '09/06 20:45', '1,218,067'),
];

// 1. 배우기 -------------------------------------------------------------
const learned = learnRule(samples)!;
const shape = learned.segments.map((s) => ('literal' in s ? s.literal : `{${s.field}}`)).join(' | ');
console.log('틀:', shape);
eq('배운 표본 모두 맞음', learned.matched, 3);
eq('칸 이름', learned.segments.filter((s) => 'field' in s).map((s) => (s as { field: string }).field), [
  'cardTail',
  'amount',
  'datetime',
  'merchant',
  'ignore',
]);
eq('통화', learned.currency, 'KRW');
eq('갈래', learned.kind, 'expense');
eq('규칙 검사 통과', notificationRuleProblem(learned.segments), null);

// 2. 규칙으로 읽기 ------------------------------------------------------
const rule: NotificationRule = {
  id: 'r1',
  packageName: PKG,
  name: 'KB 승인',
  segments: learned.segments,
  kind: learned.kind,
  currency: learned.currency,
  enabled: true,
  note: null,
  learnedFrom: 3,
  createdAt: '',
  updatedAt: '',
};
const fresh = {
  packageName: PKG,
  title: 'KB국민카드',
  text: 'KB국민카드1234승인\n홍*동님\n7,700원 일시불\n09/08 12:10\n원할머니보쌈 강남\n누적1,241,267원',
  postedAt: NOW,
};
const read = parseNotificationWithRules(fresh, [rule])!;
eq('규칙 이름', read.parser, 'rule:r1');
eq('금액', read.amount, '7700');
eq('가맹점 (칸 사이 글 "원"을 품은 이름)', read.merchant, '원할머니보쌈 강남');
eq('카드 끝자리', read.cardTail, '1234');
eq('시각', read.occurredAt?.slice(0, 16), new Date(2026, 8, 8, 12, 10).toISOString().slice(0, 16));

// 다른 앱에는 대지 않는다.
eq('다른 앱은 기존 규칙', parseNotificationWithRules({ ...fresh, packageName: 'other' }, [rule])?.parser, 'notification');
// 꺼 둔 규칙은 대지 않는다.
eq('꺼 둔 규칙', parseNotificationWithRules(fresh, [{ ...rule, enabled: false }])?.parser, 'app:kbcard');

// 기존 규칙이 모르는 낱말도 규칙이 있으면 읽는다.
const odd = [
  notificationText({ title: '페이', text: '스타벅스에서 4,500원 쓰셨어요' }),
  notificationText({ title: '페이', text: 'GS25에서 12,000원 쓰셨어요' }),
];
const oddRule = learnRule(odd)!;
console.log('틀:', oddRule.segments.map((s) => ('literal' in s ? s.literal : `{${s.field}}`)).join(' | '));
const oddInput = { packageName: 'pay', title: '페이', text: '교보문고에서 15,800원 쓰셨어요', postedAt: NOW };
eq('기존 규칙은 못 읽음', parseNotification(oddInput), null);
const oddRead = parseNotificationWithRules(oddInput, [{ ...rule, id: 'r2', packageName: 'pay', segments: oddRule.segments, kind: 'expense' }]);
eq('규칙은 읽음 (금액)', oddRead?.amount, '15800');
eq('규칙은 읽음 (가맹점)', oddRead?.merchant, '교보문고');
eq('돈 표기 있음', hasMoneyMark(oddInput), true);
eq('돈 표기 없음', hasMoneyMark({ title: '채팅', text: '내일 3시에 봐' }), false);

// 3. 대 보기의 경계 -----------------------------------------------------
eq('맨 앞이 어긋나면 안 맞음', matchSegments(learned.segments, `[광고]${samples[0]}`), null);
eq('빈칸 차이·겹친 줄바꿈은 맞음', matchSegments(learned.segments, samples[0].replace(/ /g, '  ').replace(/\n/g, '\n\n')) !== null, true);
eq('줄바꿈이 빠지면 안 맞음', matchSegments(learned.segments, samples[0].replace(/\n/g, ' ')), null);
// 되짚기가 많은 글도 곧 끝난다.
const heavy = [{ literal: 'a' }, { field: 'merchant' as const }, { literal: 'a' }, { field: 'amount' as const }, { literal: 'b' }];
const start = Date.now();
eq('되짚기 상한', matchSegments(heavy, 'a'.repeat(3000)), null);
eq('상한 안에서 끝남 (<200ms)', Date.now() - start < 200, true);

// 4. 글 토막을 칸으로 --------------------------------------------------
const single = learnRule([samples[0]])!;
const merchantIndex = single.segments.findIndex((s) => 'literal' in s && s.literal.includes('스타벅스'));
eq('표본 하나면 가맹점이 글로 남음', merchantIndex >= 0, true);
const converted = literalToField(single.segments, merchantIndex, 'merchant');
eq('바꾼 뒤 칸 둘이 붙지 않음', notificationRuleProblem(converted), null);
eq(
  '바꾼 칸으로 읽힘',
  collectValues(converted, [samples[0]]).values.flat().includes('스타벅스 성수점'),
  true,
);

// 5. 서식 묶기 ---------------------------------------------------------
const cancel = notificationText({ title: 'KB국민카드', text: 'KB국민카드1234 승인취소 홍*동님 4,500원 스타벅스' });
eq('승인과 입금은 다른 묶음', groupSamples([...samples, cancel, ...odd]).map((g) => g.length), [3, 2, 1]);

// 6. 규칙 검사 ---------------------------------------------------------
eq('금액 칸 없음', notificationRuleProblem([{ literal: 'a' }, { field: 'merchant' }]), '금액 칸이 꼭 하나 있어야 합니다.');
eq(
  '칸 둘이 붙음',
  notificationRuleProblem([{ field: 'amount' }, { field: 'merchant' }]),
  '칸 둘이 붙어 있습니다. 사이에 늘 같은 글이 있어야 끊을 수 있습니다.',
);

console.log(fail === 0 ? '\n모두 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
