/**
 * 끊긴 동안 바꾼 프로필(이름·언어·주 시작 요일)을 들고 있다가 연결되면 보내는가.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/pending-profile-smoke.ts
 */
import { apiClient } from '../src/lib/api-client';
import { useAuth } from '../src/store/auth';
import { markOffline } from '../src/store/connectivity';
import {
  flushPendingProfile,
  pendingProfileFields,
  saveProfile,
  usePendingProfile,
} from '../src/store/pending-profile';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const sent: unknown[] = [];
let online = false;
(apiClient as unknown as { updateProfile: (patch: unknown) => Promise<unknown> }).updateProfile =
  async (patch) => {
    if (!online) throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    sent.push(patch);
    return {};
  };

(async () => {
  useAuth.setState({ user: { id: 'u1', name: '옛 이름' } as never });

  eq('끊겨 있으면 들고 있다', await saveProfile({ locale: 'en' }), 'queued');
  await saveProfile({ weekStart: 1 });
  await saveProfile({ locale: 'ja' });
  eq('같은 칸은 나중 값이 이긴다', JSON.stringify(pendingProfileFields()), '{"locale":"ja","weekStart":1}');
  eq('아직 아무것도 보내지 않았다', sent.length, 0);

  // 연결이 돌아오는 신호 (끊김 -> 닿음)
  online = true;
  markOffline(true);
  markOffline(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  eq('닿으면 한 번에 보낸다', JSON.stringify(sent[0]), '{"locale":"ja","weekStart":1}');
  eq('보낸 뒤에는 비운다', JSON.stringify(pendingProfileFields()), '{}');

  // 다른 계정으로 들어오면 앞 사람의 것은 버린다
  online = false;
  await saveProfile({ name: '새 이름' });
  useAuth.setState({ user: { id: 'u2', name: '다른 사람' } as never });
  online = true;
  await flushPendingProfile();
  eq('다른 계정의 변경은 보내지 않는다', sent.length, 1);
  eq('그리고 버린다', JSON.stringify(usePendingProfile.getState().pending), '{}');

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();
