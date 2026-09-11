/**
 * 카드 정산의 셈.
 *
 * 남은 대금이 얼마인지, 적은 금액이 그 잔액을 얼마나 넘는지를 정한다. 웹의 정산 판과
 * 앱의 카드 상세가 같은 값을 보여 줘야 해서 여기 둔다 -- 한쪽에만 두면 같은 카드의
 * "남은 대금"이 화면마다 다른 부호로 보이는 날이 온다.
 */
import type { CardTransferDirection } from '@money/types';

import { toNumber } from './money';

/**
 * 남은 대금. 음수면 카드사가 갚을 돈(환불 예정)이다.
 *
 * 서버는 이 값을 카드의 현재 마감일로 그때그때 계산한다. 청구서를 저장하지 않으므로
 * 마감일을 바꾸면 과거 주기까지 곧바로 다시 셈해진다.
 */
export function outstandingOf(usage: { outstanding: string } | null | undefined): number {
  return toNumber(usage?.outstanding);
}

/**
 * 적은 금액이 남은 쪽 잔액을 넘는 정도. 넘지 않으면 0이다.
 *
 * 막지 않고 알리기만 한다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로 입금해
 * 주는 방식이 있어서, 그 사이 남은 대금은 음수(환불 예정)로 남아야 한다.
 */
export function overTransferOf(input: {
  amount: string | number;
  direction: CardTransferDirection;
  outstanding: number;
}): number {
  const amount = toNumber(input.amount);
  if (!amount) return 0;

  // 환불은 "카드사가 갚을 돈"을 줄이는 쪽이라 남은 대금의 반대편을 본다.
  const room = input.direction === 'refund' ? -input.outstanding : input.outstanding;
  return amount > room ? amount - Math.max(room, 0) : 0;
}
