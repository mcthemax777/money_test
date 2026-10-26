/*
 * 계정 삭제 안내 (2026-10-25). Google Play 의 "계정 삭제 URL" 요구에 맞춰 로그인 없이 읽을 수 있게 둔다.
 * 지우는 것과 남기는 것은 `account-deletion.service` 가 하는 일과 같다.
 */
import type { Metadata } from 'next';
import LegalPage, { type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: '계정 삭제 안내 · bboyong' };

const sections: LegalSection[] = [
  {
    title: '삭제하는 방법',
    items: [
      '앱: 설정 > 내 정보 > 계정 삭제.',
      '웹: 설정 > 내 정보 > 계정 삭제.',
      '앱을 쓸 수 없으면 가입한 Google 계정의 이메일로 운영자에게 요청하면 확인 뒤 지웁니다.',
    ],
  },
  {
    title: '함께 지우는 것',
    items: [
      '회원 정보(이메일, 이름, 사진), 로그인 기록, 푸시 알림 토큰.',
      '혼자 쓰던 가계부와 그 안의 모든 자료.',
      '문의와 답변, 가입 요청, 보낸 알림 원문.',
    ],
  },
  {
    title: '남는 것',
    items: [
      '다른 구성원과 함께 쓰던 가계부의 거래는 그 가계부의 자료로 남고, 입력자 표시만 지웁니다. 다른 구성원이 있는 가계부의 소유자는 소유자를 넘기거나 구성원을 내보낸 뒤 삭제할 수 있습니다.',
      '이용권 결제 기록은 법령에 따라 5년간 회원과의 연결을 끊고 보관합니다.',
    ],
  },
  {
    title: '구독',
    body: ['함께 지우는 가계부에 이어지는 Google Play 구독이 있으면 삭제할 때 먼저 해지합니다. 이미 결제한 기간은 환불되지 않으며, 환불이 필요하면 삭제 전에 문의해 주세요.'],
  },
];

export default function AccountDeletionPage() {
  return <LegalPage title="계정 삭제 안내" effectiveDate="2026-11-01" sections={sections} />;
}
