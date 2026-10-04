'use client';

/**
 * 페이백을 적고 고치는 팝업 (PAYBACK_DESIGN.md 7단계).
 *
 * 거래 편집기와 따로 둔다. 페이백은 원거래의 한 줄을 되돌린 돈이라 고를 것이 적다 --
 * 금액·날짜·들어온 곳·설명, 그리고 분할된 원거래면 어느 줄인지. 분류는 그 줄의 것이라
 * 고르지 않는다. 규칙(검사·짐·저장 창구)은 앱과 함께 core 의 `useEntryForm` 이 갖는다.
 */
import { useEffect } from 'react';
import type { EntryListItem } from '@money/types';
import { LEDGER_MIN_ENTRY_DATE_KEY, PAYBACK_TYPES, ledgerMaxEntryDateKey } from '@money/types';
import { parseMethod } from '@money/core/data/entry-form';
import { useEntryForm } from '@money/core/hooks/useEntryForm';
import { useInstallmentRefund } from '@money/core/hooks/useInstallmentRefund';
import { usePaybackOrigin } from '@money/core/hooks/usePaybackOrigin';
import { formatYearMonth } from '@money/core/lib/datetime';
import { ENTRY_FORM_VIOLATION_KEY } from '@money/core/lib/entry-form-messages';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import Modal from '@/components/Modal';

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

export interface PaybackTarget {
  /** 새로 적을 때의 원거래. */
  original?: EntryListItem;
  /** 고칠 페이백. */
  editing?: EntryListItem;
}

export default function PaybackEditor({
  target,
  onClose,
  onSaved,
}: {
  /** null 이면 닫힌 상태다. */
  target: PaybackTarget | null;
  onClose: () => void;
  /** 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다. */
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const projectId = useProject((state) => state.selectedProjectId);
  const myPersonId = useMyPersonId();
  const displayCurrency = useProjectDisplayCurrency();
  const ledgerCurrency = useProjectLedgerCurrency();

  const form = useEntryForm({
    projectId,
    timeZone,
    defaultPersonId: myPersonId ?? '',
    onSaved: () => onSaved?.(),
  });
  const { values, setField } = form;

  /*
   * 열 때 한 번 채운다. 고칠 때는 그 페이백을, 새로 적을 때는 원거래를.
   *
   * 열 수 없는 것(지출이 아닌 원거래)은 닫는다. 화면이 단추를 지출에만 그리므로 여기 오는
   * 일은 없지만, 빈 폼이 지출로 저장되는 것보다 닫히는 편이 낫다.
   */
  useEffect(() => {
    if (!target) return;
    const opened = target.editing
      ? form.startEdit(target.editing)
      : target.original
        ? form.startPayback(target.original)
        : false;
    if (!opened) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const original = target?.original ?? null;
  // 분할된 원거래면 어느 줄인지 고른다. 고칠 때는 줄을 바꾸지 않는다.
  const lines = original && original.lines.length > 1 ? original.lines : [];
  const chosenLine = original?.lines.find((line) => line.lineKey === values.paybackOfLineKey) ?? null;
  const categoryLabel = chosenLine
    ? chosenLine.parentCategoryName
      ? `${chosenLine.parentCategoryName} > ${chosenLine.categoryName}`
      : chosenLine.categoryName
    : target?.editing
      ? target.editing.parentCategoryName
        ? `${target.editing.parentCategoryName} > ${target.editing.categoryName}`
        : target.editing.categoryName
      : null;

  /*
   * 할부 원거래면 "할부 처리" 상자 (PAYBACK_DESIGN.md 7-9). 고칠 때는 원거래를 읽어 온다 --
   * 목록 한 줄은 페이백 자신이라 원거래의 회차를 들고 있지 않다.
   */
  const origin = usePaybackOrigin(target?.editing ?? null, projectId);
  const installment = useInstallmentRefund({
    original: original ?? origin.original,
    editingId: target?.editing?.id ?? null,
    values,
    setField,
    timeZone,
    sameCurrency: displayCurrency === ledgerCurrency,
  });
  const money = (amount: string) => formatCurrency(amount, displayCurrency);
  const monthLabel = (yearMonth: string) => {
    const [year, month] = yearMonth.split('-').map(Number);
    return year && month ? formatYearMonth(year, month) : yearMonth;
  };

  const violationKey = form.violation ? ENTRY_FORM_VIOLATION_KEY[form.violation.code] : undefined;
  const message =
    form.error || (form.violation ? (violationKey ? t(violationKey) : form.violation.code) : '');

  const save = async () => {
    if (await form.save()) onClose();
  };

  const remove = async () => {
    if (!window.confirm(t('account.deleteConfirm'))) return;
    if (await form.remove()) onClose();
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={t(target?.editing ? 'payback.editTitle' : 'payback.newTitle')}
      footer={
        <div className="flex gap-2">
          {form.isEditing ? (
            <button
              type="button"
              onClick={remove}
              disabled={form.isSubmitting}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {t('account.deleteSubmit')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={form.isSubmitting}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {form.isSubmitting ? t('common.saving') : t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500">{t('payback.hint')}</p>

        {/* 환불인가 페이백인가. 바꾸면 아래 실적 칸이 그 종류의 기본값으로 돌아간다. */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">{t('payback.type')}</span>
          <div className="grid grid-cols-2 gap-2">
            {PAYBACK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={values.paybackType === type}
                onClick={() => setField('paybackType', type)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  values.paybackType === type
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t(`payback.type.${type}`)}
              </button>
            ))}
          </div>
        </div>

        {lines.length > 0 ? (
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1">{t('payback.line')}</legend>
            <div className="space-y-1">
              {lines.map((line) => (
                <label
                  key={line.lineKey}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="payback-line"
                      checked={values.paybackOfLineKey === line.lineKey}
                      onChange={() => form.choosePaybackLine(line)}
                    />
                    {line.categoryName}
                  </span>
                  <span className="tabular-nums text-gray-500">
                    {formatCurrency(line.amount, displayCurrency)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : categoryLabel ? (
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">{t('tx.detail.category')}</span>
            <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">{categoryLabel}</p>
          </div>
        ) : null}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.amount')}</label>
          <input
            type="text"
            inputMode="decimal"
            value={values.amount}
            onChange={(event) => setField('amount', event.target.value)}
            className={INPUT}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.date')}</label>
            <input
              type="date"
              value={values.dateKey}
              min={LEDGER_MIN_ENTRY_DATE_KEY}
              max={ledgerMaxEntryDateKey()}
              onChange={(event) => setField('dateKey', event.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.time')}</label>
            <input
              type="time"
              value={values.timeKey}
              onChange={(event) => setField('timeKey', event.target.value)}
              className={INPUT}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('payback.method')}</label>
          <select
            value={values.method}
            onChange={(event) => setField('method', event.target.value)}
            className={INPUT}
          >
            <option value="">{t('editor.noMethod')}</option>
            {form.methodChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.owner && form.showAssetOwner ? `${choice.name} · ${choice.owner}` : choice.name}
              </option>
            ))}
          </select>
        </div>

        {/*
          할부 처리 (7-9). 환불한 다음 달 회차부터 남은 할부를 줄이고, 다 못 줄인 몫은 환불한 달에
          한꺼번에 돌아온 돈이 된다. 들어온 곳이 원거래 카드가 아니거나 캐시백이면 까닭만 적는다.
        */}
        {installment.isInstallment ? (
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{t('payback.installment.title')}</span>
              {installment.applies ? (
                <button
                  type="button"
                  onClick={installment.cancelAll}
                  className="rounded-lg px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
                >
                  {t('payback.installment.cancelAll')}
                </button>
              ) : null}
            </div>
            {installment.applies ? (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="py-1 text-left font-normal" />
                      <th className="py-1 text-right font-normal">{t('payback.installment.before')}</th>
                      <th className="py-1 pl-2 text-right font-normal">{t('payback.installment.after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installment.rows.map((row) => (
                      <tr key={row.index} className={row.past ? 'text-gray-400' : 'text-gray-900'}>
                        <td className="py-1">
                          {t('payback.installment.round', { index: row.index })}{' '}
                          <span className="text-xs text-gray-400">
                            {monthLabel(row.yearMonth)}
                            {row.past ? ` · ${t('payback.installment.past')}` : ''}
                          </span>
                        </td>
                        <td className="py-1 text-right tabular-nums">{money(row.before)}</td>
                        <td className="py-1 pl-2 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`${t('payback.installment.round', { index: row.index })} ${t('payback.installment.after')}`}
                            value={row.after}
                            onChange={(event) => installment.setAfter(row.index, event.target.value)}
                            className={`w-28 rounded border px-2 py-1 text-right tabular-nums ${
                              Number(row.after) < 0 ? 'border-red-300 bg-red-50' : 'border-gray-300'
                            }`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 border-t border-gray-100 pt-2 text-sm text-gray-900">
                  <p>
                    {t('payback.installment.lump', {
                      month: monthLabel(installment.refundYearMonth),
                      amount: money(installment.lump),
                    })}
                  </p>
                  <p className="text-gray-600">
                    {installment.remaining.length > 0
                      ? t('payback.installment.remaining', {
                          count: installment.remaining.length,
                          amount: money(
                            String(installment.remaining.reduce((sum, row) => sum + Number(row.after), 0)),
                          ),
                        })
                      : t('payback.installment.none')}
                  </p>
                </div>
                {installment.overAmount ? (
                  <p className="mt-1 text-xs text-red-600">{t('payback.installment.overAmount')}</p>
                ) : null}
                {installment.overShare ? (
                  <p className="mt-1 text-xs text-red-600">{t('payback.installment.overShare')}</p>
                ) : null}
                <p className="mt-1 text-xs text-gray-500">{t('payback.installment.hint')}</p>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                {t(
                  installment.blockedBy === 'not-refund'
                    ? 'payback.installment.cashback'
                    : installment.blockedBy === 'currency'
                      ? 'payback.installment.currency'
                      : 'payback.installment.otherMethod',
                )}
              </p>
            )}
          </div>
        ) : null}

        {/*
          카드 실적에서도 뺄지. 카드로 받았을 때만 뜻이 있다. 기본은 종류가 정하고(환불은 빼고
          캐시백은 빼지 않는다) 카드사 기준이 다르면 여기서 바꾼다.
        */}
        {parseMethod(values.method).cardId ? (
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.countsPerformance}
              onChange={(event) => setField('countsPerformance', event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex-1">
              <span className="block text-sm text-gray-900">{t('payback.countsPerformance')}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{t('payback.countsPerformanceHint')}</span>
            </span>
          </label>
        ) : null}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.description')}</label>
          <input
            type="text"
            value={values.description}
            onChange={(event) => setField('description', event.target.value)}
            className={INPUT}
          />
        </div>

        {message ? (
          <p className="unfold rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>
        ) : null}
      </div>
    </Modal>
  );
}
