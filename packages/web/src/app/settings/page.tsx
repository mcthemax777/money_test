'use client';

import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import ExchangeRateSettings from '@/components/ExchangeRateSettings';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="설정" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/settings/profile">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">내 정보</h2>
                <p className="mt-1 text-sm text-gray-600">
                  계정 정보를 확인하고 이름을 변경합니다
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>

        <Link href="/settings/projects">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">프로젝트 관리</h2>
                <p className="mt-1 text-sm text-gray-600">
                  프로젝트 생성, 멤버와 초대 링크, 가입 요청을 관리합니다
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>
      </div>

      <div className="space-y-4">
        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

      </div>

    </div>
  );
}
