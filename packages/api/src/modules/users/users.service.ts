import { BadRequestException, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ProjectAccessService } from '../../common/project-access.guard';
import { HIDDEN_ACCOUNT_TYPES } from '../accounts/accounts.service';
import { toCardResponse } from '../cards/card-view';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        defaultProjectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async updateProfile(userId: string, data: { name?: string; avatar?: string }) {
    const payload: { name?: string; avatar?: string } = {};

    // 이름은 다른 멤버에게 보이는 값이므로 공백만 들어가지 않도록 막는다.
    if (data.name !== undefined) {
      const name = data.name.trim();

      if (!name) {
        throw new BadRequestException('이름을 입력해주세요.');
      }

      if (name.length > 50) {
        throw new BadRequestException('이름은 50자 이하로 입력해주세요.');
      }

      payload.name = name;
    }

    if (data.avatar !== undefined) {
      payload.avatar = data.avatar;
    }

    if (Object.keys(payload).length === 0) {
      throw new BadRequestException('변경할 내용이 없습니다.');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: payload,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        defaultProjectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async setDefaultProject(userId: string, projectId: string) {
    await this.projectAccess.verifyUserHasAccessToProject(userId, projectId);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { defaultProjectId: projectId },
    });

    const defaultProjectData = await this.getUserProjectInitialData(userId, projectId);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultProjectId: user.defaultProjectId,
      },
      defaultProjectData,
    };
  }

  async getUserProjectInitialData(userId: string, projectId?: string) {
    const finalProjectId = projectId ||
      (await this.projectAccess.getDefaultProjectId(userId));

    const [project, cards, accounts, categories, people, recentEntries, budgets] =
      await Promise.all([
        this.prisma.project.findUnique({
          where: { id: finalProjectId },
          select: { id: true, name: true, description: true },
        }),
        this.prisma.card.findMany({
          where: { projectId: finalProjectId, isActive: true },
          include: { paymentAccount: true, liabilityAccount: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.account.findMany({
          // 카드 부채와 자본 계정은 사용자가 통장으로 인식하지 않으므로 제외한다
          where: {
            projectId: finalProjectId,
            isActive: true,
            type: { notIn: HIDDEN_ACCOUNT_TYPES },
          },
          include: { owner: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.category.findMany({
          // parentId가 null인 것이 대분류다 (level 컬럼은 없앴다)
          where: { projectId: finalProjectId, isActive: true, parentId: null },
          include: {
            children: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.person.findMany({
          where: { projectId: finalProjectId, isActive: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.journalEntry.findMany({
          where: { projectId: finalProjectId },
          include: {
            person: true,
            postings: {
              include: {
                account: true,
                category: true,
                // 카드 행 전체를 실으면 cardNumber 원문이 함께 나간다.
                // 표시에 필요한 것만 고른다 (entry-view의 ENTRY_INCLUDE와 같은 규칙).
                card: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          take: 30,
        }),
        this.prisma.budget.findMany({
          where: { projectId: finalProjectId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    if (!project) {
      throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    }

    return {
      project,
      // 카드 행을 그대로 내보내면 cardNumber 원문이 로그인 응답에 실린다.
      // /cards 목록과 같은 규칙으로 마스킹해서 내보낸다.
      cards: cards.map((card) => toCardResponse(card)),
      accounts,
      categories,
      people,
      recentEntries,
      budgets: budgets || [],
    };
  }
}
