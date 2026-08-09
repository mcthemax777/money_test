import type { Metadata } from 'next';
import './globals.css';
import { AuthInitializer } from '@/components/AuthInitializer';

export const metadata: Metadata = {
  title: 'Money App - 가계부',
  description: '개인 재무 관리 앱',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <AuthInitializer />
        {children}
      </body>
    </html>
  );
}
