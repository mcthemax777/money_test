import { BadRequestException } from '@nestjs/common';

/**
 * 드래그로 바꾼 순서를 저장하기 전 검증.
 *
 * 받은 id가 전부 이 프로젝트 것이고 중복이 없어야 한다. 검증 없이 저장하면
 * 다른 프로젝트의 행에 sortOrder를 쓰거나, 같은 항목이 두 번 들어와 순서가 뒤엉킨다.
 *
 * 목록 전체를 보내지 않아도 된다(화면이 일부만 다룰 수 있다). 보낸 것만 0부터
 * 다시 매기고, 나머지는 기존 값을 유지한다.
 */
export function assertReorderIds(ids: string[], allowedIds: Set<string>): void {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new BadRequestException('정렬할 항목을 지정하세요.');
  }

  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('같은 항목이 두 번 들어 있습니다.');
  }

  const unknown = ids.find((id) => !allowedIds.has(id));
  if (unknown) {
    throw new BadRequestException('이 프로젝트의 항목이 아닙니다.');
  }
}
