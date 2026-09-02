import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isClientId } from '@money/types';

/**
 * 기기가 만들어 보낸 식별자를 받아들이는 자리.
 *
 * 왜 기기가 만드는가. 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저
 * 있어야 하고, 같은 명령을 다시 보내도 행이 하나로 남으려면(멱등) 그 이름이 기기에서
 * 정해져 있어야 한다. 자세한 이유는 `@money/types` 의 id.ts 에 있다.
 *
 * 서버는 UUID 형식만 받는다. 서버가 만드는 cuid 와 모양이 달라 값만 보고도 누가
 * 만든 id 인지 갈리고, 아무 문자열이나 기본 키로 들어오는 길도 막힌다.
 */

/** 검사해서 그대로 돌려준다. 없으면 undefined (서버가 만든다). */
export function clientId(value: string | undefined | null, label = '식별자'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  if (!isClientId(value)) {
    throw new BadRequestException(`${label}는 UUID 형식이어야 합니다.`);
  }
  return value;
}

/**
 * 이미 쓰인 id 로 행을 만들려 한 경우를 500이 아니라 409로 돌려준다.
 *
 * UUIDv7 은 부딪히지 않으므로 이 상황은 사실상 "같은 명령을 두 번 보냈다"는 뜻이다.
 * 2단계에서 아웃박스와 MutationLog 가 붙으면 그때는 오류가 아니라 "이미 적용된 명령"
 * 으로 다루고 저장해 둔 결과를 그대로 돌려주게 된다. 지금은 그 자리를 분간할 수단이
 * 없으므로, 적어도 무슨 일이 일어났는지 알 수 있게 해 둔다.
 */
export async function rejectDuplicateId<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictException(`이미 있는 ${label}입니다.`);
    }
    throw error;
  }
}

/** 기본 키가 겹쳤는가. 다른 유일 제약(카테고리 이름 등)은 각 서비스가 따로 다룬다. */
function isDuplicateKey(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((field) => field === 'id' || field.endsWith('_pkey'));
}
