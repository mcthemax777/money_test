'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { exportDataToExcel } from '@/lib/excel-export';
import { importDataFromExcel } from '@/lib/excel-import';

export default function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [importSummary, setImportSummary] = useState('');
  const [projectName, setProjectName] = useState('');
  const [showProjectInput, setShowProjectInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!projectName.trim()) {
      setImportMessage('프로젝트 이름을 입력해주세요.');
      return;
    }

    try {
      setIsImporting(true);
      setImportMessage('');
      setImportSummary('');

      const result = await importDataFromExcel(file, projectName.trim());

      if (result.success) {
        const summaryText = `프로젝트 "${result.projectName}"에 사용자 ${result.summary.people}명, 계좌 ${result.summary.accounts}개, 카드 ${result.summary.cards}개, 카테고리 ${result.summary.categories}개, 거래내역 ${result.summary.transactions}건 임포트되었습니다.`;
        setImportMessage('임포트가 완료되었습니다.');
        setImportSummary(summaryText);
        setProjectName('');
        setShowProjectInput(false);
        setTimeout(() => {
          setImportMessage('');
          setImportSummary('');
        }, 7000);
      } else {
        setImportMessage('일부 데이터 임포트에 실패했습니다.');
        if (result.errors.length > 0) {
          setImportSummary(`오류: ${result.errors.slice(0, 3).join(', ')}`);
        }
      }
    } catch (error) {
      console.error('임포트 실패:', error);
      setImportMessage('임포트 실패. 다시 시도해주세요.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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

      <div className="space-y-4">
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

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">데이터 임포트</h2>
              <p className="mt-1 text-sm text-gray-600">
                내보낸 엑셀 파일을 선택하여 새 프로젝트에 데이터를 복구합니다
              </p>
            </div>
            <button
              onClick={() => setShowProjectInput(!showProjectInput)}
              disabled={isImporting}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
            >
              {isImporting ? '임포트 중...' : '엑셀에서 임포트'}
            </button>
          </div>

          {showProjectInput && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  새 프로젝트 이름
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="예: 2024년 가계부"
                  disabled={isImporting}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-200"
                />
              </div>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={handleImportExcel}
                  disabled={isImporting}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting || !projectName.trim()}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
                >
                  {isImporting ? '임포트 중...' : '파일 선택 및 임포트'}
                </button>
                <button
                  onClick={() => {
                    setShowProjectInput(false);
                    setProjectName('');
                    setImportMessage('');
                    setImportSummary('');
                  }}
                  disabled={isImporting}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 disabled:bg-gray-200 transition"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {importMessage && (
            <div
              className={`mt-4 p-3 rounded-lg ${
                importMessage.includes('실패') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}
            >
              <div>{importMessage}</div>
              {importSummary && <div className="mt-2 text-sm">{importSummary}</div>}
            </div>
          )}
        </div>
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
