/**
 * 트랜잭션을 한 줄로 세우는 규칙 (`src/data/tx-lock.ts`).
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/tx-lock-smoke.ts
 *
 * 눈으로는 보이지 않는 자리다. 동기화는 세 갈래에서 시작한다 -- 프로젝트를 고를 때,
 * 서버가 알림을 보낼 때, 거래를 적자마자. 셋이 겹치면 같은 연결에 트랜잭션이 겹쳐
 * 열린다. 전에는 겹친 것을 앞 트랜잭션 **안에서** 그냥 돌렸는데, 그러면 앞이 되돌아갈 때
 * 뒤가 적은 것까지 함께 사라진다. 사본은 비었는데 커서만 올라가 있는 상태가 그렇게
 * 만들어지고, 그 뒤로 기기는 받지 못한 변경을 "이미 본 번호"로 여겨 영영 다시 받지 않는다.
 *
 * 그래서 셋을 못 박는다.
 *   1. 겹쳐 부른 둘이 서로 섞이지 않는다.
 *   2. 앞이 되돌아가도 뒤가 적은 것은 남는다.
 *   3. 앞이 실패해도 뒤는 돈다.
 */

import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
  const driver = nodeSqliteDriver();
  await driver.run(`CREATE TABLE t (id TEXT PRIMARY KEY)`);

  // ── 1. 섞이지 않는다 ──
  const order: string[] = [];
  const slow = driver.transaction(async () => {
    order.push('A 시작');
    await tick();
    await tick();
    order.push('A 끝');
  });
  const quick = driver.transaction(async () => {
    order.push('B 시작');
    await tick();
    order.push('B 끝');
  });
  await Promise.all([slow, quick]);
  eq('앞엣것이 끝난 뒤에 뒤엣것이 시작한다', order.join(' > '), 'A 시작 > A 끝 > B 시작 > B 끝');

  // ── 2. 앞이 되돌아가도 뒤는 남는다 ──
  const doomed = driver
    .transaction(async () => {
      await driver.run(`INSERT INTO t (id) VALUES ('사라질 것')`);
      await tick();
      throw new Error('일부러 실패');
    })
    .catch(() => 'rolled back');
  const survivor = driver.transaction(async () => {
    await driver.run(`INSERT INTO t (id) VALUES ('남을 것')`);
  });

  eq('앞엣것은 되돌아간다', await doomed, 'rolled back');
  await survivor;

  const rows = await driver.all<{ id: string }>(`SELECT id FROM t ORDER BY id`);
  eq('되돌아간 것은 없다', rows.some((row) => row.id === '사라질 것'), false);
  eq('뒤엣것은 남는다', rows.some((row) => row.id === '남을 것'), true);

  // ── 3. 실패가 줄을 막지 않는다 ──
  await driver.transaction(async () => {
    await driver.run(`INSERT INTO t (id) VALUES ('그다음 것')`);
  });
  eq('그다음 트랜잭션도 돈다',
    (await driver.all<{ n: number }>(`SELECT COUNT(*) AS n FROM t`))[0].n, 2);

  driver.close();
  console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
