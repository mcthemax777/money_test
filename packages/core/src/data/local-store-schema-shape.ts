/**
 * 사본 표의 짜임. 스키마 문장에서 읽은 기대 모양, 자리표가 가리키는 표, 부모를 따라 지울 표다.
 */

import { ALL_TABLES, SCHEMA_STATEMENTS } from './schema';

/** 서버 표 이름 -> 사본의 표 이름. 여기 없는 표는 사본이 담지 않는 것이다. */
export const TOMBSTONE_TABLES: Record<string, string> = {
  JournalEntry: 'entry',
  Budget: 'budget',
  BudgetOverride: 'budget_override',
  ExchangeRate: 'exchange_rate',
  ProjectMember: 'member',
  Person: 'person',
  Account: 'account',
  Category: 'category',
  Tag: 'tag',
  Card: 'card',
  AssetValuation: 'asset_valuation',
  InstallmentPlan: 'installment_plan',
  EntryDraft: 'entry_draft',
  RecurringRule: 'recurring_rule',
};

/**
 * 스키마 문장이 적어 둔 표와 컬럼.
 *
 * 기대 목록을 손으로 또 적지 않는다. 두 벌이 되면 한쪽만 고쳐 놓고 "모양이 맞다"고
 * 믿는 일이 생긴다. 문장에서 그대로 읽는다.
 */
const isIndexStatement = (statement: string) => /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement);
export const TABLE_STATEMENTS = SCHEMA_STATEMENTS.filter((statement) => !isIndexStatement(statement));
export const INDEX_STATEMENTS = SCHEMA_STATEMENTS.filter(isIndexStatement);

export function expectedColumns(): Array<[string, string[]]> {
  const tables: Array<[string, string[]]> = [];

  for (const raw of SCHEMA_STATEMENTS) {
    /*
     * 주석을 먼저 걷어낸다. 문장 안의 `/* ... *\/` 를 그대로 두면 그것이 컬럼 이름으로
     * 읽히고, 그 뒤의 진짜 컬럼은 사라진다 -- 그러면 모양이 늘 어긋난 것으로 보인다.
     */
    const statement = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    const head = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/i.exec(statement);
    if (!head) continue;

    const body = statement.slice(head.index + head[0].length, statement.lastIndexOf(')'));
    const columns: string[] = [];
    let depth = 0;
    let current = '';

    const take = (segment: string) => {
      const name = segment.trim().split(/\s+/)[0];
      // 표 전체에 걸리는 제약(PRIMARY KEY (a, b) 등)은 컬럼이 아니다.
      if (name && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(name)) columns.push(name);
    };

    for (const char of body) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        take(current);
        current = '';
        continue;
      }
      current += char;
    }
    take(current);

    tables.push([head[1], columns]);
  }

  return tables;
}

/**
 * 사본이 담는 표 전부. 스키마 판이 바뀌면 이것을 부수고 다시 세운다.
 *
 * 아웃박스(`outbox`)와 기기 이름(`client_state`)은 여기 없다. 그 둘은 서버에서 다시 받을
 * 수 있는 값이 아니라 아직 보내지 못한 사용자의 입력이다.
 */
export const MIRROR_TABLES: readonly string[] = ALL_TABLES;

/**
 * 프로젝트를 직접 가리키지 않는 표. 부모를 따라 지운다.
 *
 * 적힌 순서대로 치운다. **위에서 아래로**, 부모 쪽부터다. 할부 계획은 다리를 가리키는데
 * 그 다리는 전표가 지워진 뒤에야 고아가 되므로, 다리를 먼저 치워야 계획이 고아로 보인다.
 * 순서를 뒤집으면 계획이 살아남아 사본에 찌꺼기가 된다.
 */
export const CHILD_TABLES: ReadonlyArray<{ table: string; column: string; parent: string }> = [
  // 태그 연결은 전표에 딸린다. 이 표에는 projectId 가 없어 부모를 따라 치운다.
  { table: 'entry_tag', column: 'entryId', parent: 'entry' },
  // 후보의 태그도 같은 짜임이다. 빠뜨리면 사본을 버리는 길이 통째로 막힌다.
  { table: 'entry_draft_tag', column: 'draftId', parent: 'entry_draft' },
  { table: 'posting', column: 'entryId', parent: 'entry' },
  { table: 'installment_plan', column: 'postingId', parent: 'posting' },
  { table: 'budget_override', column: 'budgetId', parent: 'budget' },
  { table: 'asset_valuation', column: 'accountId', parent: 'account' },
];
