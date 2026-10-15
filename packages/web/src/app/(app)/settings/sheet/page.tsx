'use client';

/*
 * 거래내역 엑셀 가져오기·내보내기. 앱의 EntrySheetScreen 과 같은 짝이다.
 *
 * 파일을 읽고 쓰는 일은 core 의 `entry-sheet`, 서버와 오가는 일은 `useEntrySheet` 가 한다.
 * 이 화면은 파일을 고르고 내려받는 자리와, 읽은 것·넣은 결과를 보여 주는 자리다.
 */
import { useRef, useState } from 'react';
import { ENTRY_SHEET_COLUMNS, type EntrySheetDto } from '@money/types';
import { useEntrySheet } from '@money/core/hooks/useEntrySheet';
import {
  countEntrySheetEntries,
  entrySheetFileName,
  readEntrySheet,
  writeEntrySheet,
  type EntrySheetReadResult,
} from '@money/core/lib/entry-sheet';
import { useTranslation } from '@money/core/lib/i18n';
import { useCanEdit, useProject } from '@money/core/store/project';

import PageHeader from '@/components/PageHeader';

const LABEL = new Map(ENTRY_SHEET_COLUMNS.map((column) => [column.key, column.label]));

export default function EntrySheetPage() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const projectName = useProject(
    (state) => state.projects.find((project) => project.id === state.selectedProjectId)?.name ?? '',
  );
  const sheet = useEntrySheet(projectId);
  // 가져오기는 거래를 만든다. 조회자에게는 칸을 두지 않는다 (서버도 editor 만 받는다).
  const canEdit = useCanEdit();

  return (
    <div className="space-y-6">
      <PageHeader title={t('sheet.title')} backHref="/settings" />
      {sheet.error ? <p className="unfold rounded-lg bg-red-50 p-3 text-sm text-red-700">{sheet.error}</p> : null}
      <ExportSection sheet={sheet} projectName={projectName} />
      {canEdit ? <ImportSection sheet={sheet} /> : null}
    </div>
  );
}

function ExportSection({ sheet, projectName }: { sheet: ReturnType<typeof useEntrySheet>; projectName: string }) {
  const { t } = useTranslation();
  const [isRange, setIsRange] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    setDone(null);
    const rows = await sheet.exportRows(
      isRange ? { startDate: startDate || undefined, endDate: endDate || undefined } : {},
    );
    if (!rows) return;
    const blob = new Blob([writeEntrySheet(rows, 'array')], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = entrySheetFileName(projectName);
    link.click();
    URL.revokeObjectURL(url);
    setDone(rows.length);
  };

  return (
    <section className="space-y-4 rounded-lg bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('sheet.export.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('sheet.export.description')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setIsRange(value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              isRange === value ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t(value ? 'sheet.export.range' : 'sheet.export.all')}
          </button>
        ))}
      </div>
      {isRange ? (
        <div className="unfold flex flex-wrap gap-3">
          <label className="text-sm text-gray-700">
            <span className="mb-1 block text-xs text-gray-500">{t('sheet.export.start')}</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="mb-1 block text-xs text-gray-500">{t('sheet.export.end')}</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={sheet.isBusy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {t('sheet.export.button')}
        </button>
        {done !== null ? <span className="unfold text-sm text-green-700">{t('sheet.export.done', { count: done })}</span> : null}
      </div>
    </section>
  );
}

function ImportSection({ sheet }: { sheet: ReturnType<typeof useEntrySheet> }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; read: EntrySheetReadResult } | null>(null);
  const [readError, setReadError] = useState('');
  const [result, setResult] = useState<EntrySheetDto.ImportResponse | null>(null);

  const pick = async (picked: File | undefined) => {
    setResult(null);
    setReadError('');
    setFile(null);
    if (!picked) return;
    try {
      setFile({ name: picked.name, read: readEntrySheet(await picked.arrayBuffer()) });
    } catch {
      setReadError(t('sheet.import.readFailed'));
    } finally {
      // 같은 파일을 고쳐 다시 고를 수 있게 비운다.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const run = async () => {
    if (!file) return;
    const imported = await sheet.importRows(file.read.rows);
    if (imported) {
      setResult(imported);
      setFile(null);
    }
  };

  const read = file?.read;
  const canImport = Boolean(read && read.missing.length === 0 && read.rows.length > 0 && !sheet.isBusy);

  return (
    <section className="space-y-4 rounded-lg bg-white p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('sheet.import.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('sheet.import.description')}</p>
        <p className="mt-2 text-xs text-gray-500">{t('sheet.import.guide')}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={sheet.isBusy}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        {t('sheet.import.pick')}
      </button>

      {readError ? <p className="unfold rounded-lg bg-red-50 p-3 text-sm text-red-700">{readError}</p> : null}

      {file && read ? (
        <div className="unfold space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-900">
            {t('sheet.import.summary', {
              name: file.name,
              count: countEntrySheetEntries(read.rows),
              rows: read.rows.length,
            })}
          </p>
          <p className="text-gray-600">
            {t('sheet.import.columns', { columns: read.columns.map((key) => LABEL.get(key)).join(', ') })}
          </p>
          {read.ignoredHeaders.length ? (
            <p className="text-gray-500">{t('sheet.import.ignored', { columns: read.ignoredHeaders.join(', ') })}</p>
          ) : null}
          {read.missing.length ? (
            <p className="text-red-700">{t('sheet.import.missing', { columns: read.missing.join(', ') })}</p>
          ) : null}
          {read.rows.length === 0 ? <p className="text-red-700">{t('sheet.import.empty')}</p> : null}
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canImport}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {t('sheet.import.button')}
          </button>
        </div>
      ) : null}

      {sheet.progress && sheet.isBusy ? (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${Math.round((sheet.progress.done / Math.max(sheet.progress.total, 1)) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {t('sheet.import.progress', { done: sheet.progress.done, total: sheet.progress.total })}
          </p>
        </div>
      ) : null}

      {result ? <ImportResult result={result} /> : null}
    </section>
  );
}

function ImportResult({ result }: { result: EntrySheetDto.ImportResponse }) {
  const { t } = useTranslation();
  const names = result.createdNames;
  const groups = (
    [
      ['sheet.import.people', names.people],
      ['sheet.import.accounts', names.accounts],
      ['sheet.import.cards', names.cards],
      ['sheet.import.categories', names.categories],
      ['sheet.import.tags', names.tags],
    ] as const
  ).filter(([, list]) => list.length > 0);

  return (
    <div className="unfold space-y-3 rounded-lg border border-gray-200 p-4 text-sm">
      <p className="font-medium text-green-700">{t('sheet.import.created', { count: result.created })}</p>
      {groups.length ? (
        <div className="space-y-1">
          <p className="font-medium text-gray-900">{t('sheet.import.createdNames')}</p>
          {groups.map(([key, list]) => (
            <p key={key} className="text-gray-700">
              <span className="text-gray-500">{t(key)}:</span> {list.join(', ')}
            </p>
          ))}
          {names.cards.length ? <p className="text-xs text-amber-700">{t('sheet.import.cardNote')}</p> : null}
        </div>
      ) : null}
      {result.skipped.length ? (
        <div className="space-y-1">
          <p className="font-medium text-red-700">{t('sheet.import.skipped', { count: result.skipped.length })}</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {result.skipped.map((item) => (
              <li key={item.rows.join(',')} className="text-gray-700">
                <span className="text-gray-500">{t('sheet.import.row', { rows: item.rows.join(', ') })}</span>{' '}
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
