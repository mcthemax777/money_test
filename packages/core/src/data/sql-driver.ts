/**
 * 기기의 SQL 저장소를 다루는 최소한의 창구.
 *
 * 왜 인터페이스인가. 실제 구현은 플랫폼마다 다르다. 앱은 expo-sqlite, 검증은 노드의
 * `node:sqlite` 다. 저장소의 스키마와 질의는 한 벌로 두고 드라이버만 갈아 끼우면,
 * 기기에서 도는 SQL 을 노드에서 그대로 돌려 볼 수 있다. 이 갈아 끼우는 방식은
 * 토큰 저장소(`auth-tokens`)와 스토어 저장소(`persist-storage`)에서 이미 쓰고 있다.
 *
 * 창구를 셋으로 좁힌 이유. 드라이버마다 제공하는 편의 기능이 다르다. 셋만 쓰면
 * 어떤 드라이버에서도 같은 코드가 돌고, 새 드라이버를 붙일 때 구현할 것도 셋뿐이다.
 */

/** 질의에 실어 보낼 수 있는 값. SQLite 가 담을 수 있는 것만 받는다. */
export type SqlValue = string | number | null;

export interface SqlDriver {
  /** 결과를 쓰지 않는 문장 (CREATE, INSERT, UPDATE, DELETE) */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;

  /** 행을 읽는 문장 */
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /**
   * 하나의 원자 단위. 중간에 실패하면 전부 되돌린다.
   *
   * 동기화가 여기에 기댄다. 델타를 반쯤 적용한 상태로 커서를 올리면, 기기는 받지
   * 못한 변경을 "이미 본 번호"로 여겨 영원히 다시 받지 못한다.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
