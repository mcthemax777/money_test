import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { randomBytes } from 'crypto';

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

  private generateInvitationCode(): string {
    return randomBytes(16).toString('hex');
  }
}
