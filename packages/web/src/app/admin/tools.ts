/**
 * 관리 도구 목록. 새 도구는 여기에 한 줄 더하고 `app/admin/<경로>/page.tsx` 를 만든다.
 *
 * 첫 화면의 카드와 위쪽 메뉴가 이 목록을 그대로 그린다.
 */
export interface AdminTool {
  href: string;
  title: string;
  description: string;
}

export const ADMIN_TOOLS: AdminTool[] = [
  {
    href: '/admin/holidays',
    title: '공휴일',
    description:
      '반복 등록의 휴일 제외·앞뒤 평일 옮기기가 쓰는 공휴일. 새 연도가 발표되면 갱신을 누르고, 임시공휴일은 직접 더합니다.',
  },
  {
    href: '/admin/app-versions',
    title: '앱 버전',
    description:
      '강제 업데이트(이보다 낮으면 쓸 수 없음)와 권유(새 버전 안내)를 안드로이드·iOS·웹마다 정합니다. 저장하면 30초 안에 모든 서버에 먹습니다.',
  },
  {
    href: '/admin/inquiries',
    title: '문의',
    description:
      '사용자가 설정의 문의하기로 보낸 글. 답을 기다리는 것이 위에 옵니다. 답하면 그 사람의 기기로 푸시가 가고 설정에 읽지 않은 답의 수가 뜹니다.',
  },
  {
    href: '/admin/notifications',
    title: '알림 원문',
    description:
      '기기가 모은 다른 금융 앱의 알림 원문. 그때 읽은 결과와 지금 규칙으로 다시 읽은 결과를 나란히 봅니다.',
  },
  {
    href: '/admin/notification-rules',
    title: '알림 규칙',
    description:
      '같은 앱의 알림 원문을 맞대어 앱별 문구 규칙을 배우고, 칸 이름을 확인해 기기로 내려보냅니다. 배우는 방법은 문서로 볼 수 있습니다.',
  },
  {
    href: '/admin/plans',
    title: '이용권',
    description:
      '프로젝트(가계부)를 찾아 지금 이용권과 결제·지급 기록을 봅니다. 보상이나 시험으로 이용권을 주고, 환불한 것은 거둡니다.',
  },
];
