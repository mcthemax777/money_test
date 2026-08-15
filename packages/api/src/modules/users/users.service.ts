import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ProjectAccessService } from '../../common/project-access.guard';

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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
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

    const [project, cards, accounts, categories, people, recentTransactions, budgets] =
      await Promise.all([
        this.prisma.project.findUnique({
          where: { id: finalProjectId },
          select: { id: true, name: true, description: true },
        }),
        this.prisma.card.findMany({
          where: { projectId: finalProjectId, userId, isActive: true },
          include: { account: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.account.findMany({
          where: { projectId: finalProjectId, userId, isActive: true },
          include: { owner: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.category.findMany({
          where: { projectId: finalProjectId, userId, isActive: true, level: 1 },
          include: {
            children: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.person.findMany({
          where: { projectId: finalProjectId, userId, isActive: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.transaction.findMany({
          where: { projectId: finalProjectId, userId },
          include: {
            account: true,
            person: true,
            mainCategory: true,
            subCategory: true,
          },
          orderBy: { date: 'desc' },
          take: 30,
        }),
        this.prisma.budget.findMany({
          where: { projectId: finalProjectId, userId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    if (!project) {
      throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    }

    return {
      project,
      cards,
      accounts,
      categories,
      people,
      recentTransactions,
      budgets: budgets || [],
    };
  }
}
