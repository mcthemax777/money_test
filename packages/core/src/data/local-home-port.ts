/**
 * 홈 화면의 값을 기기 사본에서 만든다.
 *
 * 합계와 순자산, 예산 사용액은 `@money/types` 의 집계 함수가 낸다. 서버도 같은
 * 함수를 쓰므로 같은 사본에서 같은 값이 나온다.
 *
 * 홈 화면이 쓰는 값은 모두 사본에서 난다. 결제수단별 집계와 카드 실적, 투자 계좌의
 * 시가까지 들어왔다.
 *
 * 그래도 서버 창구를 아주 놓지는 않는다. 사본이 낼 수 없는 경우가 남아 있고(설정이
 * 빠진 신용카드), 그때는 서버가 그 사정을 오류로 말해 주는 쪽이 맞다. 값을 지어내지
 * 않는 것이 이 파일의 규칙이다. 0원은 "쓰지 않았다"는 뜻이지 "아직 모른다"가 아니다.
 */

import type { HomeDataPort } from './home-port';
import type { LocalStore } from './local-store';
import { assetReads } from './local-home-assets';
import { budgetReads } from './local-home-budgets';
import { cardReads } from './local-home-cards';
import { createHomeContext, type LocalHomePortOptions } from './local-home-context';
import { entryReads } from './local-home-entries';
import { listReads } from './local-home-lists';
import { reportReads } from './local-home-reports';

export type { LocalHomePortOptions } from './local-home-context';

/**
 * 사본에서 읽는 홈 창구. 갈래(목록·자산·예산·합계·카드·거래)마다 곁 파일 `local-home-*.ts` 에 있고,
 * 여기서는 그것들을 한 창구로 묶는다.
 */
export function createLocalHomePort(store: LocalStore, options: LocalHomePortOptions): HomeDataPort {
  const ctx = createHomeContext(store, options);
  return {
    ...listReads(ctx),
    ...assetReads(ctx),
    ...budgetReads(ctx),
    ...reportReads(ctx),
    ...cardReads(ctx),
    ...entryReads(ctx),
  };
}
