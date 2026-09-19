/**
 * 태그. 거래에 자유롭게 붙이는 이름표다.
 *
 * 카테고리 서비스와 나란히 서지만 훨씬 짧다 -- 계층도 유형도 없어서 부모를 검사할
 * 일도, 지출/수입을 갈라 셀 일도 없다. 유일 조건도 (프로젝트, 이름) 하나뿐이다.
 *
 * 지우기는 카테고리와 다르다. 카테고리는 거래에 쓰이고 있으면 막지만(그 거래의 분류가
 * 사라지면 합계가 갈 곳을 잃는다), 태그는 떼어 내도 거래가 온전하다. 그래서 쓰이고
 * 있어도 지울 수 있다.
 *
 * **없앨 때 붙어 있던 자리를 남기지 않는다.** 예전에는 `isActive` 만 내리고 연결은
 * 두었는데(되살리면 함께 돌아오라고), 그러면 목록에 없는 태그가 지난 거래에 그대로
 * 남아 "지웠는데 아직 보인다"가 된다. 지금은 두 길뿐이다 -- 다른 태그로 **옮기거나**
 * (`mergeTags`), 전부 **떼고 지운다**(`deleteTag`). 무엇을 할지는 화면이 묻는다.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import {
  TagDto,
  initialRanks,
  rankAfter,
} from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { badRequest } from '@/common/app-error';
import { clientId } from '@/common/client-id';
import { stampFieldClocks } from '@/common/field-clock';
import { lockLedgerWrites } from '@/common/ledger-lock';
import { ServerClockService } from '@/common/server-clock';

/** 트랜잭션 안의 프리즈마. 떼어내기와 옮기기가 같은 손잡이를 쓴다. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly clock: ServerClockService,
  ) {}

  /** `hlc` 는 기기의 오프라인 명령을 재생할 때만 온다. */
  async createTag(userId: string, dto: TagDto.CreateRequest, projectId?: string, hlc?: string) {
    const name = dto.name?.trim();
    if (!name) throw badRequest('TAG_NAME_REQUIRED', '태그명을 입력해주세요.');

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
      'editor',
    );

    /*
     * 새 태그는 목록 맨 뒤에 붙인다. 비워 두면 드래그로 매긴
     * 목록의 앞쪽에 끼어든다 (카테고리와 같은 이유).
     */
    const last = await this.prisma.tag.aggregate({
      where: { projectId: finalProjectId },
      _max: { sortRank: true },
    });

    try {
      return await this.prisma.tag.create({
        data: {
          id: clientId(dto.id, '태그 식별자'),
          projectId: finalProjectId,
          name,
          color: dto.color ?? null,
          sortRank: rankAfter(last._max.sortRank),
          fieldHlc: stampFieldClocks(null, ['name', 'color'], hlc ?? this.clock.now()),
        },
      });
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  async getTags(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.tag.findMany({
      where: { projectId: finalProjectId },
      // 사용자가 드래그로 정한 순서. 같으면 이름 순.
      orderBy: [{ sortRank: 'asc' }, { name: 'asc' }],
    });
  }

  /** 수정·삭제 경로는 requiredRole에 'editor'를 넘긴다. */
  async getTagById(id: string, userId: string, requiredRole: ProjectRole = 'viewer') {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('태그를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, tag.projectId, requiredRole);
    return tag;
  }

  async updateTag(id: string, userId: string, dto: TagDto.UpdateRequest, hlc?: string) {
    const tag = await this.getTagById(id, userId, 'editor');

    const data: Prisma.TagUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw badRequest('TAG_NAME_REQUIRED', '태그명을 입력해주세요.');
      data.name = name;
    }
    // null 은 "색을 지운다"이고 undefined 는 "건드리지 않는다"다. 둘을 가른다.
    if (dto.color !== undefined) data.color = dto.color;
    // 순서 바꾸기는 이 필드 하나다 (분수 색인).
    if (dto.sortRank !== undefined) data.sortRank = dto.sortRank;

    data.fieldHlc = stampFieldClocks(tag.fieldHlc, Object.keys(data), hlc ?? this.clock.now());

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

    // 목록 전체를 받았으니 순서 값을 고르게 다시 매긴다 (자산·분류와 같은 규칙).
    const ranks = initialRanks(ids.length);
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.tag.update({ where: { id }, data: { sortRank: ranks[index] } }),
      ),
    );

    return this.getTags(userId, finalProjectId);
  }

  /**
   * 이 태그가 붙어 있는 자리의 수.
   *
   * 없애기 전에 묻는 데 쓴다. 분류의 `getCategoryUsage` 와 같은 자리인데, 세는 곳이
   * 셋이다 -- 거래 줄, 보관함 후보, 반복 등록. 뒤의 둘을 빼놓으면 "붙은 데가 없다"로
   * 읽고 그냥 지우게 되고, 그러면 **없는 태그를 붙이려는 반복**이 남는다.
   */
  async getTagUsage(id: string, userId: string): Promise<TagDto.UsageResponse> {
    await this.getTagById(id, userId);

    const [entries, drafts, rules] = await Promise.all([
      this.prisma.entryTag.count({ where: { tagId: id } }),
      this.prisma.entryDraftTag.count({ where: { tagId: id } }),
      this.prisma.recurringRuleTag.count({ where: { tagId: id } }),
    ]);
    return { entries, drafts, rules };
  }

  /**
   * 태그를 없애면서 붙어 있던 자리를 다른 태그로 옮긴다.
   *
   * 분류의 `mergeCategories` 와 같은 뜻이다. 다른 것은 줄이 하나라는 것뿐이다 --
   * 태그에는 계층이 없어 함께 사라지는 것이 없다.
   *
   * **사본(오프라인)에는 이 길이 없다.** 분류의 통합과 같은 선례다. 옮기기는 한 번
   * 정리하려고 누르는 것이라 연결이 닿을 때까지 미뤄도 되고, 명령으로 쌓아 두면 기기마다
   * 다른 차례로 재생되어 어느 태그가 살아남는지가 흔들린다.
   */
  async mergeTags(
    userId: string,
    dto: TagDto.MergeRequest,
    projectId?: string,
  ): Promise<TagDto.MergeResponse> {
    const fromId = dto.fromId;
    const toId = dto.toId;
    if (!fromId || !toId) {
      throw badRequest('TAG_MERGE_TARGET_REQUIRED', '옮길 태그를 골라 주세요.');
    }
    /*
     * 자기 자신으로는 옮길 수 없다.
     *
     * 옮기고 나서 지우므로, 그대로 두면 옮긴 자리가 곧바로 사라진 태그를 가리킨다.
     */
    if (fromId === toId) {
      throw badRequest('TAG_MERGE_INTO_REMOVED', '없애는 태그로는 옮길 수 없습니다.');
    }

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
      'editor',
    );

    const rows = await this.prisma.tag.findMany({
      where: { id: { in: [fromId, toId] }, projectId: finalProjectId },
    });
    if (rows.length !== 2) throw new NotFoundException('태그를 찾을 수 없습니다.');

    /*
     * 옮기기와 지우기를 한 트랜잭션에 넣고 원장 쓰기를 먼저 줄 세운다.
     * 밖에서 하면 옮긴 뒤 지우기 전에 그 태그가 붙은 거래가 하나 들어온다
     * (분류의 `mergeCategories` 와 같은 까닭이다).
     */
    return this.prisma.$transaction(async (tx) => {
      await lockLedgerWrites(tx, finalProjectId);

      const moved = await this.moveLinks(tx, fromId, toId);
      await tx.tag.delete({ where: { id: fromId } });
      return moved;
    });
  }

  /**
   * 지우기. 쓰이고 있어도 막지 않는다.
   *
   * 카테고리는 거래에 쓰이면 막는다 -- 분류가 사라지면 그 거래의 금액이 어느 합계에도
   * 들지 못한다. 태그는 그렇지 않다. 떼어 내도 거래는 온전하고 카테고리 합계도 그대로다.
   * 막아 두면 오래된 태그를 영영 정리하지 못한다.
   *
   * **붙어 있던 자리를 전부 떼고 행을 지운다.** 예전에는 연결을 남기고 `isActive` 만
   * 내렸다 -- 잘못 지웠을 때 다시 켜면 함께 돌아오라고. 그런데 그러면 목록에서 고를 수
   * 없는 이름이 지난 거래에 그대로 보여 "지웠는데 아직 있다"가 되고, 그 줄이 이름을
   * 붙들고 있어 같은 이름을 다시 만들 수도 없었다. 옮기고 싶으면 `mergeTags` 가 있다.
   *
   * `hlc` 는 기기의 오프라인 명령을 재생할 때만 온다. 지우기에는 쓸 자리가 없다 --
   * 필드별 시계는 남는 행의 것이고, 이 행은 남지 않는다. 자리표가 그 일을 대신한다.
   */
  async deleteTag(id: string, userId: string, _hlc?: string) {
    const tag = await this.getTagById(id, userId, 'editor');

    return this.prisma.$transaction(async (tx) => {
      await lockLedgerWrites(tx, tag.projectId);

      await this.dropLinks(tx, id);
      return tx.tag.delete({ where: { id } });
    });
  }

  /**
   * 한 태그의 연결을 다른 태그로 옮긴다.
   *
   * **이미 옮길 태그가 붙어 있는 자리는 옮기지 않고 지운다.** 그대로 옮기면 한 줄에
   * 같은 태그가 둘이 되어 유일 제약에 걸린다. 결과는 사람이 바라는 것과 같다 -- 그
   * 자리에는 옮길 태그가 이미 있다.
   */
  private async moveLinks(tx: Tx, fromId: string, toId: string): Promise<TagDto.MergeResponse> {
    const mine = await tx.entryTag.findMany({ where: { tagId: fromId } });
    const theirs = await tx.entryTag.findMany({
      where: { tagId: toId },
      select: { entryId: true, lineKey: true },
    });

    // 줄은 (거래, 줄 키) 로 가리킨다. 줄 키가 없는 것은 분류 줄이 없는 전표다(이체 등).
    const lineOf = (row: { entryId: string; lineKey: string | null }) =>
      `${row.entryId}:${row.lineKey ?? ''}`;
    const taken = new Set(theirs.map(lineOf));
    const duplicated = mine.filter((row) => taken.has(lineOf(row)));

    if (duplicated.length > 0) {
      await tx.entryTag.deleteMany({ where: { id: { in: duplicated.map((row) => row.id) } } });
    }
    await tx.entryTag.updateMany({ where: { tagId: fromId }, data: { tagId: toId } });

    /*
     * 후보와 반복은 복합 기본키(주인, 태그)라 `updateMany` 로 태그만 바꿀 수 없다 --
     * 이미 옮길 태그가 붙어 있으면 그 자리에서 부딪힌다. 지우고 다시 넣는다.
     */
    const draftLinks = await tx.entryDraftTag.findMany({ where: { tagId: fromId } });
    const draftTaken = new Set(
      (
        await tx.entryDraftTag.findMany({ where: { tagId: toId }, select: { draftId: true } })
      ).map((row) => row.draftId),
    );
    const movedDrafts = draftLinks.filter((row) => !draftTaken.has(row.draftId));
    await tx.entryDraftTag.deleteMany({ where: { tagId: fromId } });
    if (movedDrafts.length > 0) {
      await tx.entryDraftTag.createMany({
        data: movedDrafts.map((row) => ({ draftId: row.draftId, tagId: toId })),
      });
    }

    const ruleLinks = await tx.recurringRuleTag.findMany({ where: { tagId: fromId } });
    const ruleTaken = new Set(
      (
        await tx.recurringRuleTag.findMany({ where: { tagId: toId }, select: { ruleId: true } })
      ).map((row) => row.ruleId),
    );
    const movedRules = ruleLinks.filter((row) => !ruleTaken.has(row.ruleId));
    await tx.recurringRuleTag.deleteMany({ where: { tagId: fromId } });
    if (movedRules.length > 0) {
      await tx.recurringRuleTag.createMany({
        data: movedRules.map((row) => ({ ruleId: row.ruleId, tagId: toId })),
      });
    }

    await this.stampOwners(
      tx,
      mine.map((row) => row.entryId),
      draftLinks.map((row) => row.draftId),
    );

    return {
      movedEntries: mine.length - duplicated.length,
      movedDrafts: movedDrafts.length,
      movedRules: movedRules.length,
    };
  }

  /** 그 태그의 연결을 전부 뗀다. 달려 있던 전표와 후보에는 도장을 찍는다. */
  private async dropLinks(tx: Tx, tagId: string): Promise<void> {
    const entryLinks = await tx.entryTag.findMany({
      where: { tagId },
      select: { entryId: true },
    });
    const draftLinks = await tx.entryDraftTag.findMany({
      where: { tagId },
      select: { draftId: true },
    });

    await tx.entryTag.deleteMany({ where: { tagId } });
    await tx.entryDraftTag.deleteMany({ where: { tagId } });
    await tx.recurringRuleTag.deleteMany({ where: { tagId } });

    await this.stampOwners(
      tx,
      entryLinks.map((row) => row.entryId),
      draftLinks.map((row) => row.draftId),
    );
  }

  /**
   * 태그가 바뀐 전표와 후보에 도장을 찍는다.
   *
   * **이것이 없으면 기기가 영영 모른다.** 연결 표(EntryTag·EntryDraftTag)에는 변경
   * 번호가 없다 -- 태그 연결은 주인에 실려 움직이고, 연결이 바뀌는 자리에서 주인에
   * 도장이 찍히기 때문이다(스키마의 EntryTag 주석). 여기서는 연결만 건드리므로 그
   * 도장을 손으로 찍는다.
   *
   * 반복 등록은 세지 않는다. 그 표는 기기 사본에 두지 않고 서버에서 곧바로 읽는다.
   *
   * `updatedAt` 만 건드린다. 번호는 그 행의 도장 트리거(sync_stamp)가 발급기를 거쳐
   * 찍는다 -- 손으로 넣으면 다른 쓰기와 순서가 어긋난다.
   */
  private async stampOwners(tx: Tx, entryIds: string[], draftIds: string[]): Promise<void> {
    const entries = [...new Set(entryIds)];
    const drafts = [...new Set(draftIds)];
    const now = new Date();

    if (entries.length > 0) {
      await tx.journalEntry.updateMany({
        where: { id: { in: entries } },
        data: { updatedAt: now },
      });
    }
    if (drafts.length > 0) {
      await tx.entryDraft.updateMany({ where: { id: { in: drafts } }, data: { updatedAt: now } });
    }
  }

  /** 이름 중복(P2002)을 사용자용 메시지로 바꾼다. */
  private translateDuplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return badRequest('TAG_NAME_DUPLICATE', '같은 이름의 태그가 이미 있습니다.');
    }
    return error;
  }
}
