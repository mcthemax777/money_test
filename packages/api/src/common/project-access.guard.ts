import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DEFAULT_TIME_ZONE } from '@money/types';
import { PrismaService } from '@/config/prisma.service';

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 사용자가 프로젝트에 접근 권한이 있는지 확인
   * @param userId 사용자 ID
   * @param projectId 프로젝트 ID
   * @throws ForbiddenException 권한이 없을 때
   */
  async verifyUserHasAccessToProject(userId: string, projectId: string): Promise<void> {
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('이 프로젝트에 접근 권한이 없습니다.');
    }
  }

  /**
   * 사용자가 프로젝트에 특정 역할 이상의 권한이 있는지 확인
   * @param userId 사용자 ID
   * @param projectId 프로젝트 ID
   * @param requiredRole 필요한 역할 (owner, editor, viewer)
   * @throws ForbiddenException 권한이 없을 때
   */
  async verifyUserRole(
    userId: string,
    projectId: string,
    requiredRole: 'owner' | 'editor' | 'viewer' = 'viewer',
  ): Promise<void> {
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('이 프로젝트에 접근 권한이 없습니다.');
    }

    const roleHierarchy = { owner: 3, editor: 2, viewer: 1 };
    if (roleHierarchy[membership.role] < roleHierarchy[requiredRole]) {
      throw new ForbiddenException(
        `이 작업에는 ${requiredRole} 이상의 권한이 필요합니다.`,
      );
    }
  }

  /**
   * 사용자가 쓸 수 있는 기본 프로젝트 ID를 찾는다. 없으면 null.
   * 프로젝트가 하나도 없는 상태는 정상 상태이므로 예외를 던지지 않는다.
   */
  async findDefaultProjectId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { defaultProjectId: true },
    });

    // defaultProjectId는 관계가 아닌 단순 문자열이라 삭제된 프로젝트를 가리킬 수
    // 있다. 멤버십으로 실제 접근 가능 여부를 확인한다.
    if (user?.defaultProjectId) {
      const membership = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: user.defaultProjectId, userId },
        },
        select: { projectId: true },
      });

      if (membership) {
        return membership.projectId;
      }
    }

    // 본인이 만든 프로젝트를 우선한다.
    const owned = await this.prisma.projectMember.findFirst({
      where: { userId, role: 'owner' },
      orderBy: { joinedAt: 'asc' },
      select: { projectId: true },
    });

    if (owned) {
      return owned.projectId;
    }

    // 본인 프로젝트가 없어도 가입 요청으로 합류한 프로젝트가 있으면 그것을 쓴다.
    // role을 owner로 제한하면 합류만 한 사용자가 앱을 쓸 수 없게 된다.
    const joined = await this.prisma.projectMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: { projectId: true },
    });

    return joined?.projectId ?? null;
  }

  /**
   * 사용자의 기본 프로젝트 ID 반환. 쓸 수 있는 프로젝트가 없으면 예외.
   */
  async getDefaultProjectId(userId: string): Promise<string> {
    const projectId = await this.findDefaultProjectId(userId);

    if (!projectId) {
      throw new BadRequestException(
        '기본 프로젝트를 찾을 수 없습니다. 먼저 프로젝트를 생성하세요.',
      );
    }

    return projectId;
  }

  /**
   * projectId를 반환 (없으면 기본값)
   * 권한 확인 포함
   */
  async resolveAndVerifyProjectId(
    userId: string,
    projectIdParam?: string,
  ): Promise<string> {
    const projectId = projectIdParam || (await this.getDefaultProjectId(userId));
    await this.verifyUserHasAccessToProject(userId, projectId);
    return projectId;
  }

  /**
   * projectId와 집계 기준 타임존을 함께 반환 (권한 확인 포함).
   *
   * 월·일 경계를 계산하는 서비스는 이 함수를 쓴다. 거래 시각은 UTC 인스턴트로
   * 저장되지만 "8월"의 경계는 프로젝트 타임존의 벽시계 기준이어야 한다.
   */
  async resolveProject(
    userId: string,
    projectIdParam?: string,
  ): Promise<{ id: string; timeZone: string }> {
    const projectId = await this.resolveAndVerifyProjectId(userId, projectIdParam);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { timezone: true },
    });

    return { id: projectId, timeZone: project?.timezone || DEFAULT_TIME_ZONE };
  }

  /** 프로젝트의 집계 기준 타임존. 권한 확인이 이미 끝난 경로에서 쓴다. */
  async getProjectTimeZone(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { timezone: true },
    });

    return project?.timezone || DEFAULT_TIME_ZONE;
  }
}
