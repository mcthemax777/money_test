/**
 * 앱·웹 버전 비교 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/app-version-smoke.ts
 *
 * 강제 업데이트가 틀리면 멀쩡한 사람이 앱을 못 쓰거나, 막아야 할 판이 새 API 를 부른다.
 * 글자 비교("1.10" < "1.9")가 가장 흔한 실수라 그 사례를 먼저 둔다.
 */
import { compareVersions, isVersion, updateLevelOf } from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

console.log('── 비교 ──');
eq('1.10.0 은 1.9.0 보다 높다', compareVersions('1.10.0', '1.9.0') > 0, true);
eq('1.2 와 1.2.0 은 같다', compareVersions('1.2', '1.2.0'), 0);
eq('1.2.0 은 1.2.1 보다 낮다', compareVersions('1.2.0', '1.2.1') < 0, true);
eq('웹 빌드 번호도 시각 차례', compareVersions('20260929.090000', '20260929.153000') < 0, true);

console.log('\n── 모양 ──');
eq('1.2.0', isVersion('1.2.0'), true);
eq('웹 빌드 번호', isVersion('20260929.153000'), true);
eq('v 가 붙으면 아니다', isVersion('v1.2.0'), false);
eq('빈 글자는 아니다', isVersion(''), false);

console.log('\n── 처지 ──');
const policy = { minVersion: '1.2.0', latestVersion: '1.4.0' };
eq('최소보다 낮으면 강제', updateLevelOf('1.1.9', policy), 'force');
eq('최소와 같으면 강제가 아니고 권유', updateLevelOf('1.2.0', policy), 'recommend');
eq('권유와 같으면 없음', updateLevelOf('1.4.0', policy), 'null');
eq('더 높으면 없음', updateLevelOf('1.5.0', policy), 'null');
eq('정책이 비면 없음', updateLevelOf('1.0.0', { minVersion: null, latestVersion: null }), 'null');
eq('버전을 모르면 막지 않는다', updateLevelOf(null, policy), 'null');
eq('정책 값이 틀린 모양이면 그 단계는 없다', updateLevelOf('1.0.0', { minVersion: 'abc', latestVersion: null }), 'null');

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
