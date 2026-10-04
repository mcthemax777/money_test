'use client';

/**
 * 거래 상세의 페이백 칸 (PAYBACK_DESIGN.md 7단계).
 *
 * 두 모양이다.
 *   - **지출**: 결제할 때 깎인 차감과 받은 환불·페이백을 줄별로, 그 합과 "페이백 추가". 합이 원거래보다
 *     많으면 알린다.
 *   - **페이백**: 무엇의 페이백인가 -- 원거래의 설명·날짜·금액·분류. 누르면 원거래를 연다.
 *
 * 편집기 안의 상세와 거래 화면의 상세가 함께 쓴다. 규칙은 core 의 `usePaybacks` 가 갖는다.
 */
import { Plus } from 'lucide-react';
import { originalEntry, type EntryLine, type EntryListItem } from '@money/types';
import { usePaybackOrigin } from '@money/core/hooks/usePaybackOrigin';
import { paybackGroupSummary, usePaybacks } from '@money/core/hooks/usePaybacks';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProject, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

export default function PaybackSection({
  entry,
  layout = 'boxed',
  canEdit,
  reloadToken = 0,
  onAdd,
  onOpen,
}: {
  entry: EntryListItem;
  /**
   * 둘레 상세의 모양에 맞춘다. 편집기의 상세는 이름표 아래 회색 상자(`boxed`), 거래 화면의
   * 상세는 이름표와 값이 좌우로 선 줄(`rows`)이다.
   */
  layout?: 'boxed' | 'rows';
  canEdit: boolean;
  /** 저장한 뒤 다시 읽게 할 때 올린다. */
  reloadToken?: number;
  /** "페이백 추가". 원거래를 넘겨 받은 쪽이 편집기를 연다. */
  onAdd: (original: EntryListItem) => void;
  /** 받은 페이백 한 줄이나 페이백의 원거래를 눌렀을 때. 그 거래의 상세를 연다. */
  onOpen: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const paybacks = usePaybacks(entry, projectId, reloadToken);
  const origin = usePaybackOrigin(entry, projectId);

  if (entry.kind === 'payback') {
    /*
     * 무엇의 페이백인가. 원거래의 설명·날짜·금액과 받은 줄의 분류를 적고, 누르면 그 원거래를 연다.
     *
     * 원거래가 지워졌으면(링크가 비었다) 그 사실을, 읽지 못했으면 실패를 적는다 -- 둘을 섞으면
     * 지워지지 않은 원거래를 지워졌다고 말하게 된다.
     */
    const body = !entry.paybackOfEntryId ? (
      <span className="text-gray-500">{t('payback.unlinked')}</span>
    ) : origin.failed ? (
      <span className="text-red-700">{t('payback.originLoadFailed')}</span>
    ) : origin.original ? (
      <button
        type="button"
        onClick={() => onOpen(origin.original!)}
        className="w-full rounded text-right hover:underline"
      >
        <span className="block text-gray-900">
          {origin.original.description || origin.line?.categoryName || t('entry.noTitle')}
        </span>
        <span className="block text-xs text-gray-500">
          {formatDate(origin.original.date, timeZone)} · -{formatCurrency(origin.original.amount, currency)}
          {origin.line ? ` · ${origin.line.categoryName}` : ''}
        </span>
      </button>
    ) : (
      <span className="text-gray-500">{entry.paybackOfDate ? formatDate(entry.paybackOfDate, timeZone) : '-'}</span>
    );

    return layout === 'rows' ? (
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5">
        <span className="text-sm text-gray-500">{t('payback.origin')}</span>
        <div className="flex-1 text-right text-[15px]">{body}</div>
      </div>
    ) : (
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-1">{t('payback.origin')}</span>
        <div className="px-3 py-2 bg-gray-50 rounded-lg">{body}</div>
      </div>
    );
  }

  if (entry.kind !== 'expense') return null;

  const renderItem = (item: EntryListItem) => (
    <li key={item.id}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex w-full items-center justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-white"
      >
        <span className="text-gray-700">
          {formatDate(item.date, timeZone)} · {t(`payback.type.${item.paybackType ?? 'payback'}`)} ·{' '}
          {item.cardName ?? item.accountName ?? t('editor.noMethod')}
        </span>
        <span className="tabular-nums text-green-600">+{formatCurrency(item.amount, currency)}</span>
      </button>
    </li>
  );

  const whole = originalEntry(entry);
  const isSplit = whole.lines.length > 1;
  const money = (amount: number, code?: string) => formatCurrency(amount, code ?? currency);
  const isEmpty = paybacks.items.length === 0 && paybacks.byLine.length === 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={layout === 'rows' ? 'text-sm text-gray-500' : 'text-sm font-medium text-gray-700'}>
          {t(paybacks.hasDiscount ? 'payback.titleWithDiscount' : 'payback.title')}
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={() => onAdd(whole)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('payback.add')}
          </button>
        ) : null}
      </div>
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
        {paybacks.failed ? <p className="mb-1 text-red-700">{t('payback.loadFailed')}</p> : null}
        {isEmpty ? (
          paybacks.failed ? null : <p className="text-gray-500">{t('payback.none')}</p>
        ) : (
          <ul className="space-y-1">
            {paybacks.byLine.length > 0
              ? paybacks.byLine.map((group) => (
                  /*
                   * 줄별로 묶는다 (7-5, 7-7). 나눈 거래면 줄의 분류와 금액을 머리에 적고, 그 아래에
                   * 결제할 때 깎인 차감과 그 줄에서 돌려받은 것, 끝에 "정가 · 차감 · 돌려받음 · 남음".
                   */
                  <li key={group.line?.lineKey ?? 'stray'} className="pt-1 first:pt-0">
                    {isSplit || !group.line ? (
                      <div className="flex items-baseline justify-between gap-3 px-1">
                        <span className="min-w-0 truncate font-medium text-gray-900">
                          {group.line ? lineLabel(group.line) : t('payback.lineUnknown')}
                        </span>
                        {group.line ? (
                          <span className="shrink-0 tabular-nums text-gray-500">
                            {formatCurrency(group.line.amount, currency)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <ul className="space-y-1">
                      {group.discount !== null ? (
                        <li className="flex items-center justify-between gap-3 px-1 py-0.5">
                          <span className="text-gray-700">{t('payback.discountRow')}</span>
                          <span className="tabular-nums text-gray-700">
                            {money(group.discount, group.discountCurrency ?? undefined)}
                          </span>
                        </li>
                      ) : null}
                      {group.items.map(renderItem)}
                    </ul>
                    {group.remaining !== null ? (
                      <p className="px-1 text-right text-xs text-gray-500">{paybackGroupSummary(group, t, money)}</p>
                    ) : null}
                  </li>
                ))
              : paybacks.items.map(renderItem)}
            {paybacks.items.length > 0 ? (
              <li className="border-t border-gray-200 pt-1 text-right text-gray-700">
                {t('payback.total', { amount: formatCurrency(paybacks.total, currency) })}
              </li>
            ) : null}
          </ul>
        )}
        {paybacks.isOver ? <p className="mt-1 text-amber-700">{t('payback.over')}</p> : null}
      </div>
    </div>
  );
}

function lineLabel(line: EntryLine): string {
  return line.parentCategoryName ? `${line.parentCategoryName} · ${line.categoryName}` : line.categoryName || '-';
}
