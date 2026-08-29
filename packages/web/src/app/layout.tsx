import type { Metadata } from 'next';
import './globals.css';
import { AuthInitializer } from '@/components/AuthInitializer';
import { LocaleSync } from '@/components/LocaleSync';

/*
 * 서버가 만드는 값이라 사용자가 고른 언어를 알 수 없다. 어느 말로도 읽히는 앱
 * 이름만 둔다. 언어에 맞춘 제목은 화면이 뜬 뒤 LocaleSync가 붙인다.
 */
export const metadata: Metadata = {
  title: 'bboyong',
  description: 'Personal finance',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang은 첫 그림의 값이다. 고른 언어에 맞추는 것은 LocaleSync가 한다.
  return (
    <html lang="ko">
      <body>
        <AuthInitializer />
        <LocaleSync />
        {children}
      </body>
    </html>
  );
}
