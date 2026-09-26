/**
 * 서버에 닿지 못했을 때 화면이 적는 문장. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/offline-message-smoke.ts
 *
 * 사본과 아웃박스를 지나지 않는 조작(프로젝트·멤버, 반복 등록, 합치기, 잔액 맞추기 등)은
 * 오프라인이면 그냥 실패한다. 그때 "저장하지 못했습니다"라고 적으면 고장으로 읽혀서,
 * `apiErrorMessage` 한 자리에서 "연결되면 할 수 있습니다"로 가른다. 이 검사가 지키는 것:
 *
 *   1. 닿지 못한 오류(axios 가 response 를 비운 것)는 화면의 기본 문구 대신 오프라인 문구다.
 *   2. 읽기는 `offlineKey` 로 "볼 수 있습니다"를 고를 수 있다.
 *   3. 서버가 거절한 오류(코드가 있든 없든)는 예전 그대로다 -- 거절을 오프라인으로
 *      말하면 사용자는 연결만 기다리고 고칠 것을 고치지 않는다.
 */
import { apiErrorMessage, codedError } from '../src/lib/api-error';
import { translate } from '../src/lib/i18n';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** axios 가 서버에 닿지 못했을 때 던지는 모양. response 가 없다. */
const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const timeoutError = Object.assign(new Error('timeout of 10000ms exceeded'), {
  code: 'ECONNABORTED',
});
/** 서버가 코드 없이 거절한 것. response 가 있다. */
const rejected = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: {} },
});

for (const locale of ['ko', 'en', 'ja'] as const) {
  const onlyOnline = translate(locale, 'online.onlyOnline');
  const viewOnlyOnline = translate(locale, 'online.viewOnlyOnline');
  const fallback = translate(locale, 'projects.updateFailed');

  // ── 1. 쓰기: 닿지 못하면 오프라인 문구 ──
  eq(`${locale}: 네트워크 오류는 오프라인 문구`,
    apiErrorMessage(locale, networkError, 'projects.updateFailed'), onlyOnline);
  eq(`${locale}: 시간 초과도 오프라인 문구`,
    apiErrorMessage(locale, timeoutError, 'projects.updateFailed'), onlyOnline);

  // ── 2. 읽기: 부르는 쪽이 고른 문구 ──
  eq(`${locale}: 읽기는 "볼 수 있습니다"`,
    apiErrorMessage(locale, networkError, 'inbox.loadFailed', 'online.viewOnlyOnline'),
    viewOnlyOnline);
  eq(`${locale}: 잔액만 막히면 나머지는 저장됐다고 말한다`,
    apiErrorMessage(locale, networkError, 'account.addFailed', 'account.balanceOnlyOnline'),
    translate(locale, 'account.balanceOnlyOnline'));

  // ── 3. 거절은 예전 그대로 ──
  eq(`${locale}: 코드 없는 거절은 화면의 기본 문구`,
    apiErrorMessage(locale, rejected, 'projects.updateFailed'), fallback);
  eq(`${locale}: 코드 있는 거절은 코드의 문구`,
    apiErrorMessage(locale, codedError('PERSON_HAS_ENTRIES'), 'assets.removeFailed'),
    translate(locale, 'error.PERSON_HAS_ENTRIES'));
}

// 오프라인 문구가 기본 문구와 같으면 위 검사가 아무것도 증명하지 못한다.
eq('두 문구가 서로 다르다',
  translate('ko', 'online.onlyOnline') !== translate('ko', 'projects.updateFailed'), true);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
