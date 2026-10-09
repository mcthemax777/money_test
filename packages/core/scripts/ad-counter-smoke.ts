/**
 * 거래 저장 열 번에 전면광고 한 번 (2026-10-09).
 *
 * 무료 가계부에서만 세고, 광고를 받아 두지 못했으면 다음 저장으로 미루며, 실제로 뜬 뒤에만
 * 처음부터 다시 센다. 광고를 꽂지 않은 플랫폼(웹)은 세지 않는다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/ad-counter-smoke.ts
 */
import { INTERSTITIAL_EVERY, noteEntrySaved, setInterstitialPresenter } from '../src/lib/ads';
import { useProject, type Project } from '../src/store/project';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const project = (plan: Project['plan']): Project => ({ id: 'p1', name: '시험', role: 'owner', plan });
function select(plan: Project['plan']) {
  useProject.setState({ projects: [project(plan)], selectedProjectId: 'p1' });
}

let ready = true;
let shows = 0;
let showSucceeds = true;
const presenter = {
  isReady: () => ready,
  show: async () => {
    shows += 1;
    return showSucceeds;
  },
};

async function save(times: number) {
  for (let i = 0; i < times; i += 1) {
    noteEntrySaved();
    await tick();
  }
}

(async () => {
  select({ kind: 'free', endsAt: null });

  // 꽂지 않았으면 세지 않는다 (웹).
  await save(INTERSTITIAL_EVERY * 2);
  setInterstitialPresenter(presenter);
  await save(INTERSTITIAL_EVERY - 1);
  eq('꽂기 전 저장은 세지 않는다 (아홉 번째까지 안 뜬다)', shows, 0);
  await save(1);
  eq('열 번째에 뜬다', shows, 1);
  await save(INTERSTITIAL_EVERY - 1);
  eq('뜬 뒤로는 처음부터 센다', shows, 1);
  await save(1);
  eq('다시 열 번째에 뜬다', shows, 2);

  // 받아 두지 못했으면 미룬다.
  ready = false;
  await save(INTERSTITIAL_EVERY + 3);
  eq('준비가 안 되면 띄우지 않는다', shows, 2);
  ready = true;
  await save(1);
  eq('준비되면 다음 저장에서 바로 뜬다', shows, 3);

  // 띄우기에 실패하면 0 으로 돌리지 않는다.
  showSucceeds = false;
  await save(INTERSTITIAL_EVERY);
  eq('실패한 시도도 부른다', shows, 4);
  showSucceeds = true;
  await save(1);
  eq('실패했으면 다음 저장에서 다시 시도한다', shows, 5);

  // 유료 가계부는 세지 않는다.
  select({ kind: 'period', endsAt: '2099-01-01T00:00:00.000Z' });
  await save(INTERSTITIAL_EVERY * 3);
  eq('기간제 가계부에서는 뜨지 않는다', shows, 5);
  select({ kind: 'lifetime', endsAt: null });
  await save(INTERSTITIAL_EVERY * 3);
  eq('평생 가계부에서는 뜨지 않는다', shows, 5);

  // 이용권을 모르는 목록(옛 서버)은 무료로 본다.
  select(undefined);
  await save(INTERSTITIAL_EVERY);
  eq('이용권을 모르면 무료로 본다', shows, 6);

  // 프로젝트를 고르지 않았으면 띄우지 않는다.
  useProject.setState({ projects: [], selectedProjectId: null });
  await save(INTERSTITIAL_EVERY * 2);
  eq('가계부가 없으면 뜨지 않는다', shows, 6);

  console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
