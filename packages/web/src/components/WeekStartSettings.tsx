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
 * 언어 칸(`LanguageSettings`)과 같은 모양이다 -- 일곱 칸을 한 줄에 늘어놓고 고른
 * 것을 파랗게 둔다. 목록(select)으로 접어 두면 지금 무엇으로 보고 있는지 열어야
 * 알 수 있는데, 이 값은 달력을 열 때마다 눈에 들어오는 값이다.
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
  const names = weekdayNames();

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
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.weekStart.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('settings.weekStart.description')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {WEEK_START_DAYS.map((day) => {
          const selected = day === weekStart;

          return (
            <button
              key={day}
              type="button"
              onClick={() => choose(day)}
              disabled={isSaving}
              aria-pressed={selected}
              /* 고른 칸 표시는 언어 칸과 같은 값을 쓴다. */
              className={`min-w-14 rounded-lg border px-4 py-2 text-sm transition disabled:opacity-50 ${
                selected
                  ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {names[day]}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
