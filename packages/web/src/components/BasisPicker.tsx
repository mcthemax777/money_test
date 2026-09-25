'use client';

import { useTranslation } from '@money/core/lib/i18n';
import type { EntryBasis } from '@money/types';

const BASES: EntryBasis[] = ['accrual', 'installment'];

/**
 * 무엇을 "그 달에 쓴 돈"으로 셀지 고르는 자리.
 *
 * 거래 화면과 가계 화면의 더보기 안에 같은 모양으로 선다. 두 화면이 같은 물음에 다른
 * 낱말로 답하면 숫자가 왜 다른지 알 수 없으므로 한 곳에 둔다.
 *
 * 기본은 회차 기준이다. 할부를 산 달 하나에 몰아 두면 그 달만 혼자 튀고, 매달
 * 빠져나가는 돈은 어느 달에서도 보이지 않는다. 발생 기준은 "언제 샀나"를 묻는 화면을
 * 위해 남겨 두었다.
 */
export default function BasisPicker({
  value,
  onChange,
}: {
  value: EntryBasis;
  onChange: (basis: EntryBasis) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="px-2 pb-3">
      <p className="mb-2 text-sm font-medium text-gray-700">{t('tx.basis')}</p>
      <div className="flex gap-2 rounded-lg bg-gray-100 p-1">
        {BASES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
              value === item
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(item === 'accrual' ? 'tx.basis.accrual' : 'tx.basis.installment')}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">{t('tx.basisHint')}</p>
    </div>
  );
}
