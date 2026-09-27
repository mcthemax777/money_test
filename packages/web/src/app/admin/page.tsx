'use client';

import Link from 'next/link';

import { ADMIN_TOOLS } from './tools';

/** 관리 도구 첫 화면. 도구마다 카드 하나. */
export default function AdminHomePage() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ADMIN_TOOLS.map((tool) => (
        <Link
          key={tool.href}
          href={tool.href}
          className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 active:bg-blue-50"
        >
          <p className="font-semibold text-gray-900">{tool.title}</p>
          <p className="mt-1 text-sm text-gray-600">{tool.description}</p>
        </Link>
      ))}
    </div>
  );
}
