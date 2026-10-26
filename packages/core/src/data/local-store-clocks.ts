/**
 * 편집 시계. 필드별 시계 지도(fieldHlc)를 풀고 찍는 일과, 다음 명령의 시계를 매길 때 보는 값을 읽는 일이다.
 */

import { type FieldClocks, latestFieldClock } from '@money/types';

import type { SqlDriver } from './sql-driver';
import type { Row, SettingTable } from './local-store-types';
import { asText, placeholders } from './local-store-values';

/** 사본에 담긴 시계 지도를 되돌린다. 모양이 아니면 빈 지도다. */
export function parseClocks(value: string | null): FieldClocks {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clocks: FieldClocks = {};
    for (const [field, clock] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof clock === 'string') clocks[field] = clock;
    }
    return clocks;
  } catch {
    return {};
  }
}

/** 방금 쓴 필드에만 시계를 찍어 다시 글자로. 나머지 필드의 시계는 그대로 둔다. */
export function mergeClocks(stored: string | null, fields: readonly string[], hlc: string): string {
  const clocks = parseClocks(stored);
  for (const field of fields) {
    // 줄을 가리키는 값에는 시계를 찍지 않는다. 병합의 대상이 아니다.
    if (field === 'id' || field === 'projectId') continue;
    clocks[field] = hlc;
  }
  return JSON.stringify(clocks);
}

/**
 * 여러 전표 중 가장 늦은 시계.
 *
 * 태그 명령처럼 한 번에 여러 전표를 건드리는 명령이 쓴다. 그중 가장 늦은 값 뒤로
 * 시계를 발급해야, 사본에 그 시계를 찍을 때 어느 전표의 시계도 뒤로 가지 않는다.
 */
export async function latestEntryHlc(
  db: SqlDriver,
  entryIds: readonly string[],
): Promise<string | null> {
  if (entryIds.length === 0) return null;

  const rows = await db.all<Row>(
    `SELECT MAX(updatedHlc) AS hlc FROM entry WHERE id IN (${placeholders(entryIds.length)})`,
    [...entryIds],
  );
  return asText(rows[0]?.hlc);
}

/** 사본이 아는 그 전표의 시계. 수정 명령의 시계를 이 뒤로 놓는 데 쓴다. */
export async function entryHlc(db: SqlDriver, entryId: string): Promise<string | null> {
  const rows = await db.all<Row>(`SELECT updatedHlc FROM entry WHERE id = ?`, [entryId]);
  return asText(rows[0]?.updatedHlc);
}

/**
 * 이 자산 줄의 마지막 편집 시각.
 *
 * 기기가 "내가 본 값"의 시계로 쓴다. 필드마다 다르므로 그중 가장 늦은 것을 준다 --
 * 그 값을 보고 매긴 시계는 지금 사본에 있는 어떤 필드보다도 뒤가 된다.
 */
export async function assetClock(
  db: SqlDriver,
  table: SettingTable,
  id: string,
): Promise<string | null> {
  const rows = await db.all<Row>(`SELECT fieldHlc FROM ${table} WHERE id = ?`, [id]);
  return latestFieldClock(parseClocks(asText(rows[0]?.fieldHlc)));
}
