'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@/store/project';
import PageHeader from '@/components/PageHeader';
import ExchangeRateSettings from '@/components/ExchangeRateSettings';

export default function SettingsPage() {
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      setExportMessage('');
      // xlsx는 무겁다. 내보내기를 누를 때만 받아 설정 화면 첫 로딩에서 뺀다.
      const { exportDataToExcel } = await import('@/lib/excel-export');
      await exportDataToExcel(timeZone, displayCurrency);
      setExportMessage('엑셀 파일이 다운로드되었습니다.');
      setTimeout(() => setExportMessage(''), 3000);
    } catch (error) {
      console.error('내보내기 실패:', error);
      setExportMessage('내보내기 실패. 다시 시도해주세요.');
    } finally {
      setIsExporting(false);
    }
  };

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

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">데이터 내보내기</h2>
              <p className="mt-1 text-sm text-gray-600">
                모든 데이터를 엑셀 파일로 내보냅니다 (사용자, 계좌, 카드, 카테고리, 거래내역)
              </p>
            </div>
            <button
              onClick={handleExportExcel}
              disabled={isExporting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
            >
              {isExporting ? '준비 중...' : '엑셀로 내보내기'}
            </button>
          </div>

          {exportMessage && (
            <div
              className={`mt-4 p-3 rounded-lg ${
                exportMessage.includes('실패') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}
            >
              {exportMessage}
            </div>
          )}
        </div>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">포함되는 데이터</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span> 사용자 정보
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span> 계좌 정보
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span> 카드 정보
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span> 카테고리 정보
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span> 거래 내역
            </li>
          </ul>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">파일 형식</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-center gap-2">
              <span className="text-blue-600">📊</span> Excel 파일 (.xlsx)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">📑</span> 5개의 시트로 구성
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">🔤</span> 한글 헤더
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-600">📅</span> 오늘 날짜 포함
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
