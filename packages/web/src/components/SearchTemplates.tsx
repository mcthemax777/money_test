'use client';

/*
 * 검색 창 맨 위의 템플릿 줄 (앱의 SearchTemplates 와 같은 짝).
 *
 * 이름 붙여 둔 조건을 알약으로 늘어놓는다. 누르면 그 조건과 묶는 단위가 **바로 걸리고** 창이
 * 닫힌다(2026-10-08 사용자 요청 -- "바로바로 템플릿으로 필터 세팅"). 고르는 중인 조건은 "지금
 * 조건 저장"으로 남기고, 편집을 누르면 이름 바꾸기·지우기가 선다. 남기는 자리는 core 의
 * `useFilterTemplates`(기기, 가계부별)다.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { EntryPeriodUnit } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import type { TransactionSearch } from '@money/core/hooks/useTransactions';
import {
  templateMatches,
  useFilterTemplates,
  type FilterTemplate,
} from '@money/core/store/filter-templates';

import { Chip } from './TransactionSearchModal';

/** 저장·편집 칸의 글자 입력. 검색 창의 글자 칸과 같은 모양이다. */
const INPUT_CLASS =
  'min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function SearchTemplates({
  draft,
  draftUnit,
  canSaveDraft,
  applied,
  onPick,
}: {
  /** 저장할 조건. 검색 창이 감춘 쪽 값을 비운 것을 넘긴다 (`withSearchPeriodMode`). */
  draft: TransactionSearch;
  draftUnit: EntryPeriodUnit;
  /** 지금 조건을 남길 수 있는가. 기간을 잘못 적었으면 남기지 않는다. */
  canSaveDraft: boolean;
  /** 지금 걸린 조건. 같은 템플릿을 켜 보인다. */
  applied: { search: TransactionSearch; unit: EntryPeriodUnit };
  onPick: (template: FilterTemplate) => void;
}) {
  const { t } = useTranslation();
  const { templates, canSave, save, rename, remove } = useFilterTemplates();
  /** idle 은 알약, saving 은 이름 적기, managing 은 이름 바꾸기·지우기다. */
  const [mode, setMode] = useState<'idle' | 'saving' | 'managing'>('idle');
  const [name, setName] = useState('');
  /** 이름을 고치는 중인 템플릿과 적고 있는 이름. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // 가계부를 고르지 않았으면 남길 자리가 없다.
  if (!canSave) return null;

  const trimmed = name.trim();
  const willOverwrite = templates.some((item) => item.name === trimmed);
  const renameTaken =
    renaming !== null &&
    templates.some((item) => item.id !== renaming.id && item.name === renaming.name.trim());

  const submitSave = () => {
    if (!trimmed || !canSaveDraft) return;
    save(trimmed, draft, draftUnit);
    setName('');
    setMode('idle');
  };

  const submitRename = () => {
    if (!renaming || !renaming.name.trim() || renameTaken) return;
    rename(renaming.id, renaming.name);
    setRenaming(null);
  };

  const confirmRemove = (template: FilterTemplate) => {
    if (!window.confirm(t('tx.search.templateDeleteConfirm', { name: template.name }))) return;
    remove(template.id);
    if (renaming?.id === template.id) setRenaming(null);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
          {t('tx.search.templates')}
        </p>
        {templates.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setMode((prev) => (prev === 'managing' ? 'idle' : 'managing'));
              setRenaming(null);
            }}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {t(mode === 'managing' ? 'tx.search.templateDone' : 'tx.search.templateManage')}
          </button>
        ) : null}
      </div>

      {mode === 'managing' ? (
        /* 편집. 한 줄에 템플릿 하나 -- 이름을 고치는 칸이 알약 안에는 들어가지 않는다. */
        <ul key="managing" className="unfold divide-y divide-gray-100 rounded-lg border border-gray-200">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center gap-2 px-3 py-2">
              {renaming?.id === template.id ? (
                <>
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: template.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    aria-label={t('tx.search.templateName')}
                    className={INPUT_CLASS}
                  />
                  <button
                    type="button"
                    disabled={!renaming.name.trim() || renameTaken}
                    onClick={submitRename}
                    className="shrink-0 text-sm font-medium text-blue-600 disabled:text-gray-300"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    className="shrink-0 text-sm text-gray-500"
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{template.name}</span>
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: template.id, name: template.name })}
                    className="shrink-0 text-sm text-blue-600 hover:underline"
                  >
                    {t('tx.search.templateRename')}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmRemove(template)}
                    className="shrink-0 text-sm text-red-600 hover:underline"
                  >
                    {t('tx.search.templateDelete')}
                  </button>
                </>
              )}
            </li>
          ))}
          {renameTaken ? (
            <li className="px-3 py-2 text-xs text-red-600">{t('tx.search.templateDuplicate')}</li>
          ) : null}
        </ul>
      ) : (
        <div key="idle" className="unfold">
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <Chip
                key={template.id}
                label={template.name}
                selected={templateMatches(template, applied.search, applied.unit)}
                onClick={() => onPick(template)}
              />
            ))}
            {mode === 'idle' ? (
              <button
                type="button"
                disabled={!canSaveDraft}
                onClick={() => setMode('saving')}
                className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:text-gray-300 motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('tx.search.templateSave')}
              </button>
            ) : null}
          </div>
          {templates.length === 0 && mode === 'idle' ? (
            <p className="mt-2 text-xs leading-5 text-gray-500">{t('tx.search.templateEmpty')}</p>
          ) : null}
          {mode === 'saving' ? (
            <div className="unfold mt-3">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    // 검색 창의 엔터(적용)로 번지지 않게 여기서 끝낸다.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitSave();
                    }
                    if (e.key === 'Escape') setMode('idle');
                  }}
                  placeholder={t('tx.search.templateName')}
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  disabled={!trimmed || !canSaveDraft}
                  onClick={submitSave}
                  className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setName('');
                    setMode('idle');
                  }}
                  className="shrink-0 px-1 text-sm text-gray-500"
                >
                  {t('common.cancel')}
                </button>
              </div>
              {willOverwrite ? (
                <p className="mt-2 text-xs leading-5 text-gray-500">{t('tx.search.templateOverwrite')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
