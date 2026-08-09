'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const menuItems = [
  {
    section: null,
    items: [
      { label: '대시보드', href: '/dashboard' },
      { label: '거래', href: '/dashboard/transactions' },
    ],
  },
  {
    section: '관리',
    items: [
      { label: '자산 관리', href: '/dashboard/assets' },
      { label: '카테고리', href: '/dashboard/categories' },
    ],
  },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    '관리': false,
  });

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 md:hidden p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 pt-20 md:pt-0 overflow-y-auto transition-transform duration-300 z-40 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <nav className="p-4">
          {menuItems.map((menu) => (
            <div key={menu.section || 'top'} className={menu.section ? 'mb-8' : 'mb-4'}>
              {menu.section && (
                <button
                  onClick={() => menu.section === '관리' && toggleSection(menu.section)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider ${
                    menu.section === '관리' ? 'cursor-pointer hover:text-gray-700' : ''
                  }`}
                >
                  <span>{menu.section}</span>
                  {menu.section === '관리' && (
                    <span
                      className={`transition-transform ${
                        expandedSections['관리'] ? 'rotate-180' : ''
                      }`}
                    >
                      ▼
                    </span>
                  )}
                </button>
              )}

              {(!menu.section || expandedSections[menu.section]) && (
                <ul className={`space-y-2 ${menu.section ? 'mt-3' : ''}`}>
                  {menu.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className={`block px-4 py-2 rounded-lg transition ${
                          isActive(item.href)
                            ? 'bg-blue-50 text-blue-600 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div
        className={`fixed inset-0 bg-black/50 z-30 md:hidden ${
          isOpen ? 'block' : 'hidden'
        }`}
        onClick={() => setIsOpen(false)}
      />
    </>
  );
}
