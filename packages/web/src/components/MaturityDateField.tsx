'use client';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 정기예금·적금의 만기일. 자산 탭이 남은 날을 D-day 로 보여 준다.
 *
 * 통장 추가·수정이 함께 쓴다. 만기가 있는 유형(`hasMaturity`)일 때만 부르는 쪽이 그린다.
 * 날짜 입력의 값이 곧 "YYYY-MM-DD" 라 그대로 보낸다. 비우면 빈 문자열이다. 앱에도 같은 칸이 있다.
 */
export default function MaturityDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {t('account.maturityDate')}
      </label>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
