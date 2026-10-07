'use client';

import { X } from 'lucide-react';

import type { SearchChip } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 걸려 있는 조건 알약 줄. 거래·분석 화면이 탭 위에 둔다.
 *
 * `onRemove` 를 주면 알약을 눌러 그 조건만 뺀다. 주지 않으면 무엇으로 그렸는지 알리기만 한다
 * -- 다른 탭에서 건너온 보기(거래 탭의 분석, 분석 탭의 거래내역)는 조건을 고칠 수 없다.
 *
 * 많아지면 가로로 굴린다. 줄바꿈으로 두면 조건이 열 개 넘을 때 목록이 화면 밖으로 밀린다.
 */
export default function SearchChips({
  chips,
  onRemove,
}: {
  chips: SearchChip[];
  onRemove?: (chipId: string) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {chips.map((chip) =>
        onRemove ? (
          <button
            key={chip.id}
            type="button"
            onClick={() => onRemove(chip.id)}
            // 지우는 버튼이라 이름을 함께 읽어 준다. 알약만으로는 무엇이 빠지는지 모른다.
            aria-label={`${chip.label} ${t('tx.search.chipRemove')}`}
            title={t('tx.search.chipRemove')}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            {chip.label}
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <span
            key={chip.id}
            className="flex shrink-0 items-center whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700"
          >
            {chip.label}
          </span>
        ),
      )}
    </div>
  );
}
