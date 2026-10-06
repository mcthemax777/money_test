'use client';

import type { EntryPeriodUnit } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';

/** 묶는 단위를 고르는 알약의 차례. 좁은 것에서 넓은 것으로 간다. */
const UNITS: Array<{ id: EntryPeriodUnit; labelKey: MessageKey }> = [
  { id: 'week', labelKey: 'tx.unit.week' },
  { id: 'month', labelKey: 'tx.unit.month' },
  { id: 'year', labelKey: 'tx.unit.year' },
];

/**
 * 기간을 무엇으로 묶을지 (주·달·해). 거래 탭과 분석 탭의 더보기가 함께 쓴다 (앱의 같은 짝과 같다).
 *
 * 고르고도 창을 닫지 않는다 -- 셋을 눌러 보며 고르는 자리라, 누를 때마다 닫히면 다시 열어야 한다.
 */
export default function PeriodUnitPicker({
  value,
  onChange,
}: {
  value: EntryPeriodUnit;
  onChange: (unit: EntryPeriodUnit) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="px-2 pb-3 pt-1">
      <p className="mb-2 text-sm font-medium text-gray-700">{t('tx.unit')}</p>
      <div className="flex gap-2 rounded-lg bg-gray-100 p-1">
        {UNITS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
              value === item.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
