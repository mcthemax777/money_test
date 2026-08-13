'use client';

import { useState } from 'react';
import Link from 'next/link';
import { exportDataToExcel } from '@/lib/excel-export';

export default function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      setExportMessage('');
      await exportDataToExcel();
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">설정</h1>
        <p className="mt-2 text-gray-600">앱 설정 및 데이터 관리</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/settings/projects">
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">프로젝트 관리</h2>
                <p className="mt-1 text-sm text-gray-600">
                  프로젝트를 생성, 관리, 탈퇴합니다
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>

        <Link href="/settings/invitations">
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">프로젝트 초대 관리</h2>
                <p className="mt-1 text-sm text-gray-600">
                  팀원을 초대하고 초대 상태를 관리합니다
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
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

        <div className="bg-white rounded-lg shadow-md p-6">
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
