/**
 * 사본에 줄을 넣고 지우는 기본 쓰기. 받기·로컬 커밋·아웃박스가 함께 쓴다.
 *
 * 트랜잭션은 열지 않는다. 부르는 쪽이 연 트랜잭션 안에서 돈다.
 */

import type { SqlDriver, SqlValue } from './sql-driver';
import type { Row } from './local-store-types';

/**
 * 한 행을 넣거나 갈아 끼운다.
 *
 * 서버가 준 행이 언제나 이긴다. 사본은 서버 상태의 그림자이므로 병합할 것이 없다
 * (병합은 2단계에서 보내지 못한 명령이 생길 때 이야기가 된다).
 */
export async function upsert(
  db: SqlDriver,
  table: string,
  values: Record<string, SqlValue>,
): Promise<void> {
  const columns = Object.keys(values);
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  await db.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    columns.map((column) => values[column]),
  );
}

/** 전표의 다리와 거기 딸린 할부 계획을 지운다. 전표를 지울 때와 다리를 갈아 끼울 때 쓴다. */
export async function dropEntryLegs(db: SqlDriver, entryId: string): Promise<void> {
  await db.run(
    `DELETE FROM installment_plan
      WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)`,
    [entryId],
  );
  await db.run(`DELETE FROM posting WHERE entryId = ?`, [entryId]);
}

/**
 * 반복 규칙의 태그 목록(JSON 글자)에서 그 태그를 뺀다. 서버는 연결 표가 cascade 로 지운다.
 * 남기면 다음 받기까지 규칙이 없는 태그를 들고, 그 규칙으로 만든 후보에 빈 태그가 붙는다.
 */
export async function dropTagFromRules(db: SqlDriver, tagId: string): Promise<void> {
  const rules = await db.all<Row>(`SELECT id, tagIds FROM recurring_rule WHERE tagIds LIKE ?`, [
    `%${tagId}%`,
  ]);
  for (const rule of rules) {
    let tagIds: unknown;
    try {
      tagIds = JSON.parse(String(rule.tagIds));
    } catch {
      continue;
    }
    if (!Array.isArray(tagIds)) continue;
    await db.run(`UPDATE recurring_rule SET tagIds = ? WHERE id = ?`, [
      JSON.stringify(tagIds.filter((id) => id !== tagId)),
      String(rule.id),
    ]);
  }
}

/**
 * 사본에서 한 줄을 지운다. 딸린 줄까지 함께 간다 (서버의 cascade 와 같은 자리).
 *
 * 자리표를 받았을 때와, 화면이 삭제를 서버에 성공시킨 직후에 부른다. 두 자리가 같은
 * 규칙을 각자 적으면 한쪽만 고쳐 놓고 맞다고 믿는 일이 생긴다.
 */
export async function forgetRow(db: SqlDriver, table: string, id: string): Promise<void> {
  await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);

  if (table === 'entry') {
    await dropEntryLegs(db, id);
    // 태그 연결도 함께 간다. 남기면 "이 태그가 붙은 거래 수"(`tagUsageCounts`)가 지운 거래까지 센다.
    await db.run(`DELETE FROM entry_tag WHERE entryId = ?`, [id]);
    /*
     * 걸린 환불·페이백의 링크를 비운다. 서버는 원거래와 함께 그것들도 지워 자리표를 따로
     * 보내므로(7-6) 보통은 곧 사라진다. 그 전의 서버가 지운 것(링크만 빈 것)도 받아 둔다.
     */
    await db.run(`UPDATE entry SET paybackOfEntryId = NULL WHERE paybackOfEntryId = ?`, [id]);
  }
  if (table === 'entry_draft') {
    await db.run(`DELETE FROM entry_draft_tag WHERE draftId = ?`, [id]);
  }
  if (table === 'budget') {
    // 부모가 사라지면 그 달 조정도 함께 사라진다 (서버도 cascade 로 지운다).
    await db.run(`DELETE FROM budget_override WHERE budgetId = ?`, [id]);
  }
  if (table === 'account') {
    // 계좌가 사라지면 그 계좌의 평가 기록도 사라진다.
    await db.run(`DELETE FROM asset_valuation WHERE accountId = ?`, [id]);
  }
  if (table === 'tag') {
    /*
     * 태그가 사라지면 그 태그를 가리키던 연결도 사라진다 (서버도 cascade 로 지운다).
     *
     * 남겨 두면 없는 태그를 가리키는 줄이 사본에 쌓인다. 화면에는 드러나지 않지만
     * (태그를 읽는 질의가 내부 조인이라 걸러진다), 나중에 그 id 로 별칭이 옮겨 오면
     * 엉뚱한 태그가 붙은 것처럼 보인다.
     */
    await db.run(`DELETE FROM entry_tag WHERE tagId = ?`, [id]);
    await db.run(`DELETE FROM entry_draft_tag WHERE tagId = ?`, [id]);
    await dropTagFromRules(db, id);
  }
}
