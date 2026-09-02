/*
 * 기기의 SQL 저장소.
 *
 * core 의 `SqlDriver` 를 expo-sqlite 로 구현한다. 스키마와 질의는 core 가 갖고
 * 여기서는 창구 셋만 잇는다. 그래서 노드의 `node:sqlite` 로 검증한 SQL 이 기기에서도
 * 같은 뜻으로 돈다 (packages/core/scripts/local-store-smoke.ts).
 */
import * as SQLite from 'expo-sqlite';

import { LocalStore } from '@money/core/data/local-store';
import type { SqlDriver, SqlValue } from '@money/core/data/sql-driver';

/**
 * 사본 파일 이름.
 *
 * 사용자가 바뀌면 이 파일을 지운다. 남의 가계부 사본이 기기에 남아 있으면 안 된다
 * (설계 문서의 D10). 지우는 자리는 `core/data/mirror-teardown` 이 잡아 준다.
 *
 * **이 파일은 평문이다.** 그래서 app.json 에 `android.allowBackup: false` 를 두어
 * 구글 드라이브 자동 백업에서 기기 전체를 뺐다 (app.json 은 주석을 달 수 없어 이유를
 * 여기 적는다). 잃는 것이 없다. 이 사본은 서버에서 다시 받을 수 있는 캐시이고,
 * 토큰은 SecureStore 에 있어 원래부터 백업 대상이 아니다. 남는 위험은 기기를 풀어
 * 파일을 직접 꺼내는 경우인데, 그것은 로컬 암호화로 다뤄야 할 다른 문제다.
 */
const DATABASE_NAME = 'money-local.db';

let opened: SQLite.SQLiteDatabase | null = null;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opened) {
    opened = await SQLite.openDatabaseAsync(DATABASE_NAME);
    /*
     * WAL 로 둔다. 읽기와 쓰기가 서로를 막지 않아, 동기화가 도는 동안에도 화면이
     * 목록을 읽을 수 있다.
     */
    await opened.execAsync('PRAGMA journal_mode = WAL');
  }
  return opened;
}

export function createSqlDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  let depth = 0;

  return {
    async run(sql: string, params: readonly SqlValue[] = []) {
      await db.runAsync(sql, params as SqlValue[]);
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.getAllAsync<T>(sql, params as SqlValue[]);
    },

    /**
     * SQLite 는 트랜잭션을 겹쳐 열지 못한다. 이미 열려 있으면 그 안에서 그대로 돈다
     * (검증용 드라이버와 같은 규칙이다).
     */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();

      depth += 1;
      try {
        let result: T;
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
        return result!;
      } finally {
        depth -= 1;
      }
    },
  };
}

/**
 * 이 기기의 사본. 시작할 때 한 번 만들어 두고 계속 쓴다.
 *
 * 표를 여기서 만들어 둔다. 프로젝트를 고르기 전에 쓰는 표가 있어서다 -- 아웃박스와
 * 기기 이름은 프로젝트에 매이지 않는다. 프로젝트별 준비는 동기화가 `init` 으로 한다.
 */
export async function openLocalStore(): Promise<LocalStore> {
  const store = new LocalStore(createSqlDriver(await database()));
  await store.ensureSchema();
  return store;
}

/**
 * 사본을 파일째로 지운다.
 *
 * 로그아웃하거나 다른 사용자가 로그인할 때 부른다. 표를 비우는 것으로는 모자라다.
 * 파일이 남으면 그 안에 지난 사용자의 거래 내역이 그대로 있다.
 */
export async function deleteLocalStore(): Promise<void> {
  if (opened) {
    await opened.closeAsync();
    opened = null;
  }
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
}
