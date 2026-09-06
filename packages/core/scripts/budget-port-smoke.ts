/**
 * 웹이 예산을 고칠 때 지나가는 길. 실제 서버에 붙어 본다.
 *
 * 실행: 서버를 띄우고 토큰을 만든 뒤 (memory 의 local_api_testing)
 *   cd packages/core && API_BASE=http://localhost:3999 TOKEN=<액세스 토큰> \
 *     PROJECT_ID=<프로젝트 id> \
 *     node -r ../api/node_modules/ts-node/register/transpile-only scripts/budget-port-smoke.ts
 *
 * 화면을 창구(`settingsWritePort`)로 옮기면서 조용히 어긋날 수 있는 것이 셋 있었다.
 * 셋 다 타입 검사로는 잡히지 않고, 화면에서도 "저장은 됐는데 값이 이상하다"로만 보인다.
 *
 *   1. **프로젝트.** 창구에 projectId 를 넘기지 않으면 서버가 그 사용자의 **기본**
 *      프로젝트에 예산을 만든다. 프로젝트를 하나만 쓰는 개발 기계에서는 드러나지 않는다.
 *   2. **어느 달의 규칙인가.** 예산은 구간으로 나뉠 수 있어 한 분류에 규칙이 여럿일 수
 *      있다. yearMonth 를 잃으면 8월 화면에서 고친 금액이 9월 규칙에 적힌다.
 *   3. **모든 달 갈아 끼우기.** 창구는 applyMode 를 'all' 로 보낸다. 예전 화면은 아예
 *      보내지 않았는데, 서버가 둘을 같게 다루는지는 서버 코드를 봐야만 알 수 있다.
 */
import { apiClient } from '../src/lib/api-client';
import { setTokenStorage } from '../src/lib/auth-tokens';
import { httpSettingsWritePort } from '../src/data/settings-write-port';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const BASE = process.env.API_BASE?.trim() || 'http://localhost:3999';
const TOKEN = process.env.TOKEN?.trim();
const PROJECT_ID = process.env.PROJECT_ID?.trim();

(async () => {
  if (!TOKEN || !PROJECT_ID) {
    console.log('\nTOKEN 과 PROJECT_ID 가 없어 건너뜁니다.');
    console.log('  TOKEN=<액세스 토큰> PROJECT_ID=<프로젝트 id> node ... scripts/budget-port-smoke.ts');
    process.exit(0);
  }

  // 브라우저의 저장소를 흉내 낸다. 창구는 apiClient 를, apiClient 는 이것을 본다.
  setTokenStorage({
    get: (name) => (name === 'accessToken' ? TOKEN : undefined),
    set: () => undefined,
    remove: () => undefined,
  });
  apiClient.setBaseUrl(BASE);

  /** 이 검사가 쓰는 분류. 없으면 만든다. */
  const name = `예산창구검사-${Date.now().toString(36)}`;
  const category = await apiClient.createCategory({
    name,
    type: 'expense',
    projectId: PROJECT_ID,
  });

  try {
    // ── 1. 만들기 ──
    await httpSettingsWritePort.setBudget({
      categoryId: category.id,
      monthlyAmount: '150000',
      yearMonth: '2026-08',
      projectId: PROJECT_ID,
    });

    const august = await apiClient.getBudgetForMonth(2026, 8, PROJECT_ID);
    const madeRow = august.find((row) => row.categoryId === category.id);
    eq('창구로 만든 예산이 그 달에 보인다', madeRow?.monthlyAmount, '150000');
    eq('넘긴 프로젝트에 만들어진다', Boolean(madeRow), true);

    // ── 2. 금액 바꾸기 (모든 달) ──
    const budgetId = String(madeRow?.budgetId);
    await httpSettingsWritePort.setBudget({ id: budgetId, monthlyAmount: '200000' });

    const changed = (await apiClient.getBudgetForMonth(2026, 8, PROJECT_ID)).find(
      (row) => row.categoryId === category.id,
    );
    eq('금액이 바뀐다', changed?.monthlyAmount, '200000');

    const later = (await apiClient.getBudgetForMonth(2026, 11, PROJECT_ID)).find(
      (row) => row.categoryId === category.id,
    );
    eq("'모든 달'이라 뒤의 달도 같다", later?.monthlyAmount, '200000');

    // ── 3. 그 달만 조정하기 ──
    await httpSettingsWritePort.setBudgetOverride({
      budgetId,
      year: 2026,
      month: 8,
      amount: '30000',
    });

    const overridden = (await apiClient.getBudgetForMonth(2026, 8, PROJECT_ID)).find(
      (row) => row.categoryId === category.id,
    );
    eq('그 달만 조정된다', overridden?.monthlyAmount, '30000');
    eq('규칙 금액은 그대로다', overridden?.ruleAmount, '200000');
    eq('다른 달은 규칙 금액이다',
      (await apiClient.getBudgetForMonth(2026, 11, PROJECT_ID)).find(
        (row) => row.categoryId === category.id,
      )?.monthlyAmount,
      '200000');

    // ── 4. 조정 걷어내기 (금액을 비운다) ──
    await httpSettingsWritePort.setBudgetOverride({
      id: String(overridden?.overrideId),
      budgetId,
      year: 2026,
      month: 8,
      amount: null,
    });

    eq('조정을 걷어내면 규칙 금액으로 돌아간다',
      (await apiClient.getBudgetForMonth(2026, 8, PROJECT_ID)).find(
        (row) => row.categoryId === category.id,
      )?.monthlyAmount,
      '200000');
  } finally {
    /*
     * 검사가 만든 분류를 감춘다.
     *
     * 서버의 지우기는 숨기기(isActive=false)라 행은 남는다 -- 지난 거래에 붙은 이름을
     * 잃지 않으려는 규칙이다. 그래서 이 검사를 여러 번 돌리면 감춰진 분류가 쌓인다.
     * 이름에 시각을 넣어 두었으니 필요하면 `예산창구검사-%` 로 찾아 지우면 된다.
     */
    await apiClient.deleteCategory(category.id).catch(() => undefined);
  }

  console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
