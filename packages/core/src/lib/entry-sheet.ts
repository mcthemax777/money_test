/**
 * 거래내역 엑셀 파일을 읽고 쓴다. 웹과 앱이 함께 쓴다.
 *
 * 파일을 **얻는** 방법(웹: 파일 고르기·내려받기, 앱: 문서 고르기·공유)만 화면이 정하고,
 * 파일 ↔ 행의 변환은 여기 한 곳이다. 행 ↔ 거래는 서버(`EntrySheetService`)가 한다.
 *
 * 라이브러리는 SheetJS(xlsx 0.20.3, cdn.sheetjs.com 판)다. npm 레지스트리의 0.18.5 는 알려진
 * 취약점이 있어 쓰지 않는다.
 *
 * **날짜 칸은 일련번호로 읽는다.** 엑셀의 날짜는 1900 년부터 센 날수이고, 그것을 JS Date 로
 * 바꾸면 기기의 시간대만큼 밀리는 일이 있다(SheetJS 의 cellDates). 칸의 서식이 날짜면
 * 일련번호를 달력 값으로 바로 풀어 "YYYY-MM-DD HH:mm" 글자로 보낸다.
 */
import * as XLSX from 'xlsx';
import {
  ENTRY_SHEET_COLUMNS,
  EntrySheetDto,
  entrySheetColumnOf,
  type EntrySheetColumn,
  type EntrySheetRow,
} from '@money/types';

export interface EntrySheetReadResult {
  rows: EntrySheetRow[];
  /** 알아본 열. 화면이 "이 열들을 읽습니다"로 보여 준다. */
  columns: EntrySheetColumn[];
  /** 알아보지 못해 무시한 머리글. */
  ignoredHeaders: string[];
  /** 꼭 있어야 하는데 없는 열의 이름(날짜·금액). 하나라도 있으면 가져오지 않는다. */
  missing: string[];
}

/** 이 둘이 없으면 거래를 만들 수 없다. */
const REQUIRED: EntrySheetColumn[] = ['date', 'amount'];

/** 숫자로 적어야 합계가 되는 열. 내보낼 때 숫자 칸으로 쓴다. */
const NUMBER_COLUMNS = new Set<EntrySheetColumn>(['amount', 'billedAmount', 'discount', 'fee', 'installmentMonths']);

/**
 * 파일을 행으로. 첫 시트의 첫 행이 머리글이다.
 *
 * `data` 는 웹이면 ArrayBuffer, 앱이면 base64 글자다(파일 시스템이 그렇게 준다).
 */
export function readEntrySheet(data: ArrayBuffer | string): EntrySheetReadResult {
  const workbook = XLSX.read(data, { type: typeof data === 'string' ? 'base64' : 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || !sheet['!ref']) {
    return { rows: [], columns: [], ignoredHeaders: [], missing: REQUIRED.map(labelOf) };
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const columnAt = new Map<number, EntrySheetColumn>();
  const ignoredHeaders: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = cellText(sheet[XLSX.utils.encode_cell({ r: range.s.r, c })], false);
    if (!header) continue;
    const column = entrySheetColumnOf(header);
    // 같은 열이 둘이면 앞의 것을 쓴다.
    if (column && ![...columnAt.values()].includes(column)) columnAt.set(c, column);
    else ignoredHeaders.push(header);
  }

  const columns = [...columnAt.values()];
  const missing = REQUIRED.filter((column) => !columns.includes(column)).map(labelOf);

  const rows: EntrySheetRow[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const row: EntrySheetRow = { row: r + 1 };
    let filled = false;
    for (const [c, column] of columnAt) {
      const text = cellText(sheet[XLSX.utils.encode_cell({ r, c })], column === 'date' || column === 'time');
      if (text) {
        row[column] = text;
        filled = true;
      }
    }
    // 빈 줄(표 사이의 여백, 아래쪽 합계 줄의 빈 칸들)은 건너뛴다.
    if (filled) rows.push(row);
  }

  return { rows, columns, ignoredHeaders, missing };
}

/**
 * 칸 하나를 글자로. 날짜·시각 열이면 일련번호를 달력 값으로 푼다.
 *
 * 서식이 날짜가 아니어도 날짜 열의 숫자가 일련번호 범위(1955~2119년)면 날짜로 본다 --
 * 서식 없이 "46295" 로 저장된 파일이 있다. 20260930 같은 여덟 자리는 그 범위 밖이라
 * 서버가 글자로 읽는다.
 */
function cellText(cell: XLSX.CellObject | undefined, isDateColumn: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const isDateFormat = typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z);
    if (isDateFormat || (isDateColumn && cell.v > 20000 && cell.v < 80000)) return serialText(cell.v);
    if (isDateColumn && cell.v >= 0 && cell.v < 1) return serialText(cell.v).slice(-5);
    return String(cell.v);
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    const date = cell.v;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v).trim();
}

/** 엑셀 일련번호 → "YYYY-MM-DD HH:mm" (시각이 0 이면 날짜만). */
function serialText(serial: number): string {
  const parts = XLSX.SSF.parse_date_code(serial);
  const day = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
  return parts.H || parts.M ? `${day} ${pad(parts.H)}:${pad(parts.M)}` : day;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function labelOf(column: EntrySheetColumn): string {
  return ENTRY_SHEET_COLUMNS.find((item) => item.key === column)?.label ?? column;
}

/**
 * 행을 파일로. 모든 열을 늘 쓴다 -- 빈 파일이 곧 가져오기용 양식이다.
 *
 * 날짜는 글자("2026-09-30")로 쓴다. 날짜 칸으로 쓰면 여는 프로그램의 지역 서식에 따라
 * "2026. 9. 30." 처럼 바뀌어 저장되고, 시간대가 다른 기기에서 하루씩 밀린다.
 * 금액 열은 숫자 칸이라 엑셀에서 바로 합계를 낼 수 있다.
 */
export function writeEntrySheet(rows: EntrySheetRow[], type: 'array'): ArrayBuffer;
export function writeEntrySheet(rows: EntrySheetRow[], type: 'base64'): string;
export function writeEntrySheet(rows: EntrySheetRow[], type: 'array' | 'base64'): ArrayBuffer | string {
  const header = ENTRY_SHEET_COLUMNS.map((column) => column.label);
  const body = rows.map((row) =>
    ENTRY_SHEET_COLUMNS.map(({ key }) => {
      const value = row[key];
      if (value === undefined || value === '') return '';
      if (NUMBER_COLUMNS.has(key) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
      return value;
    }),
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet['!cols'] = ENTRY_SHEET_COLUMNS.map(({ key }) => ({ wch: COLUMN_WIDTH[key] ?? 12 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '거래내역');
  return XLSX.write(workbook, { bookType: 'xlsx', type });
}

const COLUMN_WIDTH: Partial<Record<EntrySheetColumn, number>> = {
  group: 28,
  date: 12,
  time: 7,
  kind: 8,
  payment: 16,
  toAsset: 16,
  merchant: 18,
  description: 22,
  memo: 24,
  tags: 16,
};

/**
 * 보낼 묶음으로 나눈다. 같은 거래ID 의 행은 한 묶음에 넣는다 -- 서버는 한 요청 안에서만
 * 행을 묶으므로, 분할 거래가 두 요청에 걸치면 두 거래가 된다.
 */
export function chunkEntrySheetRows(rows: EntrySheetRow[], size = EntrySheetDto.MAX_ROWS): EntrySheetRow[][] {
  const groups: EntrySheetRow[][] = [];
  const byKey = new Map<string, EntrySheetRow[]>();
  for (const row of rows) {
    const key = row.group?.trim();
    if (!key) {
      groups.push([row]);
      continue;
    }
    const group = byKey.get(key);
    if (group) group.push(row);
    else {
      const created = [row];
      byKey.set(key, created);
      groups.push(created);
    }
  }

  const chunks: EntrySheetRow[][] = [];
  let current: EntrySheetRow[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > size) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 가져올 거래 수(분할은 하나로). 화면이 "거래 N건"으로 보여 준다. */
export function countEntrySheetEntries(rows: EntrySheetRow[]): number {
  const keys = new Set<string>();
  let single = 0;
  for (const row of rows) {
    const key = row.group?.trim();
    if (key) keys.add(key);
    else single += 1;
  }
  return single + keys.size;
}

/** 내려받을 파일 이름. "거래내역_가계부이름_20260930.xlsx" */
export function entrySheetFileName(projectName: string, now = new Date()): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '').trim() || '가계부';
  return `거래내역_${safe}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`;
}
