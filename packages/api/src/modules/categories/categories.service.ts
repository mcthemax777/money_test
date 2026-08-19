import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { CategoryDto } from '@money/types';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createCategory(userId: string, dto: CategoryDto.CreateRequest, projectId?: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('카테고리명을 입력해주세요.');
    }

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
    );

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      // 대분류만 부모가 될 수 있다 (parentId가 없는 것이 대분류. level 컬럼은 두지 않는다)
      if (!parent || parent.projectId !== finalProjectId || parent.parentId !== null) {
        throw new BadRequestException('유효한 부모 카테고리가 아닙니다.');
      }
      if (parent.type !== dto.type) {
        throw new BadRequestException('하위 카테고리는 상위 카테고리와 같은 유형이어야 합니다.');
      }
    }

    try {
      return await this.prisma.category.create({
        data: {
          projectId: finalProjectId,
          name: dto.name.trim(),
          parentId: dto.parentId ?? null,
          type: dto.type as CategoryType,
          icon: dto.icon,
          defaultIsFixed: dto.defaultIsFixed ?? false,
        },
      });
    } catch (error) {
      // @@unique([projectId, name, parentId]) 위반은 중복 등록이다.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('이미 존재하는 카테고리입니다.');
      }
      throw error;
    }
  }

  async getCategories(userId: string, type?: 'income' | 'expense', projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.category.findMany({
      where: {
        projectId: finalProjectId,
        isActive: true,
        ...(type ? { type: type as CategoryType } : {}),
      },
      // 대분류(parentId = null)를 먼저, 그다음 이름순
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
  }

  async getCategoryById(id: string, userId: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('카테고리를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, category.projectId);
    return category;
  }

  async updateCategory(id: string, userId: string, dto: CategoryDto.UpdateRequest) {
    await this.getCategoryById(id, userId);

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.defaultIsFixed !== undefined) data.defaultIsFixed = dto.defaultIsFixed;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.category.update({ where: { id }, data });
  }

  async deleteCategory(id: string, userId: string) {
    const category = await this.getCategoryById(id, userId);

    if (category.isDefault) {
      throw new BadRequestException('기본 카테고리는 삭제할 수 없습니다.');
    }

    const isMain = category.parentId === null;

    // 대분류를 지우면 소분류도 함께 지워지므로, 사용 여부는 자신과 자식을 함께 본다.
    const affectedIds = isMain
      ? [
          id,
          ...(
            await this.prisma.category.findMany({
              where: { parentId: id },
              select: { id: true },
            })
          ).map((c) => c.id),
        ]
      : [id];

    const usedCount = await this.prisma.posting.count({
      where: { categoryId: { in: affectedIds } },
    });
    if (usedCount > 0) {
      throw new BadRequestException('이 카테고리가 거래에 사용되어 삭제할 수 없습니다.');
    }

    // 소분류를 개별 update로 돌리던 것을 한 번의 updateMany로 정리
    return this.prisma.$transaction(async (tx) => {
      if (isMain) {
        await tx.category.updateMany({
          where: { parentId: id },
          data: { isActive: false },
        });
      }
      return tx.category.update({ where: { id }, data: { isActive: false } });
    });
  }

  /** 프로젝트 생성 시 기본 카테고리를 한 번에 넣는다 (기존에는 행마다 create 호출). */
  async createDefaultCategories(projectId: string): Promise<void> {
    const defaults: Array<{ type: CategoryType; names: string[] }> = [
      {
        type: CategoryType.income,
        names: ['급여', '상여금', '이자/배당금', '기타수입'],
      },
      {
        type: CategoryType.expense,
        names: [
          '식료품',
          '외식',
          '교통',
          '통신',
          '공과금',
          '교육',
          '의료',
          '쇼핑',
          '엔터테인먼트',
          '저축',
        ],
      },
    ];

    await this.prisma.category.createMany({
      data: defaults.flatMap((group) =>
        group.names.map((name) => ({ projectId, name, type: group.type })),
      ),
      skipDuplicates: true,
    });
  }
}
