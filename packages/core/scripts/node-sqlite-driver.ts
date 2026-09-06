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
import { createTxLock } from '../src/data/tx-lock';

export function nodeSqliteDriver(path = ':memory:'): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  const lock = createTxLock();

  return {
    async run(sql: string, params: readonly SqlValue[] = []) {
      db.prepare(sql).run(...(params as SqlValue[]));
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    },

    /**
     * 한 줄로 세운다. 앱의 드라이버와 같은 규칙이다 (`data/tx-lock`).
     *
     * 겹쳐 열지 않고 앞엣것이 끝나기를 기다린다. 안에서 그냥 돌게 두면 앞 트랜잭션이
     * 되돌아갈 때 뒤가 적은 것까지 사라진다.
     */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return lock(async () => {
        db.exec('BEGIN');
        try {
          const result = await fn();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },

    close() {
      db.close();
    },
  };
}
