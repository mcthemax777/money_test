/**
 * 기기에 두는 원장 사본의 스키마.
 *
 * 서버 표를 그대로 옮기지만 세 가지가 다르다.
 *
 * 1. **금액은 TEXT 다.** SQLite 의 REAL 은 배정밀도 부동소수라 원 단위가 어긋난다.
 *    문자열로 담고 계산은 `@money/types` 의 Dec 가 한다.
 * 2. **달력 키를 컬럼으로 재료화한다.** 월 합계의 경계는 프로젝트 타임존의 벽시계이고
 *    그 계산은 Intl 이 한다. SQLite 는 IANA 타임존을 모르므로, 동기화할 때 미리
 *    계산해 넣어야 "8월 거래"를 SQL 로 고를 수 있다. 프로젝트 타임존이 바뀌면
 *    `recomputeCalendarKeys` 로 전부 다시 계산한다.
 * 3. **파생값은 담지 않는다.** 청구서와 할부 일정은 계산으로 얻고, 잔액은 서버가 준
 *    값을 그대로 둔다(그 계좌 행에 실려 온다).
 *
 * 외래 키 제약은 걸지 않는다. 델타는 표마다 따로 도착하고 한 쪽이 먼저 들어올 수
 * 있어서, 제약을 걸면 순서 때문에 정상적인 동기화가 거절된다. 참조가 비어 있는 동안
 * 화면이 무엇을 보여 줄지는 읽는 질의가 정한다(LEFT JOIN).
 */

/** 스키마가 바뀌면 올린다. 다르면 사본을 버리고 처음부터 다시 받는다. */
export const SCHEMA_VERSION = 3;

/**
 * 표를 만든다. 이미 있으면 아무 일도 하지 않는다.
 *
 * `updatedVersion` 은 서버가 찍어 준 번호를 그대로 담는다. 기기가 이 값을 쓰는 것은
 * 두 곳이다. 하나는 "이 행이 서버의 몇 번 상태인가"를 아는 것이고, 다른 하나는
 * 2단계에서 명령이 가정한 값을 실어 보낼 때다.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sync_state (
     projectId      TEXT PRIMARY KEY,
     version        INTEGER NOT NULL DEFAULT 0,
     schemaVersion  INTEGER NOT NULL,
     timeZone       TEXT NOT NULL,
     syncedAt       TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS project (
     id              TEXT PRIMARY KEY,
     name            TEXT NOT NULL,
     projectKey      TEXT,
     description     TEXT,
     ledgerCurrency  TEXT NOT NULL,
     displayCurrency TEXT NOT NULL,
     timezone        TEXT NOT NULL,
     updatedVersion  INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS member (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     userId         TEXT NOT NULL,
     role           TEXT NOT NULL,
     personId       TEXT,
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS person (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     name           TEXT NOT NULL,
     relationship   TEXT,
     isActive       INTEGER NOT NULL DEFAULT 1,
     sortOrder      INTEGER NOT NULL DEFAULT 0,
     createdAt      TEXT NOT NULL DEFAULT '',
     updatedAt      TEXT NOT NULL DEFAULT '',
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS account (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     ownerId        TEXT,
     type           TEXT NOT NULL,
     name           TEXT NOT NULL,
     institutionId  TEXT,
     accountNumber  TEXT,
     currency       TEXT NOT NULL,
     balance        TEXT NOT NULL DEFAULT '0',
     isActive       INTEGER NOT NULL DEFAULT 1,
     sortOrder      INTEGER NOT NULL DEFAULT 0,
     createdAt      TEXT NOT NULL DEFAULT '',
     updatedAt      TEXT NOT NULL DEFAULT '',
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS category (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     name           TEXT NOT NULL,
     parentId       TEXT,
     type           TEXT NOT NULL,
     icon           TEXT,
     defaultIsExtra INTEGER NOT NULL DEFAULT 0,
     isDefault      INTEGER NOT NULL DEFAULT 0,
     isActive       INTEGER NOT NULL DEFAULT 1,
     sortOrder      INTEGER NOT NULL DEFAULT 0,
     createdAt      TEXT NOT NULL DEFAULT '',
     updatedAt      TEXT NOT NULL DEFAULT '',
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS card (
     id                  TEXT PRIMARY KEY,
     projectId           TEXT NOT NULL,
     paymentAccountId    TEXT NOT NULL,
     liabilityAccountId  TEXT,
     name                TEXT NOT NULL,
     cardType            TEXT NOT NULL,
     issuerId            TEXT NOT NULL,
     cardNumber          TEXT,
     creditLimit         TEXT,
     performanceAmount   TEXT,
     statementClosingDay INTEGER,
     paymentDueDay       INTEGER,
     color               TEXT,
     expiryDate          TEXT,
     isActive            INTEGER NOT NULL DEFAULT 1,
     sortOrder           INTEGER NOT NULL DEFAULT 0,
     createdAt           TEXT NOT NULL DEFAULT '',
     updatedAt           TEXT NOT NULL DEFAULT '',
     updatedVersion      INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS entry (
     id              TEXT PRIMARY KEY,
     projectId       TEXT NOT NULL,
     personId        TEXT NOT NULL,
     date            TEXT NOT NULL,
     /* 프로젝트 타임존으로 미리 계산한 달력 키. SQLite 는 타임존을 모른다. */
     dateKey         TEXT NOT NULL,
     yearMonth       TEXT NOT NULL,
     description     TEXT NOT NULL,
     merchant        TEXT,
     detailedNote    TEXT,
     originalCurrency TEXT,
     originalAmount  TEXT,
     rateProvisional INTEGER NOT NULL DEFAULT 0,
     createdByUserId TEXT,
     /*
      * 이 전표를 마지막으로 고친 편집의 시계.
      *
      * 이 값을 담아 두어야 "남의 편집을 보고 고쳤다"가 순서에 남는다. 기기가 수정
      * 명령을 만들 때 이 값보다 뒤인 시계를 발급한다 (hlcReceive).
      */
     updatedHlc      TEXT,
     updatedVersion  INTEGER NOT NULL DEFAULT 0
   )`,

  /*
   * 다리는 전표와 함께 움직인다. 전표가 바뀌면 그 전표의 다리를 통째로 지우고 다시
   * 넣는다. 다리마다 번호를 붙이지 않는 것은 합계 0 이라는 불변식이 다리 하나짜리
   * 병합을 허용하지 않기 때문이다(설계 문서의 D5).
   */
  `CREATE TABLE IF NOT EXISTS posting (
     id           TEXT PRIMARY KEY,
     entryId      TEXT NOT NULL,
     accountId    TEXT,
     categoryId   TEXT,
     amount       TEXT NOT NULL,
     quantity     TEXT,
     currency     TEXT NOT NULL,
     baseAmount   TEXT NOT NULL,
     exchangeRate TEXT NOT NULL,
     extraAmount  TEXT NOT NULL DEFAULT '0',
     normalAmount TEXT NOT NULL DEFAULT '0',
     cardId       TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS budget (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     categoryId     TEXT,
     type           TEXT,
     monthlyAmount  TEXT NOT NULL,
     effectiveFrom  TEXT,
     effectiveTo    TEXT,
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS budget_override (
     id             TEXT PRIMARY KEY,
     budgetId       TEXT NOT NULL,
     year           INTEGER NOT NULL,
     month          INTEGER NOT NULL,
     amount         TEXT NOT NULL,
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS exchange_rate (
     id             TEXT PRIMARY KEY,
     projectId      TEXT NOT NULL,
     baseCurrency   TEXT NOT NULL,
     quoteCurrency  TEXT NOT NULL,
     rate           TEXT NOT NULL,
     date           TEXT NOT NULL,
     source         TEXT NOT NULL DEFAULT 'manual',
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  /*
   * 투자성 계좌의 평가 기록.
   *
   * 계좌마다 최신 한 건만 쓰이지만 전부 담는다. "최신"은 날짜로 정해지므로, 뒤늦게
   * 도착한 과거 기록이 최신을 밀어내지 않으려면 고르는 일을 읽을 때 해야 한다.
   */
  `CREATE TABLE IF NOT EXISTS asset_valuation (
     id             TEXT PRIMARY KEY,
     accountId      TEXT NOT NULL,
     date           TEXT NOT NULL,
     quantity       TEXT NOT NULL DEFAULT '0',
     price          TEXT NOT NULL DEFAULT '0',
     marketValue    TEXT NOT NULL DEFAULT '0',
     source         TEXT NOT NULL DEFAULT 'manual',
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  /*
   * 할부 개월수. 회차 금액은 담지 않는다 (총액과 개월수에서 다시 계산한다).
   *
   * 다리를 가리키므로 전표를 갈아 끼울 때 함께 지운다. 서버도 다리를 지우고 다시
   * 만들면서 계획을 cascade 로 지우고 새로 만든다.
   */
  `CREATE TABLE IF NOT EXISTS installment_plan (
     id             TEXT PRIMARY KEY,
     postingId      TEXT NOT NULL,
     totalMonths    INTEGER NOT NULL,
     feeAmount      TEXT,
     updatedVersion INTEGER NOT NULL DEFAULT 0
   )`,

  /*
   * 아웃박스. 아직 서버에 닿지 못한 명령이 여기 쌓인다.
   *
   * **이 표는 사본이 아니다.** 다른 표는 서버에서 다시 받을 수 있는 그림자라 스키마가
   * 바뀌면 버리지만, 여기 든 것은 사용자가 적었고 아직 아무 데도 없는 값이다. 그래서
   * `reset` 이 이 표를 건드리지 않는다 (버리는 것은 로그아웃뿐이다).
   *
   * 행이 아니라 명령을 담는 것이 이 표가 스키마 변경을 견디는 이유이기도 하다. 짐은
   * 화면이 만든 JSON 이라 사본의 표 모양이 바뀌어도 그대로 재생된다.
   */
  `CREATE TABLE IF NOT EXISTS outbox (
     mutationId TEXT PRIMARY KEY,
     projectId  TEXT NOT NULL,
     clientSeq  INTEGER NOT NULL,
     hlc        TEXT NOT NULL,
     kind       TEXT NOT NULL,
     /* JSON 배열. 앞 명령이 막히면 같은 대상의 뒤 명령도 미룬다. */
     targets    TEXT NOT NULL,
     payload    TEXT NOT NULL,
     /* pending | conflict | rejected | blocked */
     status     TEXT NOT NULL DEFAULT 'pending',
     error      TEXT,
     createdAt  TEXT NOT NULL
   )`,

  /*
   * 이 기기의 이름과 번호.
   *
   * clientSeq 는 한 기기 안에서 1씩 오른다. 서버가 (clientId, clientSeq) 를 유일 제약으로
   * 두므로 이 값이 되감기면 뒤 명령이 영영 적히지 않는다. 그래서 사본을 버려도 이 표는
   * 남긴다. 한 줄짜리 표이고 CHECK 로 그것을 강제한다.
   */
  `CREATE TABLE IF NOT EXISTS client_state (
     id       INTEGER PRIMARY KEY CHECK (id = 1),
     clientId TEXT NOT NULL,
     nextSeq  INTEGER NOT NULL DEFAULT 1,
     lastHlc  TEXT
   )`,

  // 목록과 월 집계가 쓰는 색인. 전표는 (프로젝트, 달) 과 (프로젝트, 날짜) 로 고른다.
  `CREATE INDEX IF NOT EXISTS entry_month_idx ON entry (projectId, yearMonth)`,
  `CREATE INDEX IF NOT EXISTS entry_date_idx ON entry (projectId, dateKey)`,
  `CREATE INDEX IF NOT EXISTS posting_entry_idx ON posting (entryId)`,
  `CREATE INDEX IF NOT EXISTS posting_category_idx ON posting (categoryId)`,
  `CREATE INDEX IF NOT EXISTS posting_account_idx ON posting (accountId)`,
  `CREATE INDEX IF NOT EXISTS account_project_idx ON account (projectId, isActive)`,
  `CREATE INDEX IF NOT EXISTS category_project_idx ON category (projectId, isActive)`,
  `CREATE INDEX IF NOT EXISTS override_budget_idx ON budget_override (budgetId, year, month)`,
  // 계좌의 최신 평가액을 고르는 길. 날짜 내림차순 한 건만 읽는다.
  `CREATE INDEX IF NOT EXISTS valuation_account_idx ON asset_valuation (accountId, date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS plan_posting_idx ON installment_plan (postingId)`,
  // 보낼 차례를 정하는 길. 한 기기의 명령은 언제나 clientSeq 순서로 나간다.
  `CREATE INDEX IF NOT EXISTS outbox_queue_idx ON outbox (projectId, status, clientSeq)`,
];

/**
 * 사본을 버릴 때 지우는 표. sync_state 도 함께 지워 커서가 남지 않게 한다.
 *
 * 아웃박스와 기기 번호는 여기 들지 않는다. 아직 보내지 못한 명령은 사본이 아니라
 * 사용자가 적은 값이고, 번호는 되감기면 안 되기 때문이다. 그 둘까지 버리는 것은
 * 로그아웃 하나뿐이고, 그때는 파일째로 지운다 (app/src/sqlite.ts).
 */
export const ALL_TABLES: readonly string[] = [
  'installment_plan',
  'asset_valuation',
  'posting',
  'entry',
  'budget_override',
  'budget',
  'exchange_rate',
  'card',
  'account',
  'category',
  'person',
  'member',
  'project',
  'sync_state',
];
