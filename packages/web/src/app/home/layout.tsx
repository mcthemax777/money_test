'use client';

import AppShell from '@/components/AppShell';

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
