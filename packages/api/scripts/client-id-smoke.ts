/**
 * 기기가 만든 id 검사. 데이터베이스에 닿지 않는다.
 *
 * 실행: cd packages/api && npx ts-node scripts/client-id-smoke.ts
 *
 * 이 id 는 오프라인 쓰기의 기반이다. 형식이 흔들리면 서버가 거절하고, 시각 순서가
 * 어긋나면 인덱스가 조각나고, 겹치면 남의 거래를 덮어쓴다. 그래서 세 가지를 본다.
 *
 *   1. UUIDv7 규격 (버전·변형 비트, 앞 48비트의 시각)
 *   2. 시각이 다르면 문자열 순서도 그대로 따라간다
 *   3. 서버가 받아들이는 형식과 거절하는 형식
 */
import {
  hasRandomSource,
  idTimestamp,
  isClientId,
  newId,
  setRandomBytes,
  withNewId,
} from '@money/types';
import { randomFillSync } from 'crypto';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}
function throws(label: string, fn: () => unknown) {
  try {
    fn();
    fail += 1;
    console.log(`FAIL  ${label} (던지지 않았다)`);
  } catch {
    console.log(`PASS  ${label} (던졌다)`);
  }
}

// 노드에는 globalThis.crypto 가 있지만, 앱처럼 밖에서 넣는 경로도 함께 본다.
setRandomBytes((byteCount) => randomFillSync(new Uint8Array(byteCount)));
eq('난수원이 있다', hasRandomSource(), true);

// ── 규격 ──
const id = newId();
eq('UUID 형식', isClientId(id), true);
eq('길이', id.length, 36);
eq('버전 자리가 7', id[14], '7');
eq('변형 자리는 8·9·a·b 중 하나', '89ab'.includes(id[19]), true);

const when = 1_767_225_600_000; // 2026-01-01T00:00:00Z
eq('앞 48비트에 시각이 담긴다', idTimestamp(newId(when)), when);
eq('시각을 넣지 않으면 지금', Math.abs((idTimestamp(newId()) ?? 0) - Date.now()) < 2000, true);

// ── 순서 ──
const early = newId(when);
const later = newId(when + 1);
eq('시각이 늦으면 문자열도 뒤에 온다', early < later, true);
eq('한참 뒤도 그대로', newId(when) < newId(when + 86_400_000), true);

// ── 겹치지 않는다 ──
const many = new Set<string>();
for (let i = 0; i < 5000; i += 1) many.add(newId(when));
eq('같은 밀리초에 5,000개를 만들어도 모두 다르다', many.size, 5000);

// ── 서버가 받아들이는 형식 ──
eq('서버가 만든 cuid 는 기기 id 가 아니다', isClientId('cmtipz71n000i6fxrurwwyuhv'), false);
eq('빈 문자열', isClientId(''), false);
eq('숫자', isClientId(12345), false);
eq('null', isClientId(null), false);
eq('하이픈이 빠진 값', isClientId(id.replace(/-/g, '')), false);
eq('SQL 조각', isClientId("' OR 1=1 --"), false);
eq('대문자도 받는다', isClientId(id.toUpperCase()), true);
eq('uuid4 도 형식으로는 받는다',
  isClientId('9f1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d'), true);
eq('버전 0 은 거절', isClientId('9f1b2c3d-4e5f-0a7b-8c9d-0e1f2a3b4c5d'), false);
eq('변형 비트가 틀리면 거절', isClientId('9f1b2c3d-4e5f-7a7b-0c9d-0e1f2a3b4c5d'), false);

eq('v7 이 아니면 시각을 읽지 않는다',
  idTimestamp('9f1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d'), null);

// ── 만드는 요청에 id 를 채우는 규칙 ──
// (apiClient 의 생성 메서드가 이 함수를 그대로 쓴다)
const filled = withNewId({ name: '김철수' });
eq('id 가 없으면 채운다', isClientId(filled.id), true);
eq('나머지 값은 그대로', filled.name, '김철수');

const mine = '01a05d52-ff4a-7906-a68d-63b0442e2365';
eq('이미 있으면 덮어쓰지 않는다', withNewId({ id: mine, name: 'x' }).id, mine);
eq('두 번 불러도 서로 다른 id',
  withNewId({ name: 'a' }).id === withNewId({ name: 'a' }).id, false);

// ── 난수원이 없는 기기 ──
setRandomBytes(null);
eq('난수원이 없다고 답한다', hasRandomSource(), false);
throws('난수원이 없으면 id 를 만들지 않는다 (약한 난수로 대신하지 않는다)', () => newId());
eq('그 기기에서는 id 를 채우지 않는다 (서버가 만든다)',
  withNewId({ name: '김철수' }).id, undefined);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
