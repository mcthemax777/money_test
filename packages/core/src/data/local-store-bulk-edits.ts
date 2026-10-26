/**
 * 여러 전표를 한 번에 고치는 일. 분류 바꾸기와 태그 붙이고 떼기다. 무엇이 바뀔지는 서버와 같은 함수가 정한다.
 */

import {
  type CategoryType,
  type TagTarget,
  applyTagChange,
  planCategoryChange,
} from '@money/types';

import { codedError } from '../lib/api-error';
import type { SqlDriver } from './sql-driver';
import type { Row } from './local-store-types';
import { asInt, asText, placeholders } from './local-store-values';

/**
 * 여러 줄의 분류를 사본에서 한 분류로 바꾼다. 서버 `changeCategory` 와 **같은 함수**가 무엇을
 * 바꿀지 정한다 (`planCategoryChange`) -- 같은 유형의 줄만, 분류 줄이 없는 거래는 건너뛴다.
 *
 * 다리의 분류 칸만 고친다. 다리를 지우고 다시 만들면 그 다리에 걸린 할부 일정이 함께 사라진다.
 * 바뀐 전표의 시계는 올린다(태그 바꾸기와 같은 까닭). 부르는 쪽이 고른 전표들의 가장 늦은
 * 시계 뒤로 발급받아 오므로 뒤로 가지 않는다.
 */
export async function changeEntryCategory(
  db: SqlDriver,
  targets: readonly TagTarget[],
  categoryId: string,
  hlc: string,
): Promise<{ entries: number; skipped: TagTarget[]; excluded: number }> {
  if (targets.length === 0) return { entries: 0, skipped: [], excluded: 0 };

  let result = { entries: 0, skipped: [] as TagTarget[], excluded: 0 };
  await db.transaction(async () => {
    const plan = await planEntryCategory(db, targets, categoryId);
    for (const line of plan.lines) {
      await db.run(
        line.lineKey === null
          ? `UPDATE posting SET categoryId = ?
              WHERE entryId = ? AND lineKey IS NULL AND categoryId IS NOT NULL`
          : `UPDATE posting SET categoryId = ?
              WHERE entryId = ? AND lineKey = ? AND categoryId IS NOT NULL`,
        line.lineKey === null
          ? [categoryId, line.entryId]
          : [categoryId, line.entryId, line.lineKey],
      );
    }
    // 원거래 줄을 따라 환불·페이백도 옮긴다 (`movePayback` 처럼 다리의 분류만).
    if (plan.followerIds.length > 0) {
      await db.run(
        `UPDATE posting SET categoryId = ?
          WHERE entryId IN (${placeholders(plan.followerIds.length)}) AND categoryId IS NOT NULL`,
        [categoryId, ...plan.followerIds],
      );
    }
    if (plan.entryIds.length > 0) {
      await db.run(
        `UPDATE entry SET updatedHlc = ? WHERE id IN (${placeholders(plan.entryIds.length)})`,
        [hlc, ...plan.entryIds],
      );
    }
    result = { entries: plan.entryIds.length, skipped: plan.skipped, excluded: plan.excluded };
  });
  return result;
}

/**
 * 바꾸면 무엇이 바뀌는지만 센다. 명령을 쌓기 전에 본다 -- 바뀌는 줄이 없으면 쌓지 않는다.
 * 분류가 없으면 `CATEGORY_NOT_FOUND` 로 던진다.
 */
export async function previewEntryCategory(
  db: SqlDriver,
  targets: readonly TagTarget[],
  categoryId: string,
): Promise<{ entries: number; skipped: TagTarget[]; excluded: number }> {
  const plan = await planEntryCategory(db, targets, categoryId);
  return { entries: plan.entryIds.length, skipped: plan.skipped, excluded: plan.excluded };
}

async function planEntryCategory(db: SqlDriver, targets: readonly TagTarget[], categoryId: string) {
  const categories = await db.all<Row>(`SELECT id, type FROM category WHERE id = ?`, [
    categoryId,
  ]);
  const category = categories[0];
  if (!category) throw codedError('CATEGORY_NOT_FOUND');

  const entryIds = [...new Set(targets.map((target) => target.entryId))];
  const known = await db.all<Row>(
    `SELECT id FROM entry WHERE id IN (${placeholders(entryIds.length)})`,
    entryIds,
  );
  const lines = await db.all<Row>(
    `SELECT p.entryId, p.lineKey, p.categoryId, c.type AS categoryType,
            e.paybackOfEntryId IS NOT NULL AS linkedPayback
       FROM posting p
       JOIN category c ON c.id = p.categoryId
       JOIN entry e ON e.id = p.entryId
      WHERE p.entryId IN (${placeholders(entryIds.length)})`,
    entryIds,
  );
  const followers = await db.all<Row>(
    `SELECT id, paybackOfEntryId, paybackOfLineKey FROM entry
      WHERE paybackOfEntryId IN (${placeholders(entryIds.length)})`,
    entryIds,
  );
  const typeOf = (value: unknown): CategoryType => (String(value) === 'income' ? 'income' : 'expense');

  return planCategoryChange(
    targets,
    lines.map((row) => ({
      entryId: String(row.entryId),
      lineKey: asText(row.lineKey),
      categoryId: String(row.categoryId),
      categoryType: typeOf(row.categoryType),
      linkedPayback: asInt(row.linkedPayback) === 1,
    })),
    new Set(known.map((row) => String(row.id))),
    { id: categoryId, type: typeOf(category.type) },
    followers.map((row) => ({
      id: String(row.id),
      paybackOfEntryId: String(row.paybackOfEntryId),
      paybackOfLineKey: asText(row.paybackOfLineKey),
    })),
  );
}

/**
 * 여러 전표의 태그를 사본에서 바꾼다. 더할 것과 뗄 것을 따로 받는다.
 *
 * 전표 자체는 건드리지 않는다 -- 연결만 넣고 빼므로 금액·다리·분할이 그대로 남는다.
 * 무엇이 달라지는지는 서버와 **같은 함수**가 정한다 (`applyTagChange`). 어느 쪽에도
 * 없는 태그는 그대로 둔다.
 *
 * **바뀐 전표의 시계는 올린다.** 태그도 전표라는 한 덩어리의 일부다 (D5). 올리지
 * 않으면 이 기기의 다음 편집이 방금 붙인 태그보다 앞선 시계를 달고 나가, 서버가 그
 * 편집을 뒤에 온 것으로 보지 않는다. 뒤로 가지 않는지 여기서 견주지 않는 것은, 부르는
 * 쪽이 고른 전표들의 가장 늦은 시계 뒤로 발급받아 오기 때문이다(`latestEntryHlc`).
 *
 * 사본에 없는 전표는 건너뛴다. 고른 줄은 모두 사본에서 온 것이라 보통은 없는 일이고,
 * 그 사이 다른 기기가 지웠다면 여기서 되살릴 것이 아니다.
 *
 * 돌려주는 것은 실제로 달라진 전표의 수다. 화면이 "몇 건에 표시했다"로 쓴다.
 */
export async function changeEntryTags(
  db: SqlDriver,
  targets: readonly TagTarget[],
  addTagIds: readonly string[],
  removeTagIds: readonly string[],
  hlc: string,
): Promise<{ entries: number; skipped: TagTarget[] }> {
  if (targets.length === 0) return { entries: 0, skipped: [] };
  if (addTagIds.length === 0 && removeTagIds.length === 0) {
    return { entries: 0, skipped: [] };
  }

  const keyOf = (target: TagTarget) =>
    `${target.entryId}\u0000${target.lineKey === undefined ? '*' : target.lineKey ?? ''}`;
  const touched = new Set<string>();
  const skipped: TagTarget[] = [];

  await db.transaction(async () => {
    const entryIds = [...new Set(targets.map((target) => target.entryId))];
    const known = await db.all<Row>(
      `SELECT id FROM entry WHERE id IN (${placeholders(entryIds.length)})`,
      [...entryIds],
    );
    const present = new Set(known.map((row) => String(row.id)));
    if (present.size === 0) {
      skipped.push(...targets);
      return;
    }

    /*
     * 사라진 줄을 가린다.
     *
     * 다른 기기가 그 사이 분할을 고쳐 줄이 없어졌을 수 있다. 조용히 버리면 사용자는
     * 표시가 된 줄 알고, 다음 pull 이 태그 없는 모습으로 덮을 때에야 알게 된다.
     * 서버의 `changeTags` 와 같은 규칙이다.
     */
    const lines = await db.all<Row>(
      `SELECT entryId, lineKey FROM posting
        WHERE entryId IN (${placeholders(entryIds.length)}) AND categoryId IS NOT NULL`,
      [...entryIds],
    );
    const lineKeysOf = new Map<string, Set<string>>();
    for (const row of lines) {
      const set = lineKeysOf.get(String(row.entryId)) ?? new Set<string>();
      if (row.lineKey != null) set.add(String(row.lineKey));
      lineKeysOf.set(String(row.entryId), set);
    }

    const applicable: Array<{ entryId: string; lineKey: string | null }> = [];
    for (const target of targets) {
      if (!present.has(target.entryId)) {
        skipped.push(target);
        continue;
      }
      /*
       * 분류 줄이 하나도 없는 전표는 빈 집합이다.
       *
       * 이체와 카드 대금 결제가 그렇고, 그때 태그는 거래 자체에 붙는다(`lineKey` 가
       * null). 없는 것과 "줄이 없다"를 가르지 않으면 그 둘에 태그를 못 붙인다.
       */
      const keys = lineKeysOf.get(target.entryId) ?? new Set<string>();

      /*
       * 줄을 가리지 않은 대상은 그 전표의 모든 줄로 편다. 서버의 `changeTags` 와 같은
       * 규칙이다 -- 목록에서 범위를 골랐을 때 그 거래들의 줄 키를 화면이 모른다.
       */
      if (target.lineKey === undefined) {
        if (keys.size === 0) applicable.push({ entryId: target.entryId, lineKey: null });
        else {
          for (const lineKey of keys) applicable.push({ entryId: target.entryId, lineKey });
        }
        continue;
      }

      const exists = target.lineKey === null ? keys.size === 0 : keys.has(target.lineKey);
      if (exists) applicable.push({ entryId: target.entryId, lineKey: target.lineKey });
      else skipped.push(target);
    }
    if (applicable.length === 0) return;

    // 지금 붙어 있는 것. 무엇이 실제로 달라지는지 세려면 이것부터 알아야 한다.
    const tagIds = [...addTagIds, ...removeTagIds];
    const existing = await db.all<Row>(
      `SELECT entryId, lineKey, tagId FROM entry_tag
        WHERE entryId IN (${placeholders(entryIds.length)})
          AND tagId IN (${placeholders(tagIds.length)})`,
      [...entryIds, ...tagIds],
    );
    const currentOf = new Map<string, Set<string>>();
    for (const row of existing) {
      const key = keyOf({ entryId: String(row.entryId), lineKey: asText(row.lineKey) });
      const set = currentOf.get(key) ?? new Set<string>();
      set.add(String(row.tagId));
      currentOf.set(key, set);
    }

    /*
     * 같은 줄이 두 번 오면 한 번만 다룬다. 거래 자체에 붙는 태그는 줄 키가 NULL 인데 SQLite 는
     * NULL 끼리 다르다고 보아 기본 키가 겹침을 막지 못한다 -- 두 번 넣으면 같은 태그가 두 줄 선다.
     */
    const seen = new Set<string>();
    for (const target of applicable) {
      if (seen.has(keyOf(target))) continue;
      seen.add(keyOf(target));
      const change = applyTagChange(
        currentOf.get(keyOf(target)) ?? [],
        addTagIds,
        removeTagIds,
      );
      for (const tagId of change.added) {
        await db.run(
          `INSERT OR IGNORE INTO entry_tag (entryId, lineKey, tagId) VALUES (?, ?, ?)`,
          [target.entryId, target.lineKey, tagId],
        );
      }
      /*
       * 떼는 것은 줄마다 지운다.
       *
       * 한 문장으로 지우면 고르지 않은 형제 줄의 태그까지 떨어진다 -- 같은 전표의
       * 어떤 줄은 고르고 어떤 줄은 고르지 않을 수 있다.
       */
      if (change.removed.length > 0) {
        await db.run(
          target.lineKey === null
            ? `DELETE FROM entry_tag
                WHERE entryId = ? AND lineKey IS NULL
                  AND tagId IN (${placeholders(change.removed.length)})`
            : `DELETE FROM entry_tag
                WHERE entryId = ? AND lineKey = ?
                  AND tagId IN (${placeholders(change.removed.length)})`,
          target.lineKey === null
            ? [target.entryId, ...change.removed]
            : [target.entryId, target.lineKey, ...change.removed],
        );
      }
      if (change.changed) touched.add(target.entryId);
    }

    if (touched.size === 0) return;

    const changed = [...touched];
    await db.run(
      `UPDATE entry SET updatedHlc = ? WHERE id IN (${placeholders(changed.length)})`,
      [hlc, ...changed],
    );
  });

  return { entries: touched.size, skipped };
}
