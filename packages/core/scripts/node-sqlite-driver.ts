/**
 * 검증용 SqlDriver. 노드에 들어 있는 `node:sqlite` 를 쓴다.
 *
 * 기기에서 도는 SQL 을 노드에서 그대로 돌려 보기 위한 것이다. 앱의 드라이버
 * (expo-sqlite)와 이 드라이버가 같은 스키마와 같은 질의를 받으므로, 여기서 통과한
 * SQL 은 기기에서도 같은 뜻이 된다.
 *
 * 실제 앱에 들어가지 않는 코드라 core/src 가 아니라 scripts 에 둔다.
 */
import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver, SqlValue } from '../src/data/sql-driver';

export function nodeSqliteDriver(path = ':memory:'): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  let depth = 0;

  return {
    async run(sql: string, params: readonly SqlValue[] = []) {
      db.prepare(sql).run(...(params as SqlValue[]));
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },

    /**
     * 겹쳐 부를 수 있게 해 둔다. 사본을 버리는 경로가 트랜잭션 안에서 또 다른
     * 트랜잭션을 열 수 있고, SQLite 는 트랜잭션을 겹쳐 열지 못한다.
     */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();

      depth += 1;
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },

    close() {
      db.close();
    },
  };
}
