/**
 * 기기에 둔 원장 사본.
 *
 * 화면은 이 저장소만 읽는다. 서버와 이야기하는 것은 동기화 엔진 하나뿐이다.
 * 그래서 온라인과 오프라인의 코드 경로가 갈리지 않는다.
 *
 * 여기서 하는 일은 둘이다.
 *   - 변경 피드(`GET /sync/pull`)의 응답을 그대로 사본에 적는다.
 *   - 화면이 쓸 모양으로 다시 읽어 준다. 더하기는 `@money/types` 의 집계 함수가 한다.
 *
 * 집계를 여기서 SQL 로 하지 않는 것은 규칙이 두 벌이 되기 때문이다. 서버도 같은
 * 함수를 쓰므로, 같은 달의 합계가 기기와 웹에서 갈릴 자리를 만들지 않는다.
 *
 * 이 파일은 저장소의 겉면이다. 메서드 이름과 모양은 화면·동기화가 부르는 그대로 두고, 몸통이 긴 일은
 * 곁의 `local-store-*.ts` 에 함수로 두었다 (받기 `-pull`, 로컬 커밋 `-commit`, 아웃박스 `-outbox`,
 * 여러 전표 고치기 `-bulk-edits`, 목록 줄 만들기 `-entry-view`, 카드 다리 `-card-postings`, 목록 조건
 * `-entry-filters`). 그 함수들은 `db` 를 받을 뿐 트랜잭션의 경계는 원래 자리 그대로다.
 */

import {
  type AccountDto,
  type CardDto,
  type CategoryDto,
  type EntryDraftDto,
  type TagTarget,
  type TagDto,
  Dec,
  type PersonDto,
  type ViewEntry,
  type CategoryNode,
  type CategoryPostingRow,
  type NamedCategoryPostingRow,
  type BuiltEntry,
  type Mutation,
  type MutationKind,
  type MutationResult,
  HIDDEN_ACCOUNT_TYPES,
  type NetWorthAccountRow,
  lineMatcherOf,
  SyncDto,
  newId,
  currencyDecimals,
  ledgerOpeningDate,
  isOverrideFrom,
  planBudgetFrom,
  recurringClockKeys,
  zonedDateKey,
  zonedYearMonth,
  RestateError,
  pendingRateItems,
  restateAmounts,
  shareListOf,
} from '@money/types';

import { SCHEMA_STATEMENTS, SCHEMA_VERSION, ALL_TABLES } from './schema';
import type { SqlDriver, SqlValue } from './sql-driver';
import { changeEntryCategory, changeEntryTags, previewEntryCategory } from './local-store-bulk-edits';
import { cardLedgerPostings, creditCardPostings, debitCardPostings } from './local-store-card-postings';
import { assetClock, entryHlc, latestEntryHlc, mergeClocks } from './local-store-clocks';
import { writeAsset, writeEntry } from './local-store-commit';
import {
  narrowFilter,
  ownerFilter,
  paybackOfFilter,
  periodFilter,
  searchFilter,
} from './local-store-entry-filters';
import { attachPostings } from './local-store-entry-view';
import {
  maskCardNumber,
  openingSeed,
  recurringRow,
  spreadRowOf,
  toDraftResponse,
  toMutation,
} from './local-store-mappers';
import { applyAlias, insertMutation, insertRetry, settleMutations } from './local-store-outbox';
import { applyPull } from './local-store-pull';
import {
  CHILD_TABLES,
  INDEX_STATEMENTS,
  MIRROR_TABLES,
  TABLE_STATEMENTS,
  expectedColumns,
} from './local-store-schema-shape';
import {
  REBUILD_PENDING,
  type HeldMutation,
  type MirrorEntryScope,
  type RestatePlan,
  type Row,
  type SettingTable,
  type StoredAccount,
  type StoredBudget,
  type StoredCardLedgerPosting,
  type StoredCardPosting,
  type StoredLedgerRow,
  type StoredPaymentCard,
  type StoredPerformanceCard,
  type SyncCursor,
} from './local-store-types';
import { asInt, asMoney, asOfClause, asText, placeholders } from './local-store-values';
import { dropEntryLegs, dropTagFromRules, forgetRow, upsert } from './local-store-writes';

/*
 * 바깥이 이 파일에서 가져가던 이름들. 몸통을 곁 파일로 옮겨도 가져가는 자리는 그대로 둔다.
 */
export {
  REBUILD_PENDING,
  type HeldMutation,
  type MirrorEntryScope,
  type RestatePlan,
  type SettingTable,
  type StoredAccount,
  type StoredBudget,
  type StoredCardLedgerPosting,
  type StoredCardPosting,
  type StoredLedgerRow,
  type StoredPaymentCard,
  type StoredPerformanceCard,
  type SyncCursor,
} from './local-store-types';
export { recurringRow } from './local-store-mappers';
export { settingTableOf } from './local-store-outbox';

export class LocalStore {
  constructor(private readonly db: SqlDriver) {}

  /**
   * 표를 만든다. 프로젝트를 고르기 전에도 부를 수 있다.
   *
   * `init` 과 나눠 두는 이유가 있다. 아웃박스와 기기 이름(client_state)은 프로젝트에
   * 매이지 않아서, 앱이 시작할 때 프로젝트를 고르기 전에 이미 필요하다. 표를 만드는
   * 일이 `init(projectId, ...)` 안에만 있으면 그 자리에서 "표가 없다"로 넘어진다
   * (에뮬레이터에서 실제로 그랬다: setupOffline 의 ensureClient 가 첫 줄에서 죽어
   * 오프라인이 통째로 꺼졌다).
   *
   * 문장은 전부 `IF NOT EXISTS` 라 여러 번 불러도 같다.
   */
  async ensureSchema(): Promise<void> {
    /*
     * 색인은 모양을 본 뒤에 세운다. 옛 표에 없는 컬럼으로 색인을 세우면 "no such column"
     * 으로 넘어져 아래의 모양 검사에 닿지 못하고, 사본을 영영 열지 못한다 -- 판 32 이전의
     * 사본이 `entry_payback_idx` 에서 실제로 그랬다.
     */
    await this.createTables(TABLE_STATEMENTS);

    /*
     * 표의 **모양**도 본다. 번호만 믿지 않는다.
     *
     * `CREATE TABLE IF NOT EXISTS` 는 이미 있는 표를 손대지 않는다. 그래서 컬럼이 늘어난
     * 판으로 올라간 기기는 표가 옛 모양 그대로 남고, 동기화가 "no column named ..." 로
     * 매번 실패한다. 판 번호는 이미 새것으로 적혀 있어 그것만 보면 알아채지 못한다
     * (에뮬레이터가 실제로 그 상태에 빠졌다).
     *
     * 어긋나면 부수고 다시 세운다. 사본은 서버에서 다시 받을 수 있는 캐시라, 잃는 것은
     * 다시 받는 시간뿐이다. 아웃박스는 그대로 둔다.
     */
    if (await this.hasStaleShape()) {
      await this.rebuild();
      return;
    }
    await this.createTables(INDEX_STATEMENTS);
  }

  /** 표를 만든다. 이미 있으면 그대로 둔다. */
  private async createTables(statements: readonly string[] = SCHEMA_STATEMENTS): Promise<void> {
    for (const statement of statements) {
      await this.db.run(statement);
    }
  }

  /** 스키마가 적어 둔 컬럼 중 실제 표에 없는 것이 있는가. */
  private async hasStaleShape(): Promise<boolean> {
    for (const [table, expected] of expectedColumns()) {
      const rows = await this.db.all<Row>(`PRAGMA table_info(${table})`);
      if (rows.length === 0) continue;

      const actual = new Set(rows.map((row) => String(row.name)));
      if (expected.some((column) => !actual.has(column))) return true;
    }
    return false;
  }

  /**
   * 이 프로젝트의 사본이 쓸 수 있는 상태인지 본다.
   *
   * 스키마 번호가 다르면 사본을 버린다. 옮기는 코드를 쓰는 대신 버리는 것은, 이
   * 사본이 서버에서 다시 받을 수 있는 캐시이기 때문이다. 아직 보내지 못한 명령이
   * 생기는 2단계부터는 그 큐만 따로 지켜야 한다.
   */
  async init(projectId: string, timeZone: string): Promise<SyncCursor> {
    await this.ensureSchema();

    const existing = await this.cursor(projectId);
    if (!existing) {
      await this.db.run(
        `INSERT INTO sync_state (projectId, version, schemaVersion, timeZone, syncedAt, mirrorFloor)
         VALUES (?, 0, ?, ?, NULL, 0)`,
        [projectId, SCHEMA_VERSION, timeZone],
      );
      return { projectId, version: 0, timeZone, syncedAt: null, mirrorFloor: 0 };
    }

    const rows = await this.db.all<Row>(
      `SELECT schemaVersion FROM sync_state WHERE projectId = ?`,
      [projectId],
    );
    if (asInt(rows[0]?.schemaVersion) !== SCHEMA_VERSION) {
      await this.rebuild();
      return this.init(projectId, timeZone);
    }

    // 프로젝트 타임존이 바뀌었으면 달력 키를 다시 계산한다.
    if (existing.timeZone !== timeZone) {
      await this.recomputeCalendarKeys(projectId, timeZone);
      return { ...existing, timeZone };
    }

    return existing;
  }

  async cursor(projectId: string): Promise<SyncCursor | null> {
    const rows = await this.db.all<Row>(
      `SELECT projectId, version, timeZone, syncedAt, mirrorFloor
         FROM sync_state WHERE projectId = ?`,
      [projectId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      projectId: String(row.projectId),
      version: asInt(row.version),
      timeZone: String(row.timeZone),
      syncedAt: asText(row.syncedAt),
      mirrorFloor: asInt(row.mirrorFloor),
    };
  }

  /**
   * 사본의 표를 **부수고 다시 세운다.** 스키마 번호가 달라졌을 때 부른다.
   *
   * 행을 지우는 것(`reset`)으로는 모자란다. 컬럼이 늘어난 판이면 옛 표에는 그 컬럼이
   * 없고, `CREATE TABLE IF NOT EXISTS` 는 이미 있는 표를 손대지 않는다. 그대로 두면
   * 동기화가 "table person has no column named ..." 로 매번 실패한다 -- 실제로 그랬다.
   *
   * **아웃박스와 기기 이름은 부수지 않는다.** 그 둘은 사본이 아니라 아직 아무 데도 없는
   * 값이다 (ALL_TABLES 에 넣지 않은 이유이기도 하다). 여기서 지우면 오프라인에서 적어 둔
   * 거래가 사라진다.
   */
  async rebuild(): Promise<void> {
    await this.db.transaction(async () => {
      for (const table of MIRROR_TABLES) {
        await this.db.run(`DROP TABLE IF EXISTS ${table}`);
      }
    });
    // 모양 검사를 다시 돌리지 않는다. 방금 세운 표라 어긋날 수 없고, 부르면 서로 부른다.
    await this.createTables();
  }

  /**
   * 사본을 통째로 버린다. 다음 동기화가 처음부터 받는다.
   *
   * 표마다 프로젝트를 가리키는 방식이 다르다. 대부분은 `projectId` 컬럼을 갖지만
   * `project` 는 자기 자신이라 `id` 이고, 다리와 월 조정은 프로젝트를 가리키지 않아
   * 부모를 따라 지운다.
   */
  async reset(projectId: string): Promise<void> {
    await this.db.transaction(() => this.clearMirrorRows(projectId));
  }

  /**
   * 사본을 버리고 **처음부터 받을 채비**를 한 트랜잭션에서 끝낸다.
   *
   * 서버가 보관 기간이 지난 자리표를 지운 뒤에 부른다. 커서를 0 으로 되돌리는 동시에
   * 그때의 바닥을 적어 두는 것이 요점이다. 둘을 나누면 사이에서 끊겼을 때 바닥이 0 으로
   * 남아, 다음 동기화가 또 처음부터 받기를 되풀이한다.
   *
   * 아웃박스는 건드리지 않는다. 그 안에 든 것은 아직 아무 데도 없는 값이다.
   */
  async resetForRebuild(projectId: string, timeZone: string, tombstoneFloor: number): Promise<void> {
    await this.db.transaction(async () => {
      await this.clearMirrorRows(projectId);
      await this.db.run(
        `INSERT INTO sync_state (projectId, version, schemaVersion, timeZone, syncedAt, mirrorFloor)
         VALUES (?, 0, ?, ?, NULL, ?)`,
        [projectId, SCHEMA_VERSION, timeZone, tombstoneFloor],
      );
    });
  }

  /**
   * 사본을 버리지 않고 바닥만 적어 둔다.
   *
   * 서버가 자리표를 지웠지만 이 사본은 버릴 이유가 없을 때다. 두 경우가 있다.
   * 커서가 이미 바닥을 넘어섰거나(따라붙어 있는 기기), 아직 아무것도 담기지 않았거나
   * (처음 쓰는 기기). 둘 다 "이 사본에는 그 바닥보다 전에 지워진 행이 없다"는 뜻이라
   * 다음 판단의 기준으로 그대로 쓸 수 있다.
   */
  async setMirrorFloor(projectId: string, tombstoneFloor: number): Promise<void> {
    /*
     * 혼자 쓰는 문장도 트랜잭션 줄에 세운다 (2026-10-16). expo-sqlite 의 트랜잭션은 배타가 아니라,
     * 그 사이 들어온 문장이 남의 트랜잭션 안에서 돌고 그 트랜잭션이 되돌아가면 함께 사라진다.
     * 아래 단독 쓰기들(putDraft·forgetDraftOp·discardMutation)도 같은 까닭으로 감싼다.
     */
    await this.db.transaction(() =>
      this.db.run(`UPDATE sync_state SET mirrorFloor = ? WHERE projectId = ?`, [
        tombstoneFloor,
        projectId,
      ]),
    );
  }

  /**
   * 한 가계부를 기기에서 통째로 잊는다 -- 사본의 행, 커서, 그 가계부의 못 보낸 명령과 보관함 처리.
   *
   * 그 가계부에 더 갈 수 없게 되었을 때(내보내짐·탈퇴·삭제) 쓴다. 예전에는 사본 파일을 통째로
   * 지워서, **다른 가계부에 적어 두고 아직 못 보낸 것까지** 함께 사라졌다 (2026-10-16). 그 가계부의
   * 명령은 어차피 보낼 곳이 없다.
   */
  async forgetProject(projectId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.clearMirrorRows(projectId);
      await this.db.run(`DELETE FROM sync_state WHERE projectId = ?`, [projectId]);
      await this.db.run(`DELETE FROM outbox WHERE projectId = ?`, [projectId]);
      await this.db.run(`DELETE FROM draft_op WHERE projectId = ?`, [projectId]);
    });
  }

  /** 아직 보내지 않은(pending) 명령이 있는 가계부들. */
  async pendingProjectIds(): Promise<string[]> {
    const rows = await this.db.all<Row>(`SELECT DISTINCT projectId FROM outbox WHERE status = 'pending'`);
    return rows.map((row) => String(row.projectId));
  }

  /** 이 기기에 사본이나 보내지 못한 명령이 남아 있는 가계부들. */
  async mirroredProjectIds(): Promise<string[]> {
    const rows = await this.db.all<Row>(
      `SELECT projectId FROM sync_state UNION SELECT projectId FROM outbox`,
    );
    return rows.map((row) => String(row.projectId));
  }

  /** 사본의 행을 지운다. 트랜잭션은 부르는 쪽이 연다. */
  private async clearMirrorRows(projectId: string): Promise<void> {
    for (const table of ALL_TABLES) {
      if (CHILD_TABLES.some((child) => child.table === table)) continue;

      const column = table === 'project' ? 'id' : 'projectId';
      await this.db.run(`DELETE FROM ${table} WHERE ${column} = ?`, [projectId]);
    }

    /*
     * 부모가 사라졌으므로 남은 자식을 걷어낸다.
     *
     * 순서가 있다. 할부 계획은 다리를, 다리는 전표를 가리키므로 다리를 먼저 치우면
     * 계획이 가리킬 곳이 사라진다. CHILD_TABLES 가 그 순서대로 적혀 있다.
     */
    for (const { table, column, parent } of CHILD_TABLES) {
      await this.db.run(`DELETE FROM ${table} WHERE ${column} NOT IN (SELECT id FROM ${parent})`);
    }
  }

  /**
   * 변경 피드의 응답을 사본에 적는다. 한 트랜잭션 안에서 행을 넣고 커서를 올린다 (`local-store-pull`).
   */
  async applyPull(response: SyncDto.PullResponse, timeZone: string): Promise<void> {
    await applyPull(this.db, response, timeZone);
  }


  /**
   * 프로젝트 타임존이 바뀌었을 때 달력 키를 다시 계산한다.
   *
   * 이 값은 저장할 때 정해지는 것이라 타임존이 바뀌면 전부 어긋난다. 서울에서
   * 뉴욕으로 바꾸면 8월 1일 새벽 거래가 7월로 옮겨가야 한다.
   */
  async recomputeCalendarKeys(projectId: string, timeZone: string): Promise<void> {
    const rows = await this.db.all<Row>(`SELECT id, date FROM entry WHERE projectId = ?`, [
      projectId,
    ]);

    await this.db.transaction(async () => {
      for (const row of rows) {
        const instant = new Date(String(row.date));
        await this.db.run(`UPDATE entry SET dateKey = ?, yearMonth = ? WHERE id = ?`, [
          zonedDateKey(instant, timeZone),
          zonedYearMonth(instant, timeZone),
          String(row.id),
        ]);
      }
      await this.db.run(`UPDATE sync_state SET timeZone = ? WHERE projectId = ?`, [
        timeZone,
        projectId,
      ]);
    });
  }

  // ───────────────────────────────────────────
  // 읽기
  // ───────────────────────────────────────────

  async people(
    projectId: string,
  ): Promise<Array<{ id: string; name: string; isActive: boolean; sortRank: string }>> {
    const rows = await this.db.all<Row>(
      `SELECT id, name, isActive, sortRank FROM person WHERE projectId = ? ORDER BY sortRank, name`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      isActive: Boolean(row.isActive),
      // 화면이 드래그로 옮길 때 이웃의 값을 봐야 한다 (`lib/reorder-rank`).
      sortRank: String(row.sortRank),
    }));
  }

  async categories(projectId: string): Promise<CategoryNode[]> {
    const rows = await this.db.all<Row>(
      `SELECT id, type, parentId FROM category WHERE projectId = ?`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type) as CategoryNode['type'],
      parentId: asText(row.parentId),
    }));
  }

  async accounts(projectId: string): Promise<StoredAccount[]> {
    const [rows, balances] = await Promise.all([
      this.db.all<Row>(
        `SELECT a.id, a.ownerId, p.name AS ownerName, a.type, a.name, a.currency,
                a.isActive, a.sortRank
           FROM account a
           LEFT JOIN person p ON p.id = a.ownerId
          WHERE a.projectId = ?
          ORDER BY a.sortRank, a.name`,
        [projectId],
      ),
      this.accountBalances(projectId),
    ]);

    return rows.map((row) => ({
      id: String(row.id),
      ownerId: asText(row.ownerId),
      ownerName: asText(row.ownerName),
      type: String(row.type),
      name: String(row.name),
      currency: String(row.currency),
      balance: balances.get(String(row.id)) ?? '0',
      isActive: Boolean(row.isActive),
      sortRank: String(row.sortRank),
    }));
  }

  /**
   * 계좌마다 지금 잔액. **서버가 준 `account.balance` 칸을 읽지 않고 다리를 더한다.**
   *
   * 잔액은 그 계좌에 걸린 다리 금액의 합이고, 서버의 그 칸은 쓸 때마다 증분으로
   * 움직이는 캐시다(api 의 `check-balances` 가 그 정의를 지킨다). 사본에는 다리가 전부
   * 있으므로 기기도 같은 값을 낼 수 있다.
   *
   * 세는 쪽을 고른 까닭은 **아직 보내지 못한 거래**다. 오프라인에서 적은 전표는 사본의
   * 다리로 들어가지만 서버의 캐시에는 없어, 그 칸을 읽으면 화면 위의 잔액과 원장 줄의
   * 누적 잔액이 그 금액만큼 벌어진다. 세면 둘이 정의상 맞는다.
   *
   * 더하는 일은 SQL 이 아니라 Dec 가 한다 (`bookValues` 와 같은 까닭이다 -- SQLite 의
   * SUM 은 REAL 로 되돌려 원 단위가 어긋난다).
   *
   * `asOf` 뒤 날짜의 전표는 세지 않는다 (서버의 `balancesAsOf` 와 같은 규칙). 미리 적어 둔
   * 다음 주 월급이 오늘 통장에 있는 것처럼 보이면 안 된다. null 이면 전부 센다 -- 지울 수
   * 있는지 볼 때는 미래의 거래도 잔액이다.
   */
  async accountBalances(
    projectId: string,
    asOf: Date | null = new Date(),
  ): Promise<Map<string, string>> {
    const cut = asOfClause(asOf);
    const [seeds, rows] = await Promise.all([
      this.db.all<Row>(
        `SELECT a.id, a.balance, a.updatedVersion FROM account a WHERE a.projectId = ?`,
        [projectId],
      ),
      this.db.all<Row>(
        `SELECT p.accountId, p.amount
           FROM posting p
           JOIN account a ON a.id = p.accountId
           JOIN entry e ON e.id = p.entryId
          WHERE a.projectId = ?${cut.sql}`,
        [projectId, ...cut.params],
      ),
    ]);

    const totals = new Map<string, Dec>(
      seeds.map((row) => [String(row.id), openingSeed(row)]),
    );
    for (const row of rows) {
      const id = String(row.accountId);
      totals.set(id, (totals.get(id) ?? Dec.of(0)).plus(asMoney(row.amount)));
    }
    return new Map([...totals].map(([id, total]) => [id, total.toString()]));
  }

  /** 계좌 하나의 지금 잔액. 카드 상세처럼 한 계좌만 볼 때 쓴다. */
  async accountBalance(accountId: string): Promise<string> {
    const cut = asOfClause(new Date());
    const [seed, rows] = await Promise.all([
      this.openingSeedOf(accountId),
      this.db.all<Row>(
        `SELECT p.amount FROM posting p JOIN entry e ON e.id = p.entryId
          WHERE p.accountId = ?${cut.sql}`,
        [accountId, ...cut.params],
      ),
    ]);

    let total = Dec.of(seed);
    for (const row of rows) total = total.plus(asMoney(row.amount));
    return total.toString();
  }

  /**
   * 계좌 하나의 기초 잔액 씨앗 (`openingSeed`). 서버가 아는 계좌면 0 이다. 잔액과 원장 줄의 누적이 같은 데서
   * 출발해야 한다 -- 원장이 0 에서 세면 오프라인에서 만든 통장의 줄 잔액이 머리의 잔액과 그만큼 갈렸다.
   */
  async openingSeedOf(accountId: string): Promise<string> {
    const rows = await this.db.all<Row>(
      `SELECT a.id, a.balance, a.updatedVersion FROM account a WHERE a.id = ?`,
      [accountId],
    );
    return (rows[0] ? openingSeed(rows[0]) : Dec.of(0)).toString();
  }

  /**
   * 순자산 계산에 넣을 계좌들.
   *
   * 시가는 평가 기록에서, 장부가는 다리 합에서 낸다. 둘 다 사본에 있다 -- 평가액은
   * 변경 피드로 함께 오고(`assetValuations`), 전표는 날짜로 자르지 않고 전부 받는다.
   * 평가 기록이 없는 계좌는 순자산 함수가 장부 잔액으로 되돌아간다.
   */
  async netWorthRows(projectId: string): Promise<NetWorthAccountRow[]> {
    const rows = (await this.accounts(projectId)).filter((row) => row.isActive);
    if (rows.length === 0) return [];

    const [marketValues, bookValues, paymentTypeOf] = await Promise.all([
      this.latestMarketValues(projectId),
      this.bookValues(projectId),
      this.cardPaymentTypes(projectId),
    ]);

    return rows.map((row) => ({
      id: row.id,
      type: row.type as NetWorthAccountRow['type'],
      paymentAccountType: paymentTypeOf.get(row.id) ?? null,
      currency: row.currency,
      balance: row.balance,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      marketValue: marketValues.get(row.id) ?? null,
      bookValue: bookValues.get(row.id) ?? null,
    }));
  }

  /**
   * 카드 부채 계정마다 결제 통장의 유형. 카드 대금을 그 통장의 묶음에 넣는다
   * (`groupOfRow`, 서버의 getNetWorth·getBalanceHistory 와 같다).
   */
  async cardPaymentTypes(projectId: string): Promise<Map<string, NetWorthAccountRow['type']>> {
    const rows = await this.db.all<Row>(
      `SELECT c.liabilityAccountId AS id, pay.type AS type
         FROM card c
         JOIN account pay ON pay.id = c.paymentAccountId
        WHERE c.projectId = ? AND c.liabilityAccountId IS NOT NULL`,
      [projectId],
    );
    return new Map(
      rows.map((row) => [String(row.id), String(row.type) as NetWorthAccountRow['type']]),
    );
  }

  /**
   * 계좌마다 가장 최근 평가액. 서버의 `latestMarketValues` 와 같은 규칙이다.
   *
   * 날짜가 가장 늦은 한 건을 고른다. 같은 날짜가 둘일 수는 없다(서버에 (계좌, 날짜)
   * 유일 제약이 있다). 평가 기록이 없는 계좌는 지도에 담기지 않고, 그러면 순자산
   * 함수가 장부 잔액으로 되돌아간다. 0원으로 채우면 총자산이 통째로 틀린다.
   */
  private async latestMarketValues(projectId: string): Promise<Map<string, string>> {
    const rows = await this.db.all<Row>(
      `SELECT v.accountId, v.marketValue
         FROM asset_valuation v
         JOIN account a ON a.id = v.accountId
        WHERE a.projectId = ?
          AND v.date = (SELECT MAX(v2.date) FROM asset_valuation v2
                         WHERE v2.accountId = v.accountId)`,
      [projectId],
    );
    return new Map(rows.map((row) => [String(row.accountId), asMoney(row.marketValue)]));
  }

  /**
   * 계좌마다 장부가. 그 계좌 다리의 저장 통화 합계다.
   *
   * 구간을 두지 않는 것은 서버와 같다. 장부가는 "이 계좌에 그동안 얼마가 들어갔나"라서
   * 전 기간 합계여야 시가와 나란히 놓고 미실현손익을 낼 수 있다. 다만 잔액처럼 지금 뒤의
   * 전표는 빼야 잔액과 같은 다리를 센다.
   */
  private async bookValues(projectId: string): Promise<Map<string, string>> {
    const cut = asOfClause(new Date());
    /*
     * 더하는 일은 SQL 이 아니라 Dec 가 한다.
     *
     * SQLite 의 SUM 은 이 값을 REAL 로 되돌리는데 그것은 배정밀도 부동소수라 원 단위가
     * 어긋난다. 금액을 TEXT 로 담은 이유가 그것이다(schema.ts 의 머리말). 한 가정의
     * 다리 수는 수천 줄이라 자바스크립트에서 더해도 부담이 없다.
     */
    const rows = await this.db.all<Row>(
      `SELECT p.accountId, p.baseAmount
         FROM posting p
         JOIN account a ON a.id = p.accountId
         JOIN entry e ON e.id = p.entryId
        WHERE a.projectId = ?${cut.sql}`,
      [projectId, ...cut.params],
    );

    const totals = new Map<string, Dec>();
    for (const row of rows) {
      const id = String(row.accountId);
      totals.set(id, (totals.get(id) ?? Dec.of(0)).plus(asMoney(row.baseAmount)));
    }
    return new Map([...totals].map(([id, total]) => [id, total.toString()]));
  }

  /**
   * 그 구간의 카테고리 다리. 집계 함수에 그대로 넣는 모양이다.
   *
   * 날짜는 프로젝트 타임존의 달력 키로 고른다. 재료화해 둔 컬럼이 여기서 값을 한다.
   * 양끝을 포함한다.
   */
  async categoryPostings(
    projectId: string,
    range: MirrorEntryScope,
  ): Promise<NamedCategoryPostingRow[]> {
    // 아무도 고르지 않았으면 한 건도 나오지 않아야 한다 ("전체"와 뜻이 다르다).
    if (range.ownerIds && range.ownerIds.length === 0) return [];
    if (range.search?.matchNothing) return [];

    const owner = ownerFilter(range.ownerIds);
    /*
     * 검색은 **전표 수준**으로 걸린다. 다리 자신이 검색에 맞는지 보는 것이 아니라
     * "그런 다리를 가진 전표인가"를 본다. 그래서 식비를 찾으면 식비가 섞인 분할 거래가
     * 통째로 들고, 달 합계가 화면에 보이는 거래들의 합과 같아진다. 서버의 entryScope 와
     * 같은 규칙이다.
     */
    const search = searchFilter(range.search);
    /*
     * 회차 기준이면 할부 계획을 줄에 함께 싣는다.
     *
     * 할부는 카드 다리에 걸리므로 같은 전표의 그 다리를 찾아 읽는다. 한 전표에 하나뿐이라
     * 딸림질의가 한 줄씩만 낸다. 서버의 AGGREGATE_SELECT 와 같은 값을 모은다.
     */
    const plan = range.withInstallment
      ? `,
              (SELECT ip.totalMonths FROM posting cp
                 JOIN installment_plan ip ON ip.postingId = cp.id
                WHERE cp.entryId = e.id LIMIT 1) AS installmentMonths,
              (SELECT ip.principalShares FROM posting cp
                 JOIN installment_plan ip ON ip.postingId = cp.id
                WHERE cp.entryId = e.id LIMIT 1) AS principalShares,
              (SELECT ip.interestShares FROM posting cp
                 JOIN installment_plan ip ON ip.postingId = cp.id
                WHERE cp.entryId = e.id LIMIT 1) AS interestShares,
              (SELECT cp.baseAmount FROM posting cp
                 JOIN installment_plan ip ON ip.postingId = cp.id
                WHERE cp.entryId = e.id LIMIT 1) AS installmentBase,
              (SELECT cp.amount FROM posting cp
                 JOIN installment_plan ip ON ip.postingId = cp.id
                WHERE cp.entryId = e.id LIMIT 1) AS installmentAmount,
              /*
               * 할부 환불 (installment-refund). 이 전표가 할부 환불이면 줄인 금액과 자기 날짜,
               * 할부 원거래면 걸린 할부 환불들(줄 키 · JSON 을 한 칸에 이어 붙인다).
               */
              p.lineKey AS lineKey, e.date AS ownDate, e.installmentAdjust AS refundAdjust,
              (SELECT group_concat(COALESCE(r.paybackOfLineKey, '') || char(31) || r.installmentAdjust, char(30))
                 FROM entry r
                WHERE r.paybackOfEntryId = e.id AND r.installmentAdjust IS NOT NULL) AS installmentCuts`
      : '';
    /*
     * 분석은 연결된 페이백을 원거래의 날짜로 고르고 그 날짜로 센다 (서버 common/payback-scope).
     * 거래 탭의 달 목록처럼 들어온 날짜로 셀 자리는 `dateBasis: 'own'` 을 넘긴다.
     */
    const analysis = (range.dateBasis ?? 'analysis') === 'analysis';
    const period = periodFilter({ ...range, yearMonth: undefined, dateBasis: analysis ? 'analysis' : 'own' });
    const dateColumn = analysis
      ? `COALESCE((SELECT o.date FROM entry o WHERE o.id = e.paybackOfEntryId), e.date) AS date`
      : 'e.date';
    const rows = await this.db.all<Row>(
      `SELECT p.categoryId, c.type AS categoryType, c.name AS categoryName,
              c.parentId AS parentCategoryId, parent.name AS parentCategoryName,
              p.baseAmount, ${dateColumn}${plan},
              /*
               * 이 줄에 붙은 태그. 걸린 줄만 남기는 판정기가 읽는다.
               *
               * 전표에 붙은 태그(줄 키가 없는 이체·카드 대금)는 분류 줄과 상관없어
               * 여기 오지 않는다.
               */
              (SELECT group_concat(et.tagId) FROM entry_tag et
                WHERE et.entryId = e.id AND et.lineKey = p.lineKey) AS lineTagIds
         FROM posting p
         JOIN entry e ON e.id = p.entryId
         JOIN category c ON c.id = p.categoryId
         LEFT JOIN category parent ON parent.id = c.parentId
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}`,
      [projectId, ...period.params, ...owner.params, ...search.params],
    );

    /*
     * 걸린 줄만 남긴다. 서버의 리포트가 같은 함수를 쓴다(`lineMatcherOf`).
     *
     * 질의는 전표 수준이라 분할의 나머지 줄까지 데려온다. 그대로 더하면 화면에 5,000원
     * 한 줄이 서 있는 달의 합계가 10,000원이 된다.
     */
    const matchLine = range.search ? lineMatcherOf(range.search) : undefined;

    return rows
      .filter(
        (row) =>
          !matchLine ||
          matchLine({
            categoryId: asText(row.categoryId),
            parentCategoryId: asText(row.parentCategoryId),
            tagIds: String(row.lineTagIds ?? '')
              .split(',')
              .filter(Boolean),
          }),
      )
      .map((row) => {
        const named: NamedCategoryPostingRow = {
          categoryId: String(row.categoryId),
          categoryType: String(row.categoryType) as NamedCategoryPostingRow['categoryType'],
          categoryName: String(row.categoryName),
          parentCategoryId: asText(row.parentCategoryId),
          parentCategoryName: asText(row.parentCategoryName),
          baseAmount: asMoney(row.baseAmount),
          date: String(row.date),
          // 이 줄의 태그. 태그 예산이 센다 (전표의 태그가 아니라 줄 키가 같은 것만).
          tagIds: String(row.lineTagIds ?? '')
            .split(',')
            .filter(Boolean),
        };
        // 회차 기준이면 할부 계획(과 줄인 회차)을 싣고, 할부 환불은 남은 몫만 환불한 날에 센다.
        return range.withInstallment ? spreadRowOf(named, row) : named;
      });
  }

  /**
   * 그 범위 전표의 시각. 년월 목록이 달을 만들 때 쓴다.
   *
   * 카테고리 다리를 세는 것과 따로 읽는 이유가 있다. **이체와 카드정산은 카테고리 다리가
   * 없다.** 다리만 보고 달을 만들면 그 유형만 골라 본 사람에게 목록이 비어 버린다.
   * 금액은 0이 맞고 줄은 있어야 한다.
   */
  async entryDates(projectId: string, range: MirrorEntryScope): Promise<string[]> {
    if (range.ownerIds && range.ownerIds.length === 0) return [];
    if (range.search?.matchNothing) return [];

    const owner = ownerFilter(range.ownerIds);
    const search = searchFilter(range.search);
    /*
     * 기초잔액 전표는 뺀다.
     *
     * 계좌를 만들 때 원장 맨 앞(1970년)에 쌓이는 자본 전표라, 넣으면 거래 목록의 첫
     * 화면에 "1970년 1월"이 줄로 앉는다. 사용자가 적은 거래가 아니고 카테고리 다리도
     * 없어 금액도 0이다. 서버의 getEntryMonths 와 같은 규칙이다.
     */
    const period = periodFilter(range);
    const rows = await this.db.all<Row>(
      `SELECT e.date FROM entry e
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}
          AND NOT EXISTS (
            SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
             WHERE op.entryId = e.id AND oa.type = 'opening_balance'
          )`,
      [projectId, ...period.params, ...owner.params, ...search.params],
    );
    return rows.map((row) => String(row.date));
  }

  /** 여러 달을 한 번에 보는 시계열용. 양끝의 달을 포함한다. */
  async categoryPostingsByMonth(
    projectId: string,
    range: { fromYearMonth: string; toYearMonth: string },
  ): Promise<CategoryPostingRow[]> {
    const rows = await this.db.all<Row>(
      `SELECT p.categoryId, c.type AS categoryType,
              p.baseAmount, e.date
         FROM posting p
         JOIN entry e ON e.id = p.entryId
         JOIN category c ON c.id = p.categoryId
        WHERE e.projectId = ? AND e.yearMonth >= ? AND e.yearMonth <= ?`,
      [projectId, range.fromYearMonth, range.toYearMonth],
    );

    return rows.map((row) => ({
      categoryId: String(row.categoryId),
      categoryType: String(row.categoryType) as CategoryPostingRow['categoryType'],
      baseAmount: asMoney(row.baseAmount),
      date: String(row.date),
    }));
  }

  /** 그 예산의 그 달 조정 줄 id. 없으면 null. */
  async budgetOverrideIdOf(budgetId: string, year: number, month: number): Promise<string | null> {
    const rows = await this.db.all<Row>(
      `SELECT id FROM budget_override WHERE budgetId = ? AND year = ? AND month = ?`,
      [budgetId, year, month],
    );
    return asText(rows[0]?.id);
  }

  /** 그 달에 적용되는 예산 규칙과 조정값. 적용 여부 판단은 부르는 쪽이 한다. */
  async budgets(projectId: string, year: number, month: number): Promise<StoredBudget[]> {
    const rows = await this.db.all<Row>(
      `SELECT b.id, b.categoryId, b.tagId, b.type, b.monthlyAmount, b.effectiveFrom, b.effectiveTo,
              o.amount AS overrideAmount, o.id AS overrideId
         FROM budget b
         LEFT JOIN budget_override o
                ON o.budgetId = b.id AND o.year = ? AND o.month = ?
        WHERE b.projectId = ?`,
      [year, month, projectId],
    );

    return rows.map((row) => ({
      id: String(row.id),
      categoryId: asText(row.categoryId),
      tagId: asText(row.tagId),
      type: asText(row.type),
      monthlyAmount: asMoney(row.monthlyAmount),
      effectiveFrom: asText(row.effectiveFrom),
      effectiveTo: asText(row.effectiveTo),
      overrideAmount: asText(row.overrideAmount),
      overrideId: asText(row.overrideId),
    }));
  }

  /**
   * 예산 규칙 전부와 그 달별 조정. 월별 예산 목록이 쓴다 (고르고 푸는 일은 부르는 쪽이 한다).
   *
   * 위 `budgets` 는 한 달의 조정만 붙여 준다. 목록은 열두 달을 한 번에 풀어야 해서 조정을
   * 모두 읽는다 -- 한 대상의 조정은 달마다 하나라 많아야 수십 줄이다.
   */
  async budgetRules(projectId: string): Promise<{
    rules: Array<{
      id: string;
      categoryId: string | null;
      tagId: string | null;
      type: string | null;
      monthlyAmount: string;
      effectiveFrom: string | null;
      effectiveTo: string | null;
    }>;
    overrides: Array<{ id: string; budgetId: string; year: number; month: number; amount: string }>;
  }> {
    const [rules, overrides] = await Promise.all([
      this.db.all<Row>(
        `SELECT id, categoryId, tagId, type, monthlyAmount, effectiveFrom, effectiveTo
           FROM budget WHERE projectId = ?`,
        [projectId],
      ),
      this.db.all<Row>(
        `SELECT o.id, o.budgetId, o.year, o.month, o.amount
           FROM budget_override o JOIN budget b ON b.id = o.budgetId
          WHERE b.projectId = ?`,
        [projectId],
      ),
    ]);
    return {
      rules: rules.map((row) => ({
        id: String(row.id),
        categoryId: asText(row.categoryId),
        tagId: asText(row.tagId),
        type: asText(row.type),
        monthlyAmount: asMoney(row.monthlyAmount),
        effectiveFrom: asText(row.effectiveFrom),
        effectiveTo: asText(row.effectiveTo),
      })),
      overrides: overrides.map((row) => ({
        id: String(row.id),
        budgetId: String(row.budgetId),
        year: asInt(row.year),
        month: asInt(row.month),
        amount: asMoney(row.amount),
      })),
    };
  }

  /**
   * 화면이 그대로 쓰는 행들.
   *
   * 서버 응답과 같은 모양을 만들어 준다. 도메인 모양으로 새로 그리면 화면 전체를
   * 함께 고쳐야 하고, 오프라인과 온라인이 서로 다른 모양을 보게 된다.
   */
  async personRows(projectId: string): Promise<PersonDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM person WHERE projectId = ? ORDER BY sortRank, createdAt`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      name: String(row.name),
      relationship: asText(row.relationship),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      // 화면이 드래그 순서를 그대로 쓴다. DTO 타입에는 없지만 서버도 함께 보낸다.
      sortRank: String(row.sortRank),
    }) as PersonDto.Response);
  }

  /**
   * 통장 목록. 서버의 `/accounts` 와 같은 것을 준다.
   *
   * **사용자에게 통장으로 보이지 않는 계정은 뺀다** -- 카드 사용액을 담는 부채 계정과
   * 기초잔액 자본 계정이다. 서버가 빼는 것을 사본이 그대로 두면, 오프라인에서만 자산
   * 화면에 "com2us 신용카드"가 통장처럼 한 줄 더 서고 순서를 옮길 때 이웃도 달라진다
   * (기기에서 실제로 그랬다).
   */
  async accountRows(projectId: string): Promise<AccountDto.Response[]> {
    const hidden = HIDDEN_ACCOUNT_TYPES.map(() => '?').join(', ');
    /*
     * 잔액은 서버 칸이 아니라 다리를 세어 낸다 (`accountBalances`). 서버 목록(`withBalancesAsOf`)처럼
     * 미래 날짜 전표를 빼고, 아직 보내지 못한 거래는 넣는다. 예전에는 칸을 그대로 읽어 다음 주
     * 월급이 오늘 통장에 들어 있었고 오프라인 거래가 잔액을 움직이지 않았다.
     */
    const [rows, balances] = await Promise.all([
      this.db.all<Row>(
        `SELECT a.*, p.id AS ownerRowId, p.name AS ownerName, p.relationship AS ownerRelationship,
                p.isActive AS ownerIsActive, p.createdAt AS ownerCreatedAt, p.updatedAt AS ownerUpdatedAt
           FROM account a
           LEFT JOIN person p ON p.id = a.ownerId
          WHERE a.projectId = ? AND a.type NOT IN (${hidden})
          ORDER BY a.sortRank, a.createdAt`,
        [projectId, ...HIDDEN_ACCOUNT_TYPES],
      ),
      this.accountBalances(projectId),
    ]);

    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      type: String(row.type),
      ownerId: asText(row.ownerId),
      name: String(row.name),
      institutionId: asText(row.institutionId),
      accountNumber: asText(row.accountNumber),
      matchText: asText(row.matchText),
      maturityDate: asText(row.maturityDate),
      balance: balances.get(String(row.id)) ?? asMoney(row.balance),
      currency: String(row.currency),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortRank: String(row.sortRank),
      // 주인은 서버가 include 로 함께 준다. 사본에서는 조인으로 만든다.
      owner: row.ownerRowId
        ? {
            id: String(row.ownerRowId),
            projectId,
            name: String(row.ownerName),
            relationship: asText(row.ownerRelationship),
            isActive: Boolean(row.ownerIsActive),
            createdAt: String(row.ownerCreatedAt),
            updatedAt: String(row.ownerUpdatedAt),
          }
        : undefined,
      // 기관 목록은 변경 피드에 없다(프로젝트에 딸리지 않은 기본 제공 항목이 대부분이다).
      // 그래서 오프라인에서는 기관 이름이 비어 있다. 화면이 이름 없이도 그려야 한다.
      institution: null,
    }) as unknown as AccountDto.Response);
  }

  async categoryRows(projectId: string): Promise<CategoryDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM category WHERE projectId = ? ORDER BY sortRank, createdAt`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      name: String(row.name),
      parentId: asText(row.parentId),
      type: String(row.type),
      icon: asText(row.icon),
      isDefault: Boolean(row.isDefault),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortRank: String(row.sortRank),
    }) as unknown as CategoryDto.Response);
  }

  /** 태그 행. 감춰진 상태가 없어 있는 것이 곧 고를 수 있는 것이다. */
  async tagRows(projectId: string): Promise<TagDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM tag WHERE projectId = ? ORDER BY sortRank, name`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      name: String(row.name),
      color: asText(row.color),
      sortRank: String(row.sortRank),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    }));
  }

  /**
   * 보관함의 후보. 탭(source)과 처지(status)로 고른다.
   *
   * 새로 온 것이 위다. 거래 시각이 없는 후보(문구에서 못 읽은 것)는 담은 시각으로
   * 줄을 세운다 -- 목록 맨 아래로 밀어 두면 방금 담은 것이 보이지 않는다.
   */
  async draftRows(
    projectId: string,
    filter: { source?: string; status?: string } = {},
  ): Promise<EntryDraftDto.Response[]> {
    const where: string[] = ['projectId = ?'];
    const params: SqlValue[] = [projectId];
    if (filter.source) {
      where.push('source = ?');
      params.push(filter.source);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }

    const rows = await this.db.all<Row>(
      `SELECT * FROM entry_draft WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(occurredAt, createdAt) DESC, createdAt DESC`,
      params,
    );

    /*
     * 태그를 한 번에 읽어 나눠 붙인다.
     *
     * 후보마다 물으면 목록 길이만큼 질의가 늘어난다 -- 보관함은 수십 건이 예사고,
     * 그 조회는 네이티브를 그만큼 오간다.
     */
    const tags = await this.db.all<Row>(
      `SELECT dt.draftId AS draftId, dt.tagId AS tagId
         FROM entry_draft_tag dt
         JOIN entry_draft d ON d.id = dt.draftId
        WHERE d.projectId = ?`,
      [projectId],
    );
    const byDraft = new Map<string, string[]>();
    for (const row of tags) {
      const draftId = String(row.draftId);
      const list = byDraft.get(draftId);
      if (list) list.push(String(row.tagId));
      else byDraft.set(draftId, [String(row.tagId)]);
    }

    return rows.map((row) => ({
      ...toDraftResponse(row),
      tagIds: byDraft.get(String(row.id)) ?? [],
    }));
  }

  /** 그 열쇠로 담은 후보가 이미 있는가. 기기가 담기 전에 스스로 본다. */
  async draftExists(projectId: string, dedupeKey: string): Promise<boolean> {
    const rows = await this.db.all<Row>(
      `SELECT id FROM entry_draft WHERE projectId = ? AND dedupeKey = ? LIMIT 1`,
      [projectId, dedupeKey],
    );
    return rows.length > 0;
  }

  /**
   * 후보를 사본에서 먼저 처리하고, 서버에 알릴 일을 적어 둔다.
   *
   * 화면은 이 함수만 부르면 온라인·오프라인을 가리지 않는다. 연결되어 있으면 곧바로
   * 이어서 `flushDraftOps` 가 돌고, 아니면 다음 동기화가 같은 일을 한다.
   *
   * 지우기는 사본에서 행을 없앤다. 나머지는 처지만 바꾼다.
   */
  async markDraft(
    projectId: string,
    draftId: string,
    op: 'registered' | 'dismissed' | 'deleted',
    entryId?: string | null,
  ): Promise<void> {
    await this.db.transaction(async () => {
      if (op === 'deleted') {
        // 사본에는 외래 키가 없다. 다리 행을 함께 지우지 않으면 임자 없는 줄이 남는다.
        await this.db.run(`DELETE FROM entry_draft_tag WHERE draftId = ?`, [draftId]);
        await this.db.run(`DELETE FROM entry_draft WHERE id = ?`, [draftId]);
      } else {
        await this.db.run(
          `UPDATE entry_draft SET status = ?, registeredEntryId = ?, updatedAt = ? WHERE id = ?`,
          [op, entryId ?? null, new Date().toISOString(), draftId],
        );
      }

      await this.db.run(
        `INSERT INTO draft_op (draftId, projectId, op, entryId, createdAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(draftId) DO UPDATE SET op = excluded.op, entryId = excluded.entryId`,
        [draftId, projectId, op, entryId ?? null, new Date().toISOString()],
      );
    });
  }

  /** 후보를 사본에 담는다. 서버에 올리는 일은 부르는 쪽이 한다. */
  async putDraft(draft: EntryDraftDto.Response): Promise<void> {
    // 태그와 행을 한 단위로 (setMirrorFloor 의 주석). 헤드리스 알림 작업이 동기화와 겹쳐 부른다.
    await this.db.transaction(() => this.writeDraft(draft));
  }

  private async writeDraft(draft: EntryDraftDto.Response): Promise<void> {
    await this.putDraftTags(draft.id, draft.tagIds);
    await upsert(this.db, 'entry_draft', {
      id: draft.id,
      projectId: draft.projectId,
      source: draft.source,
      status: draft.status,
      rawText: draft.rawText,
      appPackage: draft.appPackage,
      appTitle: draft.appTitle,
      kind: draft.kind,
      amount: draft.amount,
      currency: draft.currency,
      occurredAt: draft.occurredAt,
      merchant: draft.merchant,
      description: draft.description,
      installmentMonths: draft.installmentMonths,
      personId: draft.personId,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      toAccountId: draft.toAccountId,
      feeAmount: draft.feeAmount,
      feeCategoryId: draft.feeCategoryId,
      cardId: draft.cardId,
      confidence: draft.confidence,
      parser: draft.parser,
      dedupeKey: draft.dedupeKey,
      registeredEntryId: draft.registeredEntryId,
      recurringRuleId: draft.recurringRuleId,
      createdByName: draft.createdByName,
      deviceName: draft.deviceName,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      updatedVersion: 0,
    });
  }

  /** 그 후보의 태그를 준 목록으로 갈아 끼운다. 델타와 담기가 함께 쓴다. */
  private async putDraftTags(draftId: string, tagIds: string[] | undefined): Promise<void> {
    await this.db.run(`DELETE FROM entry_draft_tag WHERE draftId = ?`, [draftId]);
    for (const tagId of tagIds ?? []) {
      await this.db.run(`INSERT OR IGNORE INTO entry_draft_tag (draftId, tagId) VALUES (?, ?)`, [
        draftId,
        tagId,
      ]);
    }
  }

  /** 아직 서버에 알리지 못한 후보 처리. 동기화가 이것을 비운다. */
  async pendingDraftOps(
    projectId: string,
  ): Promise<Array<{ draftId: string; op: string; entryId: string | null }>> {
    const rows = await this.db.all<Row>(
      `SELECT draftId, op, entryId FROM draft_op WHERE projectId = ? ORDER BY createdAt`,
      [projectId],
    );
    return rows.map((row) => ({
      draftId: String(row.draftId),
      op: String(row.op),
      entryId: asText(row.entryId),
    }));
  }

  /** 서버가 받아들인 처리를 큐에서 뺀다. */
  async forgetDraftOp(draftId: string, sent?: { op: string; entryId: string | null }): Promise<void> {
    /*
     * 보낸 그 처리일 때만 뺀다 (2026-10-16).
     *
     * 보내는 사이 사용자가 처리를 바꿨으면(등록 → 지우기) 같은 줄이 새 값으로 덮여 있다. 후보 id 로만
     * 지우면 그 새 처리가 서버에 한 번도 가지 않은 채 사라진다.
     */
    await this.db.transaction(() =>
      sent
        ? this.db.run(`DELETE FROM draft_op WHERE draftId = ? AND op = ? AND entryId IS ?`, [
            draftId,
            sent.op,
            sent.entryId,
          ])
        : this.db.run(`DELETE FROM draft_op WHERE draftId = ?`, [draftId]),
    );
  }

  /**
   * 이 가맹점으로 적어 둔 지난 거래. 분류를 짐작하는 재료다(`draft-match`).
   *
   * 가장 최근 것이 먼저 온다. 다리에서 분류를 꺼내므로 분할 거래는 첫 줄의 분류가
   * 온다 -- 짐작에는 그것으로 충분하고, 사람이 저장 전에 본다.
   */
  async merchantHistory(
    projectId: string,
    limit = 200,
  ): Promise<Array<{ merchant: string | null; description: string; categoryId: string | null }>> {
    const rows = await this.db.all<Row>(
      `SELECT e.merchant AS merchant, e.description AS description,
              (SELECT p.categoryId FROM posting p
                 WHERE p.entryId = e.id AND p.categoryId IS NOT NULL LIMIT 1) AS categoryId
         FROM entry e
        WHERE e.projectId = ?
        ORDER BY e.date DESC
        LIMIT ?`,
      [projectId, limit],
    );
    return rows.map((row) => ({
      merchant: asText(row.merchant),
      description: String(row.description ?? ''),
      categoryId: asText(row.categoryId),
    }));
  }

  /**
   * 카드 행. "사용액"은 부채 계정 잔액의 부호를 뒤집은 값이다(서버와 같은 규칙).
   * 체크카드는 빚이 생기지 않으므로 null 이다.
   */
  async cardRows(projectId: string): Promise<CardDto.Response[]> {
    // 부채 잔액도 다리를 세어 낸다 (`accountBalances` 의 까닭과 같다).
    const [rows, balances] = await Promise.all([
      this.db.all<Row>(
        `SELECT c.*
           FROM card c
          WHERE c.projectId = ?
          ORDER BY c.sortRank, c.createdAt`,
        [projectId],
      ),
      this.accountBalances(projectId),
    ]);

    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      paymentAccountId: String(row.paymentAccountId),
      liabilityAccountId: asText(row.liabilityAccountId),
      name: String(row.name),
      cardNumberMasked: maskCardNumber(asText(row.cardNumber)),
      cardType: String(row.cardType),
      issuerId: String(row.issuerId),
      expiryDate: asText(row.expiryDate),
      creditLimit: asText(row.creditLimit),
      performanceAmount: asText(row.performanceAmount),
      statementClosingDay: row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
      paymentDueDay: row.paymentDueDay == null ? null : asInt(row.paymentDueDay),
      color: asText(row.color),
      matchText: asText(row.matchText),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortRank: String(row.sortRank),
      currentUsage: row.liabilityAccountId
        ? Dec.of(balances.get(String(row.liabilityAccountId)) ?? '0')
            .negated()
            .toString()
        : null,
    }) as unknown as CardDto.Response);
  }

  /**
   * 그 구간의 전표와 다리. 목록 화면이 쓰는 모양(`ViewEntry`)으로 만들어 준다.
   *
   * 목록 한 줄로 펴는 일은 `@money/types` 의 toListItem 이 한다. 서버도 같은 함수를
   * 쓰므로 같은 거래가 두 곳에서 다르게 보이지 않는다.
   *
   * 정렬은 서버와 같다(날짜 내림차순, 같으면 id 내림차순).
   */
  async viewEntries(projectId: string, range: MirrorEntryScope): Promise<ViewEntry[]> {
    if (range.ownerIds && range.ownerIds.length === 0) return [];
    if (range.search?.matchNothing) return [];

    const owner = ownerFilter(range.ownerIds);
    const search = searchFilter(range.search);
    const period = periodFilter(range);
    const narrow = narrowFilter(range);
    const paybackOf = paybackOfFilter(range.paybackOf);
    const entries = await this.db.all<Row>(
      `SELECT e.*, p.name AS personName
         FROM entry e
         LEFT JOIN person p ON p.id = e.personId
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}${narrow.sql}${paybackOf.sql}
        ORDER BY e.date DESC, e.id DESC`,
      [
        projectId,
        ...period.params,
        ...owner.params,
        ...search.params,
        ...narrow.params,
        ...paybackOf.params,
      ],
    );
    if (entries.length === 0) return [];

    return attachPostings(this.db, entries);
  }

  /**
   * 그 이름이 이미 쓰이고 있는가. 서버의 유일성 제약과 같은 규칙이다.
   *
   *   소분류  (가계부, 이름, 부모) 가 유일하다.
   *   대분류  (가계부, 유형, 이름) 이 유일하다 -- 지출 "기타"와 수입 "기타"는 함께 산다.
   *
   * 감춘 분류를 가릴 일이 없다. 분류에는 감춰진 상태가 없고, 지운 분류는 행이 사라져
   * 그 이름이 곧바로 풀린다.
   */
  async categoryNameTaken(
    projectId: string,
    name: string,
    parentId: string | null,
    type: string,
    /** 이름을 고치는 중이라면 그 분류 자신. 제 이름에 걸리지 않게 뺀다. */
    exceptId?: string,
  ): Promise<boolean> {
    const skip = exceptId ? ' AND id <> ?' : '';
    const skipParam = exceptId ? [exceptId] : [];
    const rows = parentId
      ? await this.db.all<Row>(
          `SELECT 1 FROM category
            WHERE projectId = ? AND name = ? AND parentId = ?${skip} LIMIT 1`,
          [projectId, name, parentId, ...skipParam],
        )
      : await this.db.all<Row>(
          `SELECT 1 FROM category
            WHERE projectId = ? AND name = ? AND type = ? AND parentId IS NULL${skip} LIMIT 1`,
          [projectId, name, type, ...skipParam],
        );
    return rows.length > 0;
  }

  /** 그 태그 이름이 이미 쓰이고 있는가. 서버의 (가계부, 이름) 유일성과 같다. */
  async tagNameTaken(projectId: string, name: string, exceptId?: string): Promise<boolean> {
    const rows = await this.db.all<Row>(
      `SELECT 1 FROM tag WHERE projectId = ? AND name = ?${exceptId ? ' AND id <> ?' : ''} LIMIT 1`,
      [projectId, name, ...(exceptId ? [exceptId] : [])],
    );
    return rows.length > 0;
  }

  /** 분류 한 줄의 자리(유형과 부모). 이름을 고칠 때 어느 묶음에서 견줄지 정한다. */
  async categorySlot(id: string): Promise<{ type: string; parentId: string | null } | null> {
    const [row] = await this.db.all<Row>(
      `SELECT type, parentId FROM category WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return { type: String(row.type), parentId: asText(row.parentId) };
  }

  /**
   * 그 분류와 그 소분류에 달린 거래 다리의 수. 열쇠는 분류 id 다.
   *
   * 없애기를 막는 데 쓴다. 서버의 `deleteCategory` 는 쓰이고 있는 분류를 막는데
   * (CATEGORY_IN_USE), 앱은 사본에 먼저 쓰므로 그 규칙을 여기서도 한 번 본다 --
   * 그러지 않으면 화면에는 지워진 것처럼 보이다가 다음 동기화에서 되돌아온다.
   *
   * 소분류마다 따로 센다. 대분류를 없앨 때 **거래가 있는 소분류에만** 갈 곳을 묻기
   * 위해서다 (서버의 `getCategoryUsage` 와 같은 모양이다).
   */
  async categoryPostingCounts(categoryId: string): Promise<Record<string, number>> {
    const [target] = await this.db.all<Row>(`SELECT id, parentId FROM category WHERE id = ?`, [
      categoryId,
    ]);
    if (!target) return {};

    // 소분류를 없애는 일에는 딸린 것이 없다.
    const children = target.parentId
      ? []
      : await this.db.all<Row>(`SELECT id FROM category WHERE parentId = ?`, [categoryId]);
    const ids = [categoryId, ...children.map((row) => String(row.id))];

    const rows = await this.db.all<Row>(
      `SELECT categoryId, COUNT(*) AS n FROM posting
        WHERE categoryId IN (${ids.map(() => '?').join(', ')})
        GROUP BY categoryId`,
      ids,
    );

    // 한 건도 없는 분류도 0 으로 담는다. 빠져 있으면 부르는 쪽이 "모른다"와 가를 수 없다.
    const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const row of rows) counts[String(row.categoryId)] = Number(row.n ?? 0);
    return counts;
  }

  /**
   * 전표 하나를 id 로 읽는다. 없으면 null.
   *
   * 자산 상세의 원장 줄이 쓴다. 그 줄은 다리(posting) 한 개짜리라 거래 한 줄로 펼 수
   * 없고, 눌러서 상세를 열려면 그 전표를 통째로 읽어야 한다.
   */
  async viewEntryById(id: string): Promise<ViewEntry | null> {
    const [entry] = await this.viewEntriesByIds([id]);
    return entry ?? null;
  }

  /** id 목록으로 전표를 읽는다. 커서 페이지가 고른 줄에 다리를 붙일 때 쓴다. */
  private async viewEntriesByIds(ids: string[]): Promise<ViewEntry[]> {
    const placeholders = ids.map(() => '?').join(', ');
    const entries = await this.db.all<Row>(
      `SELECT e.*, p.name AS personName
         FROM entry e
         LEFT JOIN person p ON p.id = e.personId
        WHERE e.id IN (${placeholders})
        ORDER BY e.date DESC, e.id DESC`,
      ids,
    );
    return attachPostings(this.db, entries);
  }

  /**
   * 그 계좌들에 걸린 다리 전부 (계좌, 기준통화 금액, 전표 시각). 자산 추이가 칸에 떨군다.
   *
   * 서버는 SQL 로 계좌·칸별 합을 내지만, 사본은 다리를 읽어 공용 함수로 쌓는다
   * (`stackBalanceHistory`). 한 가계부의 다리는 수천 줄 규모라 읽어도 가볍다.
   */
  async accountPostingRows(
    projectId: string,
    accountIds: readonly string[],
  ): Promise<Array<{ accountId: string; baseAmount: string; date: string }>> {
    if (accountIds.length === 0) return [];
    const placeholders = accountIds.map(() => '?').join(', ');
    const rows = await this.db.all<Row>(
      `SELECT p.accountId, p.baseAmount, e.date
         FROM posting p JOIN entry e ON e.id = p.entryId
        WHERE e.projectId = ? AND p.accountId IN (${placeholders})`,
      [projectId, ...accountIds],
    );
    return rows.map((row) => ({
      accountId: String(row.accountId),
      baseAmount: asMoney(row.baseAmount),
      date: String(row.date),
    }));
  }

  /** 그 계좌들의 평가 기록. 날짜 오름차순이다 (`stackBalanceHistory` 가 그 차례를 전제한다). */
  async valuationRows(
    accountIds: readonly string[],
  ): Promise<Array<{ accountId: string; date: string; marketValue: string }>> {
    if (accountIds.length === 0) return [];
    const placeholders = accountIds.map(() => '?').join(', ');
    const rows = await this.db.all<Row>(
      `SELECT accountId, date, marketValue FROM asset_valuation
        WHERE accountId IN (${placeholders}) ORDER BY date ASC`,
      [...accountIds],
    );
    return rows.map((row) => ({
      accountId: String(row.accountId),
      date: String(row.date),
      marketValue: asMoney(row.marketValue),
    }));
  }

  /** 그 계좌들의 다리를 가진 전표 (다리·태그를 붙여서). 계좌별 누적 수익이 거래 종류를 가른다. */
  async entriesTouchingAccounts(
    projectId: string,
    accountIds: readonly string[],
  ): Promise<ViewEntry[]> {
    if (accountIds.length === 0) return [];
    const placeholders = accountIds.map(() => '?').join(', ');
    const entries = await this.db.all<Row>(
      `SELECT e.*, p.name AS personName
         FROM entry e
         LEFT JOIN person p ON p.id = e.personId
        WHERE e.projectId = ?
          AND EXISTS (SELECT 1 FROM posting ap
                       WHERE ap.entryId = e.id AND ap.accountId IN (${placeholders}))`,
      [projectId, ...accountIds],
    );
    return attachPostings(this.db, entries);
  }

  /**
   * "고른 달부터"를 사본에 적는다. 서버의 `BudgetsService.setBudgetFrom` 과 같은 차례다 --
   * 그 대상의 규칙들 가운데 그 달 이후에 시작하는 것은 지우고, 걸친 것은 앞 달까지로 끊고,
   * 그 달부터의 달별 조정을 지운 뒤, 금액이 있으면 그 달부터의 새 규칙을 세운다.
   */
  async applyBudgetFrom(
    projectId: string,
    input: {
      categoryId: string | null;
      tagId: string | null;
      type: string | null;
      fromMonth: string;
      amount: string | null;
      ruleId: string;
    },
  ): Promise<void> {
    const { rules, overrides } = await this.budgetRules(projectId);
    const siblings = rules.filter(
      (rule) =>
        rule.categoryId === input.categoryId &&
        rule.tagId === input.tagId &&
        // 분류·태그 예산은 id 하나로 정해지고, 전체 예산만 유형으로 갈린다 (서버와 같다).
        (input.categoryId || input.tagId ? true : rule.type === input.type),
    );
    const ids = new Set(siblings.map((rule) => rule.id));
    const plan = planBudgetFrom(siblings, input.fromMonth);

    await this.db.transaction(async () => {
      for (const override of overrides) {
        if (ids.has(override.budgetId) && isOverrideFrom(override, input.fromMonth)) {
          await this.db.run(`DELETE FROM budget_override WHERE id = ?`, [override.id]);
        }
      }
      for (const id of plan.remove) {
        await this.db.run(`DELETE FROM budget_override WHERE budgetId = ?`, [id]);
        await this.db.run(`DELETE FROM budget WHERE id = ?`, [id]);
      }
      for (const rule of plan.cut) {
        await this.db.run(`UPDATE budget SET effectiveTo = ? WHERE id = ?`, [rule.effectiveTo, rule.id]);
      }
      if (input.amount !== null) {
        await upsert(this.db, 'budget', {
          id: input.ruleId,
          projectId,
          categoryId: input.categoryId,
          tagId: input.tagId,
          type: input.type,
          monthlyAmount: input.amount,
          effectiveFrom: input.fromMonth,
          effectiveTo: null,
          fieldHlc: null,
          // 아직 서버를 거치지 않은 줄이다. 다음 pull 이 진짜 번호로 덮는다.
          updatedVersion: 0,
        });
      }
    });
  }

  /**
   * 분류 통합을 사본에 적는다. 서버 `CategoriesService.mergeCategories` 와 같은 일이다 --
   * 없앨 분류의 다리·보관함 후보를 옮겨 받을 분류로 옮기고, 없앨 분류의 예산은 지우고
   * (그 분류에만 뜻이 있는 값이다), 후보에 남은 것은 비운 뒤 분류를 지운다. 옮긴 다리 수를 준다.
   * 검사(기본 분류·유형·옮길 곳)는 부르는 쪽이 먼저 한다.
   */
  async applyCategoryMerge(
    projectId: string,
    moves: ReadonlyArray<{ fromId: string; toId?: string | null }>,
  ): Promise<number> {
    const fromIds = [...new Set(moves.map((move) => move.fromId))];
    let moved = 0;
    await this.db.transaction(async () => {
      for (const move of moves) {
        if (!move.toId) continue;
        const count = await this.db.all<Row>(
          `SELECT count(*) AS n FROM posting WHERE categoryId = ?`,
          [move.fromId],
        );
        moved += asInt(count[0]?.n);
        await this.db.run(`UPDATE posting SET categoryId = ? WHERE categoryId = ?`, [move.toId, move.fromId]);
        // 아직 거래가 아닌 것들도 함께 옮긴다 (서버 `categories.service` 와 같다).
        for (const table of ['entry_draft', 'recurring_rule']) {
          await this.db.run(
            `UPDATE ${table} SET categoryId = ? WHERE projectId = ? AND categoryId = ?`,
            [move.toId, projectId, move.fromId],
          );
        }
      }
      for (const id of fromIds) {
        const budgets = await this.db.all<Row>(`SELECT id FROM budget WHERE categoryId = ?`, [id]);
        for (const budget of budgets) await this.forgetRow('budget', String(budget.id));
        for (const table of ['entry_draft', 'recurring_rule']) {
          await this.db.run(`UPDATE ${table} SET categoryId = NULL WHERE projectId = ? AND categoryId = ?`, [
            projectId,
            id,
          ]);
        }
        // 대분류가 사라지면 남은 소분류도 함께 간다 (서버는 cascade). 거래가 없는 것만 남아 있다(창구가 검사한다).
        await this.db.run(`DELETE FROM category WHERE id = ? OR parentId = ?`, [id, id]);
      }
    });
    return moved;
  }

  /**
   * 잔액 맞추기를 사본에 적는다. 서버 `LedgerService.setBalanceTo` 와 같은 식이다 --
   * 기초잔액 = 목표 잔액 − (기초잔액 전표를 뺀) 나머지 거래의 합. 기초잔액 전표가 있으면 그
   * 금액을 고치고(0 이면 지운다), 없으면 `openingEntryId` 로 새로 세운다. 서버도 그 id 로 세워
   * 두 곳이 같은 전표가 된다.
   *
   * 외화 통장의 환산은 기존 기초잔액 다리의 환율(없으면 1)을 쓴다 -- 서버는 그때의 환율로
   * 다시 계산하므로 기준통화 금액은 다음 동기화에서 서버 값으로 바뀔 수 있다. 자본 계정이
   * 사본에 없으면(아직 기초잔액을 둔 적이 없는 가계부) 적지 않는다; 서버가 만들고 pull 이 가져온다.
   */
  async applyBalanceTo(
    projectId: string,
    input: { accountId: string; balance: string; openingEntryId: string; hlc: string },
  ): Promise<void> {
    // 맞추는 것은 지금 잔액이다 (`accountBalances`). 미래 날짜의 거래는 그 위에 얹힌다.
    const cut = asOfClause(new Date());
    const project = await this.projectRow(projectId);
    const timeZone = project?.timeZone ?? 'Asia/Seoul';
    const ledgerCurrency = project?.ledgerCurrency ?? 'KRW';
    const accounts = await this.db.all<Row>(
      `SELECT id, type, name, ownerId, currency, updatedVersion FROM account WHERE projectId = ?`,
      [projectId],
    );
    const account = accounts.find((row) => String(row.id) === input.accountId);

    /*
     * 서버가 아직 모르는 통장(끊긴 동안 만든 것)은 기초잔액이 전표가 아니라 잔액 칸의 씨앗이다
     * (`openingSeed`). 그 씨앗을 맞춘다 -- 전표를 세우면 씨앗과 함께 두 번 센다. 서버는 만들기
     * 명령을 재생한 뒤 이 명령으로 기초잔액 전표를 다시 계산한다.
     */
    if (account && asInt(account.updatedVersion) === 0) {
      const legs = await this.db.all<Row>(
        `SELECT p.amount FROM posting p JOIN entry e ON e.id = p.entryId
          WHERE p.accountId = ?${cut.sql}`,
        [input.accountId, ...cut.params],
      );
      const seed = Dec.of(input.balance).minus(Dec.sum(legs.map((row) => Dec.of(asMoney(row.amount)))));
      await this.db.run(`UPDATE account SET balance = ? WHERE id = ?`, [seed.toString(), input.accountId]);
      return;
    }
    const equity = accounts.find((row) => String(row.type) === 'opening_balance');
    if (!account || !equity || !account.ownerId) return;
    const equityId = String(equity.id);

    const opening = (
      await this.db.all<Row>(
        `SELECT e.id FROM entry e
          WHERE e.projectId = ?
            AND EXISTS (SELECT 1 FROM posting p WHERE p.entryId = e.id AND p.accountId = ?)
            AND EXISTS (SELECT 1 FROM posting q WHERE q.entryId = e.id AND q.accountId = ?)
          ORDER BY e.date ASC LIMIT 1`,
        [projectId, input.accountId, equityId],
      )
    )[0];
    const openingId = opening ? String(opening.id) : null;

    const others = await this.db.all<Row>(
      `SELECT p.amount FROM posting p JOIN entry e ON e.id = p.entryId
        WHERE p.accountId = ?${openingId ? ' AND p.entryId <> ?' : ''}${cut.sql}`,
      [input.accountId, ...(openingId ? [openingId] : []), ...cut.params],
    );
    const openingAmount = Dec.of(input.balance).minus(
      Dec.sum(others.map((row) => Dec.of(asMoney(row.amount)))),
    );

    if (openingAmount.isZero()) {
      if (openingId) await this.removeEntry(openingId);
      return;
    }

    const legRate = openingId
      ? asText(
          (
            await this.db.all<Row>(
              `SELECT exchangeRate FROM posting WHERE entryId = ? AND accountId = ?`,
              [openingId, input.accountId],
            )
          )[0]?.exchangeRate,
        )
      : null;
    const currency = String(account.currency);
    const rate = Dec.of(currency === ledgerCurrency ? '1' : legRate ?? '1');
    const base = openingAmount.times(rate).round(currencyDecimals(ledgerCurrency));

    const entryId = openingId ?? input.openingEntryId;
    await this.writeEntry(
      entryId,
      {
        projectId,
        personId: String(account.ownerId),
        date: ledgerOpeningDate(),
        description: `${String(account.name)} 기초잔액`,
        postings: [
          { accountId: input.accountId, amount: openingAmount, currency, exchangeRate: rate, baseAmount: base },
          {
            accountId: equityId,
            amount: base.negated(),
            currency: ledgerCurrency,
            exchangeRate: Dec.of(1),
            baseAmount: base.negated(),
          },
        ],
      },
      { timeZone, hlc: input.hlc, makeId: newId },
    );
  }

  /**
   * 구성원·통장·카드를 지우지 못하게 막는 사정. 서버의 `retirePerson`·`retireAccount`·
   * `retireCard` 와 같은 차례·같은 코드다. 없으면 null.
   *
   * 사본에 없는 것(투자 상세, 카드 청구서)은 세지 못한다 -- 그것이 붙어 있으면 재생할 때 서버가
   * 거절하고, 다음 동기화에서 그 줄이 사본에 되살아난다.
   */
  async deleteBlocker(
    projectId: string,
    kind: 'person' | 'account' | 'card',
    id: string,
    /**
     * 숨기기는 앞의 검사(살아 있는 통장·카드, 남은 잔액)만 본다. 서버의 deactivate* 가 숨기기와
     * 지우기에 같은 앞부분을 쓰고, 지우기만 붙은 거래·기록을 더 본다.
     */
    mode: 'hide' | 'delete' = 'delete',
  ): Promise<string | null> {
    const count = async (sql: string, params: SqlValue[]) =>
      asInt((await this.db.all<Row>(sql, params))[0]?.n);

    if (kind === 'person') {
      if ((await count(`SELECT count(*) AS n FROM account WHERE ownerId = ? AND isActive = 1`, [id])) > 0) {
        return 'PERSON_HAS_ACCOUNTS';
      }
      if (mode === 'hide') return null;
      if ((await count(`SELECT count(*) AS n FROM entry WHERE personId = ?`, [id])) > 0) {
        return 'PERSON_HAS_ENTRIES';
      }
      const records =
        (await count(`SELECT count(*) AS n FROM account WHERE ownerId = ?`, [id])) +
        (await count(`SELECT count(*) AS n FROM member WHERE personId = ?`, [id]));
      return records > 0 ? 'PERSON_HAS_RECORDS' : null;
    }

    // 미래 날짜의 거래도 잔액이다. 그것이 남은 계좌를 지우면 그 거래가 갈 곳이 없다.
    const balances = await this.accountBalances(projectId, null);
    if (kind === 'account') {
      // 결제 통장이든 카드의 부채 계정 자체이든 살아 있는 카드가 있으면 막는다 (서버와 같다).
      const cards = await count(
        `SELECT count(*) AS n FROM card WHERE isActive = 1 AND (paymentAccountId = ? OR liabilityAccountId = ?)`,
        [id, id],
      );
      if (cards > 0) return 'ACCOUNT_HAS_CARDS';
      if (!Dec.of(balances.get(id) ?? '0').isZero()) return 'ACCOUNT_HAS_BALANCE';
      if (mode === 'hide') return null;
      if ((await count(`SELECT count(*) AS n FROM posting WHERE accountId = ?`, [id])) > 0) {
        return 'ACCOUNT_HAS_ENTRIES';
      }
      const records =
        (await count(`SELECT count(*) AS n FROM asset_valuation WHERE accountId = ?`, [id])) +
        (await count(`SELECT count(*) AS n FROM card WHERE paymentAccountId = ? OR liabilityAccountId = ?`, [id, id]));
      return records > 0 ? 'ACCOUNT_HAS_RECORDS' : null;
    }

    const card = await this.cardById(projectId, id);
    if (card?.liabilityAccountId && !Dec.of(balances.get(card.liabilityAccountId) ?? '0').isZero()) {
      return 'CARD_HAS_UNPAID';
    }
    if (mode === 'hide') return null;
    if ((await count(`SELECT count(*) AS n FROM posting WHERE cardId = ?`, [id])) > 0) {
      return 'CARD_HAS_ENTRIES';
    }
    return null;
  }

  /** 분류 하나에 달린 다리 수. 통합 검사가 "거래가 있는데 옮길 곳이 없다"를 가린다. */
  async categoryPostingCount(categoryId: string): Promise<number> {
    const rows = await this.db.all<Row>(`SELECT count(*) AS n FROM posting WHERE categoryId = ?`, [categoryId]);
    return asInt(rows[0]?.n);
  }

  /**
   * 태그 통합을 사본에 적는다. 서버 `TagsService.mergeTags` 와 같은 일이다 -- 붙어 있던 자리를
   * 옮길 태그로 옮기되 이미 그 태그가 붙은 자리는 옮기지 않고 지운다(한 줄에 같은 태그가 둘이
   * 되지 않게). 그 뒤 없앨 태그를 지운다.
   */
  async applyTagMerge(fromId: string, toId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `DELETE FROM entry_tag
          WHERE tagId = ?
            AND EXISTS (SELECT 1 FROM entry_tag other
                         WHERE other.tagId = ? AND other.entryId = entry_tag.entryId
                           AND other.lineKey IS entry_tag.lineKey)`,
        [fromId, toId],
      );
      await this.db.run(`UPDATE entry_tag SET tagId = ? WHERE tagId = ?`, [toId, fromId]);
      await this.db.run(
        `DELETE FROM entry_draft_tag
          WHERE tagId = ?
            AND EXISTS (SELECT 1 FROM entry_draft_tag other
                         WHERE other.tagId = ? AND other.draftId = entry_draft_tag.draftId)`,
        [fromId, toId],
      );
      await this.db.run(`UPDATE entry_draft_tag SET tagId = ? WHERE tagId = ?`, [toId, fromId]);
      await this.db.run(`DELETE FROM tag WHERE id = ?`, [fromId]);
    });
  }

  /** 반복 등록 행들 (사본의 칸 그대로). 읽는 쪽이 응답 모양으로 편다. */
  async recurringRuleRows(projectId: string): Promise<Row[]> {
    return this.db.all<Row>(
      // 켜져 있는 것이 위다 (서버 목록과 같은 차례).
      `SELECT * FROM recurring_rule WHERE projectId = ? ORDER BY isActive DESC, createdAt DESC`,
      [projectId],
    );
  }

  /**
   * 반복 등록 한 줄을 적는다 (새 줄이거나 통째로 갈아 끼우기).
   *
   * `stamp` 는 이 기기가 고친 칸과 그 명령의 시계다. 그 칸의 시계 자리(`recurringClockOf`)에
   * 찍어 두어야 다음 편집이 이 값보다 뒤가 된다 (`writeAsset` 과 같은 까닭).
   */
  async putRecurringRule(
    projectId: string,
    row: Row,
    stamp?: { hlc: string; fields: readonly string[] },
  ): Promise<void> {
    const values = recurringRow(projectId, row);
    if (stamp) {
      values.fieldHlc = mergeClocks(
        asText(values.fieldHlc),
        recurringClockKeys(stamp.fields),
        stamp.hlc,
      );
    }
    await upsert(this.db, 'recurring_rule', values);
  }

  /** 반복 등록을 지운다. 만들어진 후보는 남는다 (서버와 같다 -- 연결만 비운다). */
  async removeRecurringRule(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(`DELETE FROM recurring_rule WHERE id = ?`, [id]);
      await this.db.run(`UPDATE entry_draft SET recurringRuleId = NULL WHERE recurringRuleId = ?`, [id]);
    });
  }

  /** 그 가계부의 공휴일 ("YYYY-MM-DD"). */
  async publicHolidays(projectId: string): Promise<Set<string>> {
    const rows = await this.db.all<Row>(`SELECT date FROM public_holiday WHERE projectId = ?`, [
      projectId,
    ]);
    return new Set(rows.map((row) => String(row.date)));
  }

  /**
   * 반복마다 후보를 만든 마지막 날. 서버의 `lastMadeOn` 과 같은 규칙이다 -- 후보 열쇠
   * (`r:<규칙>:<날짜>`)의 최댓값이 곧 마지막 날이다.
   */
  async recurringLastMadeOn(projectId: string): Promise<Map<string, string>> {
    const rows = await this.db.all<Row>(
      `SELECT recurringRuleId, MAX(dedupeKey) AS lastKey FROM entry_draft
        WHERE projectId = ? AND recurringRuleId IS NOT NULL GROUP BY recurringRuleId`,
      [projectId],
    );
    const made = new Map<string, string>();
    for (const row of rows) {
      // 서버의 dateFromDedupeKey 와 같은 식이다 (날짜 뒤에 토막이 더 붙을 수 있다).
      const match = /:(\d{4}-\d{2}-\d{2})(?::|$)/.exec(String(row.lastKey ?? ''));
      if (match) made.set(String(row.recurringRuleId), match[1]);
    }
    return made;
  }

  /** 이 태그가 붙은 거래 줄과 보관함 후보의 수. 태그를 지우기 전에 센다 (끊겨 있을 때). */
  async tagUsageCounts(
    tagId: string,
  ): Promise<{ entries: number; drafts: number; rules: number }> {
    const [entries, drafts, rules] = await Promise.all([
      this.db.all<Row>(`SELECT count(*) AS n FROM entry_tag WHERE tagId = ?`, [tagId]),
      this.db.all<Row>(`SELECT count(*) AS n FROM entry_draft_tag WHERE tagId = ?`, [tagId]),
      // 반복 등록은 태그 id 를 JSON 배열로 담는다. 따옴표째 찾아 다른 id 의 일부와 헷갈리지 않게.
      this.db.all<Row>(`SELECT count(*) AS n FROM recurring_rule WHERE tagIds LIKE ?`, [`%"${tagId}"%`]),
    ]);
    return { entries: asInt(entries[0]?.n), drafts: asInt(drafts[0]?.n), rules: asInt(rules[0]?.n) };
  }

  /**
   * 그 구간의 전표를 한 쪽씩. 서버와 같은 커서 방식이다.
   *
   * 정렬은 (날짜 내림, id 내림)이고 커서는 그 마지막 줄을 가리킨다. 오프셋 대신
   * 커서를 쓰는 이유는 그 사이에 거래가 하나 들어와도 같은 줄을 두 번 보여 주거나
   * 건너뛰지 않기 때문이다.
   */
  async viewEntriesPage(
    projectId: string,
    options: MirrorEntryScope & {
      limit: number;
      cursor?: { date: string; id: string } | null;
    },
  ): Promise<{ entries: ViewEntry[]; hasMore: boolean }> {
    if (options.ownerIds && options.ownerIds.length === 0) {
      return { entries: [], hasMore: false };
    }
    if (options.search?.matchNothing) return { entries: [], hasMore: false };

    const owner = ownerFilter(options.ownerIds);
    const search = searchFilter(options.search);
    const period = periodFilter(options);
    const narrow = narrowFilter(options);
    const paybackOf = paybackOfFilter(options.paybackOf);
    const cursor = options.cursor;
    // 튜플 비교. (date, id) < (커서의 date, 커서의 id)
    const keyset = cursor ? ` AND (e.date < ? OR (e.date = ? AND e.id < ?))` : '';
    const keysetParams = cursor ? [cursor.date, cursor.date, cursor.id] : [];

    const rows = await this.db.all<Row>(
      `SELECT e.id FROM entry e
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}${narrow.sql}${paybackOf.sql}${keyset}
        ORDER BY e.date DESC, e.id DESC
        LIMIT ?`,
      [
        projectId,
        ...period.params,
        ...owner.params,
        ...search.params,
        ...narrow.params,
        ...paybackOf.params,
        ...keysetParams,
        options.limit + 1,
      ],
    );

    const hasMore = rows.length > options.limit;
    const ids = rows.slice(0, options.limit).map((row) => String(row.id));
    if (ids.length === 0) return { entries: [], hasMore: false };

    // 고른 id 만 다시 읽어 다리를 붙인다. 정렬은 여기서 다시 맞춘다.
    const entries = await this.viewEntriesByIds(ids);
    return { entries, hasMore };
  }

  /** 프로젝트 자신. 통화와 타임존을 여기서 읽는다. */
  async projectRow(
    projectId: string,
  ): Promise<{ ledgerCurrency: string; displayCurrency: string; timeZone: string } | null> {
    const rows = await this.db.all<Row>(
      `SELECT ledgerCurrency, displayCurrency, timezone FROM project WHERE id = ?`,
      [projectId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      ledgerCurrency: String(row.ledgerCurrency),
      displayCurrency: String(row.displayCurrency),
      timeZone: String(row.timezone),
    };
  }

  /** 가계부 한 줄의 이름·설명·표시 통화를 고친다. 오프라인에서 고친 값을 곧바로 보이게 한다. */
  async patchProject(
    projectId: string,
    patch: { name?: string; description?: string | null; displayCurrency?: string },
  ): Promise<void> {
    const columns = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (columns.length === 0) return;
    await this.db.run(
      `UPDATE project SET ${columns.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
      [...columns.map(([, value]) => (value ?? null) as SqlValue), projectId],
    );
  }

  /**
   * 환율을 직접 정한 줄을 적는다. (가계부, 쌍, 날짜)가 같은 줄이 있으면 그 줄을 고친다 --
   * 서버의 유일 조건(projectId, baseCurrency, quoteCurrency, date)과 같은 규칙이다.
   */
  async putExchangeRate(
    projectId: string,
    input: { id: string; from: string; to: string; rate: string; dateKey: string },
  ): Promise<void> {
    await this.db.transaction(async () => {
      const rows = await this.db.all<Row>(
        `SELECT id FROM exchange_rate
          WHERE projectId = ? AND baseCurrency = ? AND quoteCurrency = ? AND date = ?`,
        [projectId, input.from, input.to, input.dateKey],
      );
      if (rows[0]) {
        await this.db.run(`UPDATE exchange_rate SET rate = ?, source = 'manual' WHERE id = ?`, [
          input.rate,
          String(rows[0].id),
        ]);
        return;
      }
      await upsert(this.db, 'exchange_rate', {
        id: input.id,
        projectId,
        baseCurrency: input.from,
        quoteCurrency: input.to,
        rate: input.rate,
        date: input.dateKey,
        source: 'manual',
        // 아직 서버를 거치지 않은 줄이다. 다음 pull 이 진짜 번호로 덮는다.
        updatedVersion: 0,
      });
    });
  }

  /**
   * 그 쌍의 직접 정한 환율을 모두 지운다. 반대 방향도 함께다 (서버 `clearRate` 와 같다) -- 반대 방향만
   * 남기면 그 역수(`resolveRate`)가 지운 환율을 되살린다.
   */
  async dropExchangeRates(projectId: string, from: string, to: string): Promise<void> {
    await this.db.run(
      `DELETE FROM exchange_rate
        WHERE projectId = ?
          AND ((baseCurrency = ? AND quoteCurrency = ?) OR (baseCurrency = ? AND quoteCurrency = ?))`,
      [projectId, from, to, to, from],
    );
  }

  /** 통화쌍의 최신 환율 한 줄 (날짜·출처까지). 환율 설정 화면이 쓴다. */
  async latestRateRow(
    projectId: string,
    baseCurrency: string,
    quoteCurrency: string,
  ): Promise<{ rate: string; date: string; source: string } | null> {
    const rows = await this.db.all<Row>(
      `SELECT rate, date, source FROM exchange_rate
        WHERE projectId = ? AND baseCurrency = ? AND quoteCurrency = ?
        ORDER BY date DESC LIMIT 1`,
      [projectId, baseCurrency, quoteCurrency],
    );
    const row = rows[0];
    if (!row) return null;
    return { rate: asMoney(row.rate), date: String(row.date), source: String(row.source) };
  }

  // ───────────────────────────────────────────
  // 로컬 커밋
  // ───────────────────────────────────────────

  /** 조립한 전표를 사본에 적는다. 다리를 통째로 갈아 끼운다 (`local-store-commit`). */
  async writeEntry(
    entryId: string,
    built: BuiltEntry,
    options: {
      timeZone: string;
      hlc: string;
      makeId: () => string;
      /** **거래 자체**에 붙는 태그. 분류 줄이 없는 전표에만 쓴다 (이체, 카드 대금 결제). */
      tagIds?: string[];
    },
  ): Promise<void> {
    await writeEntry(this.db, entryId, built, options);
  }

  /** 여러 전표 중 가장 늦은 시계 (`local-store-clocks`). */
  async latestEntryHlc(entryIds: readonly string[]): Promise<string | null> {
    return latestEntryHlc(this.db, entryIds);
  }

  /** 사본이 아는 그 전표의 시계. 수정 명령의 시계를 이 뒤로 놓는 데 쓴다. */
  async entryHlc(entryId: string): Promise<string | null> {
    return entryHlc(this.db, entryId);
  }

  /** 자산 한 줄을 사본에 쓴다. 바꾼 필드의 시계만 찍는다 (`local-store-commit`). */
  async writeAsset(
    table: SettingTable,
    id: string,
    values: Record<string, SqlValue>,
    hlc: string,
  ): Promise<void> {
    await writeAsset(this.db, table, id, values, hlc);
  }

  /** 이 자산 줄의 마지막 편집 시각. 필드마다의 시계 가운데 가장 늦은 것이다. */
  async assetClock(table: SettingTable, id: string): Promise<string | null> {
    return assetClock(this.db, table, id);
  }

  /** 여러 줄의 분류를 사본에서 한 분류로 바꾼다 (`local-store-bulk-edits`). */
  async changeEntryCategory(
    targets: readonly TagTarget[],
    categoryId: string,
    hlc: string,
  ): Promise<{ entries: number; skipped: TagTarget[]; excluded: number }> {
    return changeEntryCategory(this.db, targets, categoryId, hlc);
  }

  /** 분류를 바꾸면 무엇이 바뀌는지만 센다. 분류가 없으면 `CATEGORY_NOT_FOUND` 로 던진다. */
  async previewEntryCategory(
    targets: readonly TagTarget[],
    categoryId: string,
  ): Promise<{ entries: number; skipped: TagTarget[]; excluded: number }> {
    return previewEntryCategory(this.db, targets, categoryId);
  }

  /** 여러 전표의 태그를 사본에서 바꾼다. 실제로 달라진 전표의 수를 준다 (`local-store-bulk-edits`). */
  async changeEntryTags(
    targets: readonly TagTarget[],
    addTagIds: readonly string[],
    removeTagIds: readonly string[],
    hlc: string,
  ): Promise<{ entries: number; skipped: TagTarget[] }> {
    return changeEntryTags(this.db, targets, addTagIds, removeTagIds, hlc);
  }

  /**
   * 이 카드의 청구액 미확정 외화 결제. 서버의 `/cards/:id/pending-rates` 와 같은 답이다.
   *
   * 고르는 조건도 서버와 같다 -- 카드 부채 계정에 걸린 다리 가운데 전표가 미확정이고
   * 원 통화가 있는 것. 주기를 매기는 일은 공용 함수(`pendingRateItems`)가 한다.
   *
   * 마감일·결제일이 없는 카드는 빈 목록이다. 서버는 그런 카드를 거절하는데, 화면은
   * 목록이 비면 판을 그리지 않으므로 결과가 같다.
   */
  async pendingRates(cardId: string): Promise<CardDto.PendingRatesResponse> {
    const cards = await this.db.all<Row>(
      `SELECT c.projectId, c.liabilityAccountId, c.statementClosingDay, c.paymentDueDay,
              a.currency AS liabilityCurrency
         FROM card c LEFT JOIN account a ON a.id = c.liabilityAccountId
        WHERE c.id = ?`,
      [cardId],
    );
    const card = cards[0];
    const empty = { cardId, currency: asText(card?.liabilityCurrency) ?? 'KRW', items: [] };
    if (!card?.liabilityAccountId || card.statementClosingDay == null || card.paymentDueDay == null) {
      return empty;
    }

    const project = await this.projectRow(String(card.projectId));
    const rows = await this.db.all<Row>(
      `SELECT e.id, e.date, e.description, e.merchant, e.originalCurrency, e.originalAmount,
              p.amount
         FROM posting p JOIN entry e ON e.id = p.entryId
        WHERE p.accountId = ? AND e.rateProvisional = 1 AND e.originalCurrency IS NOT NULL
        ORDER BY e.date, e.id`,
      [String(card.liabilityAccountId)],
    );

    return {
      ...empty,
      items: pendingRateItems(
        rows.map((row) => ({
          entryId: String(row.id),
          date: new Date(String(row.date)),
          description: String(row.description),
          merchant: asText(row.merchant),
          originalCurrency: String(row.originalCurrency),
          originalAmount: asMoney(row.originalAmount),
          liabilityAmount: asMoney(row.amount),
        })),
        { statementClosingDay: asInt(card.statementClosingDay), paymentDueDay: asInt(card.paymentDueDay) },
        project?.timeZone ?? 'Asia/Seoul',
      ),
    };
  }

  /**
   * 청구액 확정을 사본에서 셈한다. **쓰지 않는다.**
   *
   * 셈과 쓰기를 가르는 이유. 규칙에 어긋나는 확정(외화 다리가 있는 거래, 원 통화가 없는
   * 거래)은 서버도 영영 거절하므로 큐에 넣으면 안 된다. 먼저 셈해 보고 던지면 부르는
   * 쪽이 명령을 쌓기 전에 멈춘다. 쓰기는 `applyRestate` 가 한다.
   *
   * 나누는 규칙은 서버와 같은 함수다(`restateAmounts`). 끝수가 가는 줄까지 같아야 재생한
   * 전표와 사본의 금액이 1원도 어긋나지 않는다.
   */
  async planRestate(
    projectId: string,
    items: readonly { entryId: string; billedAmount: string }[],
  ): Promise<RestatePlan> {
    const project = await this.projectRow(projectId);
    const base = project?.ledgerCurrency ?? 'KRW';
    const plan: RestatePlan = [];

    for (const item of items) {
      const entries = await this.db.all<Row>(
        `SELECT originalAmount FROM entry WHERE id = ? AND projectId = ?`,
        [item.entryId, projectId],
      );
      if (!entries[0]) throw new RestateError('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      if (entries[0].originalAmount == null) {
        throw new RestateError(
          'NO_ORIGINAL_AMOUNT',
          '원 통화 금액이 없는 거래는 청구액을 확정할 수 없습니다.',
        );
      }

      const postings = await this.db.all<Row>(
        `SELECT id, amount, currency, lineKey FROM posting WHERE entryId = ?`,
        [item.entryId],
      );
      const next = restateAmounts(
        postings.map((row) => ({
          id: String(row.id),
          amount: asMoney(row.amount),
          currency: String(row.currency),
          lineKey: asText(row.lineKey),
        })),
        item.billedAmount,
        base,
      );
      plan.push({
        entryId: item.entryId,
        postings: [...next.entries()].map(([id, amount]) => ({ id, amount: amount.toString() })),
      });
    }
    return plan;
  }

  /**
   * 셈한 확정을 사본에 적는다. 다리 금액만 바꾸고 전표를 확정으로 돌린다.
   *
   * 잔액은 건드리지 않는다 -- 읽는 쪽이 다리를 세므로(`accountBalances`) 다리만 바뀌면
   * 잔액도 따라온다. 다리가 전부 기준통화라 환산액도 같은 값이다(서버와 같다).
   */
  async applyRestate(plan: RestatePlan, hlc: string): Promise<void> {
    if (plan.length === 0) return;

    await this.db.transaction(async () => {
      for (const entry of plan) {
        for (const posting of entry.postings) {
          await this.db.run(`UPDATE posting SET amount = ?, baseAmount = ? WHERE id = ?`, [
            posting.amount,
            posting.amount,
            posting.id,
          ]);
        }
        await this.db.run(
          `UPDATE entry SET rateProvisional = 0, updatedHlc = ? WHERE id = ?`,
          [hlc, entry.entryId],
        );
      }
    });
  }

  /** 사본에서 한 줄을 지운다. 딸린 줄까지 함께 간다 (`local-store-writes`). */
  async forgetRow(table: string, id: string): Promise<void> {
    await forgetRow(this.db, table, id);
  }

  /**
   * 태그를 사본에서 지운다. 붙어 있던 연결도 함께 간다.
   *
   * 서버의 `deleteTag` 가 하는 일을 사본에서도 한다. 하지 않으면 다음 동기화가 올
   * 때까지 지운 태그가 목록과 거래에 그대로 남는다 -- 오프라인에서 지우면 그 사이가
   * 몇 시간이 되기도 한다.
   *
   * 서버가 거절하면(권한이 없다) 다음 동기화가 그 행을 도로 실어 온다. 지우기가
   * 사본에서만 앞서 가는 것은 자산·분류와 같은 규칙이다.
   */
  async removeTag(tagId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(`DELETE FROM entry_tag WHERE tagId = ?`, [tagId]);
      await this.db.run(`DELETE FROM entry_draft_tag WHERE tagId = ?`, [tagId]);
      await dropTagFromRules(this.db, tagId);
      // 그 태그의 예산도 함께 간다 (서버는 cascade). 남기면 홈의 태그 예산 상자가 자리표가 올 때까지 남았다.
      const budgets = await this.db.all<Row>(`SELECT id FROM budget WHERE tagId = ?`, [tagId]);
      for (const budget of budgets) await this.forgetRow('budget', String(budget.id));
      await this.db.run(`DELETE FROM tag WHERE id = ?`, [tagId]);
    });
  }

  /**
   * 분류를 사본에서 지운다. 소분류도 함께 간다(서버도 cascade 로 지운다).
   *
   * 예산은 서버가 함께 지우고, 그 자리표가 다음 동기화에 실려 온다. 여기서 미리
   * 지우지 않는 까닭은 예산이 달마다 조정을 달고 있어(budget_override) 되돌릴 자리가
   * 넓기 때문이다 -- 목록에서 분류가 사라지는 것만으로 화면은 충분히 설명된다.
   */
  async removeCategory(categoryId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(`DELETE FROM category WHERE id = ? OR parentId = ?`, [
        categoryId,
        categoryId,
      ]);
    });
  }

  /**
   * 전표를 사본에서 지운다. 딸린 다리와 할부 계획도 함께 간다.
   *
   * 걸린 환불·페이백도 함께 지운다. 서버 원장의 `deleteEntry` 와 같다 (PAYBACK_DESIGN.md 7-6) --
   * 명령은 원거래 하나만 올라가고, 서버가 같은 것을 지워 자리표로 돌려준다.
   */
  async removeEntry(entryId: string): Promise<void> {
    await this.db.transaction(async () => {
      const paybacks = await this.db.all<Row>(`SELECT id FROM entry WHERE paybackOfEntryId = ?`, [entryId]);
      for (const id of [entryId, ...paybacks.map((row) => String(row.id))]) {
        await dropEntryLegs(this.db, id);
        /*
         * 태그 연결도 치운다. 남기면 태그를 지울 때 세는 "이 태그가 붙은 거래 수"
         * (`tagUsageCounts`)에 지운 거래와 함께 지운 환불·페이백까지 들어간다.
         */
        await this.db.run(`DELETE FROM entry_tag WHERE entryId = ?`, [id]);
        await this.db.run(`DELETE FROM entry WHERE id = ?`, [id]);
      }
    });
  }

  // ───────────────────────────────────────────
  // 조립이 읽는 것
  // ───────────────────────────────────────────

  /** 계좌 하나. 다른 프로젝트의 것은 없는 것으로 본다(서버와 같은 규칙이다). */
  async accountById(
    projectId: string,
    accountId: string,
  ): Promise<{ id: string; type: string; currency: string; ownerId: string | null } | null> {
    const rows = await this.db.all<Row>(
      `SELECT id, type, currency, ownerId FROM account WHERE id = ? AND projectId = ?`,
      [accountId, projectId],
    );
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          type: String(row.type),
          currency: String(row.currency),
          ownerId: asText(row.ownerId),
        }
      : null;
  }

  async cardById(
    projectId: string,
    cardId: string,
  ): Promise<{
    id: string;
    name: string;
    cardType: string;
    paymentAccountId: string;
    liabilityAccountId: string | null;
  } | null> {
    const rows = await this.db.all<Row>(
      `SELECT id, name, cardType, paymentAccountId, liabilityAccountId
         FROM card WHERE id = ? AND projectId = ?`,
      [cardId, projectId],
    );
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          cardType: String(row.cardType),
          paymentAccountId: String(row.paymentAccountId),
          liabilityAccountId: asText(row.liabilityAccountId),
        }
      : null;
  }

  /** 프로젝트의 미지정 계정. 결제수단을 고르지 않은 지출·수입이 붙는다. */
  async unassignedAccount(projectId: string): Promise<{ id: string; currency: string } | null> {
    const rows = await this.db.all<Row>(
      `SELECT id, currency FROM account WHERE projectId = ? AND type = 'unassigned' LIMIT 1`,
      [projectId],
    );
    const row = rows[0];
    return row ? { id: String(row.id), currency: String(row.currency) } : null;
  }

  /** 이 계좌를 부채 계정으로 쓰는 카드의 id. */
  async cardIdForLiability(projectId: string, accountId: string): Promise<string | null> {
    const rows = await this.db.all<Row>(
      `SELECT id FROM card WHERE liabilityAccountId = ? AND projectId = ?`,
      [accountId, projectId],
    );
    return asText(rows[0]?.id);
  }

  /**
   * 페이백이 가리키는 원거래의 분류 다리. 원거래가 사본에 없으면 null.
   *
   * 조립(`LedgerLookup.paybackTarget`)이 원거래가 페이백인지와 줄의 분류를 정하는 데 쓴다.
   */
  async paybackTargetLegs(
    projectId: string,
    entryId: string,
  ): Promise<Array<{ lineKey: string | null; categoryId: string; categoryType: string; baseAmount: string }> | null> {
    const entry = await this.db.all<Row>(`SELECT id FROM entry WHERE id = ? AND projectId = ?`, [
      entryId,
      projectId,
    ]);
    if (entry.length === 0) return null;
    const rows = await this.db.all<Row>(
      `SELECT p.lineKey, p.categoryId, c.type AS categoryType, p.baseAmount
         FROM posting p JOIN category c ON c.id = p.categoryId
        WHERE p.entryId = ?`,
      [entryId],
    );
    return rows.map((row) => ({
      lineKey: asText(row.lineKey),
      categoryId: String(row.categoryId),
      categoryType: String(row.categoryType),
      baseAmount: String(row.baseAmount),
    }));
  }

  /**
   * 원거래의 할부 계획과 걸린 할부 환불 (installment-refund). 할부가 아니면 null.
   *
   * 할부 환불의 회차를 검사하고(`LookupPaybackTarget.installment`), 원거래를 고칠 때 어긋나지
   * 않는지 본다(`checkInstallmentRefunds`). 서버의 prisma-lookup 과 같은 값이다.
   */
  async installmentTargetOf(entryId: string): Promise<{
    months: number;
    cardId: string;
    sameCurrency: boolean;
    entryAmount: string;
    principals: string[] | null;
    interests: string[] | null;
    refunds: Array<{ id: string; lineKey: string | null; cardId: string | null; adjust: string | null }>;
  } | null> {
    const plan = await this.db.all<Row>(
      `SELECT p.cardId, p.amount, p.baseAmount, ip.totalMonths, ip.principalShares, ip.interestShares
         FROM posting p JOIN installment_plan ip ON ip.postingId = p.id
        WHERE p.entryId = ? LIMIT 1`,
      [entryId],
    );
    const row = plan[0];
    if (!row || !row.cardId || asInt(row.totalMonths) < 2) return null;
    const refunds = await this.db.all<Row>(
      `SELECT e.id, e.paybackOfLineKey, e.installmentAdjust,
              (SELECT cp.cardId FROM posting cp
                WHERE cp.entryId = e.id AND cp.cardId IS NOT NULL AND cp.categoryId IS NULL LIMIT 1) AS cardId
         FROM entry e
        WHERE e.paybackOfEntryId = ? AND e.installmentAdjust IS NOT NULL`,
      [entryId],
    );
    return {
      months: asInt(row.totalMonths),
      cardId: String(row.cardId),
      sameCurrency: String(row.amount) === String(row.baseAmount),
      entryAmount: Dec.of(String(row.baseAmount)).abs().toString(),
      principals: shareListOf(row.principalShares),
      interests: shareListOf(row.interestShares),
      refunds: refunds.map((refund) => ({
        id: String(refund.id),
        lineKey: asText(refund.paybackOfLineKey),
        cardId: asText(refund.cardId),
        adjust: asText(refund.installmentAdjust),
      })),
    };
  }

  /**
   * 원거래에 걸린 환불·페이백과 그 분류 다리. 원거래를 고칠 때 맞추고(`planPaybackRebind`),
   * 새로 적을 때 상한을 보는 데 쓴다 (서버 원장과 같은 규칙).
   */
  async paybacksOf(
    entryId: string,
  ): Promise<Array<{ id: string; lineKey: string | null; categoryId: string | null; baseAmount: string }>> {
    const rows = await this.db.all<Row>(
      `SELECT e.id, e.paybackOfLineKey AS lineKey, p.categoryId, p.baseAmount
         FROM entry e
         JOIN posting p ON p.entryId = e.id AND p.categoryId IS NOT NULL
        WHERE e.paybackOfEntryId = ?`,
      [entryId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      lineKey: asText(row.lineKey),
      categoryId: asText(row.categoryId),
      baseAmount: String(row.baseAmount),
    }));
  }

  /**
   * 환불·페이백을 원거래의 다른 줄·분류로 옮긴다. 원거래를 고친 뒤 사본에서 곧바로 맞춘다 --
   * 서버도 같은 일을 하고 다음 pull 이 그 결과로 덮는다.
   */
  async movePayback(paybackId: string, lineKey: string, categoryId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(`UPDATE posting SET categoryId = ? WHERE entryId = ? AND categoryId IS NOT NULL`, [
        categoryId,
        paybackId,
      ]);
      await this.db.run(`UPDATE entry SET paybackOfLineKey = ? WHERE id = ?`, [lineKey, paybackId]);
    });
  }

  async categoriesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string; type: string }>> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.db.all<Row>(
      `SELECT id, name, type
         FROM category WHERE projectId = ? AND id IN (${placeholders})`,
      [projectId, ...ids],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      type: String(row.type),
    }));
  }

  // ───────────────────────────────────────────
  // 아웃박스
  // ───────────────────────────────────────────

  /**
   * 이 기기의 이름과 다음 번호를 준비한다.
   *
   * 이름은 한 번만 만든다. 새로 만들면 서버가 보기에 다른 기기가 되어 (clientId,
   * clientSeq) 멱등이 끊기고, 응답을 못 받고 다시 보낸 명령이 두 번 적힌다.
   */
  async ensureClient(makeId: () => string): Promise<string> {
    const rows = await this.db.all<Row>(`SELECT clientId FROM client_state WHERE id = 1`);
    const existing = asText(rows[0]?.clientId);
    if (existing) return existing;

    const clientId = makeId();
    await this.db.run(`INSERT INTO client_state (id, clientId, nextSeq) VALUES (1, ?, 1)`, [
      clientId,
    ]);
    return clientId;
  }

  /**
   * 명령 하나를 큐에 넣는다.
   *
   * 번호와 시계를 여기서 발급한다. 화면이 정하면 두 화면이 같은 번호를 쓸 수 있고, 그러면
   * 서버가 뒤엣것을 영영 받지 않는다. 발급과 적재를 한 트랜잭션에 두는 이유도 같다.
   *
   * `now` 를 받는 것은 검사에서 시계를 고정하기 위해서다.
   */
  async enqueue(
    input: {
      projectId: string;
      mutationId: string;
      kind: MutationKind;
      targets: string[];
      payload: unknown;
      /**
       * 이 명령이 보고 고친 값의 시계.
       *
       * 남의 편집을 받아 본 뒤 고쳤다면 그 값보다 뒤여야 병합에서 이긴다. 없으면
       * 기기의 시계만으로 정한다(새로 만드는 경우가 그렇다).
       */
      observed?: string | null;
    },
    now = Date.now(),
  ): Promise<Mutation> {
    return this.db.transaction(() => insertMutation(this.db, input, now));
  }

  /** 보낼 차례의 명령. 언제나 clientSeq 순서다. */
  async pendingMutations(projectId: string, limit = 200): Promise<Mutation[]> {
    const [rows, clientId] = await Promise.all([
      this.db.all<Row>(
        `SELECT * FROM outbox
          WHERE projectId = ? AND status = 'pending'
          ORDER BY clientSeq
          LIMIT ?`,
        [projectId, limit],
      ),
      this.clientId(),
    ]);
    return rows.map((row) => toMutation(row, clientId));
  }

  /** 이 기기의 이름. 아직 없으면 빈 문자열. */
  async clientId(): Promise<string> {
    const rows = await this.db.all<Row>(`SELECT clientId FROM client_state WHERE id = 1`);
    return asText(rows[0]?.clientId) ?? '';
  }

  /**
   * 서버가 돌려준 결과를 반영한다. 다시 낸 명령의 수를 돌려준다 (`local-store-outbox`).
   */
  async settleMutations(
    results: readonly MutationResult[],
    makeId: () => string,
  ): Promise<{ requeued: number }> {
    return settleMutations(this.db, results, makeId);
  }

  /**
   * 기기가 만든 id 를 서버가 채택한 id 로 갈아 끼운다. 트랜잭션은 부르는 쪽이 연다 (`local-store-outbox`).
   */
  async applyAlias(localId: string, serverId: string): Promise<void> {
    await applyAlias(this.db, localId, serverId);
  }

  /**
   * 서버의 다른 id 로 옮겨진 id 들 (기기 id -> 서버 id). 화면이 옛 id 를 들고 왔을 때 쓴다.
   *
   * 분류·태그를 두 기기가 같은 이름으로 만들면 서버는 먼저 선 것을 채택하고, 기기는 제 id 를 그것으로
   * 갈아 끼운다(`applyAlias`). 그 전에 열어 둔 폼은 옛 id 를 들고 있어, 그대로 저장하면 없는 분류로
   * 거절되거나 아무 데도 가리키지 않는 태그 연결이 생겼다.
   */
  async aliasesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.db.all<Row>(
      `SELECT localId, serverId FROM alias WHERE localId IN (${placeholders(unique.length)})`,
      [...unique],
    );
    return new Map(rows.map((row) => [String(row.localId), String(row.serverId)]));
  }

  /** 사용자에게 보여 줄 보류 칸. 충돌과 거절이 여기 모인다. */
  async heldMutations(projectId: string): Promise<HeldMutation[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM outbox
        WHERE projectId = ? AND status <> 'pending'
        ORDER BY clientSeq`,
      [projectId],
    );
    const clientId = await this.clientId();

    return Promise.all(
      rows.map(async (row) => {
        const mutation = toMutation(row, clientId);
        return {
          ...mutation,
          status: String(row.status) as HeldMutation['status'],
          error: asText(row.error),
          createdAt: String(row.createdAt),
          /*
           * 고치려던 거래가 아직 있는가. 없으면 다시 보내도 영영 거절된다.
           *
           * 사본을 보고 판단한다. 삭제는 자리표로 오고 그때 사본에서 그 줄이 사라지므로,
           * 여기서 없다는 것은 곧 "그 사이 누가 지웠다"는 뜻이다.
           */
          targetMissing:
            mutation.kind === 'entry.replace' && mutation.targets.length > 0
              ? (await this.entryExists(mutation.targets[0])) === false
              : false,
        };
      }),
    );
  }

  /** 이 전표가 사본에 있는가. 보류 칸이 "대상이 사라졌다"를 판단할 때 쓴다. */
  async entryExists(entryId: string): Promise<boolean> {
    const rows = await this.db.all<Row>(`SELECT 1 AS present FROM entry WHERE id = ?`, [entryId]);
    return rows.length > 0;
  }

  /** 큐에서 뺀다. 사용자가 "그만두겠다"를 고른 자리다. */
  async discardMutation(mutationId: string): Promise<void> {
    await this.db.transaction(async () => {
      const rows = await this.db.all<Row>(`SELECT projectId FROM outbox WHERE mutationId = ?`, [mutationId]);
      await this.db.run(`DELETE FROM outbox WHERE mutationId = ?`, [mutationId]);
      /*
       * 버린 명령이 사본에 남긴 것을 되돌릴 길이 없다. 서버는 바뀐 줄만 다시 보내는데 거절된 줄은
       * 바뀌지 않았다 -- 버린 거래가 잔액·예산에 유령으로 남고, 거절된 삭제는 사라진 채로 남았다.
       * 그래서 다음 동기화가 남은 명령을 먼저 보낸 뒤 처음부터 다시 받게 표시한다(`REBUILD_PENDING`).
       * 바로 지우지 않는 까닭은 아직 보내지 않은 다른 명령의 모습이 화면에서 사라지기 때문이다.
       */
      if (rows[0]) {
        await this.db.run(`UPDATE sync_state SET version = ? WHERE projectId = ?`, [
          REBUILD_PENDING,
          String(rows[0].projectId),
        ]);
      }
    });
  }

  /**
   * 방금 쌓은 명령을 거둔다. 사본에 적다가 실패했을 때다 (2026-10-16).
   *
   * 큐에 넣고 사본에 적는 일은 두 트랜잭션이다. 적기가 실패하면 화면은 "저장하지 못했다"를 말하는데
   * 명령은 남아 서버로 간다 -- 사용자가 다시 저장하면 새 id 로 하나 더 생긴다. 아직 보내지 않은
   * 것만 거둔다. 이미 나가고 있으면 다음 받기가 사본을 맞춘다.
   */
  async withdrawMutation(mutationId: string): Promise<void> {
    await this.db.transaction(() =>
      this.db.run(`DELETE FROM outbox WHERE mutationId = ? AND status = 'pending'`, [mutationId]),
    );
  }

  /**
   * 방금 쌓은 명령의 사본 쓰기를 한다. 쓰기가 실패하면 명령을 거두고 오류를 그대로 던진다 (`withdrawMutation`).
   *
   * 명령을 쌓는 모든 창구가 이 길을 쓴다. 예전에는 전표 저장만 거두어, 태그·분류 바꾸기나 지우기는 화면이
   * 실패를 말하는데 명령은 서버로 갔고, 다시 누르면 같은 명령이 하나 더 쌓였다.
   */
  async applyQueued<T>(mutationId: string, apply: () => Promise<T>): Promise<T> {
    try {
      return await apply();
    } catch (error) {
      await this.withdrawMutation(mutationId).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 막힌 명령을 **새 명령으로** 다시 낸다. 돌려주는 것은 새로 만든 명령이다.
   *
   * 상태만 'pending' 으로 되돌리면 아무 일도 일어나지 않는다. 서버는 명령 id 로 판정을
   * 기록해 두어(MutationLog), 같은 id 가 다시 오면 재생하지 않고 **그때의 판정을 그대로**
   * 돌려준다. 충돌은 영원히 충돌로, 거절은 영원히 거절로 되돌아온다.
   *
   * 그래서 짐만 물려받고 id·순번·시계를 새로 뽑는다. 시계는 사본에 지금 들어 있는 값을
   * 보고(`observed`) 그보다 뒤가 되므로, 충돌로 밀렸던 편집이 이번에는 이긴다 -- 사용자가
   * "그래도 내 값으로 하겠다"를 고른 자리이기 때문이다 (설계 문서의 D6).
   *
   * 앞 명령이 막아 함께 미뤄졌던 것(blocked)도 같은 길로 나간다. 그쪽은 서버가 본 적이
   * 없어 id 를 바꾸지 않아도 되지만, 한 길로 두는 편이 규칙이 하나다.
   */
  async retryMutation(mutationId: string, makeId: () => string): Promise<Mutation | null> {
    return this.db.transaction(() => insertRetry(this.db, mutationId, makeId));
  }

  /**
   * 아직 보내지 못한 명령 수. 화면이 "N건 대기" 를 보여 줄 때 쓴다.
   *
   * 프로젝트를 주지 않으면 이 기기 전체를 센다. 세션이 끊긴 뒤(로그인 화면)에는 어느
   * 프로젝트를 보고 있었는지가 남아 있다고 믿을 수 없어서, 그 자리에서는 전체를 묻는다.
   */
  async outboxCount(projectId?: string): Promise<{ pending: number; held: number }> {
    const rows = await this.db.all<Row>(
      projectId
        ? `SELECT status, COUNT(*) AS n FROM outbox WHERE projectId = ? GROUP BY status`
        : `SELECT status, COUNT(*) AS n FROM outbox GROUP BY status`,
      projectId ? [projectId] : [],
    );
    let pending = 0;
    let held = 0;
    for (const row of rows) {
      if (String(row.status) === 'pending') pending += asInt(row.n);
      else held += asInt(row.n);
    }
    return { pending, held };
  }

  /**
   * 결제수단 집계가 쓰는 카드.
   *
   * 카드의 주인은 결제 통장의 주인이다. 실적 기준액의 통화도 그 통장의 통화라서
   * 한 번에 함께 읽는다 (부르는 쪽이 그 통화로 환율을 고른다).
   */
  async cardsForPaymentMethods(projectId: string): Promise<StoredPaymentCard[]> {
    const rows = await this.db.all<Row>(
      `SELECT c.id, c.name, c.cardType, c.isActive, c.color, c.statementClosingDay,
              c.performanceAmount, pay.currency AS paymentCurrency,
              owner.id AS ownerId, owner.name AS ownerName
         FROM card c
         LEFT JOIN account pay ON pay.id = c.paymentAccountId
         LEFT JOIN person owner ON owner.id = pay.ownerId
        WHERE c.projectId = ?
        ORDER BY c.sortRank, c.createdAt`,
      [projectId],
    );

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      cardType: String(row.cardType),
      isActive: Boolean(row.isActive),
      color: asText(row.color),
      statementClosingDay: row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
      performanceAmount: asText(row.performanceAmount),
      paymentCurrency: asText(row.paymentCurrency) ?? 'KRW',
      ownerId: asText(row.ownerId),
      ownerName: asText(row.ownerName),
    }));
  }

  /**
   * 실적 계산이 쓰는 카드 한 장. 두 계좌를 함께 읽는다.
   *
   * 신용카드의 사용액과 남은 대금은 부채 계정의 통화이고, 체크카드는 결제 통장의
   * 통화다. 어느 쪽을 쓸지는 부르는 쪽이 카드 종류를 보고 정한다.
   */
  async cardForPerformance(cardId: string): Promise<StoredPerformanceCard | null> {
    const rows = await this.db.all<Row>(
      `SELECT c.id, c.projectId, c.name, c.cardType, c.statementClosingDay, c.paymentDueDay,
              c.performanceAmount, c.liabilityAccountId,
              pay.currency AS paymentCurrency,
              liability.currency AS liabilityCurrency
         FROM card c
         LEFT JOIN account pay ON pay.id = c.paymentAccountId
         LEFT JOIN account liability ON liability.id = c.liabilityAccountId
        WHERE c.id = ?`,
      [cardId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: String(row.id),
      projectId: String(row.projectId),
      name: String(row.name),
      cardType: String(row.cardType),
      statementClosingDay:
        row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
      paymentDueDay: row.paymentDueDay == null ? null : asInt(row.paymentDueDay),
      performanceAmount: asText(row.performanceAmount),
      liabilityAccountId: asText(row.liabilityAccountId),
      paymentCurrency: asText(row.paymentCurrency) ?? 'KRW',
      liabilityCurrency: asText(row.liabilityCurrency),
      // 남은 대금도 다리를 세어 낸다. 부채 계정이 없는 체크카드는 셀 것이 없다.
      liabilityBalance: row.liabilityAccountId
        ? await this.accountBalance(String(row.liabilityAccountId))
        : null,
    };
  }

  /** 신용카드로 쓴 다리. 부채 계정에 걸린 것만 본다 (`local-store-card-postings`). */
  async creditCardPostings(liabilityAccountId: string): Promise<StoredCardPosting[]> {
    return creditCardPostings(this.db, liabilityAccountId);
  }

  /** 체크카드로 쓴 다리. 그 카드가 찍힌 다리다. */
  async debitCardPostings(cardId: string): Promise<StoredCardPosting[]> {
    return debitCardPostings(this.db, cardId);
  }

  /** 실적 원장의 재료. 주기별 사용액이 읽는 다리에 화면에 적을 것을 붙여 준다. */
  async cardLedgerPostings(input: {
    liabilityAccountId?: string | null;
    cardId?: string | null;
  }): Promise<StoredCardLedgerPosting[]> {
    return cardLedgerPostings(this.db, input);
  }

  /**
   * 한 계좌의 다리 전부. 날짜 오름차순이고 잔액 누적의 바탕이 된다.
   *
   * 금액만 읽는다. 화면에 적을 것(설명·분류)은 보여 줄 줄에만 붙이면 되므로 따로
   * 읽는다 -- 오래된 통장이면 다리가 수천 줄이라 그때마다 다 가져올 까닭이 없다.
   */
  async accountPostingAmounts(
    accountId: string,
  ): Promise<Array<{ postingId: string; date: string; amount: string }>> {
    const rows = await this.db.all<Row>(
      `SELECT p.id AS postingId, e.date, p.amount
         FROM posting p
         JOIN entry e ON e.id = p.entryId
        WHERE p.accountId = ?
        ORDER BY e.date, p.id`,
      [accountId],
    );

    return rows.map((row) => ({
      postingId: String(row.postingId),
      date: String(row.date),
      amount: asMoney(row.amount),
    }));
  }

  /** 고른 다리의 화면 값. 원장 한 쪽에 실을 줄만 읽는다. */
  async ledgerRows(postingIds: string[]): Promise<Map<string, StoredLedgerRow>> {
    if (postingIds.length === 0) return new Map();

    const marks = postingIds.map(() => '?').join(',');
    const rows = await this.db.all<Row>(
      `SELECT p.id AS postingId, p.amount, p.cardId, card.name AS cardName,
              e.id AS entryId, e.date, e.description, e.merchant, e.countsPerformance,
              cat.name AS categoryName, parent.name AS parentCategoryName,
              (SELECT COUNT(*) FROM posting a WHERE a.entryId = e.id AND a.accountId IS NOT NULL)
                AS accountLegs
         FROM posting p
         JOIN entry e ON e.id = p.entryId
         LEFT JOIN card ON card.id = p.cardId
         LEFT JOIN posting cp
           ON cp.id = (SELECT c.id FROM posting c
                        WHERE c.entryId = e.id AND c.categoryId IS NOT NULL
                        ORDER BY c.id LIMIT 1)
         LEFT JOIN category cat ON cat.id = cp.categoryId
         LEFT JOIN category parent ON parent.id = cat.parentId
        WHERE p.id IN (${marks})`,
      postingIds,
    );

    return new Map(
      rows.map((row) => {
        /*
         * 이체 계열에는 대표 분류를 달지 않는다. 계좌 다리가 둘 이상이면 그 전표의
         * 카테고리 다리는 수수료이지 무슨 거래인지를 말하는 분류가 아니다
         * (서버의 `ledgerRowCategory` 와 같은 규칙).
         */
        const isTransfer = asInt(row.accountLegs) > 1;

        return [
          String(row.postingId),
          {
            postingId: String(row.postingId),
            entryId: String(row.entryId),
            date: String(row.date),
            description: asText(row.description) ?? '',
            merchant: asText(row.merchant),
            amount: asMoney(row.amount),
            cardId: asText(row.cardId),
            cardName: asText(row.cardName),
            categoryName: isTransfer ? null : asText(row.categoryName),
            parentCategoryName: isTransfer ? null : asText(row.parentCategoryName),
            countsPerformance: Boolean(row.countsPerformance),
          },
        ];
      }),
    );
  }

  /** 사본에 담긴 행 수. 화면이 "얼마나 받았는지" 보여 줄 때와 검증에 쓴다. */
  async counts(projectId: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const table of ['person', 'account', 'category', 'card', 'entry', 'budget']) {
      const rows = await this.db.all<Row>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE projectId = ?`,
        [projectId],
      );
      result[table] = asInt(rows[0]?.n);
    }
    const postings = await this.db.all<Row>(
      `SELECT COUNT(*) AS n FROM posting WHERE entryId IN (SELECT id FROM entry WHERE projectId = ?)`,
      [projectId],
    );
    result.posting = asInt(postings[0]?.n);
    return result;
  }

}
