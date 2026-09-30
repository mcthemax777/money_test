/**
 * 거래내역 엑셀 가져오기·내보내기 창구.
 *
 * 다른 창구와 같은 자리다. 웹은 서버 창구를, 앱은 사본 창구(`local-entry-sheet`)를 꽂는다.
 * 행을 거래로 옮기는 규칙은 둘 다 `@money/types` 의 `entry-sheet-io` 한 벌이다.
 */
import type { EntrySheetDto, EntrySheetRow } from '@money/types';

import { apiClient } from '../lib/api-client';

export interface EntrySheetPort {
  /** 한 묶음(`EntrySheetDto.MAX_ROWS` 행까지)을 넣는다. 나눠 보내는 일은 훅이 한다. */
  importRows(rows: EntrySheetRow[], projectId: string): Promise<EntrySheetDto.ImportResponse>;
  exportRows(query: EntrySheetDto.ExportQuery, projectId: string): Promise<EntrySheetRow[]>;
}

/** 서버에 곧바로 묻는 창구. 웹은 이것을 쓴다. */
export const httpEntrySheetPort: EntrySheetPort = {
  importRows: (rows, projectId) => apiClient.importEntrySheet(rows, projectId),
  exportRows: (query, projectId) => apiClient.exportEntrySheet(query, projectId),
};

let current: EntrySheetPort = httpEntrySheetPort;

/** 창구를 갈아 끼운다. null 을 주면 서버 창구로 되돌아간다. */
export function setEntrySheetPort(port: EntrySheetPort | null): void {
  current = port ?? httpEntrySheetPort;
}

export function entrySheetPort(): EntrySheetPort {
  return current;
}
