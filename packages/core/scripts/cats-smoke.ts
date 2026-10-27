/**
 * 고양이 엠블럼의 표와 규칙 (2026-10-28).
 *
 * 품종·미션의 사전 열쇠가 세 언어에 다 있는지, 시험용 그림이 품종마다 있는지, 걸음이 줄 밖으로 나가지 않는지,
 * 고르지 않았을 때 데리고 다니는 고양이(먼저 온 차례)를 본다. 사전 열쇠는 `cats.breed.${id}` 처럼 만들어 쓰므로
 * 타입 검사가 빠진 열쇠를 잡지 못한다 -- 여기서 잡는다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/cats-smoke.ts
 */
import { CAT_BREEDS, CAT_PARADE_MAX, defaultParade } from '@money/types';

import { CAT_LOOKS, catMissionKey, catNameKey, nextCatAction } from '../src/lib/cats';
import { en } from '../src/lib/i18n/messages/en';
import { ja } from '../src/lib/i18n/messages/ja';
import { ko } from '../src/lib/i18n/messages/ko';

let fail = 0;
function check(label: string, ok: boolean) {
  if (!ok) {
    fail++;
    console.log(`✗ ${label}`);
  }
}

const dictionaries: Array<[string, Record<string, string>]> = [
  ['ko', ko as Record<string, string>],
  ['en', en as Record<string, string>],
  ['ja', ja as Record<string, string>],
];
for (const breed of CAT_BREEDS) {
  for (const [name, dictionary] of dictionaries) {
    check(`${name} ${catNameKey(breed.id)}`, Boolean(dictionary[catNameKey(breed.id)]));
    check(`${name} ${catMissionKey(breed.mission)}`, Boolean(dictionary[catMissionKey(breed.mission)]));
  }
  check(`그림 ${breed.id}`, Boolean(CAT_LOOKS[breed.id]));
}
check('45종', CAT_BREEDS.length === 45);
check('기본 고양이는 숨기지 않는다', CAT_BREEDS.find((breed) => breed.mission === 'start')?.hidden === false);

// 걸음: 1,000번 골라도 0 ~ 폭 안이다.
let x = 100;
for (let index = 0; index < 1000; index++) {
  const action = nextCatAction(x, 300);
  if (action.kind === 'walk') {
    check(`걸음이 줄 안 (${action.toX})`, action.toX >= 0 && action.toX <= 300);
    check('걸음 시간 > 0', action.ms > 0);
    x = action.toX;
  }
}
check('폭이 없으면 걷지 않는다', nextCatAction(0, 0).kind !== 'walk');

// 고르지 않았을 때: 먼저 온 차례, 같은 때면 도감 차례, 최대 다섯.
const parade = defaultParade([
  { breedId: 'toybob', grantedAt: '2026-10-01T00:00:00.000Z' },
  ...CAT_BREEDS.slice(0, 8).map((breed) => ({ breedId: breed.id, grantedAt: '2026-10-02T00:00:00.000Z' })),
]);
check('먼저 온 고양이가 앞', parade[0] === 'toybob');
check('같은 때면 도감 차례', parade[1] === CAT_BREEDS[0].id && parade[2] === CAT_BREEDS[1].id);
check('최대 다섯', parade.length === CAT_PARADE_MAX);

console.log(fail === 0 ? '✓ cats-smoke 통과' : `✗ ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
