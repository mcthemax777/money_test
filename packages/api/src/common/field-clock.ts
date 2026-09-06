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
