import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
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
   * 사용자의 기본 프로젝트 ID 반환
   * defaultProjectId가 설정되어 있으면 그것, 아니면 owner 프로젝트 반환
   */
  async getDefaultProjectId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { defaultProjectId: true },
    });

    if (user?.defaultProjectId) {
      // 기본 프로젝트가 설정되어 있고, 사용자가 여전히 접근 권한이 있는지 확인
      try {
        await this.verifyUserHasAccessToProject(userId, user.defaultProjectId);
        return user.defaultProjectId;
      } catch {
        // 권한이 없으면 다음 로직으로 진행
      }
    }

    // 기본 프로젝트가 없거나 권한이 없으면 owner 프로젝트 찾기
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, role: 'owner' },
      select: { projectId: true },
    });

    if (!member) {
      throw new BadRequestException(
        '기본 프로젝트를 찾을 수 없습니다. 먼저 프로젝트를 생성하세요.',
      );
    }

    return member.projectId;
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
}
