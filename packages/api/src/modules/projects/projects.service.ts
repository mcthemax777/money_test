import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { randomBytes, randomInt } from 'crypto';
import { ProjectAccessService } from '../../common/project-access.guard';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';

interface CreateProjectDto {
  name: string;
  description?: string;
}

interface UpdateProjectDto {
  name?: string;
  description?: string | null;
  timezone?: string;
  /** 표시 통화. 저장 통화(ledgerCurrency)는 만든 뒤 바꿀 수 없다. */
  displayCurrency?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

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

    // 이 프로젝트가 사용자의 유일한 프로젝트라면 기본 프로젝트로 지정한다.
    // 프로젝트를 모두 삭제했거나 강퇴당한 뒤 다시 만드는 경우가 여기에 해당한다.
    const membershipCount = await this.prisma.projectMember.count({ where: { userId } });

    if (membershipCount === 1) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { defaultProjectId: project.id },
      });
    }

    return {
      ...project,
      role: 'owner',
    };
  }

  /**
   * 프로젝트 설정 변경 (이름, 설명, 집계 기준 타임존).
   *
   * 이름과 설명은 모든 구성원이 함께 보고, 타임존을 바꾸면 월 합계와 카드 청구주기
   * 경계가 함께 움직인다. 모두 프로젝트 전체에 영향을 주므로 소유자만 바꿀 수 있다.
   */
  async updateProject(projectId: string, userId: string, dto: UpdateProjectDto) {
    await this.verifyUserIsOwner(projectId, userId);

    const data: {
      name?: string;
      description?: string | null;
      timezone?: string;
      displayCurrency?: string;
    } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('프로젝트 이름을 입력해주세요.');
      }
      data.name = name;
    }

    // 설명은 없어도 되는 값이다. 빈 문자열로 지우면 null로 저장해
    // "설명 없음"을 한 가지 형태로만 남긴다.
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }

    if (dto.timezone !== undefined) {
      if (!isValidTimeZone(dto.timezone)) {
        throw new BadRequestException('알 수 없는 타임존입니다.');
      }
      data.timezone = dto.timezone;
    }

    /*
     * 표시 통화만 바꾼다. 저장된 값은 하나도 건드리지 않는다.
     *
     * Posting.baseAmount 는 저장 통화(ledgerCurrency)로 남아 있고, 리포트가 읽을
     * 때 합계에 환율을 한 번 곱해 이 통화로 보여 준다. 그래서 몇 번을 오가도
     * 원본이 그대로다. 예전에는 저장값을 다시 계산해 덮어썼고, 그때마다 통화
     * 자릿수로 반올림해 왕복에 손실이 남았다 (₩13,333 -> $9.66 -> ₩13,331).
     *
     * 저장 통화는 만든 뒤 바꿀 수 없다. 그것을 바꾸면 거래 시점에 실제로 청구된
     * 금액(원화 카드의 달러 결제 등)까지 다시 계산해야 하는데, 그건 기록된 사실을
     * 고치는 일이다.
     */
    if (dto.displayCurrency !== undefined) {
      data.displayCurrency = this.exchangeRates.assertCurrency(dto.displayCurrency, '표시 통화');
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('변경할 값이 없습니다.');
    }

    const project = await this.prisma.project.update({ where: { id: projectId }, data });
    const member = await this.verifyUserInProject(projectId, userId);
    return { ...project, role: member.role };
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
      /** 이 사용자가 이 프로젝트에서 "나"로 지정한 구성원 */
      myPersonId: pm.personId,
    }));
  }

  /**
   * "구성원 중 나" 지정.
   *
   * 프로젝트 단위가 아니라 멤버십 단위다. 한 가계부를 여러 사용자가 함께 쓰면
   * 각자 다른 구성원을 자기로 지정한다. null을 주면 지정을 해제한다.
   */
  async setMyPerson(projectId: string, userId: string, personId: string | null) {
    const member = await this.verifyUserInProject(projectId, userId);

    if (personId) {
      const person = await this.prisma.person.findUnique({ where: { id: personId } });
      if (!person || person.projectId !== projectId) {
        throw new NotFoundException('이 프로젝트의 구성원이 아닙니다.');
      }
    }

    const updated = await this.prisma.projectMember.update({
      where: { id: member.id },
      data: { personId },
      include: { project: true },
    });

    return { ...updated.project, role: updated.role, myPersonId: updated.personId };
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

  // 초대 링크 발급. 링크 주소는 환경마다 달라지므로 코드만 돌려주고
  // 실제 URL 조립은 클라이언트가 자기 origin으로 처리한다.
  async generateInvitationLink(
    projectId: string,
    role: 'editor' | 'viewer',
    userId: string,
  ) {
    await this.verifyUserIsOwner(projectId, userId);

    const invitation = await this.prisma.projectInvitation.create({
      data: {
        projectId,
        invitationCode: this.generateInvitationCode(),
        role,
        status: 'pending',
        invitedByUserId: userId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후 만료
      },
    });

    return {
      id: invitation.id,
      invitationCode: invitation.invitationCode,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  // 초대 코드로 어떤 프로젝트인지 확인한다. 아직 멤버가 아닌 사람이 호출하므로
  // 가계부 내용은 담지 않는다.
  async getInvitationByCode(invitationCode: string, userId: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { invitationCode },
      include: {
        project: {
          include: { members: { include: { user: true } } },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('초대를 찾을 수 없습니다');
    }

    const isExpired = Boolean(invitation.expiresAt && new Date() > invitation.expiresAt);
    const owner = invitation.project.members.find((m) => m.role === 'owner');

    return {
      invitationCode: invitation.invitationCode,
      role: invitation.role,
      // 만료된 pending 초대는 status가 아직 pending이므로 여기서 만료로 보여준다.
      status: isExpired && invitation.status === 'pending' ? 'expired' : invitation.status,
      expiresAt: invitation.expiresAt,
      projectId: invitation.projectId,
      projectName: invitation.project.name,
      projectDescription: invitation.project.description,
      ownerName: owner?.user.name ?? null,
      memberCount: invitation.project.members.length,
      isMember: invitation.project.members.some((m) => m.userId === userId),
    };
  }

  // 유출된 링크를 무효화한다.
  async revokeInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, projectId: true, status: true },
    });

    if (!invitation) {
      throw new NotFoundException('초대를 찾을 수 없습니다');
    }

    await this.verifyUserIsOwner(invitation.projectId, userId);

    if (invitation.status !== 'pending') {
      throw new BadRequestException('이미 처리된 초대입니다');
    }

    await this.prisma.projectInvitation.delete({ where: { id: invitationId } });

    return { success: true };
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

    await this.clearStaleDefaultProject(userId, projectId);

    return { success: true };
  }

  async deleteProject(projectId: string, userId: string) {
    await this.verifyUserIsOwner(projectId, userId);

    // 삭제하면 멤버십도 cascade로 사라지므로 대상 사용자를 미리 확보한다.
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });

    // 프로젝트와 관련된 모든 데이터 삭제
    await this.prisma.project.delete({
      where: { id: projectId },
    });

    // defaultProjectId는 관계가 아니라 cascade로 정리되지 않는다.
    // 방치하면 이 프로젝트를 기본으로 쓰던 사용자의 로그인이 깨진다.
    for (const member of members) {
      await this.clearStaleDefaultProject(member.userId, projectId);
    }

    return { success: true };
  }

  /**
   * owner가 멤버를 프로젝트에서 내보낸다.
   */
  async removeMember(projectId: string, targetUserId: string, requesterId: string) {
    await this.verifyUserIsOwner(projectId, requesterId);

    if (targetUserId === requesterId) {
      throw new BadRequestException('본인은 강퇴할 수 없습니다. 프로젝트 탈퇴를 이용하세요.');
    }

    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      include: { user: { select: { name: true } } },
    });

    if (!target) {
      throw new NotFoundException('프로젝트 멤버가 아닙니다.');
    }

    // 소유권 박탈은 강퇴로 처리하지 않는다.
    if (target.role === 'owner') {
      throw new BadRequestException('소유자는 강퇴할 수 없습니다.');
    }

    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });

    // 승인 기록을 남겨두면 멤버가 아닌데 승인 상태인 행이 남는다.
    // 지워야 나중에 다시 가입 요청을 보낼 수 있는 상태가 깔끔하다.
    await this.prisma.projectJoinRequest.deleteMany({
      where: { projectId, userId: targetUserId },
    });

    // 강퇴당한 사용자의 기본 프로젝트가 이 프로젝트였다면 정리한다.
    await this.clearStaleDefaultProject(targetUserId, projectId);

    return { success: true, userId: targetUserId, userName: target.user.name };
  }

  /**
   * 사용자의 defaultProjectId가 방금 떠난(또는 삭제된) 프로젝트를 가리키면
   * 남아 있는 프로젝트로 옮기고, 남은 것이 없으면 비운다.
   */
  private async clearStaleDefaultProject(userId: string, removedProjectId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { defaultProjectId: true },
    });

    if (user?.defaultProjectId !== removedProjectId) {
      return;
    }

    const remaining = await this.prisma.projectMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: { projectId: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { defaultProjectId: remaining?.projectId ?? null },
    });
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
  // 승인된 요청은 이미 멤버가 되어 프로젝트 목록에 나타나므로 제외한다.
  async getMyJoinRequests(userId: string) {
    const requests = await this.prisma.projectJoinRequest.findMany({
      where: { userId, status: { not: 'approved' } },
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

/** IANA 타임존 이름인지 확인한다. ICU가 모르는 이름이면 예외가 난다. */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
