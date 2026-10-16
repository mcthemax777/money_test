/**
 * 설정 엔티티의 필드별 시계를 읽고 찍는 자리.
 *
 * 병합 규칙 자체는 `@money/types` 의 `field-merge` 에 있다 (기기도 같은 것을 쓴다).
 * 여기 있는 것은 그 규칙과 데이터베이스 사이의 얇은 층이다 -- Prisma 의 Json 컬럼은
 * `JsonValue` 로 오고 그 안에 무엇이 들었는지 타입이 말해 주지 않는다.
 *
 * **누가 무엇을 하는가.** 이긴 필드를 고르는 일은 명령을 재생하는 쪽이 한다(거기서만
 * 충돌인지 아닌지를 판정할 수 있다). 서비스는 받은 필드를 그대로 쓰고, 그 필드의 시계만
 * 여기서 찍는다. 온라인 요청은 시계를 넘기지 않으므로 서버 시계가 들어가고, 그것은 언제나
 * 가장 늦은 값이라 자연히 이긴다.
 */
import { Prisma } from '@prisma/client';
import type { FieldClocks } from '@money/types';

/** Prisma 의 Json 값을 시계 지도로. 모양이 아니면 빈 지도다. */
export function readFieldClocks(value: unknown): FieldClocks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const clocks: FieldClocks = {};
  for (const [field, clock] of Object.entries(value as Record<string, unknown>)) {
    if (typeof clock === 'string') clocks[field] = clock;
  }
  return clocks;
}

/**
 * 방금 쓴 필드에 시계를 찍는다. 나머지 필드의 시계는 그대로 둔다.
 *
 * 건드리지 않은 필드까지 새 시계를 받으면, 다른 기기가 그 필드에 대해 갖고 있던 정당한
 * 편집이 이유 없이 진다.
 */
export function stampFieldClocks(
  stored: unknown,
  fields: readonly string[],
  hlc: string,
): FieldClocks {
  const clocks = readFieldClocks(stored);
  for (const field of fields) clocks[field] = hlc;
  return clocks;
}

/** 필드별 시계를 가진 표. 표 이름은 이 목록에서만 받는다 (SQL 에 그대로 들어간다). */
export type FieldClockTable = 'Account' | 'Card' | 'Tag' | 'Person' | 'Category';

/**
 * 방금 쓴 필드의 시계를 **데이터베이스 안에서** 합친다 (2026-10-16).
 *
 * `stampFieldClocks` 는 읽어 둔 지도에 찍어 통째로 다시 쓴다. 두 요청이 같은 줄의 서로 다른 필드를 함께
 * 고치면 둘 다 옛 지도를 읽고, 늦게 쓴 쪽이 앞의 필드 시계를 지운다 -- 그 뒤 그 필드에 대한 더 오래된
 * 오프라인 편집이 충돌 없이 이긴다. 여기서는 바꾼 필드만 jsonb `||` 로 덮어 쓰므로 겹쳐도 서로를 지우지 않는다.
 *
 * 값을 쓰는 UPDATE 와 같은 트랜잭션에서 **그보다 먼저** 부른다. 그래야 그 UPDATE 가 돌려주는 행에 합친
 * 시계가 실린다.
 */
export async function mergeFieldClocks(
  db: Pick<Prisma.TransactionClient, '$executeRaw'>,
  table: FieldClockTable,
  id: string,
  fields: readonly string[],
  hlc: string,
): Promise<void> {
  if (fields.length === 0) return;
  const patch = JSON.stringify(Object.fromEntries(fields.map((field) => [field, hlc])));
  // 지도가 아닌 값(옛 판의 JSON null 따위)에 붙이면 배열이 된다. 그때는 빈 지도에서 시작한다.
  await db.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)}
       SET "fieldHlc" = (CASE WHEN jsonb_typeof("fieldHlc") = 'object' THEN "fieldHlc" ELSE '{}'::jsonb END)
                        || ${patch}::jsonb
     WHERE id = ${id}`;
}
