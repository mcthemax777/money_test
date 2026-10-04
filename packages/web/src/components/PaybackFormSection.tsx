'use client';

/**
 * 거래 폼의 페이백 칸 (PAYBACK_DESIGN.md 7단계 보강).
 *
 * 지출을 적거나 고치는 폼 안에서 두 가지를 보인다.
 *   - **받은 페이백**: 고치는 중인 지출에 이미 걸린 것. 누르면 페이백 편집기가 열린다.
 *   - **함께 저장할 페이백**: 여기서 적는 줄. 지출을 저장한 직후 그 지출에 걸려 저장된다
 *     (core 의 `usePaybackDrafts`). 새 지출에도 적을 수 있다.
 */
import { Plus, X } from 'lucide-react';
import { PAYBACK_TYPES, type EntryListItem, type PaybackType } from '@money/types';
import { usePaybackDrafts } from '@money/core/hooks/usePaybackDrafts';
import { usePaybacks } from '@money/core/hooks/usePaybacks';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProject, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

const INPUT =
  'w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function PaybackFormSection({
  original,
  drafts,
  lines,
  methodOptions,
  defaultMethod,
  reloadToken = 0,
  onOpenPayback,
}: {
  /** 고치는 중인 지출. 새로 적는 중이면 null 이다 -- 받은 페이백이 아직 없다. */
  original: EntryListItem | null;
  drafts: ReturnType<typeof usePaybackDrafts>;
  /** 지금 폼의 분류 줄. 분할이면 여럿이고, 페이백마다 어느 줄인지 고른다. */
  lines: Array<{ lineKey: string; categoryId: string; label: string }>;
  /** 들어온 곳으로 고를 것. 거래 폼의 결제수단 목록과 같은 값이다('account:id' / 'card:id'). */
  methodOptions: Array<{ id: string; name: string }>;
  /** 새 줄의 들어온 곳. 지금 폼에서 고른 결제수단이다. */
  defaultMethod: string;
  reloadToken?: number;
  onOpenPayback: (payback: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const received = usePaybacks(original, projectId, reloadToken);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{t('payback.title')}</span>
        <button
          type="button"
          onClick={() =>
            drafts.add({ method: defaultMethod, lineKey: lines.length === 1 ? lines[0].lineKey : '' })
          }
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t('payback.add')}
        </button>
      </div>

      {original && (received.items.length > 0 || received.failed) ? (
        <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <p className="mb-1 text-xs text-gray-500">{t('payback.received')}</p>
          {received.failed ? (
            <p className="text-red-700">{t('payback.loadFailed')}</p>
          ) : (
            <ul className="space-y-1">
              {received.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenPayback(item)}
                    className="flex w-full items-center justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-white"
                  >
                    <span className="text-gray-700">
                      {formatDate(item.date, timeZone)} · {t(`payback.type.${item.paybackType ?? 'payback'}`)} ·{' '}
                      {item.categoryName ?? ''}
                    </span>
                    <span className="tabular-nums text-green-600">+{formatCurrency(item.amount, currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {received.isOver ? <p className="mt-1 text-amber-700">{t('payback.over')}</p> : null}
        </div>
      ) : null}

      {drafts.drafts.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{t('payback.toAdd')}</p>
          {drafts.drafts.map((draft) => {
            const invalid = drafts.violation?.key === draft.key;
            return (
              <div
                key={draft.key}
                className={`grid grid-cols-2 gap-2 rounded-lg border p-2 ${invalid ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={t('editor.amount')}
                  aria-label={t('editor.amount')}
                  value={draft.amount}
                  onChange={(event) => drafts.update(draft.key, { amount: event.target.value })}
                  className={INPUT}
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    aria-label={t('editor.date')}
                    value={draft.dateKey}
                    onChange={(event) => drafts.update(draft.key, { dateKey: event.target.value })}
                    className={INPUT}
                  />
                  <button
                    type="button"
                    onClick={() => drafts.remove(draft.key)}
                    aria-label={t('payback.remove')}
                    title={t('payback.remove')}
                    className="shrink-0 rounded-lg px-1 text-gray-500 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <select
                  aria-label={t('payback.type')}
                  value={draft.paybackType}
                  onChange={(event) => drafts.update(draft.key, { paybackType: event.target.value as PaybackType })}
                  className={INPUT}
                >
                  {PAYBACK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`payback.type.${type}`)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('payback.method')}
                  value={draft.method}
                  onChange={(event) => drafts.update(draft.key, { method: event.target.value })}
                  className={INPUT}
                >
                  {methodOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {lines.length > 1 ? (
                  <select
                    aria-label={t('payback.line')}
                    value={draft.lineKey}
                    onChange={(event) => drafts.update(draft.key, { lineKey: event.target.value })}
                    className={INPUT}
                  >
                    <option value="">{t('payback.line')}</option>
                    {lines.map((line) => (
                      <option key={line.lineKey} value={line.lineKey}>
                        {line.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="self-center truncate px-1 text-sm text-gray-500">{lines[0]?.label ?? ''}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
