/**
 * 기기가 보낸 명령을 재생하는 곳.
 *
 * **온라인 요청과 똑같은 도메인 서비스로 흘려보낸다**(설계 문서의 D3). 행을 그대로 밀어
 * 넣으면 전표의 균형 검증과 잔액 반영을 우회하는데, 그 두 가지가 이 가계부에서 조용히
 * 틀리는 자리다. 그래서 여기서는 명령을 EntriesService 가 받는 모양으로 되돌릴 뿐
 * 새 쓰기 경로를 만들지 않는다.
 *
 * 세 가지가 이 파일의 책임이다.
 *
 *   1. **멱등.** 같은 명령이 두 번 와도 한 번만 적힌다. 응답을 못 받은 기기는 반드시
 *      다시 보내고, 그때 서버가 적용했는지 기기는 알 수 없다.
 *      멱등은 **행을 먼저 잡는 방식**으로 지킨다. 조회한 뒤 재생하고 마지막에 기록하면,
 *      같은 명령이 동시에 두 번 도착했을 때 둘 다 "본 적 없다"로 읽는다. 인스턴스가
 *      하나일 때도 가능한 일이고 여럿이면 흔해진다.
 *   2. **순서.** 한 기기의 명령은 clientSeq 순서로만 적용한다.
 *   3. **의존.** 어떤 명령이 거절되면 **그 대상을 건드리는 뒤 명령만** 함께 보류한다.
 *      전표를 만든 명령이 거절되었는데 그것을 고치는 명령이 뒤따라 적용되면, 없는
 *      전표를 고치려다 실패하거나 더 나쁘게는 다른 전표에 적용된다.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  type AccountCreatePayload,
  type BudgetOverridePayload,
  type BudgetSetPayload,
  type CategoryCreatePayload,
  type CategoryUpdatePayload,
  type TagCreatePayload,
  type TagUpdatePayload,
  type AccountUpdatePayload,
  type CardCreatePayload,
  type CardUpdatePayload,
  type EntryDeletePayload,
  type EntryMutationPayload,
  type EntryTagsPayload,
  type Mutation,
  type MutationResult,
  type PersonCreatePayload,
  type PersonUpdatePayload,
  type PushRequest,
  type PushResponse,
  encodeHlc,
  hlcNext,
  isAfterHlc,
  isBlockedBy,
  mergeFields,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { readFieldClocks } from '@/common/field-clock';
import { LedgerService } from '../ledger/ledger.service';
import { EntriesService } from '../entries/entries.service';
import { PeopleService } from '../people/people.service';
import { AccountsService } from '../accounts/accounts.service';
import { CardsService } from '../cards/cards.service';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';
import { BudgetsService } from '../budgets/budgets.service';

/** 한 번에 받는 명령 수. 일주일치를 한 요청에 밀면 끊긴다. */
const MAX_MUTATIONS = 200;

/**
 * 잡아 둔 명령을 죽은 것으로 보기까지의 시간.
 *
 * 재생 하나는 전표 한 건을 쓰는 트랜잭션이라 길어야 수백 밀리초다. 1분이 지나도록
 * 결과가 없다면 잡은 프로세스가 죽었다고 본다. 짧게 잡으면 느린 요청을 두 번 재생하고,
 * 길게 잡으면 죽은 뒤에 그 명령이 그만큼 오래 묶인다. 재생 자체가 멱등하므로
 * (전표 id 로 한 번 더 걸러진다) 짧은 쪽보다 안전한 쪽으로 1분을 둔다.
 */
const CLAIM_TIMEOUT_MS = 60_000;

/** 잡기의 결과. */
type Claim =
  /** 내가 잡았다. 재생해도 된다. */
  | { kind: 'owned' }
  /** 다른 요청이 잡고 있다. 아직 결과를 모른다. */
  | { kind: 'running' }
  /** 이미 판정이 끝났다. 그때 돌려준 결과를 그대로 쓴다. */
  | { kind: 'settled'; result: MutationResult }
  /** 같은 (기기, 순번)을 다른 명령이 이미 썼다. */
  | { kind: 'seqTaken' };

@Injectable()
export class MutationReplayService {
  private readonly logger = new Logger(MutationReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
    private readonly entries: EntriesService,
    private readonly people: PeopleService,
    private readonly accounts: AccountsService,
    private readonly cards: CardsService,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
    private readonly budgets: BudgetsService,
  ) {}

  async push(
    userId: string,
    request: PushRequest,
    projectIdParam?: string,
  ): Promise<PushResponse> {
    /*
     * 권한은 재생 시점에 다시 본다 (D10).
     *
     * editor 였을 때 큐에 넣은 명령이 viewer 로 바뀐 뒤 도착할 수 있다. 그때는 전부
     * 거절되고, 기기가 그것을 보류 칸에 남겨 사용자에게 알린다.
     */
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || request.projectId,
      'editor',
    );

    const mutations = [...(request.mutations ?? [])]
      .slice(0, MAX_MUTATIONS)
      // 한 기기가 보낸 명령은 언제나 이 순서로 적용한다.
      .sort((a, b) => a.clientSeq - b.clientSeq);

    const results: MutationResult[] = [];
    /** 앞에서 거절된 대상. 이것을 건드리는 뒤 명령은 서버까지 가지 않는다. */
    const blocked = new Set<string>();
    /**
     * 앞에서 판정이 나지 않은 대상.
     *
     * 거절과 갈라 두는 이유는 사용자에게 보일 것이 다르기 때문이다. 거절된 대상을
     * 건드리는 명령은 보류 칸으로 올려 사람이 고르게 하고, 판정이 나지 않은 대상은
     * 큐에 그대로 두어 다음 동기화가 다시 보내게 한다.
     */
    const deferred = new Set<string>();

    for (const mutation of mutations) {
      if (isBlockedBy(mutation, deferred)) {
        results.push({
          mutationId: mutation.mutationId,
          status: 'deferred',
          error: '앞선 명령의 결과를 아직 알 수 없어 함께 미뤘습니다.',
        });
        mutation.targets.forEach((target) => deferred.add(target));
        continue;
      }

      if (isBlockedBy(mutation, blocked)) {
        results.push({
          mutationId: mutation.mutationId,
          status: 'blocked',
          error: '앞선 명령이 처리되지 않아 함께 미뤘습니다.',
        });
        mutation.targets.forEach((target) => blocked.add(target));
        continue;
      }

      const result = await this.applyOne(userId, projectId, request.clientId, mutation);
      results.push(result);

      /*
       * 거절만 뒤를 막는다. 충돌은 막지 않는다.
       *
       * 충돌은 "대상이 있는데 더 늦은 편집이 이겼다"는 뜻이라 뒤 명령이 가리킬 전표가
       * 그대로 있다. 오히려 뒤 명령은 그 늦은 편집보다 더 늦은 시계를 달고 있어 이길 수
       * 있다. 여기서 막으면 사용자의 가장 최근 편집이 사라진다.
       */
      if (result.status === 'rejected') {
        mutation.targets.forEach((target) => blocked.add(target));
      }

      // 다른 요청이 재생 중이면 이 전표의 지금 상태를 알 수 없다. 뒤 명령도 미룬다.
      if (result.status === 'deferred') {
        mutation.targets.forEach((target) => deferred.add(target));
      }
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { syncVersion: true },
    });

    return { results, version: project.syncVersion };
  }

  /**
   * 명령 하나를 각자의 트랜잭션에서 적용한다.
   *
   * 한 건이 거절되어도 뒤의 명령이 막히지 않게 하려면 트랜잭션을 함께 쓸 수 없다.
   * 하나로 묶으면 마지막 한 건의 실패가 앞의 성공까지 되돌린다.
   */
  private async applyOne(
    userId: string,
    projectId: string,
    clientId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const claim = await this.claim(projectId, clientId, mutation);

    if (claim.kind === 'settled') return claim.result;

    if (claim.kind === 'running') {
      /*
       * 다른 요청이 같은 명령을 재생하는 중이다.
       *
       * 기기가 응답을 못 받아 다시 보냈고, 두 요청이 서로 다른 인스턴스에 닿은 경우다.
       * 여기서 답할 수 있는 것이 없다 -- 적용이라고 하면 실패한 명령이 조용히 사라지고,
       * 거절이라고 하면 성공한 명령이 보류 칸에 뜬다. 판정을 미루고 다음 동기화에
       * 다시 묻게 한다. 그때는 저 요청이 남긴 결과가 있다.
       */
      return {
        mutationId: mutation.mutationId,
        status: 'deferred',
        error: '같은 명령을 이미 처리하고 있습니다.',
      };
    }

    if (claim.kind === 'seqTaken') {
      /*
       * (기기, 순번)이 이미 다른 명령의 것이다.
       *
       * 기기가 번호를 다시 썼다는 뜻이라 정상 경로에는 없다. 그냥 적용하면 결과를
       * 기록할 자리가 없어 멱등이 깨진다 -- 다시 보낼 때마다 또 적힌다. 그래서
       * 적용하지 않고 이유를 달아 돌려준다.
       */
      this.logger.warn(
        `순번 충돌 ${mutation.mutationId} (clientId ${clientId}, clientSeq ${mutation.clientSeq})`,
      );
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'CLIENT_SEQ_TAKEN',
        error: '같은 순번을 다른 명령이 이미 썼습니다.',
      };
    }

    try {
      const result = await this.replay(userId, projectId, mutation);
      await this.settle(mutation, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      const code = (error as { code?: unknown })?.code;

      const result: MutationResult = {
        mutationId: mutation.mutationId,
        status: 'rejected',
        error: message,
        ...(typeof code === 'string' ? { code } : {}),
      };
      await this.settle(mutation, result);
      this.logger.warn(`명령 거절 ${mutation.kind} ${mutation.mutationId}: ${message}`);
      return result;
    }
  }

  /**
   * 재생하기 전에 명령 로그 행을 잡는다.
   *
   * **여기가 멱등의 자리다.** 조회한 뒤 재생하고 마지막에 기록하면, 같은 명령이 동시에
   * 두 번 도착했을 때 둘 다 "본 적 없다"로 읽고 둘 다 재생한다. 행을 먼저 넣으면
   * 유일 제약이 한쪽만 통과시킨다 -- 판정은 데이터베이스가 하고, 진 쪽은 재생하지 않는다.
   */
  private async claim(
    projectId: string,
    clientId: string,
    mutation: Mutation,
  ): Promise<Claim> {
    // ON CONFLICT DO NOTHING. 이긴 요청만 1을 받는다.
    const inserted = await this.prisma.mutationLog.createMany({
      data: [
        {
          mutationId: mutation.mutationId,
          projectId,
          clientId,
          clientSeq: mutation.clientSeq,
          kind: mutation.kind,
          status: 'running',
          claimedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { kind: 'owned' };

    const seen = await this.prisma.mutationLog.findUnique({
      where: { mutationId: mutation.mutationId },
    });

    /*
     * 행이 없는데 넣지도 못했다면 걸린 제약은 (clientId, clientSeq) 쪽이다.
     * 같은 순번을 다른 명령 id 가 이미 썼다.
     */
    if (!seen) return { kind: 'seqTaken' };

    if (seen.status === 'running') {
      const stale = new Date(Date.now() - CLAIM_TIMEOUT_MS);
      if (seen.claimedAt > stale) return { kind: 'running' };

      /*
       * 잡은 요청이 죽었다. 넘겨받는다.
       *
       * 조건을 그대로 UPDATE 에 실어 두 요청이 동시에 넘겨받는 일을 막는다. 진 쪽은
       * count 0 을 받고 판정을 미룬다. 넘겨받아 다시 재생해도 안전하다 -- 죽은 요청의
       * 트랜잭션은 통째로 되돌아갔거나 통째로 커밋되었고, 커밋되었다면 전표 id 로
       * duplicate 가 된다.
       */
      const taken = await this.prisma.mutationLog.updateMany({
        where: { mutationId: mutation.mutationId, status: 'running', claimedAt: { lt: stale } },
        data: { claimedAt: new Date() },
      });
      if (taken.count === 1) {
        this.logger.warn(`멈춘 명령을 넘겨받는다 ${mutation.mutationId}`);
        return { kind: 'owned' };
      }
      return { kind: 'running' };
    }

    /*
     * 판정이 끝난 명령이다. 그때 돌려준 결과를 그대로 돌려준다.
     *
     * 거절이었다면 거절 그대로다. 여기서 duplicate 로 덮으면 기기가 "적용됐다"로
     * 읽어 보류 칸에서 지운다.
     */
    const stored = (seen.resultJson ?? null) as MutationResult | null;
    if (stored) {
      return {
        kind: 'settled',
        result: stored.status === 'applied' ? { ...stored, status: 'duplicate' } : stored,
      };
    }
    return { kind: 'settled', result: { mutationId: mutation.mutationId, status: 'duplicate' } };
  }

  private async replay(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    switch (mutation.kind) {
      case 'entry.create':
        return this.createEntry(userId, projectId, mutation);
      case 'entry.replace':
        return this.replaceEntry(userId, projectId, mutation);
      case 'entry.delete':
        return this.deleteEntry(userId, projectId, mutation);
      case 'entry.tags':
        return this.changeEntryTags(userId, projectId, mutation);
      case 'person.create':
        return this.createPerson(userId, projectId, mutation);
      case 'person.update':
        return this.updatePerson(userId, projectId, mutation);
      case 'account.create':
        return this.createAccount(userId, projectId, mutation);
      case 'account.update':
        return this.updateAccount(userId, projectId, mutation);
      case 'card.create':
        return this.createCard(userId, projectId, mutation);
      case 'card.update':
        return this.updateCard(userId, projectId, mutation);
      case 'category.create':
        return this.createCategory(userId, projectId, mutation);
      case 'category.update':
        return this.updateCategory(userId, projectId, mutation);
      case 'tag.create':
        return this.createTag(userId, projectId, mutation);
      case 'tag.update':
        return this.updateTag(userId, projectId, mutation);
      case 'budget.set':
        return this.setBudget(userId, projectId, mutation);
      case 'budget.override':
        return this.setOverride(userId, projectId, mutation);
      default:
        return {
          mutationId: mutation.mutationId,
          status: 'rejected',
          error: `알 수 없는 명령입니다: ${mutation.kind}`,
        };
    }
  }

  private async createEntry(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryMutationPayload;

    /*
     * 이미 그 id 의 전표가 있으면 만들지 않는다.
     *
     * 명령 로그가 있으니 보통은 일어나지 않지만, 로그가 지워진 뒤 기기가 다시 보내는
     * 길이 남아 있다. 그때 새로 만들면 같은 지출이 두 번 적힌다. id 가 기기 것이라
     * 이 확인이 가능하다.
     */
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) {
      if (existing.projectId !== projectId) {
        return {
          mutationId: mutation.mutationId,
          status: 'rejected',
          error: '다른 프로젝트에 같은 식별자의 거래가 있습니다.',
        };
      }
      return { mutationId: mutation.mutationId, status: 'duplicate' };
    }

    const input = await this.buildInput(userId, projectId, payload, mutation.hlc);
    const entry = await this.ledger.createEntry({ ...input, id: payload.id });
    return this.applied(mutation, projectId, entry.id);
  }

  private async replaceEntry(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryMutationPayload;

    const existing = await this.prisma.journalEntry.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true, updatedHlc: true },
    });
    if (!existing || existing.projectId !== projectId) {
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'ENTRY_NOT_FOUND',
        error: '거래를 찾을 수 없습니다.',
      };
    }

    /*
     * 병합. 전표는 다리까지 통째로 한 단위이고, HLC 가 늦은 쪽이 통째로 이긴다 (D5).
     *
     * 진 편집을 버리지 않는다. 기기가 이 결과를 충돌 목록에 남겨 "다른 기기에서 같은
     * 거래를 고쳤습니다"로 알리고, 사용자가 자기 값으로 되돌릴 수 있다 (D6). 돈은
     * 조용히 사라지면 안 된다.
     */
    if (isAfterHlc(existing.updatedHlc, mutation.hlc)) {
      return {
        mutationId: mutation.mutationId,
        status: 'conflict',
        error: '다른 기기에서 이 거래를 더 늦게 고쳤습니다.',
      };
    }

    const input = await this.buildInput(userId, projectId, payload, mutation.hlc);
    await this.ledger.replaceEntry(payload.id, input);
    return this.applied(mutation, projectId, payload.id);
  }

  private async deleteEntry(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryDeletePayload;

    const existing = await this.prisma.journalEntry.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    /*
     * 이미 없으면 할 일이 끝난 것이다.
     *
     * 다른 기기가 먼저 지웠거나 이 명령이 재전송된 경우다. 어느 쪽이든 사용자가 원한
     * 상태이므로 오류로 만들지 않는다.
     */
    if (!existing || existing.projectId !== projectId) {
      return { mutationId: mutation.mutationId, status: 'duplicate' };
    }

    /*
     * 삭제는 시계를 보지 않는다. 툼스톤이 언제나 이긴다 (D5).
     *
     * 지운 거래가 되살아나면 금액이 두 번 세어진다. 되살리기는 사용자가 새로 적는 편이
     * 안전하다.
     */
    await this.entries.deleteEntry(payload.id, userId);
    return this.applied(mutation, projectId, payload.id);
  }

  /**
   * 여러 전표의 태그를 바꾼다.
   *
   * 전표 명령 셋과 나란히 서지만 병합 규칙이 다르다. 통째로 이기고 지는 것이 아니라
   * **더한 것과 뗀 것만** 적용한다 -- 두 사람이 서로 다른 태그를 붙였을 때 둘 다 남아야
   * 하기 때문이다. 어느 쪽에도 없는 태그는 건드리지 않는다.
   *
   * 시계는 명령의 것을 쓴다. 재생하는 오늘 것을 찍으면 그 사이 다른 기기가 그 전표를
   * 고친 편집보다 뒤로 가서, 이 표시가 그 편집을 이긴 것처럼 남는다.
   *
   * 재생 모드로 부른다. 그 사이 지워진 전표는 건너뛴다 -- 한 건이 사라졌다고 나머지
   * 스무 건의 표시까지 영영 막을 수는 없다.
   */
  private async changeEntryTags(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryTagsPayload;

    try {
      await this.entries.changeTags(
        userId,
        {
          entryIds: payload.entryIds ?? [],
          addTagIds: payload.addTagIds ?? [],
          removeTagIds: payload.removeTagIds ?? [],
        },
        projectId,
        { hlc: mutation.hlc },
      );
    } catch (error) {
      /*
       * 태그가 없어졌거나 남의 프로젝트 것이면 거절이다.
       *
       * 여기서 조용히 넘기면 사용자는 표시가 된 줄 알고, 다음 동기화가 그 전표를 다시
       * 받아 태그 없는 모습으로 덮는다. 그때는 무엇이 사라졌는지 알 길이 없다 (D6).
       */
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'TAG_CHANGE_FAILED',
        error: error instanceof Error ? error.message : '태그를 바꾸지 못했습니다.',
      };
    }

    return this.applied(mutation, projectId, payload.entryIds?.[0] ?? '');
  }

  // ───────────────────────────────────────────
  // 자산 (구성원·통장·카드)
  //
  // 전표와 규칙이 둘 다르다.
  //   1. **필드별 병합.** 이름과 색 사이에는 얽힌 불변식이 없어서, 서로 다른 필드를 고친
  //      두 편집은 다툴 이유가 없다 (D5). 이긴 필드만 골라 서비스에 넘긴다.
  //   2. **지움 명령이 없다.** 서버가 하는 일이 숨기기(isActive)라 update 로 온다.
  //      숨기기에는 선행조건이 있어(주인의 통장, 카드의 미결제액) 서버가 다시 본다 (D11).
  // ───────────────────────────────────────────

  private async createPerson(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as PersonCreatePayload;

    const existing = await this.prisma.person.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return this.sameOrForeign(mutation, existing.projectId, projectId, '구성원');

    await this.people.createPerson(
      userId,
      { id: payload.id, name: payload.name, relationship: payload.relationship ?? undefined },
      projectId,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  private async updatePerson(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as PersonUpdatePayload;

    const person = await this.prisma.person.findUnique({ where: { id: payload.id } });
    if (!person || person.projectId !== projectId) return this.notFound(mutation, '구성원');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(person.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    /*
     * 숨기기는 따로 부른다. 선행조건(활성 통장 0개)이 그 함수 안에 있고, 그것을 건너뛰면
     * 주인이 목록에서 사라진 통장이 남는다.
     */
    const { isActive, ...rest } = merged.apply as PersonUpdatePayload;
    if (Object.keys(rest).length > 0) {
      /*
       * `relationship: null` 은 "비운다"다. DTO 는 undefined 만 받지만 서비스는 빈 값을
       * null 로 저장하므로, 여기서 빈 문자열로 옮겨 같은 뜻이 되게 한다.
       */
      await this.people.updatePerson(
        payload.id,
        userId,
        { ...rest, ...(rest.relationship === null ? { relationship: '' } : {}) } as never,
        mutation.hlc,
      );
    }
    if (isActive === false) await this.people.deactivatePerson(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.people.updatePerson(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return this.applied(mutation, projectId, payload.id);
  }

  private async createAccount(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as AccountCreatePayload;

    const existing = await this.prisma.account.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return this.sameOrForeign(mutation, existing.projectId, projectId, '통장');

    await this.accounts.createAccount(
      userId,
      {
        id: payload.id,
        name: payload.name,
        type: payload.type,
        ownerId: payload.ownerId ?? undefined,
        institutionId: payload.institutionId ?? undefined,
        accountNumber: payload.accountNumber ?? undefined,
        currency: payload.currency,
        openingBalance: payload.initialBalance,
      } as never,
      projectId,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  private async updateAccount(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as AccountUpdatePayload;

    const account = await this.prisma.account.findUnique({ where: { id: payload.id } });
    if (!account || account.projectId !== projectId) return this.notFound(mutation, '통장');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(account.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    const { isActive, ...rest } = merged.apply as AccountUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.accounts.updateAccount(payload.id, userId, rest as never, mutation.hlc);
    }
    // 숨기기의 선행조건은 연결된 카드와 잔액이다. 통장 자체를 고치는 것과 다른 함수다.
    if (isActive === false) await this.accounts.deactivateAccount(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.accounts.updateAccount(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return this.applied(mutation, projectId, payload.id);
  }

  private async createCard(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CardCreatePayload;

    const existing = await this.prisma.card.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return this.sameOrForeign(mutation, existing.projectId, projectId, '카드');

    await this.cards.createCard(
      userId,
      {
        id: payload.id,
        liabilityAccountId: payload.liabilityAccountId,
        name: payload.name,
        cardType: payload.cardType,
        issuerId: payload.issuerId,
        paymentAccountId: payload.paymentAccountId,
        cardNumber: payload.cardNumber ?? undefined,
        creditLimit: payload.creditLimit ?? undefined,
        performanceAmount: payload.performanceAmount ?? undefined,
        statementClosingDay: payload.statementClosingDay ?? undefined,
        paymentDueDay: payload.paymentDueDay ?? undefined,
        color: payload.color ?? undefined,
      } as never,
      projectId,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  private async updateCard(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CardUpdatePayload;

    const card = await this.prisma.card.findUnique({ where: { id: payload.id } });
    if (!card || card.projectId !== projectId) return this.notFound(mutation, '카드');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(card.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    const { isActive, ...rest } = merged.apply as CardUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.cards.updateCard(payload.id, userId, rest as never, mutation.hlc);
    }
    // 숨기기는 갚지 않은 사용액이 남아 있으면 막힌다. 부채 계정도 함께 내려간다.
    if (isActive === false) await this.cards.deactivateCard(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.cards.updateCard(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return this.applied(mutation, projectId, payload.id);
  }

  /**
   * 분류 만들기.
   *
   * **같은 이름이 이미 있으면 그 행을 채택한다.** 두 사람이 오프라인에서 같은 분류를
   * 만드는 일은 흔하고, 그것을 오류로 두면 그 명령이 영원히 막힌다. 대신 서버가 채택한
   * id 를 별칭으로 돌려주고, 기기가 자기 사본과 큐의 참조를 그 id 로 옮긴다 (D 별칭).
   */
  private async createCategory(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CategoryCreatePayload;

    const existing = await this.prisma.category.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return this.sameOrForeign(mutation, existing.projectId, projectId, '분류');

    const sameName = await this.prisma.category.findFirst({
      where: {
        projectId,
        name: payload.name.trim(),
        parentId: payload.parentId ?? null,
        type: payload.type as never,
      },
      select: { id: true },
    });
    if (sameName) {
      return {
        ...(await this.applied(mutation, projectId, sameName.id)),
        alias: { from: payload.id, to: sameName.id },
      };
    }

    await this.categories.createCategory(
      userId,
      {
        id: payload.id,
        name: payload.name,
        type: payload.type,
        parentId: payload.parentId ?? undefined,
        icon: payload.icon ?? undefined,
        defaultIsExtra: payload.defaultIsExtra,
      } as never,
      projectId,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  private async updateCategory(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CategoryUpdatePayload;

    const category = await this.prisma.category.findUnique({ where: { id: payload.id } });
    if (!category || category.projectId !== projectId) return this.notFound(mutation, '분류');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(category.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    await this.categories.updateCategory(payload.id, userId, merged.apply as never, mutation.hlc);
    return this.applied(mutation, projectId, payload.id);
  }

  /** 태그 만들기. 이름이 겹치면 분류와 같은 규칙으로 기존 행을 채택한다. */
  private async createTag(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as TagCreatePayload;

    const existing = await this.prisma.tag.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return this.sameOrForeign(mutation, existing.projectId, projectId, '태그');

    const sameName = await this.prisma.tag.findFirst({
      where: { projectId, name: payload.name.trim() },
      select: { id: true },
    });
    if (sameName) {
      return {
        ...(await this.applied(mutation, projectId, sameName.id)),
        alias: { from: payload.id, to: sameName.id },
      };
    }

    await this.tags.createTag(
      userId,
      { id: payload.id, name: payload.name, color: payload.color ?? undefined } as never,
      projectId,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  private async updateTag(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as TagUpdatePayload;

    const tag = await this.prisma.tag.findUnique({ where: { id: payload.id } });
    if (!tag || tag.projectId !== projectId) return this.notFound(mutation, '태그');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(tag.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    const { isActive, ...rest } = merged.apply as TagUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.tags.updateTag(payload.id, userId, rest as never, mutation.hlc);
    }
    // 태그의 숨기기는 선행조건이 없다. 떼어 내도 거래는 온전하다.
    if (isActive === false) await this.tags.deleteTag(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.tags.updateTag(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return this.applied(mutation, projectId, payload.id);
  }

  /**
   * 예산 한 줄을 정한다. 없으면 만들고, 있으면 금액만 바꾼다.
   *
   * 구간 편집(applyMode='from')은 여기로 오지 않는다. 그 사이 달라진 규칙들 위에서 다시
   * 계산되는 조작이라 재생하면 결과가 달라진다 -- 온라인에서만 한다 (D12).
   */
  private async setBudget(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetSetPayload;

    const existing = await this.prisma.budget.findUnique({ where: { id: payload.id } });
    if (existing && existing.projectId !== projectId) {
      return this.sameOrForeign(mutation, existing.projectId, projectId, '예산');
    }

    if (!existing) {
      await this.budgets.createBudget(
        userId,
        {
          id: payload.id,
          categoryId: payload.categoryId ?? undefined,
          type: payload.type ?? undefined,
          monthlyAmount: payload.monthlyAmount,
          /*
           * 어느 달의 규칙을 고칠지. 없으면 서버가 재생하는 오늘이 속한 달이다.
           *
           * 예산은 구간으로 나뉠 수 있어 한 분류에 규칙이 여럿일 수 있다. 이 값이 없으면
           * 8월 화면에서 고친 금액이 9월 규칙에 적힌다.
           */
          yearMonth: payload.yearMonth,
        } as never,
        projectId,
        mutation.hlc,
      );
      return this.applied(mutation, projectId, payload.id);
    }

    const merged = mergeFields(
      { monthlyAmount: payload.monthlyAmount },
      mutation.hlc,
      readFieldClocks(existing.fieldHlc),
    );
    if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);

    await this.budgets.updateBudget(
      payload.id,
      userId,
      { monthlyAmount: payload.monthlyAmount, applyMode: 'all' } as never,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  /**
   * 그 달만 다른 금액으로. 없으면 만들고, 값이 없으면 지운다.
   *
   * 키가 (예산, 년, 월)이라 다른 달을 고친 두 편집은 서로 다른 행이다 -- 애초에 다툴 일이
   * 없다. 같은 달을 고친 것끼리만 시계로 가른다.
   */
  private async setOverride(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as BudgetOverridePayload;

    const budget = await this.prisma.budget.findUnique({ where: { id: payload.budgetId } });
    if (!budget || budget.projectId !== projectId) return this.notFound(mutation, '예산');

    const existing = await this.prisma.budgetOverride.findUnique({
      where: {
        budgetId_year_month: {
          budgetId: payload.budgetId,
          year: payload.year,
          month: payload.month,
        },
      },
    });

    if (existing) {
      const merged = mergeFields(
        { amount: payload.amount ?? null },
        mutation.hlc,
        readFieldClocks(existing.fieldHlc),
      );
      if (Object.keys(merged.apply).length === 0) return this.allFieldsLost(mutation, merged.lost);
    }

    if (payload.amount == null) {
      if (existing) await this.budgets.deleteOverride(existing.id, userId);
      return this.applied(mutation, projectId, payload.id);
    }

    await this.budgets.createOverride(
      userId,
      {
        id: payload.id,
        budgetId: payload.budgetId,
        year: payload.year,
        month: payload.month,
        amount: payload.amount,
      } as never,
      mutation.hlc,
    );
    return this.applied(mutation, projectId, payload.id);
  }

  /**
   * 이미 그 id 의 행이 있을 때의 답.
   *
   * 같은 프로젝트면 재전송이라 duplicate 다. 다른 프로젝트면 기기가 만든 id 가 남의 것과
   * 겹친 것이라 적용하지 않는다 -- 남의 가계부를 고칠 뻔한 자리다.
   */
  private sameOrForeign(
    mutation: Mutation,
    existingProjectId: string,
    projectId: string,
    label: string,
  ): MutationResult {
    if (existingProjectId !== projectId) {
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        error: `다른 프로젝트에 같은 식별자의 ${label}이(가) 있습니다.`,
      };
    }
    return { mutationId: mutation.mutationId, status: 'duplicate' };
  }

  private notFound(mutation: Mutation, label: string): MutationResult {
    return {
      mutationId: mutation.mutationId,
      status: 'rejected',
      code: 'TARGET_NOT_FOUND',
      error: `${label}을(를) 찾을 수 없습니다.`,
    };
  }

  /**
   * 보낸 필드가 전부 더 늦은 편집에 밀렸을 때.
   *
   * 충돌로 돌려준다. 조용히 "적용했다"고 답하면 사용자가 고친 이름이 아무 말 없이
   * 사라지고, 보류 칸에서 되살릴 길도 없어진다 (D6).
   */
  private allFieldsLost(mutation: Mutation, lost: readonly string[]): MutationResult {
    return {
      mutationId: mutation.mutationId,
      status: 'conflict',
      error: `다른 기기에서 더 늦게 고쳤습니다 (${lost.join(', ')}).`,
    };
  }

  /** 명령의 짐을 조립 입구가 받는 모양으로. 검증은 조립이 한다. */
  private async buildInput(
    userId: string,
    projectId: string,
    payload: EntryMutationPayload,
    hlc: string,
  ) {
    const input = await this.ledger.buildFromRequest({
      projectId,
      createdByUserId: userId,
      kind: payload.kind,
      personId: payload.personId,
      date: new Date(payload.date),
      description: payload.description,
      merchant: payload.merchant,
      detailedNote: payload.detailedNote,
      /*
       * 오프라인에서 쓴 환율을 그대로 쓴다.
       *
       * 비워 두면 재생하는 오늘 환율로 값이 다시 매겨져, 기기가 보여 준 금액과 서버에
       * 남는 금액이 갈린다 (D7).
       */
      currency: payload.currency,
      exchangeRate: payload.exchangeRate,
      billedAmount: payload.billedAmount,
      amount: payload.amount,
      categoryId: payload.categoryId,
      extraAmount: payload.extraAmount,
      splits: payload.splits,
      accountId: payload.accountId,
      toAccountId: payload.toAccountId,
      cardId: payload.cardId,
      installmentMonths: payload.installmentMonths,
      toAmount: payload.toAmount,
      transferFee: payload.transferFee,
      transferFeeCategoryId: payload.transferFeeCategoryId,
      cardTransferDirection: payload.cardTransferDirection,
    });

    return {
      ...input,
      // 태그는 조립 규칙이 다루지 않는다(다리를 바꾸지 않는다). 짐에서 그대로 옮긴다.
      tagIds: payload.tagIds ?? [],
      updatedHlc: hlc || encodeHlc(hlcNext(null, 'server')),
    };
  }

  private async applied(
    mutation: Mutation,
    projectId: string,
    entryId: string,
  ): Promise<MutationResult> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { syncVersion: true },
    });
    void entryId;
    return {
      mutationId: mutation.mutationId,
      status: 'applied',
      appliedVersion: project.syncVersion,
    };
  }

  /**
   * 잡아 둔 행에 판정을 적는다. 재전송이 이것을 보고 두 번 적히지 않는다.
   *
   * 실패해도 던지지 않는다. 이 시점에는 재생이 이미 끝나 있어서, 여기서 던지면
   * 성공한 명령이 실패로 보고된다. 행이 사라진 경우(정리 스크립트)가 그 예다.
   * 대신 기록이 없으므로 다음 재전송은 다시 재생되고, 그때는 전표 id 가 막는다.
   */
  private async settle(mutation: Mutation, result: MutationResult): Promise<void> {
    try {
      await this.prisma.mutationLog.update({
        where: { mutationId: mutation.mutationId },
        data: {
          status: result.status,
          resultJson: result as unknown as object,
          appliedVersion: result.appliedVersion ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `명령 기록 실패 ${mutation.mutationId} (clientSeq ${mutation.clientSeq}): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
