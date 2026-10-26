/**
 * 분류·태그 명령의 재생 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 만들기는 같은 이름이 있으면 그 행을 채택하고 별칭을 돌려준다. 고치기는 자산과 같은
 * 필드별 병합이고, `isActive: false` 는 "지워 달라"는 표식이다. 통합은 온라인과 같은 서비스다.
 * Nest 공급자가 아니라 재생 서비스가 자기 의존성으로 만들어 쓴다 (mutation-claim.ts 머리말).
 */
import {
  type CategoryCreatePayload,
  type CategoryMergePayload,
  type CategoryUpdatePayload,
  type Mutation,
  type MutationResult,
  type TagCreatePayload,
  type TagMergePayload,
  type TagUpdatePayload,
  mergeFields,
} from '@money/types';
import type { PrismaService } from '@/config/prisma.service';
import { readFieldClocks } from '@/common/field-clock';
import type { CategoriesService } from '../categories/categories.service';
import type { TagsService } from '../tags/tags.service';
import { allFieldsLost, appliedResult, sameOrForeign, targetNotFound } from './mutation-results';

export class CatalogMutations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
  ) {}

  /**
   * 분류 만들기.
   *
   * **같은 이름이 이미 있으면 그 행을 채택한다.** 두 사람이 오프라인에서 같은 분류를
   * 만드는 일은 흔하고, 그것을 오류로 두면 그 명령이 영원히 막힌다. 대신 서버가 채택한
   * id 를 별칭으로 돌려주고, 기기가 자기 사본과 큐의 참조를 그 id 로 옮긴다 (D 별칭).
   */
  async createCategory(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CategoryCreatePayload;

    const existing = await this.prisma.category.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '분류');

    const findSameName = () =>
      this.prisma.category.findFirst({
        where: {
          projectId,
          name: payload.name.trim(),
          parentId: payload.parentId ?? null,
          type: payload.type as never,
        },
        select: { id: true },
      });

    return this.createOrAdopt(mutation, projectId, payload.id, findSameName, () =>
      this.categories.createCategory(
        userId,
        {
          id: payload.id,
          name: payload.name,
          type: payload.type,
          parentId: payload.parentId ?? undefined,
          icon: payload.icon ?? undefined,
        } as never,
        projectId,
        mutation.hlc,
      ),
    );
  }

  async updateCategory(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CategoryUpdatePayload;

    const category = await this.prisma.category.findUnique({ where: { id: payload.id } });
    if (!category || category.projectId !== projectId) return targetNotFound(mutation, '분류');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(category.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    /*
     * 지우기는 따로 부른다. 자산 셋과 같은 규칙이다 (D11).
     *
     * `isActive: false` 는 끊긴 기기가 "지워 달라"고 적어 보내는 표식이다 -- 설정 명령에
     * 지우기 갈래가 따로 없어 이 칸을 쓴다. 선행조건(이 분류를 쓰는 거래가 없을 것)이 그
     * 함수 안에 있고, 그것을 건너뛰면 `Posting.categoryId` 가 cascade 라 그 거래의 다리가
     * 함께 사라진다. 대분류를 지울 때 소분류가 함께 가는 것도 그쪽 규칙이다.
     *
     * 되살리기(`isActive: true`)는 받지 않는다. 지운 행은 남아 있지 않다.
     */
    const { isActive, ...rest } = merged.apply as CategoryUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.categories.updateCategory(payload.id, userId, rest as never, mutation.hlc);
    }
    if (isActive === false) await this.categories.deleteCategory(payload.id, userId, mutation.hlc);

    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 분류 통합. 온라인과 같은 서비스라 같은 검사를 재생 시점에 다시 한다 -- 끊긴 동안 옮겨 받을
   * 분류가 사라졌으면 거절되어 보류 칸으로 간다. 이미 없앤 분류만 남은 재전송이면(모두 사라짐)
   * 서비스가 찾지 못해 거절하므로, 없앨 분류가 하나도 없으면 끝난 것으로 본다.
   */
  async mergeCategories(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CategoryMergePayload;
    const fromIds = payload.moves.map((move) => move.fromId);
    const alive = await this.prisma.category.count({ where: { id: { in: fromIds }, projectId } });
    if (alive === 0) return appliedResult(this.prisma, mutation, projectId);
    await this.categories.mergeCategories(
      userId,
      { moves: payload.moves.map((move) => ({ fromId: move.fromId, ...(move.toId ? { toId: move.toId } : {}) })) },
      projectId,
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  /** 태그 만들기. 이름이 겹치면 분류와 같은 규칙으로 기존 행을 채택한다. */
  async createTag(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as TagCreatePayload;

    const existing = await this.prisma.tag.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '태그');

    const findSameName = () =>
      this.prisma.tag.findFirst({
        where: { projectId, name: payload.name.trim() },
        select: { id: true },
      });

    return this.createOrAdopt(mutation, projectId, payload.id, findSameName, () =>
      this.tags.createTag(
        userId,
        { id: payload.id, name: payload.name, color: payload.color ?? undefined } as never,
        projectId,
        mutation.hlc,
      ),
    );
  }

  async updateTag(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as TagUpdatePayload;

    const tag = await this.prisma.tag.findUnique({ where: { id: payload.id } });
    if (!tag || tag.projectId !== projectId) return targetNotFound(mutation, '태그');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(tag.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    /*
     * `isActive: false` 는 분류와 같이 "지워 달라"는 표식이다.
     *
     * 태그의 지우기에는 선행조건이 없다 -- 붙어 있던 자리를 전부 떼고 지운다. 떼어 내도
     * 거래는 온전하고 분류별 합계도 그대로다. 되살리기는 받지 않는다.
     */
    const { isActive, ...rest } = merged.apply as TagUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.tags.updateTag(payload.id, userId, rest as never, mutation.hlc);
    }
    if (isActive === false) await this.tags.deleteTag(payload.id, userId, mutation.hlc);

    return appliedResult(this.prisma, mutation, projectId);
  }

  /** 태그 통합. 없앨 태그가 이미 없으면 끝난 것으로 본다 (분류 통합과 같은 까닭). */
  async mergeTags(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as TagMergePayload;
    const from = await this.prisma.tag.findUnique({ where: { id: payload.id } });
    if (!from) return appliedResult(this.prisma, mutation, projectId);
    if (from.projectId !== projectId) return targetNotFound(mutation, '태그');
    await this.tags.mergeTags(userId, { fromId: payload.id, toId: payload.toId }, projectId);
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 같은 이름의 행이 있으면 그것을 채택하고(별칭), 없으면 만든다. 분류와 태그가 함께 쓴다.
   *
   * 만들기가 실패하면 한 번 더 찾는다. 이름을 본 뒤 만들기 전에 다른 기기가 같은 이름을 먼저 만들면
   * 유일성 제약에 걸리는데, 예전에는 그것이 거절이 되어 그 id 를 쓰는 거래들까지 함께 거절됐다.
   */
  private async createOrAdopt(
    mutation: Mutation,
    projectId: string,
    id: string,
    findSameName: () => Promise<{ id: string } | null>,
    create: () => Promise<unknown>,
  ): Promise<MutationResult> {
    const adopt = async (): Promise<MutationResult | null> => {
      const sameName = await findSameName();
      if (!sameName) return null;
      return {
        ...(await appliedResult(this.prisma, mutation, projectId)),
        alias: { from: id, to: sameName.id },
      };
    };

    const adopted = await adopt();
    if (adopted) return adopted;
    try {
      await create();
    } catch (error) {
      const late = await adopt();
      if (late) return late;
      throw error;
    }
    return appliedResult(this.prisma, mutation, projectId);
  }
}
