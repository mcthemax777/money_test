import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { CurrencyCode, DEFAULT_TIME_ZONE, isCurrencyCode } from '@money/types';
import { PrismaService } from '@/config/prisma.service';

/** 프로젝트 역할. 숫자가 클수록 넓은 권한이다. */
const ROLE_RANK: Record<ProjectRole, number> = { owner: 3, editor: 2, viewer: 1 };

const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: '소유자',
  editor: '편집',
  viewer: '읽기',
};

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 사용자가 프로젝트에 필요한 역할 이상의 권한이 있는지 확인.
   *
   * 기본값은 viewer라 조회 경로는 인자를 넘기지 않아도 된다. **데이터를 바꾸는
   * 경로는 반드시 'editor'를 넘겨야 한다.** 넘기지 않으면 읽기 전용으로 초대한
   * 구성원이 거래·계좌·예산을 고칠 수 있다.
   *
   * @throws ForbiddenException 멤버가 아니거나 역할이 모자랄 때
   */
  async verifyUserHasAccessToProject(
    userId: string,
    projectId: string,
    requiredRole: ProjectRole = 'viewer',
  ): Promise<void> {
    // 호출부가 `query.projectId!` 처럼 넘겨 undefined가 들어오면 Prisma가
    // 500으로 터진다. 권한 경로이므로 여기서 명시적으로 막는다.
    if (!projectId) {
      throw new BadRequestException('프로젝트를 지정해야 합니다.');
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('이 프로젝트에 접근 권한이 없습니다.');
    }

    if (ROLE_RANK[membership.role] < ROLE_RANK[requiredRole]) {
      throw new ForbiddenException(
        `이 작업에는 ${ROLE_LABEL[requiredRole]} 이상의 권한이 필요합니다.`,
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
   * projectId를 반환 (없으면 기본값). 권한 확인 포함.
   *
   * 데이터를 바꾸는 경로는 requiredRole에 'editor'를 넘긴다.
   */
  async resolveAndVerifyProjectId(
    userId: string,
    projectIdParam?: string,
    requiredRole: ProjectRole = 'viewer',
  ): Promise<string> {
    const projectId = projectIdParam || (await this.getDefaultProjectId(userId));
    await this.verifyUserHasAccessToProject(userId, projectId, requiredRole);
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
    requiredRole: ProjectRole = 'viewer',
  ): Promise<{ id: string; timeZone: string }> {
    const projectId = await this.resolveAndVerifyProjectId(
      userId,
      projectIdParam,
      requiredRole,
    );
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

  /**
   * 프로젝트의 저장 통화와 표시 통화.
   *
   *   ledger  : Posting.baseAmount 가 담긴 통화. 만든 뒤 바뀌지 않는다.
   *             전표 균형 판정과 거래 시점 금액이 이 통화로 남는다.
   *   display : 리포트를 보여줄 통화. 읽을 때만 환산하므로 바꿔도 저장값은 그대로다.
   *
   * 권한 확인이 이미 끝난 경로에서 쓴다.
   */
  async getProjectCurrencies(
    projectId: string,
  ): Promise<{ ledger: CurrencyCode; display: CurrencyCode }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ledgerCurrency: true, displayCurrency: true },
    });

    // 알 수 없는 코드가 저장돼 있으면 원으로 본다. 여기서 예외를 던지면
    // 프로젝트 전체가 열리지 않는다.
    const ledger = isCurrencyCode(project?.ledgerCurrency) ? project.ledgerCurrency : 'KRW';
    const display = isCurrencyCode(project?.displayCurrency) ? project.displayCurrency : ledger;
    return { ledger, display };
  }

  /** 저장 통화만 필요할 때. 원장이 쓴다. */
  async getProjectLedgerCurrency(projectId: string): Promise<CurrencyCode> {
    return (await this.getProjectCurrencies(projectId)).ledger;
  }
}
