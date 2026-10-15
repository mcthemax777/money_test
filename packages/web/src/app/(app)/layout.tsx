'use client';

import AppShell from '@/components/AppShell';

/**
 * 가계부 화면들(예산·거래·분석·자산·설정)의 껍데기 (2026-10-16).
 *
 * 예전에는 화면 폴더마다 레이아웃이 따로 껍데기를 감싸, 아래 탭을 옮길 때마다 껍데기가 새로 서며
 * 가계부 목록·사용자·문의 답·보관함 수를 다시 받았다(탭 하나에 요청 너덧). 이 묶음 하나가 감싸면
 * 탭을 옮겨도 껍데기는 그대로다. 괄호 폴더라 주소에는 나타나지 않는다.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
