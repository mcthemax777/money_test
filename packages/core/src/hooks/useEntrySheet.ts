/**
 * 거래내역 엑셀 가져오기·내보내기. 웹과 앱이 같은 훅을 쓰고, 파일을 얻고 내놓는 일만 화면이 한다.
 *
 * **창구(`entrySheetPort`)를 거친다.** 웹은 서버에서 곧바로, 앱은 기기 사본에서 한다 --
 * 앱은 끊겨 있어도 가져오고 내보낸다. 가져온 것(없어서 만든 구성원·자산·분류·태그와 거래)은
 * 손으로 적은 것과 같은 오프라인 명령으로 쌓였다가 연결되면 서버로 간다.
 */
import { useCallback, useState } from 'react';
import type { EntrySheetDto, EntrySheetRow } from '@money/types';

import { entrySheetPort } from '../data/entry-sheet-port';
import { useApiError } from '../lib/api-error';
import { chunkEntrySheetRows } from '../lib/entry-sheet';

export interface EntrySheetProgress {
  /** 보낸 행 수 / 전체 행 수. */
  done: number;
  total: number;
}

export interface UseEntrySheetResult {
  isBusy: boolean;
  progress: EntrySheetProgress | null;
  error: string;
  /** 나눠 보내고 결과를 합친다. 도중에 끊기면 그때까지의 결과와 오류를 함께 남긴다. */
  importRows: (rows: EntrySheetRow[]) => Promise<EntrySheetDto.ImportResponse | null>;
  exportRows: (query: EntrySheetDto.ExportQuery) => Promise<EntrySheetRow[] | null>;
}

const EMPTY_RESULT = (): EntrySheetDto.ImportResponse => ({
  created: 0,
  skipped: [],
  createdNames: { people: [], accounts: [], cards: [], categories: [], tags: [] },
});

export function useEntrySheet(projectId: string | null): UseEntrySheetResult {
  const { messageOf } = useApiError();
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<EntrySheetProgress | null>(null);
  const [error, setError] = useState('');

  const importRows = useCallback(
    async (rows: EntrySheetRow[]) => {
      if (!projectId) return null;
      setIsBusy(true);
      setError('');
      const merged = EMPTY_RESULT();
      let done = 0;
      setProgress({ done, total: rows.length });
      try {
        for (const chunk of chunkEntrySheetRows(rows)) {
          const result = await entrySheetPort().importRows(chunk, projectId);
          merged.created += result.created;
          merged.skipped.push(...result.skipped);
          for (const key of Object.keys(merged.createdNames) as Array<keyof typeof merged.createdNames>) {
            merged.createdNames[key].push(...result.createdNames[key]);
          }
          done += chunk.length;
          setProgress({ done, total: rows.length });
        }
        return merged;
      } catch (caught) {
        setError(messageOf(caught, 'sheet.importFailed', 'online.onlyOnline'));
        // 앞 묶음은 이미 들어갔다. 무엇이 들어갔는지 알려야 다시 가져올 때 겹치지 않게 한다.
        return merged.created > 0 ? merged : null;
      } finally {
        setIsBusy(false);
      }
    },
    [projectId, messageOf],
  );

  const exportRows = useCallback(
    async (query: EntrySheetDto.ExportQuery) => {
      if (!projectId) return null;
      setIsBusy(true);
      setError('');
      try {
        return await entrySheetPort().exportRows(query, projectId);
      } catch (caught) {
        setError(messageOf(caught, 'sheet.exportFailed', 'online.onlyOnline'));
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [projectId, messageOf],
  );

  return { isBusy, progress, error, importRows, exportRows };
}
