import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { randomBytes, randomInt } from 'crypto';

interface CreateProjectDto {
  name: string;
  description?: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        projectKey: await this.issueProjectKey(),
      },
    });

    await this.prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        role: 'owner',
      },
    });

    return {
      ...project,
      role: 'owner',
    };
  }

  async getMyProjects(userId: string) {
    const projects = await this.prisma.projectMember.findMany({
      where: { userId },
      include: {
        project: true,
      },
    });

    return projects.map((pm) => ({
      ...pm.project,
      role: pm.role,
    }));
  }

  async getProjectMembers(projectId: string, userId: string) {
    await this.verifyUserInProject(projectId, userId);

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: true,
      },
    });

    return members.map((pm) => ({
      id: pm.user.id,
      email: pm.user.email,
      name: pm.user.name,
      role: pm.role,
      joinedAt: pm.joinedAt,
    }));
  }

  async sendEmailInvitation(projectId: string, email: string, role: 'owner' | 'editor' | 'viewer', userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    const invitationCode = this.generateInvitationCode();

    const invitation = await this.prisma.projectInvitation.create({
      data: {
        projectId,
        email,
        invitationCode,
        role,
        status: 'pending',
        invitedByUserId: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7일 후 만료
      },
    });

    // TODO: 실제 이메일 발송 로직 구현
    console.log(`Email invitation sent to ${email} with code: ${invitationCode}`);

    return {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    };
  }

  async generateInvitationLink(projectId: string, role: 'owner' | 'editor' | 'viewer', userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    const invitationCode = this.generateInvitationCode();

    const invitation = await this.prisma.projectInvitation.create({
      data: {
        projectId,
        email: '', // 링크 초대는 이메일 미정
        invitationCode,
        role,
        status: 'pending',
        invitedByUserId: userId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후 만료
      },
    });

    return {
      id: invitation.id,
      invitationCode: invitation.invitationCode,
      invitationLink: `${process.env.FRONTEND_URL}/join?code=${invitation.invitationCode}`,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(invitationCode: string, userId: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { invitationCode },
    });

    if (!invitation) {
      throw new NotFoundException('초대를 찾을 수 없습니다');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException(`초대가 이미 ${invitation.status} 상태입니다`);
    }

    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      await this.prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('초대가 만료되었습니다');
    }

    // 이미 프로젝트 멤버인지 확인
    const existingMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: invitation.projectId,
          userId,
        },
      },
    });

    if (existingMember) {
      throw new BadRequestException('이미 이 프로젝트의 멤버입니다');
    }

    // ProjectMember 생성
    await this.prisma.projectMember.create({
      data: {
        projectId: invitation.projectId,
        userId,
        role: invitation.role,
      },
    });

    // ProjectInvitation 상태 업데이트
    await this.prisma.projectInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: userId,
      },
    });

    const project = await this.prisma.project.findUnique({
      where: { id: invitation.projectId },
    });

    return {
      projectId: project!.id,
      projectName: project!.name,
      role: invitation.role,
    };
  }

  async declineInvitation(invitationCode: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { invitationCode },
    });

    if (!invitation) {
      throw new NotFoundException('초대를 찾을 수 없습니다');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException(`초대가 이미 ${invitation.status} 상태입니다`);
    }

    await this.prisma.projectInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined' },
    });

    return { success: true };
  }

  async getProjectPendingInvitations(projectId: string, userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    const invitations = await this.prisma.projectInvitation.findMany({
      where: {
        projectId,
        status: 'pending',
      },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      invitationCode: inv.invitationCode,
      role: inv.role,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }

  private async verifyUserInProject(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('이 프로젝트에 접근할 권한이 없습니다');
    }

    return member;
  }

  private async verifyUserIsOwner(projectId: string, userId: string) {
    const member = await this.verifyUserInProject(projectId, userId);

    if (member.role !== 'owner') {
      throw new ForbiddenException('프로젝트 소유자만 이 작업을 수행할 수 있습니다');
    }

    return member;
  }

  async leaveProject(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!member) {
      throw new NotFoundException('프로젝트 멤버가 아닙니다.');
    }

    // 마지막 owner인 경우 탈퇴 불가
    if (member.role === 'owner') {
      const ownerCount = await this.prisma.projectMember.count({
        where: { projectId, role: 'owner' },
      });

      if (ownerCount === 1) {
        throw new BadRequestException('마지막 소유자는 프로젝트를 탈퇴할 수 없습니다.');
      }
    }

    await this.prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    return { success: true };
  }

  async deleteProject(projectId: string, userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    // 프로젝트와 관련된 모든 데이터 삭제
    await this.prisma.project.delete({
      where: { id: projectId },
    });

    return { success: true };
  }

  // ===== 프로젝트 키 =====

  // 사람이 눈으로 읽고 입력하는 키이므로 혼동되는 문자(0/O, 1/I/L)를 제외한다.
  private static readonly PROJECT_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  private static readonly PROJECT_KEY_LENGTH = 8;

  private generateProjectKey(): string {
    const alphabet = ProjectsService.PROJECT_KEY_ALPHABET;
    let key = '';
    for (let i = 0; i < ProjectsService.PROJECT_KEY_LENGTH; i += 1) {
      // randomInt는 나머지 연산 편향이 없다.
      key += alphabet[randomInt(alphabet.length)];
    }
    return key;
  }

  // 중복은 사실상 발생하지 않지만, unique 제약에 걸려 프로젝트 생성이 실패하는 것을 막는다.
  // 가입 시 기본 프로젝트를 만드는 AuthService도 같은 규칙을 써야 하므로 공개한다.
  async issueProjectKey(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = this.generateProjectKey();
      const taken = await this.prisma.project.findUnique({ where: { projectKey: key } });
      if (!taken) {
        return key;
      }
    }
    throw new BadRequestException('프로젝트 키를 발급하지 못했습니다. 다시 시도해주세요.');
  }

  // ===== 가입 요청 =====

  // 키로 프로젝트를 찾는다. 아직 멤버가 아닌 사람도 호출하므로
  // 가계부 내용은 절대 포함하지 않고 식별에 필요한 정보만 돌려준다.
  async findProjectByKey(projectKey: string, userId: string) {
    const key = projectKey?.trim().toUpperCase();

    if (!key) {
      throw new BadRequestException('프로젝트 키를 입력해주세요.');
    }

    const project = await this.prisma.project.findUnique({
      where: { projectKey: key },
      include: {
        members: { include: { user: true } },
        joinRequests: { where: { userId } },
      },
    });

    if (!project) {
      throw new NotFoundException('해당 키의 프로젝트를 찾을 수 없습니다.');
    }

    const owner = project.members.find((m) => m.role === 'owner');

    return {
      id: project.id,
      projectKey: project.projectKey,
      name: project.name,
      description: project.description,
      ownerName: owner?.user.name ?? null,
      memberCount: project.members.length,
      isMember: project.members.some((m) => m.userId === userId),
      myRequestStatus: project.joinRequests[0]?.status ?? null,
    };
  }

  async requestToJoin(projectId: string, userId: string, message?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });

    if (!project) {
      throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    }

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (member) {
      throw new BadRequestException('이미 이 프로젝트의 멤버입니다.');
    }

    const existing = await this.prisma.projectJoinRequest.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (existing?.status === 'pending') {
      throw new BadRequestException('이미 가입 요청을 보냈습니다. 승인을 기다려주세요.');
    }

    const trimmedMessage = message?.trim() || null;

    // 쌍마다 한 행만 유지하므로, 거절되었던 요청은 같은 행을 pending으로 되돌린다.
    const request = await this.prisma.projectJoinRequest.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, message: trimmedMessage, status: 'pending' },
      update: {
        message: trimmedMessage,
        status: 'pending',
        decidedAt: null,
        decidedByUserId: null,
      },
    });

    return {
      id: request.id,
      projectId: request.projectId,
      projectName: project.name,
      status: request.status,
      createdAt: request.createdAt,
    };
  }

  // owner가 자기 프로젝트의 대기 중인 요청을 본다.
  async getProjectJoinRequests(projectId: string, userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    const requests = await this.prisma.projectJoinRequest.findMany({
      where: { projectId, status: 'pending' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    return requests.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.user.name,
      email: r.user.email,
      avatar: r.user.avatar,
      message: r.message,
      createdAt: r.createdAt,
    }));
  }

  // 요청자가 자신의 요청 상태를 확인한다.
  async getMyJoinRequests(userId: string) {
    const requests = await this.prisma.projectJoinRequest.findMany({
      where: { userId },
      include: { project: true },
      orderBy: { updatedAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.project.name,
      projectKey: r.project.projectKey,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    }));
  }

  async approveJoinRequest(
    requestId: string,
    userId: string,
    role: 'editor' | 'viewer' = 'editor',
  ) {
    const request = await this.prisma.projectJoinRequest.findUnique({
      where: { id: requestId },
      include: { project: true, user: true },
    });

    if (!request) {
      throw new NotFoundException('가입 요청을 찾을 수 없습니다.');
    }

    await this.verifyUserIsOwner(request.projectId, userId);

    if (request.status !== 'pending') {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    // 승인 사이에 요청자가 다른 경로로 멤버가 되었을 수 있으므로 중복 생성을 피한다.
    const existingMember = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: request.projectId, userId: request.userId } },
    });

    if (!existingMember) {
      await this.prisma.projectMember.create({
        data: { projectId: request.projectId, userId: request.userId, role },
      });
    }

    await this.prisma.projectJoinRequest.update({
      where: { id: requestId },
      data: { status: 'approved', decidedAt: new Date(), decidedByUserId: userId },
    });

    return {
      projectId: request.projectId,
      projectName: request.project.name,
      userId: request.userId,
      userName: request.user.name,
      role: existingMember?.role ?? role,
    };
  }

  async rejectJoinRequest(requestId: string, userId: string) {
    const request = await this.prisma.projectJoinRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('가입 요청을 찾을 수 없습니다.');
    }

    await this.verifyUserIsOwner(request.projectId, userId);

    if (request.status !== 'pending') {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    await this.prisma.projectJoinRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', decidedAt: new Date(), decidedByUserId: userId },
    });

    return { success: true };
  }

  // 요청자가 대기 중인 자기 요청을 취소한다.
  async cancelJoinRequest(requestId: string, userId: string) {
    const request = await this.prisma.projectJoinRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('가입 요청을 찾을 수 없습니다.');
    }

    if (request.userId !== userId) {
      throw new ForbiddenException('본인이 보낸 요청만 취소할 수 있습니다.');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    await this.prisma.projectJoinRequest.delete({ where: { id: requestId } });

    return { success: true };
  }

  private generateInvitationCode(): string {
    return randomBytes(16).toString('hex');
  }
}
