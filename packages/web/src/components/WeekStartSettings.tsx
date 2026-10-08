'use client';

import { useState } from 'react';
import { WEEK_START_DAYS, type WeekStart } from '@money/types';

import { weekdayNames } from '@money/core/lib/datetime';
import { useApiError } from '@money/core/lib/api-error';
import { useTranslation } from '@money/core/lib/i18n';
import { useWeekStartStore } from '@money/core/store/week-start';

/**
 * 한 주를 어느 요일에서 시작할지 고르는 자리.
 *
 * 언어 칸(`LanguageSettings`)과 같은 모양이다 -- 이름과 설명 아래에 선택 상자를 둔다.
 *
 * 요일 이름은 사전이 아니라 Intl 이 만든다 (`weekdayNames`). 일요일 차례로 받아
 * 번호를 그대로 자리로 쓴다 -- 0 이 일요일이다.
 */
export default function WeekStartSettings() {
  const { t } = useTranslation();
  const { weekStart, setWeekStart, isSaving } = useWeekStartStore();
  const [error, setError] = useState('');
  const { messageOf } = useApiError();

  // useTranslation 이 언어 스토어를 구독하므로, 언어를 바꾸면 이름도 다시 만들어진다.
  // 목록에 이름만 한 줄씩 서므로 달력 머리글의 짧은 이름("일") 대신 긴 이름을 쓴다.
  const names = weekdayNames(0, 'long');

  const choose = async (next: WeekStart) => {
    setError('');

    try {
      await setWeekStart(next);
    } catch (err) {
      console.error('시작 요일 변경 실패:', err);
      // 스토어가 이미 이전 요일로 되돌려 두었다.
      // 서버에 닿지 못했으면 "연결되면 할 수 있습니다"로 말한다 (messageOf 가 가른다).
      setError(messageOf(err, 'settings.weekStart.saveFailed'));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t('settings.weekStart.title')}</h2>
        <select
          value={weekStart}
          onChange={(e) => choose(Number(e.target.value) as WeekStart)}
          disabled={isSaving}
          aria-label={t('settings.weekStart.title')}
          className="px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {WEEK_START_DAYS.map((day) => (
            <option key={day} value={day}>
              {names[day]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
