/**
 * 태그. 거래에 자유롭게 붙이는 이름표다.
 *
 * 카테고리 서비스와 나란히 서지만 훨씬 짧다 -- 계층도 유형도 없어서 부모를 검사할
 * 일도, 지출/수입을 갈라 셀 일도 없다. 유일 조건도 (프로젝트, 이름) 하나뿐이다.
 *
 * 지우기는 카테고리와 다르다. 카테고리는 거래에 쓰이고 있으면 막지만(그 거래의 분류가
 * 사라지면 합계가 갈 곳을 잃는다), 태그는 떼어 내도 거래가 온전하다. 그래서 쓰이고
 * 있어도 지울 수 있고, 붙어 있던 연결은 함께 사라진다.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { TagDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { badRequest } from '@/common/app-error';
import { clientId } from '@/common/client-id';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createTag(userId: string, dto: TagDto.CreateRequest, projectId?: string) {
    const name = dto.name?.trim();
    if (!name) throw badRequest('TAG_NAME_REQUIRED', '태그명을 입력해주세요.');

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
      'editor',
    );

    /*
     * 새 태그는 목록 맨 뒤에 붙인다. sortOrder 를 0으로 두면 드래그로 0,1,2...를 매긴
     * 목록의 앞쪽에 끼어든다 (카테고리와 같은 이유).
     */
    const last = await this.prisma.tag.aggregate({
      where: { projectId: finalProjectId },
      _max: { sortOrder: true },
    });

    try {
      return await this.prisma.tag.create({
        data: {
          id: clientId(dto.id, '태그 식별자'),
          projectId: finalProjectId,
          name,
          color: dto.color ?? null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  async getTags(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.tag.findMany({
      where: { projectId: finalProjectId, isActive: true },
      // 사용자가 드래그로 정한 순서. 같으면 이름 순.
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** 수정·삭제 경로는 requiredRole에 'editor'를 넘긴다. */
  async getTagById(id: string, userId: string, requiredRole: ProjectRole = 'viewer') {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('태그를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, tag.projectId, requiredRole);
    return tag;
  }

  async updateTag(id: string, userId: string, dto: TagDto.UpdateRequest) {
    await this.getTagById(id, userId, 'editor');

    const data: Prisma.TagUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw badRequest('TAG_NAME_REQUIRED', '태그명을 입력해주세요.');
      data.name = name;
    }
    // null 은 "색을 지운다"이고 undefined 는 "건드리지 않는다"다. 둘을 가른다.
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      return await this.prisma.tag.update({ where: { id }, data });
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  /** 드래그로 바꾼 표시 순서 저장. 목록이 평평해서 한 묶음뿐이다. */
  async reorderTags(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
      'editor',
    );

    const rows = await this.prisma.tag.findMany({
      where: { projectId: finalProjectId },
      select: { id: true },
    });
    assertReorderIds(ids, new Set(rows.map((row) => row.id)));

    await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.tag.update({ where: { id }, data: { sortOrder: index } })),
    );

    return this.getTags(userId, finalProjectId);
  }

  /**
   * 지우기. 쓰이고 있어도 막지 않는다.
   *
   * 카테고리는 거래에 쓰이면 막는다 -- 분류가 사라지면 그 거래의 금액이 어느 합계에도
   * 들지 못한다. 태그는 그렇지 않다. 떼어 내도 거래는 온전하고 카테고리 합계도 그대로다.
   * 막아 두면 오래된 태그를 영영 정리하지 못한다.
   *
   * 카테고리처럼 `isActive` 를 내려 감춘다. 연결(EntryTag)은 그대로 두어, 잘못 지웠을 때
   * 다시 켜면 붙어 있던 거래가 함께 돌아온다.
   */
  async deleteTag(id: string, userId: string) {
    await this.getTagById(id, userId, 'editor');
    return this.prisma.tag.update({ where: { id }, data: { isActive: false } });
  }

  /** 이름 중복(P2002)을 사용자용 메시지로 바꾼다. */
  private translateDuplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return badRequest('TAG_NAME_DUPLICATE', '같은 이름의 태그가 이미 있습니다.');
    }
    return error;
  }
}
