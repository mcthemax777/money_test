import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { CategoryDto } from '@money/types';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserDefaultProjectId(userId: string): Promise<string> {
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, role: 'owner' },
      select: { projectId: true },
    });

    if (!member) {
      throw new BadRequestException('기본 프로젝트를 찾을 수 없습니다.');
    }

    return member.projectId;
  }

  async createCategory(
    userId: string,
    dto: CategoryDto.CreateRequest,
  ): Promise<CategoryDto.Response> {
    const projectId = await this.getUserDefaultProjectId(userId);

    // 소분류인 경우 부모 카테고리 확인
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });

      if (!parent || parent.userId !== userId || parent.level !== 1) {
        throw new BadRequestException('유효한 부모 카테고리가 아닙니다.');
      }

      // 하위 카테고리는 부모 카테고리와 같은 유형이어야 함
      if (parent.type !== dto.type) {
        throw new BadRequestException('하위 카테고리는 상위 카테고리와 같은 유형이어야 합니다.');
      }
    }

    // 같은 레벨에서 이름 중복 확인
    const existingCategory = await this.prisma.category.findFirst({
      where: {
        projectId,
        userId,
        name: dto.name,
        parentId: dto.parentId || null,
      },
    });

    if (existingCategory) {
      throw new BadRequestException('이미 존재하는 카테고리입니다.');
    }

    const level = dto.parentId ? 2 : 1;

    return this.prisma.category.create({
      data: {
        projectId,
        userId,
        name: dto.name,
        parentId: dto.parentId,
        level,
        type: dto.type,
        icon: dto.icon,
        color: dto.color,
      },
    });
  }

  async getCategories(userId: string, type?: 'income' | 'expense', projectId?: string): Promise<CategoryDto.Response[]> {
    const finalProjectId = projectId || (await this.getUserDefaultProjectId(userId));
    const where: any = { userId, projectId: finalProjectId, isActive: true };
    if (type) where.type = type;

    const categories = await this.prisma.category.findMany({
      where,
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });

    return categories;
  }

  async getCategoryById(id: string, userId: string): Promise<CategoryDto.Response> {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category || category.userId !== userId) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }

    return category;
  }

  async updateCategory(
    id: string,
    userId: string,
    dto: CategoryDto.UpdateRequest,
  ): Promise<CategoryDto.Response> {
    await this.getCategoryById(id, userId);

    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  async deleteCategory(id: string, userId: string): Promise<CategoryDto.Response> {
    const category = await this.getCategoryById(id, userId);

    // 대분류인 경우 소분류도 함께 삭제
    if (category.level === 1) {
      const children = await this.prisma.category.findMany({
        where: { parentId: id },
      });

      for (const child of children) {
        await this.prisma.category.update({
          where: { id: child.id },
          data: { isActive: false },
        });
      }

      // 대분류가 거래에 사용되는지만 확인
      const transactionCount = await this.prisma.transaction.count({
        where: {
          mainCategoryId: id,
          userId,
        },
      });

      if (transactionCount > 0) {
        throw new BadRequestException('이 카테고리가 거래에 사용되어 삭제할 수 없습니다.');
      }
    } else {
      // 소분류는 거래 사용 여부 확인
      const transactionCount = await this.prisma.transaction.count({
        where: {
          subCategoryId: id,
          userId,
        },
      });

      if (transactionCount > 0) {
        throw new BadRequestException('이 카테고리가 거래에 사용되어 삭제할 수 없습니다.');
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // 기본 카테고리 생성 (사용자 가입 시 자동)
  async createDefaultCategories(userId: string, projectId: string): Promise<void> {
    const defaultCategories = [
      {
        type: 'income',
        main: ['급여', '상여금', '이자/배당금', '기타수입'],
      },
      {
        type: 'expense',
        main: [
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

    for (const category of defaultCategories) {
      for (const name of category.main) {
        await this.prisma.category.create({
          data: {
            projectId,
            userId,
            name,
            type: category.type,
            level: 1,
          },
        });
      }
    }
  }
}
