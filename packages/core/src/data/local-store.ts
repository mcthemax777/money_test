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
 */

import {
  type AccountDto,
  type CardDto,
  type CategoryDto,
  Dec,
  type PersonDto,
  type ViewEntry,
  type ViewPosting,
  type CategoryNode,
  type CategoryPostingRow,
  type NamedCategoryPostingRow,
  type BuiltEntry,
  type Mutation,
  type MutationKind,
  type MutationResult,
  type NetWorthAccountRow,
  type ParsedEntrySearch,
  SyncDto,
  decodeHlc,
  encodeHlc,
  hlcNext,
  hlcReceive,
  isDeferred,
  isSettled,
  zonedDateKey,
  zonedYearMonth,
} from '@money/types';

import { ALL_TABLES, SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';
import type { SqlDriver, SqlValue } from './sql-driver';

/** 사본이 어디까지 따라왔는지. */
export interface SyncCursor {
  projectId: string;
  version: number;
  /** 달력 키를 계산할 때 쓴 타임존. 프로젝트 타임존이 바뀌면 키를 다시 계산해야 한다. */
  timeZone: string;
  syncedAt: string | null;
}

/** 사본에 담긴 계좌 한 줄. 화면과 순자산 계산이 함께 쓴다. */
export interface StoredAccount {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  type: string;
  name: string;
  currency: string;
  balance: string;
  isActive: boolean;
  sortOrder: number;
}

/** 사본에 담긴 예산 규칙 한 줄. 그 달의 조정값을 함께 실어 준다. */
export interface StoredBudget {
  id: string;
  categoryId: string | null;
  type: string | null;
  monthlyAmount: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** 그 달만 따로 잡아 둔 금액. 없으면 null */
  overrideAmount: string | null;
  overrideId: string | null;
}

/** 결제수단 집계가 보는 카드 한 장. 실적 기준액은 아직 통장 통화다. */
export interface StoredPaymentCard {
  id: string;
  name: string;
  cardType: string;
  isActive: boolean;
  color: string | null;
  statementClosingDay: number | null;
  performanceAmount: string | null;
  paymentCurrency: string;
  ownerId: string | null;
  ownerName: string | null;
}

/** 실적 계산이 보는 카드 한 장. */
export interface StoredPerformanceCard {
  id: string;
  projectId: string;
  cardType: string;
  statementClosingDay: number | null;
  paymentDueDay: number | null;
  performanceAmount: string | null;
  liabilityAccountId: string | null;
  paymentCurrency: string;
  liabilityCurrency: string | null;
  liabilityBalance: string | null;
}

/** 보류 칸의 명령 하나. 화면이 이유와 시각을 함께 보여 준다. */
export interface HeldMutation extends Mutation {
  status: 'conflict' | 'rejected' | 'blocked';
  error: string | null;
  createdAt: string;
}

/** 주기별 사용액이 보는 다리 하나. */
export interface StoredCardPosting {
  amount: string;
  date: string;
  installmentMonths: number | null;
}

type Row = Record<string, SqlValue>;

const asText = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

const asMoney = (value: unknown): string => asText(value) ?? '0';

const asFlag = (value: unknown): number => (value ? 1 : 0);

/**
 * 큐의 한 줄을 명령으로.
 *
 * clientId 는 이 표에 담지 않는다. 기기마다 하나뿐이라 줄마다 되풀이할 값이 아니고,
 * 한 곳에만 두어야 나중에 바뀔 일이 생겨도 어긋나지 않는다.
 */
const toMutation = (row: Row, clientId: string): Mutation => ({
  mutationId: String(row.mutationId),
  clientId,
  clientSeq: Number(row.clientSeq),
  hlc: String(row.hlc),
  kind: String(row.kind) as MutationKind,
  projectId: String(row.projectId),
  targets: JSON.parse(String(row.targets)) as string[],
  payload: JSON.parse(String(row.payload)) as unknown,
});

const toCardPosting = (row: Row): StoredCardPosting => ({
  amount: asMoney(row.amount),
  date: String(row.date),
  installmentMonths: row.totalMonths == null ? null : Number(row.totalMonths),
});

const asInt = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/** ISO 문자열로. Date 와 문자열이 섞여 오므로 한 곳에서 맞춘다. */
const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

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
    for (const statement of SCHEMA_STATEMENTS) {
      await this.db.run(statement);
    }
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
        `INSERT INTO sync_state (projectId, version, schemaVersion, timeZone, syncedAt)
         VALUES (?, 0, ?, ?, NULL)`,
        [projectId, SCHEMA_VERSION, timeZone],
      );
      return { projectId, version: 0, timeZone, syncedAt: null };
    }

    const rows = await this.db.all<Row>(
      `SELECT schemaVersion FROM sync_state WHERE projectId = ?`,
      [projectId],
    );
    if (asInt(rows[0]?.schemaVersion) !== SCHEMA_VERSION) {
      await this.reset(projectId);
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
      `SELECT projectId, version, timeZone, syncedAt FROM sync_state WHERE projectId = ?`,
      [projectId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      projectId: String(row.projectId),
      version: asInt(row.version),
      timeZone: String(row.timeZone),
      syncedAt: asText(row.syncedAt),
    };
  }

  /**
   * 사본을 통째로 버린다. 다음 동기화가 처음부터 받는다.
   *
   * 표마다 프로젝트를 가리키는 방식이 다르다. 대부분은 `projectId` 컬럼을 갖지만
   * `project` 는 자기 자신이라 `id` 이고, 다리와 월 조정은 프로젝트를 가리키지 않아
   * 부모를 따라 지운다.
   */
  async reset(projectId: string): Promise<void> {
    await this.db.transaction(async () => {
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
        await this.db.run(
          `DELETE FROM ${table} WHERE ${column} NOT IN (SELECT id FROM ${parent})`,
        );
      }
    });
  }

  /**
   * 변경 피드의 응답을 사본에 적는다.
   *
   * 한 트랜잭션 안에서 행을 넣고 커서를 올린다. 반쯤 적용한 뒤 커서가 올라가면,
   * 기기는 받지 못한 변경을 "이미 본 번호"로 여겨 영원히 다시 받지 못한다.
   *
   * 타임존을 받는 것은 달력 키를 그때 계산해 넣기 때문이다.
   */
  async applyPull(response: SyncDto.PullResponse, timeZone: string): Promise<void> {
    const { projectId, changes, tombstones, version } = response;

    await this.db.transaction(async () => {
      const project = changes.project as Row | null;
      if (project) {
        await this.upsert('project', {
          id: String(project.id),
          name: asText(project.name) ?? '',
          projectKey: asText(project.projectKey),
          description: asText(project.description),
          ledgerCurrency: asText(project.ledgerCurrency) ?? 'KRW',
          displayCurrency: asText(project.displayCurrency) ?? 'KRW',
          timezone: asText(project.timezone) ?? timeZone,
          updatedVersion: asInt(project.updatedVersion),
        });
      }

      for (const row of changes.members as Row[]) {
        await this.upsert('member', {
          id: String(row.id),
          projectId,
          userId: String(row.userId),
          role: String(row.role),
          personId: asText(row.personId),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.people as Row[]) {
        await this.upsert('person', {
          id: String(row.id),
          projectId,
          name: asText(row.name) ?? '',
          relationship: asText(row.relationship),
          isActive: asFlag(row.isActive),
          sortOrder: asInt(row.sortOrder),
          createdAt: asIso(row.createdAt),
          updatedAt: asIso(row.updatedAt),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.accounts as Row[]) {
        await this.upsert('account', {
          id: String(row.id),
          projectId,
          ownerId: asText(row.ownerId),
          type: String(row.type),
          name: asText(row.name) ?? '',
          institutionId: asText(row.institutionId),
          accountNumber: asText(row.accountNumber),
          currency: asText(row.currency) ?? 'KRW',
          balance: asMoney(row.balance),
          isActive: asFlag(row.isActive),
          sortOrder: asInt(row.sortOrder),
          createdAt: asIso(row.createdAt),
          updatedAt: asIso(row.updatedAt),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.categories as Row[]) {
        await this.upsert('category', {
          id: String(row.id),
          projectId,
          name: asText(row.name) ?? '',
          parentId: asText(row.parentId),
          type: String(row.type),
          icon: asText(row.icon),
          defaultIsExtra: asFlag(row.defaultIsExtra),
          isDefault: asFlag(row.isDefault),
          isActive: asFlag(row.isActive),
          sortOrder: asInt(row.sortOrder),
          createdAt: asIso(row.createdAt),
          updatedAt: asIso(row.updatedAt),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.cards as Row[]) {
        await this.upsert('card', {
          id: String(row.id),
          projectId,
          paymentAccountId: String(row.paymentAccountId),
          liabilityAccountId: asText(row.liabilityAccountId),
          name: asText(row.name) ?? '',
          cardType: String(row.cardType),
          issuerId: String(row.issuerId),
          cardNumber: asText(row.cardNumber),
          creditLimit: asText(row.creditLimit),
          performanceAmount: asText(row.performanceAmount),
          statementClosingDay: row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
          paymentDueDay: row.paymentDueDay == null ? null : asInt(row.paymentDueDay),
          color: asText(row.color),
          expiryDate: asText(row.expiryDate),
          isActive: asFlag(row.isActive),
          sortOrder: asInt(row.sortOrder),
          createdAt: asIso(row.createdAt),
          updatedAt: asIso(row.updatedAt),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const entry of changes.entries) {
        const row = entry as unknown as Row;
        const date = asIso(row.date);
        const instant = new Date(date);

        await this.upsert('entry', {
          id: String(row.id),
          projectId,
          personId: String(row.personId),
          date,
          // 프로젝트 타임존의 달력 키를 여기서 박아 둔다.
          dateKey: zonedDateKey(instant, timeZone),
          yearMonth: zonedYearMonth(instant, timeZone),
          description: asText(row.description) ?? '',
          merchant: asText(row.merchant),
          detailedNote: asText(row.detailedNote),
          originalCurrency: asText(row.originalCurrency),
          originalAmount: asText(row.originalAmount),
          rateProvisional: asFlag(row.rateProvisional),
          createdByUserId: asText(row.createdByUserId),
          updatedHlc: asText(row.updatedHlc),
          updatedVersion: asInt(row.updatedVersion),
        });

        /*
         * 전표가 오면 그 다리를 통째로 갈아 끼운다. 다리 수가 바뀌는 수정도 이 한
         * 경로로 처리된다.
         *
         * 옛 다리에 걸린 할부 계획도 함께 지운다. 서버의 replaceEntry 가 다리를 지우고
         * 다시 만들면서 계획을 cascade 로 지우고 새로 만들기 때문에, 새 계획은 새 번호를
         * 달고 이 응답에 함께 실려 온다. 그래서 아래 installmentPlans 를 전표보다 뒤에
         * 적용해야 한다. 순서를 뒤집으면 방금 받은 계획이 여기서 지워진다.
         */
        await this.db.run(
          `DELETE FROM installment_plan
            WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)`,
          [String(row.id)],
        );
        await this.db.run(`DELETE FROM posting WHERE entryId = ?`, [String(row.id)]);
        for (const posting of (entry.postings ?? []) as Row[]) {
          await this.upsert('posting', {
            id: String(posting.id),
            entryId: String(row.id),
            accountId: asText(posting.accountId),
            categoryId: asText(posting.categoryId),
            amount: asMoney(posting.amount),
            quantity: asText(posting.quantity),
            currency: asText(posting.currency) ?? 'KRW',
            baseAmount: asMoney(posting.baseAmount),
            exchangeRate: asMoney(posting.exchangeRate),
            extraAmount: asMoney(posting.extraAmount),
            normalAmount: asMoney(posting.normalAmount),
            cardId: asText(posting.cardId),
          });
        }
      }

      for (const row of changes.budgets as Row[]) {
        await this.upsert('budget', {
          id: String(row.id),
          projectId,
          categoryId: asText(row.categoryId),
          type: asText(row.type),
          monthlyAmount: asMoney(row.monthlyAmount),
          effectiveFrom: asText(row.effectiveFrom),
          effectiveTo: asText(row.effectiveTo),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.budgetOverrides as Row[]) {
        await this.upsert('budget_override', {
          id: String(row.id),
          budgetId: String(row.budgetId),
          year: asInt(row.year),
          month: asInt(row.month),
          amount: asMoney(row.amount),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      for (const row of changes.exchangeRates as Row[]) {
        await this.upsert('exchange_rate', {
          id: String(row.id),
          projectId,
          baseCurrency: String(row.baseCurrency),
          quoteCurrency: String(row.quoteCurrency),
          rate: asMoney(row.rate),
          date: asIso(row.date).slice(0, 10),
          source: asText(row.source) ?? 'manual',
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      /*
       * 서버가 아직 이 표를 보내지 않을 수 있다. 앱이 서버보다 먼저 올라가는 배포
       * 순서에서 그렇다. 그때는 이 표만 비워 두고 나머지 동기화는 그대로 돈다.
       */
      for (const row of (changes.assetValuations ?? []) as Row[]) {
        await this.upsert('asset_valuation', {
          id: String(row.id),
          accountId: String(row.accountId),
          // 날짜만 쓴다. 최신 한 건을 고르는 비교가 문자열 정렬이라 자릿수가 같아야 한다.
          date: asIso(row.date).slice(0, 10),
          quantity: asMoney(row.quantity),
          price: asMoney(row.price),
          marketValue: asMoney(row.marketValue),
          source: asText(row.source) ?? 'manual',
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      // 전표보다 반드시 뒤다. 위의 전표 교체가 옛 다리의 계획을 지우기 때문이다.
      for (const row of (changes.installmentPlans ?? []) as Row[]) {
        await this.upsert('installment_plan', {
          id: String(row.id),
          postingId: String(row.postingId),
          totalMonths: asInt(row.totalMonths),
          feeAmount: asText(row.feeAmount),
          updatedVersion: asInt(row.updatedVersion),
        });
      }

      // 자리표. 표 이름은 서버 표 이름 그대로 온다.
      for (const tombstone of tombstones) {
        const table = TOMBSTONE_TABLES[tombstone.entity];
        if (!table) continue;

        await this.db.run(`DELETE FROM ${table} WHERE id = ?`, [tombstone.entityId]);
        if (table === 'entry') {
          await this.db.run(`DELETE FROM posting WHERE entryId = ?`, [tombstone.entityId]);
        }
        if (table === 'entry') {
          await this.db.run(
            `DELETE FROM installment_plan
              WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)`,
            [tombstone.entityId],
          );
        }
        if (table === 'budget') {
          // 부모가 사라지면 그 달 조정도 함께 사라진다 (서버도 cascade 로 지운다).
          await this.db.run(`DELETE FROM budget_override WHERE budgetId = ?`, [tombstone.entityId]);
        }
        if (table === 'account') {
          // 계좌가 사라지면 그 계좌의 평가 기록도 사라진다.
          await this.db.run(`DELETE FROM asset_valuation WHERE accountId = ?`, [
            tombstone.entityId,
          ]);
        }
      }

      await this.db.run(
        `UPDATE sync_state SET version = ?, timeZone = ?, syncedAt = ? WHERE projectId = ?`,
        [version, timeZone, new Date().toISOString(), projectId],
      );
    });
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

  async people(projectId: string): Promise<Array<{ id: string; name: string; isActive: boolean }>> {
    const rows = await this.db.all<Row>(
      `SELECT id, name, isActive FROM person WHERE projectId = ? ORDER BY sortOrder, name`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      isActive: Boolean(row.isActive),
    }));
  }

  async categories(projectId: string): Promise<CategoryNode[]> {
    const rows = await this.db.all<Row>(
      `SELECT id, type, parentId FROM category WHERE projectId = ? AND isActive = 1`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type) as CategoryNode['type'],
      parentId: asText(row.parentId),
    }));
  }

  async accounts(projectId: string): Promise<StoredAccount[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.id, a.ownerId, p.name AS ownerName, a.type, a.name, a.currency,
              a.balance, a.isActive, a.sortOrder
         FROM account a
         LEFT JOIN person p ON p.id = a.ownerId
        WHERE a.projectId = ?
        ORDER BY a.sortOrder, a.name`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      ownerId: asText(row.ownerId),
      ownerName: asText(row.ownerName),
      type: String(row.type),
      name: String(row.name),
      currency: String(row.currency),
      balance: asMoney(row.balance),
      isActive: Boolean(row.isActive),
      sortOrder: asInt(row.sortOrder),
    }));
  }

  /**
   * 순자산 계산에 넣을 계좌들.
   *
   * 시가와 장부가는 아직 담지 않는다. 평가액(AssetValuation)이 변경 피드에 없고
   * 장부가는 전 기간의 다리 합계라 최근 몇 달만 담은 사본으로는 낼 수 없다.
   * 그래서 오프라인 순자산은 투자 계좌를 장부 잔액으로 세고 미실현 손익은 0이 된다.
   * 온라인에서 본 값과 다를 수 있는 자리라, 화면이 그 차이를 감추지 않아야 한다.
   */
  async netWorthRows(projectId: string): Promise<NetWorthAccountRow[]> {
    const rows = (await this.accounts(projectId)).filter((row) => row.isActive);
    if (rows.length === 0) return [];

    const [marketValues, bookValues] = await Promise.all([
      this.latestMarketValues(projectId),
      this.bookValues(projectId),
    ]);

    return rows.map((row) => ({
      id: row.id,
      type: row.type as NetWorthAccountRow['type'],
      currency: row.currency,
      balance: row.balance,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      marketValue: marketValues.get(row.id) ?? null,
      bookValue: bookValues.get(row.id) ?? null,
    }));
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
   * 전 기간 합계여야 시가와 나란히 놓고 미실현손익을 낼 수 있다.
   */
  private async bookValues(projectId: string): Promise<Map<string, string>> {
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
        WHERE a.projectId = ?`,
      [projectId],
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
    const rows = await this.db.all<Row>(
      `SELECT p.categoryId, c.type AS categoryType, c.name AS categoryName,
              c.parentId AS parentCategoryId, parent.name AS parentCategoryName,
              p.baseAmount, p.normalAmount, p.extraAmount, e.date
         FROM posting p
         JOIN entry e ON e.id = p.entryId
         JOIN category c ON c.id = p.categoryId
         LEFT JOIN category parent ON parent.id = c.parentId
        WHERE e.projectId = ? AND e.dateKey >= ? AND e.dateKey <= ?${owner.sql}${search.sql}`,
      [projectId, range.fromDateKey, range.toDateKey, ...owner.params, ...search.params],
    );

    return rows.map((row) => ({
      categoryId: String(row.categoryId),
      categoryType: String(row.categoryType) as NamedCategoryPostingRow['categoryType'],
      categoryName: String(row.categoryName),
      parentCategoryId: asText(row.parentCategoryId),
      parentCategoryName: asText(row.parentCategoryName),
      baseAmount: asMoney(row.baseAmount),
      normalAmount: asMoney(row.normalAmount),
      extraAmount: asMoney(row.extraAmount),
      date: String(row.date),
    }));
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
              p.baseAmount, p.normalAmount, p.extraAmount, e.date
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
      normalAmount: asMoney(row.normalAmount),
      extraAmount: asMoney(row.extraAmount),
      date: String(row.date),
    }));
  }

  /** 그 달에 적용되는 예산 규칙과 조정값. 적용 여부 판단은 부르는 쪽이 한다. */
  async budgets(projectId: string, year: number, month: number): Promise<StoredBudget[]> {
    const rows = await this.db.all<Row>(
      `SELECT b.id, b.categoryId, b.type, b.monthlyAmount, b.effectiveFrom, b.effectiveTo,
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
      type: asText(row.type),
      monthlyAmount: asMoney(row.monthlyAmount),
      effectiveFrom: asText(row.effectiveFrom),
      effectiveTo: asText(row.effectiveTo),
      overrideAmount: asText(row.overrideAmount),
      overrideId: asText(row.overrideId),
    }));
  }

  /**
   * 화면이 그대로 쓰는 행들.
   *
   * 서버 응답과 같은 모양을 만들어 준다. 도메인 모양으로 새로 그리면 화면 전체를
   * 함께 고쳐야 하고, 오프라인과 온라인이 서로 다른 모양을 보게 된다.
   */
  async personRows(projectId: string): Promise<PersonDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM person WHERE projectId = ? ORDER BY sortOrder, createdAt`,
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
      sortOrder: asInt(row.sortOrder),
    }) as PersonDto.Response);
  }

  async accountRows(projectId: string): Promise<AccountDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.*, p.id AS ownerRowId, p.name AS ownerName, p.relationship AS ownerRelationship,
              p.isActive AS ownerIsActive, p.createdAt AS ownerCreatedAt, p.updatedAt AS ownerUpdatedAt
         FROM account a
         LEFT JOIN person p ON p.id = a.ownerId
        WHERE a.projectId = ?
        ORDER BY a.sortOrder, a.createdAt`,
      [projectId],
    );

    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      type: String(row.type),
      ownerId: asText(row.ownerId),
      name: String(row.name),
      institutionId: asText(row.institutionId),
      accountNumber: asText(row.accountNumber),
      balance: asMoney(row.balance),
      currency: String(row.currency),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortOrder: asInt(row.sortOrder),
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
      `SELECT * FROM category WHERE projectId = ? ORDER BY sortOrder, createdAt`,
      [projectId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      projectId,
      name: String(row.name),
      parentId: asText(row.parentId),
      type: String(row.type),
      icon: asText(row.icon),
      defaultIsExtra: Boolean(row.defaultIsExtra),
      isDefault: Boolean(row.isDefault),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortOrder: asInt(row.sortOrder),
    }) as unknown as CategoryDto.Response);
  }

  /**
   * 카드 행. "사용액"은 부채 계정 잔액의 부호를 뒤집은 값이다(서버와 같은 규칙).
   * 체크카드는 빚이 생기지 않으므로 null 이다.
   */
  async cardRows(projectId: string): Promise<CardDto.Response[]> {
    const rows = await this.db.all<Row>(
      `SELECT c.*, liability.balance AS liabilityBalance
         FROM card c
         LEFT JOIN account liability ON liability.id = c.liabilityAccountId
        WHERE c.projectId = ?
        ORDER BY c.sortOrder, c.createdAt`,
      [projectId],
    );

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
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      sortOrder: asInt(row.sortOrder),
      currentUsage:
        row.liabilityBalance == null
          ? null
          : Dec.of(asMoney(row.liabilityBalance)).negated().toString(),
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
    const entries = await this.db.all<Row>(
      `SELECT e.*, p.name AS personName
         FROM entry e
         LEFT JOIN person p ON p.id = e.personId
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}
        ORDER BY e.date DESC, e.id DESC`,
      [projectId, ...period.params, ...owner.params, ...search.params],
    );
    if (entries.length === 0) return [];

    return this.attachPostings(entries);
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
    return this.attachPostings(entries);
  }

  /** 전표 목록에 그 다리를 붙인다. */
  private async attachPostings(entries: Row[]): Promise<ViewEntry[]> {
    if (entries.length === 0) return [];

    const ids = entries.map((entry) => String(entry.id));
    const placeholders = ids.map(() => '?').join(', ');
    const postings = await this.db.all<Row>(
      `SELECT po.*,
              a.id AS accountRowId, a.name AS accountName, a.type AS accountType,
              c.id AS categoryRowId, c.name AS categoryName, c.type AS categoryType,
              c.parentId AS categoryParentId, parent.name AS categoryParentName,
              cd.id AS cardRowId, cd.name AS cardName,
              ip.totalMonths AS installmentMonths
         FROM posting po
         LEFT JOIN account a ON a.id = po.accountId
         LEFT JOIN category c ON c.id = po.categoryId
         LEFT JOIN category parent ON parent.id = c.parentId
         LEFT JOIN card cd ON cd.id = po.cardId
         LEFT JOIN installment_plan ip ON ip.postingId = po.id
        WHERE po.entryId IN (${placeholders})`,
      ids,
    );

    const byEntry = new Map<string, ViewPosting[]>();
    for (const row of postings) {
      const list = byEntry.get(String(row.entryId)) ?? [];
      list.push({
        id: String(row.id),
        accountId: asText(row.accountId),
        categoryId: asText(row.categoryId),
        amount: asMoney(row.amount),
        currency: String(row.currency),
        exchangeRate: asMoney(row.exchangeRate),
        baseAmount: asMoney(row.baseAmount),
        extraAmount: asMoney(row.extraAmount),
        cardId: asText(row.cardId),
        account: row.accountRowId
          ? {
              id: String(row.accountRowId),
              name: String(row.accountName),
              type: String(row.accountType) as ViewPosting['account'] extends null
                ? never
                : NonNullable<ViewPosting['account']>['type'],
            }
          : null,
        category: row.categoryRowId
          ? {
              id: String(row.categoryRowId),
              name: String(row.categoryName),
              type: String(row.categoryType) as NonNullable<ViewPosting['category']>['type'],
              parentId: asText(row.categoryParentId),
              parent: row.categoryParentId
                ? { id: String(row.categoryParentId), name: String(row.categoryParentName) }
                : null,
            }
          : null,
        card: row.cardRowId ? { id: String(row.cardRowId), name: String(row.cardName) } : null,
        // 할부가 걸리지 않은 다리는 조인이 비어 null 이 된다.
        installmentPlan:
          row.installmentMonths == null
            ? null
            : { totalMonths: asInt(row.installmentMonths) },
      });
      byEntry.set(String(row.entryId), list);
    }

    return entries.map((entry) => ({
      id: String(entry.id),
      date: String(entry.date),
      description: String(entry.description),
      merchant: asText(entry.merchant),
      detailedNote: asText(entry.detailedNote),
      personId: String(entry.personId),
      person: entry.personName ? { name: String(entry.personName) } : null,
      originalCurrency: asText(entry.originalCurrency),
      originalAmount: asText(entry.originalAmount),
      rateProvisional: Boolean(entry.rateProvisional),
      postings: byEntry.get(String(entry.id)) ?? [],
    }));
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
    const cursor = options.cursor;
    // 튜플 비교. (date, id) < (커서의 date, 커서의 id)
    const keyset = cursor ? ` AND (e.date < ? OR (e.date = ? AND e.id < ?))` : '';
    const keysetParams = cursor ? [cursor.date, cursor.date, cursor.id] : [];

    const rows = await this.db.all<Row>(
      `SELECT e.id FROM entry e
        WHERE e.projectId = ?${period.sql}${owner.sql}${search.sql}${keyset}
        ORDER BY e.date DESC, e.id DESC
        LIMIT ?`,
      [
        projectId,
        ...period.params,
        ...owner.params,
        ...search.params,
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

  /** 통화쌍의 최신 환율. 서버의 getRate 와 같은 규칙(날짜 내림차순 첫 줄)이다. */
  async latestRate(
    projectId: string,
    baseCurrency: string,
    quoteCurrency: string,
  ): Promise<string | null> {
    const rows = await this.db.all<Row>(
      `SELECT rate FROM exchange_rate
        WHERE projectId = ? AND baseCurrency = ? AND quoteCurrency = ?
        ORDER BY date DESC LIMIT 1`,
      [projectId, baseCurrency, quoteCurrency],
    );
    return asText(rows[0]?.rate);
  }

  // ───────────────────────────────────────────
  // 로컬 커밋
  // ───────────────────────────────────────────

  /**
   * 조립한 전표를 사본에 적는다. 화면은 이 값을 곧바로 본다.
   *
   * 서버의 `replaceEntry` 와 같은 방식이다 -- 다리를 통째로 갈아 끼운다. 다리 수가 바뀌는
   * 수정(수수료 추가, 분할 변경)까지 한 경로로 처리되고, 만들 때와 고칠 때의 코드가
   * 갈리지 않는다.
   *
   * 잔액(account.balance)은 건드리지 않는다. 파생값이라 동기화하지 않기로 했고(D7),
   * 기기가 여기서 증분을 더하면 서버 값이 도착할 때 드리프트가 남는다. 화면이 "아직
   * 보내지 못한 명령의 증분"을 따로 얹는 것이 그 자리다.
   */
  async writeEntry(
    entryId: string,
    built: BuiltEntry,
    options: { timeZone: string; hlc: string; makeId: () => string },
  ): Promise<void> {
    const instant = built.date instanceof Date ? built.date : new Date(built.date);

    await this.db.transaction(async () => {
      await this.upsert('entry', {
        id: entryId,
        projectId: built.projectId,
        personId: built.personId,
        date: instant.toISOString(),
        dateKey: zonedDateKey(instant, options.timeZone),
        yearMonth: zonedYearMonth(instant, options.timeZone),
        description: built.description,
        merchant: built.merchant ?? null,
        detailedNote: built.detailedNote ?? null,
        originalCurrency: built.originalCurrency ?? null,
        originalAmount: built.originalAmount ? built.originalAmount.toString() : null,
        rateProvisional: asFlag(built.rateProvisional),
        createdByUserId: null,
        // 이 편집의 시계. 다음에 이 전표를 고칠 때 이 값보다 뒤를 발급한다.
        updatedHlc: options.hlc,
        /*
         * 번호는 0 이다. 서버가 아직 이 전표를 모르기 때문이다.
         *
         * 다음 pull 이 서버가 찍은 번호로 이 줄을 덮어쓴다. 0 을 넣어 두면 그때까지
         * "아직 서버에 없다"가 값으로 남는다.
         */
        updatedVersion: 0,
      });

      await this.db.run(
        `DELETE FROM installment_plan
          WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)`,
        [entryId],
      );
      await this.db.run(`DELETE FROM posting WHERE entryId = ?`, [entryId]);

      for (const posting of built.postings) {
        const postingId = options.makeId();
        await this.upsert('posting', {
          id: postingId,
          entryId,
          accountId: posting.accountId ?? null,
          categoryId: posting.categoryId ?? null,
          amount: posting.amount.toString(),
          quantity: posting.quantity ? posting.quantity.toString() : null,
          currency: posting.currency,
          baseAmount: posting.baseAmount.toString(),
          exchangeRate: posting.exchangeRate.toString(),
          extraAmount: (posting.extraAmount ?? Dec.of(0)).toString(),
          normalAmount: posting.baseAmount
            .abs()
            .minus(posting.extraAmount ?? Dec.of(0))
            .toString(),
          cardId: posting.cardId ?? null,
        });

        /*
         * 할부는 카드 다리에 붙는다. 서버의 `saveInstallmentPlan` 과 같은 조건이다.
         *
         * 회차 금액은 담지 않는다. 총액과 개월수에서 다시 계산되는 파생값이다 (D7).
         */
        if (
          built.installmentMonths &&
          built.installmentMonths >= 2 &&
          posting.cardId &&
          posting.amount.isNegative()
        ) {
          await this.upsert('installment_plan', {
            id: options.makeId(),
            postingId,
            totalMonths: built.installmentMonths,
            feeAmount: null,
            updatedVersion: 0,
          });
        }
      }
    });
  }

  /** 사본이 아는 그 전표의 시계. 수정 명령의 시계를 이 뒤로 놓는 데 쓴다. */
  async entryHlc(entryId: string): Promise<string | null> {
    const rows = await this.db.all<Row>(`SELECT updatedHlc FROM entry WHERE id = ?`, [entryId]);
    return asText(rows[0]?.updatedHlc);
  }

  /** 전표를 사본에서 지운다. 딸린 다리와 할부 계획도 함께 간다. */
  async removeEntry(entryId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `DELETE FROM installment_plan
          WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)`,
        [entryId],
      );
      await this.db.run(`DELETE FROM posting WHERE entryId = ?`, [entryId]);
      await this.db.run(`DELETE FROM entry WHERE id = ?`, [entryId]);
    });
  }

  // ───────────────────────────────────────────
  // 조립이 읽는 것
  // ───────────────────────────────────────────

  /** 계좌 하나. 다른 프로젝트의 것은 없는 것으로 본다(서버와 같은 규칙이다). */
  async accountById(
    projectId: string,
    accountId: string,
  ): Promise<{ id: string; type: string; currency: string } | null> {
    const rows = await this.db.all<Row>(
      `SELECT id, type, currency FROM account WHERE id = ? AND projectId = ?`,
      [accountId, projectId],
    );
    const row = rows[0];
    return row ? { id: String(row.id), type: String(row.type), currency: String(row.currency) } : null;
  }

  async cardById(
    projectId: string,
    cardId: string,
  ): Promise<{
    id: string;
    cardType: string;
    paymentAccountId: string;
    liabilityAccountId: string | null;
  } | null> {
    const rows = await this.db.all<Row>(
      `SELECT id, cardType, paymentAccountId, liabilityAccountId
         FROM card WHERE id = ? AND projectId = ?`,
      [cardId, projectId],
    );
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          cardType: String(row.cardType),
          paymentAccountId: String(row.paymentAccountId),
          liabilityAccountId: asText(row.liabilityAccountId),
        }
      : null;
  }

  /** 이 계좌를 부채 계정으로 쓰는 카드의 id. */
  async cardIdForLiability(projectId: string, accountId: string): Promise<string | null> {
    const rows = await this.db.all<Row>(
      `SELECT id FROM card WHERE liabilityAccountId = ? AND projectId = ?`,
      [accountId, projectId],
    );
    return asText(rows[0]?.id);
  }

  async categoriesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string; type: string; defaultIsExtra: boolean }>> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.db.all<Row>(
      `SELECT id, name, type, defaultIsExtra
         FROM category WHERE projectId = ? AND id IN (${placeholders})`,
      [projectId, ...ids],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      type: String(row.type),
      defaultIsExtra: Boolean(row.defaultIsExtra),
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
    return this.db.transaction(async () => {
      const rows = await this.db.all<Row>(
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

      await this.db.run(
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

      await this.db.run(
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
    });
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
   * 서버가 돌려준 결과를 반영한다.
   *
   * 끝난 것(적용·중복)은 큐에서 뺀다. 그 밖은 남겨 두고 상태만 적는다 -- 충돌은 사용자가
   * 보고 고를 것이고, 거절과 보류는 왜 못 갔는지 알려야 한다. 조용히 지우면 사용자가
   * 적은 것이 아무 말 없이 사라진다.
   */
  async settleMutations(results: readonly MutationResult[]): Promise<void> {
    await this.db.transaction(async () => {
      for (const result of results) {
        if (isSettled(result.status)) {
          await this.db.run(`DELETE FROM outbox WHERE mutationId = ?`, [result.mutationId]);
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
        await this.db.run(`UPDATE outbox SET status = ?, error = ? WHERE mutationId = ?`, [
          result.status,
          result.error ?? null,
          result.mutationId,
        ]);
      }
    });
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
    return rows.map((row) => ({
      ...toMutation(row, clientId),
      status: String(row.status) as HeldMutation['status'],
      error: asText(row.error),
      createdAt: String(row.createdAt),
    }));
  }

  /** 큐에서 뺀다. 사용자가 "그만두겠다"를 고른 자리다. */
  async discardMutation(mutationId: string): Promise<void> {
    await this.db.run(`DELETE FROM outbox WHERE mutationId = ?`, [mutationId]);
  }

  /**
   * 막혔던 명령을 다시 줄에 세운다.
   *
   * 앞 명령을 버리고 나면 뒤 명령은 다시 보내 볼 만하다. 상태만 되돌리고 번호는 그대로
   * 두는데, 번호를 새로 매기면 서버가 보기에 다른 명령이 되어 멱등이 깨진다.
   */
  async retryMutation(mutationId: string): Promise<void> {
    await this.db.run(
      `UPDATE outbox SET status = 'pending', error = NULL WHERE mutationId = ?`,
      [mutationId],
    );
  }

  /** 아직 보내지 못한 명령 수. 화면이 "N건 대기" 를 보여 줄 때 쓴다. */
  async outboxCount(projectId: string): Promise<{ pending: number; held: number }> {
    const rows = await this.db.all<Row>(
      `SELECT status, COUNT(*) AS n FROM outbox WHERE projectId = ? GROUP BY status`,
      [projectId],
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
        ORDER BY c.sortOrder, c.createdAt`,
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
      `SELECT c.id, c.projectId, c.cardType, c.statementClosingDay, c.paymentDueDay,
              c.performanceAmount, c.liabilityAccountId,
              pay.currency AS paymentCurrency,
              liability.currency AS liabilityCurrency, liability.balance AS liabilityBalance
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
      cardType: String(row.cardType),
      statementClosingDay:
        row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
      paymentDueDay: row.paymentDueDay == null ? null : asInt(row.paymentDueDay),
      performanceAmount: asText(row.performanceAmount),
      liabilityAccountId: asText(row.liabilityAccountId),
      paymentCurrency: asText(row.paymentCurrency) ?? 'KRW',
      liabilityCurrency: asText(row.liabilityCurrency),
      liabilityBalance: asText(row.liabilityBalance),
    };
  }

  /**
   * 신용카드로 쓴 다리. 부채 계정에 걸린 것만 본다.
   *
   * 카테고리 다리가 하나도 없는 전표는 뺀다. 대금 결제와 잔액 조정이 그런 전표인데,
   * 그것은 사용이 아니라 갚은 것이라 주기 사용액에 들면 안 된다 (서버의 같은 조건).
   *
   * 구간을 자르지 않는다. 서버는 질의 비용 때문에 최장 할부만큼 앞에서 자르지만, 사본은
   * 기기 안에 있고 집계 함수가 표시 범위 밖의 주기를 어차피 버린다.
   */
  async creditCardPostings(liabilityAccountId: string): Promise<StoredCardPosting[]> {
    const rows = await this.db.all<Row>(
      `SELECT p.amount, e.date, ip.totalMonths
         FROM posting p
         JOIN entry e ON e.id = p.entryId
         LEFT JOIN installment_plan ip ON ip.postingId = p.id
        WHERE p.accountId = ?
          AND EXISTS (SELECT 1 FROM posting c WHERE c.entryId = e.id AND c.categoryId IS NOT NULL)`,
      [liabilityAccountId],
    );
    return rows.map(toCardPosting);
  }

  /**
   * 체크카드로 쓴 다리.
   *
   * 연결 통장의 다리에 cardId 가 함께 찍힌다. 통장에서 직접 나간 지출에는 cardId 가
   * 없으므로 이 조건만으로 이 카드로 쓴 것만 걸린다.
   */
  async debitCardPostings(cardId: string): Promise<StoredCardPosting[]> {
    const rows = await this.db.all<Row>(
      `SELECT p.amount, e.date, NULL AS totalMonths
         FROM posting p
         JOIN entry e ON e.id = p.entryId
        WHERE p.cardId = ?`,
      [cardId],
    );
    return rows.map(toCardPosting);
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

  /**
   * 한 행을 넣거나 갈아 끼운다.
   *
   * 서버가 준 행이 언제나 이긴다. 사본은 서버 상태의 그림자이므로 병합할 것이 없다
   * (병합은 2단계에서 보내지 못한 명령이 생길 때 이야기가 된다).
   */
  private async upsert(table: string, values: Record<string, SqlValue>): Promise<void> {
    const columns = Object.keys(values);
    const placeholders = columns.map(() => '?').join(', ');
    const updates = columns
      .filter((column) => column !== 'id')
      .map((column) => `${column} = excluded.${column}`)
      .join(', ');

    await this.db.run(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates}`,
      columns.map((column) => values[column]),
    );
  }
}

/** 서버 표 이름 -> 사본의 표 이름. 여기 없는 표는 사본이 담지 않는 것이다. */
const TOMBSTONE_TABLES: Record<string, string> = {
  JournalEntry: 'entry',
  Budget: 'budget',
  BudgetOverride: 'budget_override',
  ExchangeRate: 'exchange_rate',
  ProjectMember: 'member',
  Person: 'person',
  Account: 'account',
  Category: 'category',
  Card: 'card',
  AssetValuation: 'asset_valuation',
  InstallmentPlan: 'installment_plan',
};

/**
 * 프로젝트를 직접 가리키지 않는 표. 부모를 따라 지운다.
 *
 * 적힌 순서대로 치운다. **위에서 아래로**, 부모 쪽부터다. 할부 계획은 다리를 가리키는데
 * 그 다리는 전표가 지워진 뒤에야 고아가 되므로, 다리를 먼저 치워야 계획이 고아로 보인다.
 * 순서를 뒤집으면 계획이 살아남아 사본에 찌꺼기가 된다.
 */
const CHILD_TABLES: ReadonlyArray<{ table: string; column: string; parent: string }> = [
  { table: 'posting', column: 'entryId', parent: 'entry' },
  { table: 'installment_plan', column: 'postingId', parent: 'posting' },
  { table: 'budget_override', column: 'budgetId', parent: 'budget' },
  { table: 'asset_valuation', column: 'accountId', parent: 'account' },
];

/**
 * 카드 번호 마스킹. 서버가 내보내는 모양과 같아야 한다.
 *
 * 사본에는 서버가 이미 마스킹한 값이 들어오지만(응답에 실린 것이 그것이다), 값이
 * 없을 때 화면이 undefined 를 만나지 않도록 한 곳에서 빈 문자열로 맞춘다.
 */
function maskCardNumber(value: string | null): string {
  return value ?? '';
}

/**
 * 자산 주인 조건. 서버의 `assetOwnerCondition` 과 같은 규칙이다.
 *
 *   - 돈이 나간 다리(음수)의 계좌 주인을 본다. 이체는 보내는 계좌가 기준이다.
 *   - 나간 다리가 없으면(수입, 잔액 증가 조정) 들어온 다리를 본다.
 *   - 자본 계정은 주인이 없어 "나간 다리" 판단에서 제외된다(ownerId IS NOT NULL).
 *
 * 부호는 문자열의 첫 글자로 본다. 금액은 표준 십진 표기로 담기므로 음수는 언제나
 * '-' 로 시작한다. TEXT 를 숫자로 바꿔 비교하면 정밀도를 잃는 자리가 생긴다.
 */
/**
 * 목록 질의가 보는 범위. 사람 필터와 거래 화면의 검색이 함께 걸린다.
 *
 * `search` 는 `@money/types` 의 `parseEntrySearch` 가 읽어 준 것을 그대로 받는다.
 * 무엇을 고른 것으로 볼지는 서버와 한 벌이어야 하고, 그것을 **문장으로 옮기는 일**만
 * 저장소마다 다르다.
 */
export interface MirrorEntryScope {
  fromDateKey: string;
  toDateKey: string;
  /**
   * 한 달만 볼 때 ("YYYY-MM"). 주면 위 달력 키 범위 대신 이것을 쓴다.
   *
   * 동기화할 때 프로젝트 타임존으로 계산해 박아 둔 컬럼이라, 달의 길이도 시차도 다시
   * 따질 것이 없다. 부르는 쪽이 `-01 ~ -31` 같은 구간을 만들면 30일 이하인 달에서
   * 다음 달 초하루가 함께 들어온다.
   */
  yearMonth?: string;
  ownerIds?: string[];
  search?: ParsedEntrySearch;
}

/** 기간 조건. 달 이름이 있으면 그것이 앞선다. */
function periodFilter(range: MirrorEntryScope): { sql: string; params: string[] } {
  if (range.yearMonth) {
    return { sql: ' AND e.yearMonth = ?', params: [range.yearMonth] };
  }
  return {
    sql: ' AND e.dateKey >= ? AND e.dateKey <= ?',
    params: [range.fromDateKey, range.toDateKey],
  };
}

/**
 * 검색을 SQL 조건으로. 무리 안은 OR, 무리끼리는 AND.
 *
 * 무리 하나가 EXISTS 하나다. 무리를 쪼개 EXISTS 를 여럿 걸면 "식비 다리가 있고
 * 교통비 다리도 있는 전표"가 되어 분할 거래만 걸린다.
 *
 * 부호는 문자열의 첫 글자로 본다. 금액이 표준 십진 표기로 담기므로 음수는 언제나
 * '-' 로 시작한다. TEXT 를 숫자로 바꿔 비교하면 정밀도를 잃는 자리가 생긴다
 * (ownerFilter 와 같은 규칙이다).
 */
/**
 * 유형 조건. 고른 유형끼리 OR 로 잇는다. 서버의 `entryKindCondition` 과 같은 규칙이다.
 *
 * **지출·수입은 카테고리 기준, 이체·카드정산은 자금 이동 기준이다.**
 *
 *   지출     지출 카테고리 다리가 있는 전표
 *   수입     수입 카테고리 다리가 있는 전표
 *   이체     계좌 사이를 옮긴 돈 (신용카드·기초잔액이 끼지 않은)
 *   카드정산 계좌 사이를 옮긴 돈 중 신용카드 부채 계정이 끼는 것
 *   조정     기초잔액 계정이 끼는 것
 *
 * 지출을 `classifyEntry` 와 다르게 두는 이유는 **수수료가 붙은 이체**다. 그 전표는 표시
 * 유형이 이체지만 수수료는 지출 카테고리 다리이고, 지출 합계는 카테고리 기준이라 그
 * 수수료를 이미 센다. 표시 유형으로 지출을 고르면 그 전표가 빠져 합계가 갈린다.
 *
 * "계좌 다리가 둘 이상"은 **부호가 다른 계좌 다리가 둘 다 있는가**로 본다. 전표는
 * 균형을 이루므로 계좌 사이를 옮긴 돈은 한쪽이 음수, 다른 쪽이 양수다. 부호는 문자열의
 * 첫 글자로 읽는다 (ownerFilter 와 같은 규칙).
 */
function kindFilter(kinds?: readonly string[]): string {
  if (!kinds || kinds.length === 0) return '';

  const leg = (extra: string) =>
    `EXISTS (SELECT 1 FROM posting kp WHERE kp.entryId = e.id AND ${extra})`;
  const negative = leg(`kp.accountId IS NOT NULL AND substr(kp.amount, 1, 1) = '-'`);
  const positive = leg(
    `kp.accountId IS NOT NULL AND substr(kp.amount, 1, 1) != '-' AND kp.amount != '0'`,
  );
  const moves = `(${negative} AND ${positive})`;
  const accountType = (type: string) =>
    `EXISTS (
       SELECT 1 FROM posting kp JOIN account ka ON ka.id = kp.accountId
        WHERE kp.entryId = e.id AND ka.type = '${type}'
     )`;
  const categoryType = (type: string) =>
    `EXISTS (
       SELECT 1 FROM posting kp JOIN category kc ON kc.id = kp.categoryId
        WHERE kp.entryId = e.id AND kc.type = '${type}'
     )`;

  const of = (kind: string): string => {
    switch (kind) {
      case 'card_payment':
        return `(${moves} AND ${accountType('credit_card')})`;
      case 'adjustment':
        return `(${moves} AND NOT ${accountType('credit_card')} AND ${accountType('opening_balance')})`;
      case 'transfer':
        return `(${moves} AND NOT ${accountType('credit_card')} AND NOT ${accountType('opening_balance')})`;
      case 'income':
        return categoryType('income');
      default:
        return categoryType('expense');
    }
  };

  return `
        AND (${kinds.map(of).join(' OR ')})`;
}

function searchFilter(search?: ParsedEntrySearch): { sql: string; params: string[] } {
  if (!search) return { sql: '', params: [] };

  let sql = '';
  const params: string[] = [];

  const categoryIds = search.categoryIds ?? [];
  if (categoryIds.length > 0) {
    const list = categoryIds.map(() => '?').join(', ');
    // 대분류를 고르면 소분류까지. 서버의 entrySearchConditions 와 같은 규칙이다.
    sql += `
        AND EXISTS (
          SELECT 1 FROM posting sp LEFT JOIN category sc ON sc.id = sp.categoryId
           WHERE sp.entryId = e.id
             AND (sp.categoryId IN (${list}) OR sc.parentId IN (${list}))
        )`;
    params.push(...categoryIds, ...categoryIds);
  }

  const accountIds = search.paymentAccountIds ?? [];
  const cardIds = search.paymentCardIds ?? [];
  if (accountIds.length > 0 || cardIds.length > 0) {
    const negative = `substr(mp.amount, 1, 1) = '-'`;
    const branches: string[] = [];

    if (accountIds.length > 0) {
      /*
       * 결제수단 관점이다. 이 통장에서 실제로 돈이 나간 전표만 본다.
       *
       * 체크카드 결제는 연결 통장 다리에도 걸리므로 카드가 붙은 다리를 빼고, 이체로
       * 돈이 들어온 쪽(+)도 뺀다. 수단별 목록에 적힌 금액과 그것을 눌러 나온 거래의
       * 합이 어긋나지 않아야 한다.
       */
      branches.push(
        `(mp.accountId IN (${accountIds.map(() => '?').join(', ')}) AND mp.cardId IS NULL AND ${negative})`,
      );
      params.push(...accountIds);
    }
    if (cardIds.length > 0) {
      branches.push(
        `(mp.cardId IN (${cardIds.map(() => '?').join(', ')}) AND ${negative})`,
      );
      params.push(...cardIds);
    }

    sql += `
        AND EXISTS (
          SELECT 1 FROM posting mp
           WHERE mp.entryId = e.id AND (${branches.join(' OR ')})
        )`;
  }

  // 유형. 값이 상수뿐이라 자리표를 쓰지 않는다 (`parseEntrySearch` 가 아는 값만 남긴다).
  sql += kindFilter(search.kinds);

  return { sql, params };
}

function ownerFilter(ownerIds?: string[]): { sql: string; params: string[] } {
  if (!ownerIds || ownerIds.length === 0) return { sql: '', params: [] };

  const list = ownerIds.map(() => '?').join(', ');
  const negative = `substr(op.amount, 1, 1) = '-'`;
  const positive = `substr(op.amount, 1, 1) != '-' AND op.amount != '0'`;

  const sql = `
        AND (
          EXISTS (
            SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
             WHERE op.entryId = e.id AND ${negative} AND oa.ownerId IN (${list})
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
               WHERE op.entryId = e.id AND ${negative} AND oa.ownerId IS NOT NULL
            )
            AND EXISTS (
              SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
               WHERE op.entryId = e.id AND ${positive} AND oa.ownerId IN (${list})
            )
          )
        )`;

  return { sql, params: [...ownerIds, ...ownerIds] };
}
