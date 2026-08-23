import { Prisma } from '@prisma/client';

/**
 * 카드를 응답용으로 펴는 규칙.
 *
 * 두 가지를 여기 한 곳에서 보장한다.
 *   1. `cardNumber` 원문은 절대 응답에 실리지 않는다. 뒷 4자리만 남긴 문자열로 바꾼다.
 *   2. 부채 잔액은 음수(빚)로 저장되므로 화면이 쓰는 "사용액"으로 부호를 뒤집는다.
 *
 * 카드 행을 그대로 응답에 넣는 경로가 생기면 1번이 조용히 깨진다(로그인 응답의
 * 초기 데이터가 실제로 그랬다). 카드를 내보내는 모든 경로는 이 함수를 거친다.
 */
export function toCardResponse<
  T extends {
    cardNumber: string | null;
    liabilityAccount?: { balance: Prisma.Decimal } | null;
  },
>(card: T) {
  const { cardNumber, liabilityAccount, ...rest } = card;

  return {
    ...rest,
    cardNumberMasked: cardNumber ? `****-****-****-${cardNumber.slice(-4)}` : '',
    currentUsage: liabilityAccount ? liabilityAccount.balance.neg() : null,
  };
}
