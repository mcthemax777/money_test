/*
 * 기기의 SQL 저장소.
 *
 * core 의 `SqlDriver` 를 expo-sqlite 로 구현한다. 스키마와 질의는 core 가 갖고
 * 여기서는 창구 셋만 잇는다. 그래서 노드의 `node:sqlite` 로 검증한 SQL 이 기기에서도
 * 같은 뜻으로 돈다 (packages/core/scripts/local-store-smoke.ts).
 */
import * as SQLite from 'expo-sqlite';

import { LocalStore } from '@money/core/data/local-store';
import { clearMirrorKey, mirrorKey } from './mirror-key';
import type { SqlDriver, SqlValue } from '@money/core/data/sql-driver';
import { createTxLock } from '@money/core/data/tx-lock';

/**
 * 사본 파일 이름.
 *
 * 사용자가 바뀌면 이 파일을 지운다. 남의 가계부 사본이 기기에 남아 있으면 안 된다
 * (설계 문서의 D10). 지우는 자리는 `core/data/mirror-teardown` 이 잡아 준다.
 *
 * **이 파일은 SQLCipher 로 암호화되어 있다.** 열쇠는 SecureStore 에 있다
 * (`mirror-key.ts`). 앱 전용 저장소와 안드로이드의 파일 암호화가 이미 한 겹이지만,
 * 그 둘은 기기를 풀어 파일을 꺼내는 경우를 막지 못한다. 사본에는 거래 내역이 통째로
 * 들어 있어 그 한 겹을 더 둔다.
 *
 * `app.json` 의 `android.allowBackup: false` 도 그대로 둔다. 암호화된 파일을 백업에
 * 넣어도 열쇠가 없어 쓸모가 없고, 백업에서 빼는 편이 단순하다 (app.json 은 주석을
 * 달 수 없어 이유를 여기 적는다).
 */
const DATABASE_NAME = 'money-local.db';

/**
 * 사본을 닫기 전에 돌고 있는 질의를 기다리는 시간.
 *
 * 여기 오는 질의는 화면 하나를 채우는 크기라 보통 밀리초 단위로 끝난다. 이 시간을
 * 넘긴다는 것은 네이티브가 멈췄다는 뜻이므로, 더 기다리는 대신 물러난다.
 */
const DRAIN_TIMEOUT_MS = 5000;

let opened: SQLite.SQLiteDatabase | null = null;

/**
 * 사본을 열고 열쇠를 꽂는다.
 *
 * **`PRAGMA key` 가 다른 어떤 문장보다 먼저다.** 그 앞에 무엇이든 보내면 아직 잠긴
 * 파일을 읽으려는 것이라 실패한다.
 */
async function openWithKey(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // 원본 키다. 16진수 64자가 곧 256비트라 PBKDF2 를 거치지 않는다.
  await db.execAsync(`PRAGMA key = "x'${await mirrorKey()}'"`);
  return db;
}

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opened) {
    let db = await openWithKey();

    /*
     * 열쇠가 맞는지 여기서 확인한다.
     *
     * `PRAGMA key` 는 틀려도 그 자리에서 알려 주지 않는다. 처음 읽을 때에야 "file is
     * not a database" 로 터진다. 그 순간이 화면 한복판이면 무엇이 잘못됐는지 알 수 없어,
     * 여는 김에 한 번 읽어 본다.
     *
     * 열리지 않는 경우는 둘이다 -- 암호화 전에 만들어진 평문 사본이거나(이 기능을 켜기
     * 전에 깔린 앱), 열쇠를 잃은 경우다. 어느 쪽이든 **파일을 버리고 새로 만든다.**
     * 사본은 서버에서 다시 받을 수 있는 캐시라 잃는 것이 없다.
     *
     * 아웃박스도 함께 사라진다는 것이 유일하게 아까운 자리다. 다만 이 길로 오는 것은
     * 판을 처음 올리는 그 한 번뿐이고, 그때 아직 못 보낸 명령이 남아 있으려면 오프라인인
     * 채로 앱을 갈아 끼워야 한다.
     */
    try {
      await db.getAllAsync('SELECT count(*) FROM sqlite_master');
    } catch {
      await db.closeAsync().catch(() => undefined);
      await SQLite.deleteDatabaseAsync(DATABASE_NAME);
      db = await openWithKey();
    }

    /*
     * WAL 로 둔다. 읽기와 쓰기가 서로를 막지 않아, 동기화가 도는 동안에도 화면이
     * 목록을 읽을 수 있다.
     */
    await db.execAsync('PRAGMA journal_mode = WAL');
    opened = db;
  }
  return opened;
}

/**
 * 닫힌 사본을 쓰려 할 때의 오류.
 *
 * 사본을 버리는 일(로그아웃·주인 바뀜)과 동기화가 겹치면, 이미 돌던 동기화가 닫힌
 * 연결을 계속 쓴다. 네이티브가 "NativeDatabase ... already released" 로 죽는 자리다.
 * 여기서 먼저 막아 무엇이 일어난 것인지 알아볼 수 있는 오류로 바꾼다.
 */
export class MirrorClosedError extends Error {
  constructor() {
    super('기기 사본이 닫혔습니다.');
    this.name = 'MirrorClosedError';
  }
}

/*
 * 사본을 닫기 전에 지나야 하는 문.
 *
 * `check()` 는 질의를 **시작할 때**만 본다. 시작한 뒤 네이티브에서 도는 동안 사본이
 * 닫히면 그 자리에서 이미 놓인 statement 를 만지게 되어 SIGSEGV 로 죽는다
 * (`exsqlite3_reset`). 실제로 로그아웃에서 그랬다 -- 로그인 화면이 뜨자마자 세는
 * "보내지 못한 거래"(`outbox` 집계)가 돌고 있는 동안 `deleteLocalStore` 가 닫았다.
 * 운이 좋으면 죽는 대신 삭제가 거절되는데(`ERR_DELETE_DATABASE`), 그때는 앞 사용자의
 * 사본이 기기에 남는다. 둘 다 같은 경합의 두 얼굴이다.
 *
 * 그래서 도는 질의를 세고, 닫기는 그 수가 0 이 될 때까지 기다린다. `closing` 이 서면
 * 새 질의는 시작하지 않는다 -- 기다리는 동안 새로 들어온 것 때문에 영영 0 이 되지 않는
 * 일을 막는다.
 */
let inFlight = 0;
let closing = false;
const drainWaiters: Array<() => void> = [];

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) {
      while (drainWaiters.length) drainWaiters.pop()!();
    }
  }
}

/**
 * 돌고 있는 질의가 모두 끝나기를 기다린다. 시간 안에 비면 true.
 *
 * 무작정 기다리지 않는 것은, 네이티브가 멈춰 버린 경우에 로그아웃까지 함께 멈추기
 * 때문이다. 그 경우 닫지도 지우지도 않고 물러난다 -- 사본은 남지만 아무도 읽지 않고
 * (`store` 는 이미 비었다), 다른 계정이 로그인하면 그 자리에서 다시 지운다
 * (`signInWithGoogle` 이 사본의 주인을 보고 가른다).
 */
function waitUntilDrained(timeoutMs: number): Promise<boolean> {
  if (inFlight === 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    drainWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export function createSqlDriver(db: SQLite.SQLiteDatabase, isOpen: () => boolean): SqlDriver {
  const lock = createTxLock();
  const check = () => {
    if (closing || !isOpen()) throw new MirrorClosedError();
  };

  return {
    async run(sql: string, params: readonly SqlValue[] = []) {
      check();
      await guard(() => db.runAsync(sql, params as SqlValue[]));
    },

    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      check();
      return guard(() => db.getAllAsync<T>(sql, params as SqlValue[]));
    },

    /**
     * 트랜잭션은 한 줄로 세운다 (`@money/core/data/tx-lock`).
     *
     * SQLite 는 연결 하나에 트랜잭션을 겹쳐 열지 못한다. 동기화는 화면·알림·저장 직후
     * 세 갈래에서 시작하므로 겹치는 일이 실제로 일어난다. 겹친 것을 앞 트랜잭션 안에서
     * 그냥 돌리면(전에 그렇게 했다) 앞이 되돌아갈 때 뒤가 적은 것까지 사라진다.
     */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return lock(async () => {
        check();
        /*
         * 안쪽 문장이 아니라 트랜잭션 전체를 센다. 문장과 문장 사이에서 닫히면 절반만
         * 적힌 채로 끝나고, 그 뒤의 COMMIT 이 닫힌 연결로 간다.
         */
        return guard(async () => {
          let result: T;
          await db.withTransactionAsync(async () => {
            result = await fn();
          });
          return result!;
        });
      });
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
  const handle = await database();
  /*
   * 이 드라이버가 여는 그 연결이 아직 살아 있는지 본다.
   *
   * `deleteLocalStore` 가 연결을 닫고 `opened` 를 비운 뒤 다른 파일을 열 수 있다. 그때
   * 옛 드라이버를 붙들고 있던 일(돌고 있던 동기화)이 닫힌 연결을 쓰지 못하게 막는다.
   */
  const store = new LocalStore(createSqlDriver(handle, () => opened === handle));
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
  closing = true;
  try {
    /*
     * 돌고 있는 질의가 끝나기를 기다린다. 여기서 기다리지 않으면 네이티브가 statement 를
     * 만지는 도중에 연결이 사라져 앱이 통째로 죽는다.
     */
    if (!(await waitUntilDrained(DRAIN_TIMEOUT_MS))) {
      throw new Error('기기 사본에서 돌고 있는 질의가 끝나지 않아 지우지 못했습니다.');
    }

    if (opened) {
      await opened.closeAsync();
      opened = null;
    }
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    // 열쇠도 함께 버린다. 다음 사용자의 사본은 새 열쇠로 잠근다.
    await clearMirrorKey();
  } finally {
    closing = false;
  }
}
