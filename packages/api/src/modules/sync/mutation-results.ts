/**
 * 재생 결과의 공통 모양 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 전표·자산·설정 재생이 같은 문장과 같은 상태로 답해야 기기가 한 갈래로 읽는다.
 * 그래서 "적용", "이미 있음", "없음", "전부 졌음"의 답을 여기 한 곳에서 만든다.
 */
import type { Mutation, MutationResult } from '@money/types';
import type { PrismaService } from '@/config/prisma.service';

/** 적용했다는 답. 그때의 가계부 번호를 함께 준다 -- 기기가 그 번호까지 받았다고 적는다. */
export async function appliedResult(
  prisma: PrismaService,
  mutation: Mutation,
  projectId: string,
): Promise<MutationResult> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { syncVersion: true },
  });
  return {
    mutationId: mutation.mutationId,
    status: 'applied',
    appliedVersion: project.syncVersion,
  };
}

/**
 * 이미 그 id 의 행이 있을 때의 답.
 *
 * 같은 프로젝트면 재전송이라 duplicate 다. 다른 프로젝트면 기기가 만든 id 가 남의 것과
 * 겹친 것이라 적용하지 않는다 -- 남의 가계부를 고칠 뻔한 자리다.
 */
export function sameOrForeign(
  mutation: Mutation,
  existingProjectId: string,
  projectId: string,
  label: string,
): MutationResult {
  if (existingProjectId !== projectId) {
    return {
      mutationId: mutation.mutationId,
      status: 'rejected',
      error: `다른 프로젝트에 같은 식별자의 ${label}이(가) 있습니다.`,
    };
  }
  return { mutationId: mutation.mutationId, status: 'duplicate' };
}

/** 고칠 대상이 이 가계부에 없을 때의 답. */
export function targetNotFound(mutation: Mutation, label: string): MutationResult {
  return {
    mutationId: mutation.mutationId,
    status: 'rejected',
    code: 'TARGET_NOT_FOUND',
    error: `${label}을(를) 찾을 수 없습니다.`,
  };
}

/**
 * 보낸 필드가 전부 더 늦은 편집에 밀렸을 때.
 *
 * 충돌로 돌려준다. 조용히 "적용했다"고 답하면 사용자가 고친 이름이 아무 말 없이
 * 사라지고, 보류 칸에서 되살릴 길도 없어진다 (D6).
 */
export function allFieldsLost(mutation: Mutation, lost: readonly string[]): MutationResult {
  return {
    mutationId: mutation.mutationId,
    status: 'conflict',
    error: `다른 기기에서 더 늦게 고쳤습니다 (${lost.join(', ')}).`,
  };
}
