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
];
