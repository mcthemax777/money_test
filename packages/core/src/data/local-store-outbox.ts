/**
 * 아웃박스. 명령을 쌓고, 서버의 판정을 반영하고, 막힌 명령을 다시 낸다.
 *
 * 트랜잭션은 부르는 쪽(`LocalStore`)이 연다. 여기 함수들은 한 트랜잭션 안에서 함께 돌아야 하는 몸통이다.
 */

import {
  type EntryCategoryPayload,
  type EntryTagsPayload,
  type Mutation,
  type MutationKind,
  type MutationResult,
  TABLE_BACKED_KINDS,
  decodeHlc,
  encodeHlc,
  hlcNext,
  hlcReceive,
  isDeferred,
  isSettingMutation,
  isSettled,
} from '@money/types';

import { track } from '../lib/analytics';
import type { SqlDriver } from './sql-driver';
import { assetClock, entryHlc, latestEntryHlc } from './local-store-clocks';
import type { Row, SettingTable } from './local-store-types';
import { asInt, asText } from './local-store-values';
import { dropTagFromRules } from './local-store-writes';

/**
 * 이 명령이 건드리는 사본의 표. 전표 명령이면 null 이다.
 *
 * 한 자리에 둔 이유가 있다. 명령을 쌓는 쪽과 막힌 명령을 다시 내는 쪽이 **같은 표의
 * 시계**를 봐야 하는데, 두 곳이 따로 알고 있으면 한쪽만 고쳐 놓고 맞다고 믿게 된다.
 * 실제로 그랬다 -- 다시 내는 쪽이 전표 표만 보아서, 통장 이름의 충돌은 몇 번을 눌러도
 * 다시 밀렸다.
 */
export function settingTableOf(kind: MutationKind): SettingTable | null {
  // 표 한 줄에 붙는 설정 명령만 표가 있다. 통합·삭제·환율 같은 것은 시계 없이 차례대로 간다.
  if (!isSettingMutation(kind) || !TABLE_BACKED_KINDS.has(kind)) return null;

  // 명령 이름이 곧 표 이름이다. 예산 조정만 (예산, 년, 월) 키라 표가 따로 있고, 반복 등록은
  // 표 이름이 길다.
  if (kind === 'budget.override') return 'budget_override';
  if (kind === 'recurring.create' || kind === 'recurring.update') return 'recurring_rule';
  return kind.split('.')[0] as SettingTable;
}

/**
 * 큐에 한 줄을 넣는다. 트랜잭션은 부르는 쪽이 연다.
 *
 * `enqueue` 와 `retryMutation` 이 함께 쓴다. 다시 보내기는 버리기와 넣기가 한 단위여야
 * 해서(둘 사이에서 멈추면 명령이 사라진다) 트랜잭션을 밖에 두었다.
 */
export async function insertMutation(
  db: SqlDriver,
  input: {
    projectId: string;
    mutationId: string;
    kind: MutationKind;
    targets: string[];
    payload: unknown;
    observed?: string | null;
  },
  now: number,
): Promise<Mutation> {
  const rows = await db.all<Row>(
    `SELECT clientId, nextSeq, lastHlc FROM client_state WHERE id = 1`,
  );
  const state = rows[0];
  if (!state) throw new Error('기기 이름이 아직 없습니다. ensureClient 를 먼저 부르세요.');

  const clientId = String(state.clientId);
  const clientSeq = asInt(state.nextSeq);
  const last = decodeHlc(asText(state.lastHlc));
  const seen = decodeHlc(input.observed);
  const hlc = encodeHlc(
    seen ? hlcReceive(last, seen, clientId, now) : hlcNext(last, clientId, now),
  );

  await db.run(
    `UPDATE client_state SET nextSeq = ?, lastHlc = ? WHERE id = 1`,
    [clientSeq + 1, hlc],
  );

  const mutation: Mutation = {
    mutationId: input.mutationId,
    clientId,
    clientSeq,
    hlc,
    kind: input.kind,
    projectId: input.projectId,
    targets: input.targets,
    payload: input.payload,
  };

  await db.run(
    `INSERT INTO outbox
       (mutationId, projectId, clientSeq, hlc, kind, targets, payload, status, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    [
      mutation.mutationId,
      mutation.projectId,
      mutation.clientSeq,
      mutation.hlc,
      mutation.kind,
      JSON.stringify(mutation.targets),
      JSON.stringify(mutation.payload),
      new Date(now).toISOString(),
    ],
  );

  return mutation;
}

/**
 * 서버가 돌려준 결과를 반영한다. 다시 낸 명령의 수를 돌려준다.
 *
 * 끝난 것(적용·중복)은 큐에서 뺀다. 그 밖은 남겨 두고 상태만 적는다 -- 충돌은 사용자가
 * 보고 고를 것이고, 거절과 보류는 왜 못 갔는지 알려야 한다. 조용히 지우면 사용자가
 * 적은 것이 아무 말 없이 사라진다.
 *
 * **순번 충돌만 예외다.** 그것은 사람이 고를 것이 없는 사정이라(내 번호가 뒤로 물러났다)
 * 서버가 알려 준 마지막 번호 다음으로 앞당기고 그 자리에서 다시 낸다. 보류 칸에 올리면
 * 사용자가 어긋난 폭만큼 "다시 보내기"를 눌러야 하고, 그동안 이 기기의 모든 변경이
 * 조용히 서버에 닿지 않는다.
 */
export async function settleMutations(
  db: SqlDriver,
  results: readonly MutationResult[],
  makeId: () => string,
): Promise<{ requeued: number }> {
  let requeued = 0;
  /** 보류 칸에 올린 것. 통계는 묶음이 실제로 적힌 뒤에 보낸다. */
  const held: MutationResult[] = [];

  await db.transaction(async () => {
    /*
     * 번호를 먼저 앞당긴다. 다시 내는 것보다 앞이어야 새 번호가 서버의 마지막을 지난다.
     *
     * 한 묶음 안의 여러 명령이 같은 값을 실어 오므로 가장 큰 것을 한 번만 본다.
     */
    const collided = results.filter(
      (result) => result.code === 'CLIENT_SEQ_TAKEN' && typeof result.lastClientSeq === 'number',
    );
    if (collided.length > 0) {
      const last = Math.max(...collided.map((result) => result.lastClientSeq as number));
      await db.run(
        `UPDATE client_state SET nextSeq = ? WHERE id = 1 AND nextSeq <= ?`,
        [last + 1, last],
      );
    }

    /** 이번에 새 번호로 다시 낸 명령들의 대상. 그 때문에 막힌 뒤 명령을 함께 다시 낸다. */
    const requeuedTargets = new Set<string>();
    for (const result of results) {
      /*
       * 서버가 다른 행을 채택했다. 사본과 큐의 참조를 그 id 로 옮긴다.
       *
       * 판정보다 먼저 한다. 이 명령이 큐에서 빠지기 전에 뒤 명령의 짐을 고쳐 두어야
       * 없는 id 를 가리킨 채로 나가지 않는다.
       */
      if (result.alias) await applyAlias(db, result.alias.from, result.alias.to);

      if (isSettled(result.status)) {
        await db.run(`DELETE FROM outbox WHERE mutationId = ?`, [result.mutationId]);
        continue;
      }
      /*
       * 판정이 나지 않은 것은 손대지 않는다.
       *
       * 서버가 같은 명령을 이미 재생하고 있다는 뜻이라 사용자가 할 일이 없다. 보류 칸에
       * 올리면 스스로 풀릴 일에 사람을 부르게 되고, 큐에서 빼면 그 재생이 실패했을 때
       * 적은 것이 사라진다. 그대로 두면 다음 동기화가 다시 보내고 그때 결과를 받는다.
       */
      if (isDeferred(result.status)) continue;

      /*
       * 순번 충돌은 다시 낸다. 짐과 대상은 그대로이고 번호와 명령 id 만 새것이다.
       *
       * 한 묶음에 여럿이 겹쳤으면 서버가 돌려준 차례대로 다시 내므로 서로의 앞뒤도
       * 그대로다. (앞의 것만 겹치고 뒤의 것은 통과한 경우에는 앞뒤가 뒤집힐 수 있다.
       * 번호가 물러난 폭이 묶음보다 작을 때인데, 그때는 뒤의 것이 앞의 것을 못 찾아
       * 보류 칸으로 가고 사용자가 그 자리에서 알게 된다.)
       */
      if (result.code === 'CLIENT_SEQ_TAKEN' && typeof result.lastClientSeq === 'number') {
        const again = await insertRetry(db, result.mutationId, makeId);
        if (again) {
          requeued += 1;
          again.targets.forEach((target) => requeuedTargets.add(target));
        }
        continue;
      }
      /*
       * 다시 낸 명령 때문에 막힌 뒤 명령도 함께 다시 낸다 (2026-10-21). 서버는 순번이 겹친 명령을 거절로
       * 돌려주고, 같은 대상을 건드리는 뒤 명령을 "막힘"으로 돌려준다. 예전에는 그것이 보류 칸에 남아 사람이
       * 다시 보내야 했다. 서버가 돌려준 차례대로 다시 내므로 앞뒤가 그대로다.
       */
      if (result.status === 'blocked' && requeuedTargets.size > 0) {
        const row = (await db.all<Row>(`SELECT targets FROM outbox WHERE mutationId = ?`, [result.mutationId]))[0];
        const targets = row ? (JSON.parse(String(row.targets)) as string[]) : [];
        if (targets.some((target) => requeuedTargets.has(target))) {
          const again = await insertRetry(db, result.mutationId, makeId);
          if (again) {
            requeued += 1;
            again.targets.forEach((target) => requeuedTargets.add(target));
          }
          continue;
        }
      }

      await db.run(`UPDATE outbox SET status = ?, error = ? WHERE mutationId = ?`, [
        result.status,
        // 코드를 앞에 붙여 둔다. 보류 칸이 그것으로 화면 언어의 문장을 고른다 (`storedReasonMessage`).
        result.code && result.error ? `${result.code}: ${result.error}` : result.error ?? null,
        result.mutationId,
      ]);
      held.push(result);
    }
  });

  for (const result of held) {
    track({
      name: 'sync_held',
      params: {
        status: result.status as 'conflict' | 'rejected' | 'blocked',
        code: result.code ?? 'none',
      },
    });
  }

  return { requeued };
}

/**
 * 기기가 만든 id 를 서버가 채택한 id 로 갈아 끼운다.
 *
 * 두 사람이 오프라인에서 같은 이름의 분류를 만들었을 때, 같은 자리(분류·태그·전체와
 * 그 달)의 예산을 각자 정했을 때다. 옮길 곳이 셋이다.
 *
 *   1. **사본의 참조** -- 다리와 예산이 그 분류를 가리키고, 소분류는 부모를 가리킨다.
 *   2. **큐에 남은 명령** -- 아직 보내지 않은 짐이 옛 id 를 들고 있다.
 *   3. **그 줄 자신** -- 서버의 행은 다음 pull 로 들어오므로 여기서 지운다.
 *
 * 트랜잭션은 부르는 쪽(`settleMutations`)이 연다.
 */
export async function applyAlias(db: SqlDriver, localId: string, serverId: string): Promise<void> {
  if (localId === serverId) return;

  await db.run(
    `INSERT OR REPLACE INTO alias (localId, serverId) VALUES (?, ?)`,
    [localId, serverId],
  );

  /*
   * 같은 달의 조정이 양쪽 예산에 다 있으면 기기 쪽을 남긴다. 그 조정의 명령이 큐에 있어
   * 서버에도 곧 그 값이 선다. 둘 다 옮기면 그 달 조정이 둘이 된다.
   */
  await db.run(
    `DELETE FROM budget_override
      WHERE budgetId = ?
        AND EXISTS (SELECT 1 FROM budget_override mine
                     WHERE mine.budgetId = ? AND mine.year = budget_override.year
                       AND mine.month = budget_override.month)`,
    [serverId, localId],
  );

  for (const [table, column] of [
    ['posting', 'categoryId'],
    ['budget', 'categoryId'],
    ['category', 'parentId'],
    ['entry_draft', 'categoryId'],
    ['entry_draft', 'feeCategoryId'],
    ['recurring_rule', 'categoryId'],
    ['recurring_rule', 'feeCategoryId'],
    ['entry_tag', 'tagId'],
    ['entry_draft_tag', 'tagId'],
    // 태그 예산도 그 태그를 가리킨다. 빠뜨리면 합쳐진 태그의 예산이 사라진 태그에 남는다.
    ['budget', 'tagId'],
    // 같은 자리의 예산을 두 기기가 각자 만들면 서버는 먼저 선 규칙을 채택한다.
    ['budget_override', 'budgetId'],
  ] as const) {
    /*
     * OR IGNORE: 한 거래에 두 태그가 다 붙어 있으면 옮긴 줄이 이미 있는 줄과 키가 겹친다.
     * 예전에는 그 오류로 정리 트랜잭션이 통째로 되돌아가 큐가 영영 정리되지 않았다.
     * 겹쳐서 남은 옛 줄은 아래에서 지운다.
     */
    await db.run(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`, [
      serverId,
      localId,
    ]);
  }
  await db.run(`DELETE FROM entry_tag WHERE tagId = ?`, [localId]);
  await db.run(`DELETE FROM entry_draft_tag WHERE tagId = ?`, [localId]);
  // 반복 규칙의 태그는 JSON 배열 글자다. 서버 태그가 이미 있으면 옛 것만 빼고, 없으면 바꾼다.
  await db.run(
    `UPDATE recurring_rule SET tagIds = replace(tagIds, ?, ?) WHERE tagIds LIKE ? AND tagIds NOT LIKE ?`,
    [localId, serverId, `%${localId}%`, `%${serverId}%`],
  );
  await dropTagFromRules(db, localId);

  /*
   * 큐의 짐은 글자로 바꾼다. JSON 을 다시 풀어 쓰는 것보다 안전하다 -- id 는
   * UUID 라 다른 값의 일부로 들어갈 일이 없고, 어느 자리에 있든 함께 옮겨야 한다.
   */
  await db.run(
    `UPDATE outbox
        SET payload = replace(payload, ?, ?),
            targets = replace(targets, ?, ?)`,
    [localId, serverId, localId, serverId],
  );

  for (const table of ['category', 'tag', 'budget'] as const) {
    await db.run(`DELETE FROM ${table} WHERE id = ?`, [localId]);
  }
}

/**
 * 다시 내기의 몸통. 트랜잭션은 부르는 쪽이 연다.
 *
 * `settleMutations` 도 이것을 쓴다 -- 순번 충돌을 그 자리에서 다시 내는데, 그쪽은 이미
 * 트랜잭션 안이라 `retryMutation` 을 부를 수 없다 (사본은 트랜잭션을 겹쳐 열지 못한다).
 */
export async function insertRetry(
  db: SqlDriver,
  mutationId: string,
  makeId: () => string,
): Promise<Mutation | null> {
  const rows = await db.all<Row>(`SELECT * FROM outbox WHERE mutationId = ?`, [mutationId]);
  const row = rows[0];
  if (!row) return null;

  const targets = JSON.parse(String(row.targets)) as string[];
  const payload = JSON.parse(String(row.payload)) as unknown;

  const kind = String(row.kind) as MutationKind;
  const observed = await observedClock(db, kind, targets, payload);

  await db.run(`DELETE FROM outbox WHERE mutationId = ?`, [mutationId]);

  return insertMutation(
    db,
    {
      projectId: String(row.projectId),
      mutationId: makeId(),
      kind,
      targets,
      payload,
      observed,
    },
    Date.now(),
  );
}

/**
 * 이 명령이 딛고 서야 할 시계. 사본에 지금 들어 있는 값을 본다.
 *
 * 충돌이었다면 그 사이에 이긴 편집이 pull 로 들어와 있다. 그것을 보고 뒤 번호를
 * 받아야 이번 명령이 이긴다 -- 사용자가 "그래도 내 값으로 하겠다"를 고른 자리다 (D6).
 *
 * **대상마다 시계가 사는 곳이 다르다.** 전표는 자기 칸(`updatedHlc`)에, 자산·분류·
 * 태그·예산은 필드별 지도(`fieldHlc`)에 있다. 전표 칸만 보면 자산 쪽은 언제나
 * 빈손이라 기기의 물리 시계로만 번호가 매겨지고, 서버의 지도가 앞서 있으면 다시
 * 밀린다 -- 몇 번을 눌러도 자기 값이 들어가지 않는다.
 *
 * 사본에 대상이 없으면(삭제가 이겼다) 없는 대로 둔다.
 */
async function observedClock(
  db: SqlDriver,
  kind: MutationKind,
  targets: readonly string[],
  payload: unknown,
): Promise<string | null> {
  const table = settingTableOf(kind);
  if (table) return targets.length > 0 ? assetClock(db, table, targets[0]) : null;
  // 표에 붙지 않는 설정 명령(통합·삭제·환율 등)은 필드별 시계가 없다. 차례대로 간다.
  if (isSettingMutation(kind)) return null;

  /*
   * 태그 표시는 여러 전표를 한 번에 건드린다. 그중 가장 늦은 시계 뒤로 가야 어느
   * 전표에서도 밀리지 않는다. 대상 목록에는 태그 id 도 섞여 있어 짐에서 읽는다
   * (쌓을 때와 같은 값이다).
   */
  if (kind === 'entry.tags') {
    const targetsOf = (payload as EntryTagsPayload | null)?.targets ?? [];
    return latestEntryHlc(db, targetsOf.map((one) => one.entryId));
  }
  // 분류 바꾸기도 같다. 대상 목록에 분류 id 가 섞여 있어 짐에서 읽는다.
  if (kind === 'entry.category') {
    const targetsOf = (payload as EntryCategoryPayload | null)?.targets ?? [];
    return latestEntryHlc(db, targetsOf.map((one) => one.entryId));
  }
  // 청구액 확정도 여러 전표를 한 번에 건드린다. 대상이 전부 전표다.
  if (kind === 'entry.restate') return latestEntryHlc(db, targets);

  return targets.length > 0 ? entryHlc(db, targets[0]) : null;
}
