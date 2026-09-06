/**
 * 여러 거래의 태그를 한 번에 손보는 창의 규칙. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/tag-pick-smoke.ts
 *
 * 눌러서 알기 어려운 것이 하나 있어 검사로 못 박는다. **일부만 붙은 태그를 두 번
 * 누르면 어디로 가는가.** 꺼짐으로 보내면 빗금만 사라지고 확인해도 아무 일이 없어,
 * 뗀 것으로 읽은 사용자와 결과가 어긋난다. 그래서 되돌리는 한 번은 처음의 "일부"다.
 *
 * 나머지 둘(전부 붙은 태그·아무도 안 붙은 태그)은 켜짐과 꺼짐을 오간다. 셋을 함께
 * 봐야 "일부만 특별하다"가 드러난다.
 */
import {
  tagPickResult,
  tagPickState,
  toggleTagPick,
  type TagPickChanges,
} from '../src/lib/tag-pick';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 고른 두 건 중 하나에만 "여행"이 붙었고, "경조사"는 둘 다, "식비"는 아무도 없다. */
const TAGS = ['g-trip', 'g-event', 'g-food'];
const COMMON = ['g-event'];
const PARTIAL = ['g-trip'];

const stateOf = (tagId: string, changed: TagPickChanges) =>
  tagPickState(tagId, changed, COMMON, PARTIAL);
const press = (tagId: string, changed: TagPickChanges) =>
  toggleTagPick(tagId, changed, COMMON, PARTIAL);
const result = (changed: TagPickChanges) => tagPickResult(TAGS, changed, COMMON);

// ── 1. 열었을 때 ──
let changed: TagPickChanges = {};
eq('전부 가진 태그는 켜짐', stateOf('g-event', changed), 'on');
eq('일부만 가진 태그는 일부', stateOf('g-trip', changed), 'partial');
eq('아무도 없는 태그는 꺼짐', stateOf('g-food', changed), 'off');
eq('손대지 않으면 더할 것도', result(changed).addTagIds.join(','), '');
eq('손대지 않으면 뗄 것도 없다', result(changed).removeTagIds.join(','), '');

// ── 2. 일부는 켜짐과 일부 사이만 오간다 ──
changed = press('g-trip', changed);
eq('일부를 한 번 누르면 켜짐', stateOf('g-trip', changed), 'on');
eq('그때 전부에 붙인다', result(changed).addTagIds.join(','), 'g-trip');

changed = press('g-trip', changed);
eq('다시 누르면 꺼짐이 아니라 일부', stateOf('g-trip', changed), 'partial');
eq('되돌렸으니 더할 것이 없다', result(changed).addTagIds.join(','), '');
eq('뗄 것도 없다 (이 창은 일부를 떼지 않는다)', result(changed).removeTagIds.join(','), '');

changed = press('g-trip', changed);
eq('세 번째는 다시 켜짐', stateOf('g-trip', changed), 'on');

// ── 3. 전부 가진 태그는 켜짐과 꺼짐을 오간다 ──
let common: TagPickChanges = press('g-event', {});
eq('켜진 것을 누르면 꺼짐', stateOf('g-event', common), 'off');
eq('그때 전부에서 뗀다', result(common).removeTagIds.join(','), 'g-event');
common = press('g-event', common);
eq('다시 누르면 켜짐', stateOf('g-event', common), 'on');
eq('처음으로 돌아왔으니 뗄 것이 없다', result(common).removeTagIds.join(','), '');
eq('이미 붙어 있으니 더할 것도 없다', result(common).addTagIds.join(','), '');

// ── 4. 아무도 없는 태그도 켜짐과 꺼짐을 오간다 ──
let none: TagPickChanges = press('g-food', {});
eq('꺼진 것을 누르면 켜짐', stateOf('g-food', none), 'on');
eq('그때 전부에 붙인다', result(none).addTagIds.join(','), 'g-food');
none = press('g-food', none);
eq('다시 누르면 꺼짐', stateOf('g-food', none), 'off');
eq('처음으로 돌아왔으니 더할 것이 없다', result(none).addTagIds.join(','), '');

// ── 5. 서로 섞이지 않는다 ──
const mixed = press('g-food', press('g-trip', press('g-event', {})));
eq('셋을 한 번씩 눌러도 더할 것은 둘',
  result(mixed).addTagIds.join(','), 'g-trip,g-food');
eq('뗄 것은 하나', result(mixed).removeTagIds.join(','), 'g-event');

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
