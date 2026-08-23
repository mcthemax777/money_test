import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { CategoryDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';

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
      'editor',
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

    /*
     * 새 카테고리는 같은 묶음(대분류끼리, 또는 한 부모 아래 소분류끼리) 맨 뒤에 붙인다.
     * sortOrder를 기본값 0으로 두면 드래그로 0,1,2...를 매긴 목록의 앞쪽에 끼어들고,
     * 드래그 전이라도 전부 0이라 이름순 자리에 들어가 목록 중간에 나타난다.
     */
    const lastOrder = await this.prisma.category.aggregate({
      where: { projectId: finalProjectId, parentId: dto.parentId ?? null },
      _max: { sortOrder: true },
    });

    try {
      return await this.prisma.category.create({
        data: {
          projectId: finalProjectId,
          name: dto.name.trim(),
          parentId: dto.parentId ?? null,
          sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
          type: dto.type as CategoryType,
          icon: dto.icon,
          defaultIsFixed: dto.defaultIsFixed ?? false,
        },
      });
    } catch (error) {
      throw this.translateDuplicate(error);
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
      // 사용자가 드래그로 정한 순서. 같으면 이름 순.
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * 드래그로 바꾼 표시 순서 저장.
   *
   * 대분류끼리, 또는 한 대분류 아래 소분류끼리 보내면 된다. 화면에 보이는 묶음만
   * 다시 매기고 나머지는 그대로 둔다.
   */
  async reorderCategories(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
      'editor',
    );

    const rows = await this.prisma.category.findMany({
      where: { projectId: finalProjectId },
      select: { id: true },
    });
    assertReorderIds(ids, new Set(rows.map((row) => row.id)));

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.category.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.getCategories(userId, undefined, finalProjectId);
  }

  /** 수정·삭제 경로는 requiredRole에 'editor'를 넘긴다. */
  async getCategoryById(id: string, userId: string, requiredRole: ProjectRole = 'viewer') {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('카테고리를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, category.projectId, requiredRole);
    return category;
  }

  async updateCategory(id: string, userId: string, dto: CategoryDto.UpdateRequest) {
    await this.getCategoryById(id, userId, 'editor');

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('카테고리명을 입력해주세요.');
      data.name = name;
    }
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.defaultIsFixed !== undefined) data.defaultIsFixed = dto.defaultIsFixed;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // 이름 변경도 생성과 같은 중복 검사를 받아야 한다. 예전에는 여기만 빠져 있어
    // 이름 충돌이 Prisma 오류 그대로 500이 됐다.
    try {
      return await this.prisma.category.update({ where: { id }, data });
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  /**
   * 이름 중복(P2002)을 사용자용 메시지로 바꾼다.
   *
   * 대분류는 (프로젝트, 유형, 이름), 소분류는 (프로젝트, 이름, 부모)가 유일해야 한다.
   * 그래서 지출 "기타"와 수입 "기타"는 공존할 수 있고, 서로 다른 대분류 아래의
   * 같은 이름 소분류도 공존할 수 있다.
   */
  private translateDuplicate(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new BadRequestException('같은 이름의 카테고리가 이미 있습니다.');
    }
    return error;
  }

  async deleteCategory(id: string, userId: string) {
    const category = await this.getCategoryById(id, userId, 'editor');

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

    // 선언한 순서를 sortOrder에 담는다. 전부 0으로 두면 목록이 이름순으로 보이고,
    // 나중에 추가한 카테고리(최댓값 + 1)와 자리가 어긋난다.
    const rows = defaults.flatMap((group) =>
      group.names.map((name) => ({ projectId, name, type: group.type })),
    );

    await this.prisma.category.createMany({
      data: rows.map((row, index) => ({ ...row, sortOrder: index })),
      skipDuplicates: true,
    });
  }
}
