/**
 * 계정 삭제. 지우기 전에 무엇이 함께 사라지는지 화면이 먼저 보여 준다.
 *
 * - 나 혼자 쓰는 가계부는 계정과 함께 지운다.
 * - 다른 구성원이 있는 가계부의 소유자면 지우지 않는다. 그 가계부는 남의 자료이기도 해서
 *   함께 지울 수 없고, 소유자 없이 남길 수도 없다. 소유자를 넘기거나 구성원을 내보낸 뒤 지운다.
 * - 구성원으로만 참여한 가계부에서는 빠진다. 가계부와 내가 적은 거래는 남는다.
 * - 이용권 결제 기록은 사람과의 연결만 끊고 남긴다(환불 문의·법정 보관).
 */
export interface AccountDeletionPreview {
  /** 함께 지워지는 가계부. Play 구독이 이어지는 중이면 계정을 지워도 결제가 계속되니 따로 알린다. */
  soloProjects: { id: string; name: string; hasRenewingSubscription: boolean }[];
  /** 지우기를 막는 가계부(내가 소유자이고 다른 구성원이 있다). */
  sharedOwnedProjects: { id: string; name: string; memberCount: number }[];
  /** 구성원으로만 참여해 빠지게 되는 가계부 수. */
  joinedProjectCount: number;
}
