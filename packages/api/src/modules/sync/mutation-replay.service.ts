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
 *   2. **순서.** 한 기기의 명령은 clientSeq 순서로만 적용한다.
 *   3. **의존.** 어떤 명령이 거절되면 **그 대상을 건드리는 뒤 명령만** 함께 보류한다.
 *      전표를 만든 명령이 거절되었는데 그것을 고치는 명령이 뒤따라 적용되면, 없는
 *      전표를 고치려다 실패하거나 더 나쁘게는 다른 전표에 적용된다.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  type EntryDeletePayload,
  type EntryMutationPayload,
  type Mutation,
  type MutationResult,
  type PushRequest,
  type PushResponse,
  encodeHlc,
  hlcNext,
  isAfterHlc,
  isBlockedBy,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { EntriesService } from '../entries/entries.service';

/** 한 번에 받는 명령 수. 일주일치를 한 요청에 밀면 끊긴다. */
const MAX_MUTATIONS = 200;

@Injectable()
export class MutationReplayService {
  private readonly logger = new Logger(MutationReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
    private readonly entries: EntriesService,
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
    /** 앞에서 막힌 대상. 이것을 건드리는 뒤 명령은 서버까지 가지 않는다. */
    const blocked = new Set<string>();

    for (const mutation of mutations) {
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
    const seen = await this.prisma.mutationLog.findUnique({
      where: { mutationId: mutation.mutationId },
    });
    if (seen) {
      /*
       * 이미 본 명령이다. 그때 돌려준 결과를 그대로 돌려준다.
       *
       * 거절이었다면 거절 그대로다. 여기서 duplicate 로 덮으면 기기가 "적용됐다"로
       * 읽어 보류 칸에서 지운다.
       */
      const stored = (seen.resultJson ?? null) as MutationResult | null;
      if (stored) {
        return stored.status === 'applied' ? { ...stored, status: 'duplicate' } : stored;
      }
      return { mutationId: mutation.mutationId, status: 'duplicate' };
    }

    try {
      const result = await this.replay(userId, projectId, mutation);
      await this.record(projectId, clientId, mutation, result);
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
      await this.record(projectId, clientId, mutation, result);
      this.logger.warn(`명령 거절 ${mutation.kind} ${mutation.mutationId}: ${message}`);
      return result;
    }
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

    return { ...input, updatedHlc: hlc || encodeHlc(hlcNext(null, 'server')) };
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
   * 결과를 남긴다. 재전송이 이것을 보고 두 번 적히지 않는다.
   *
   * (clientId, clientSeq) 가 겹치면 기기가 번호를 다시 쓴 것이다. 그때는 기록만 건너뛴다 --
   * 이미 적용은 끝났고, 여기서 던지면 성공한 명령이 실패로 보고된다.
   */
  private async record(
    projectId: string,
    clientId: string,
    mutation: Mutation,
    result: MutationResult,
  ): Promise<void> {
    try {
      await this.prisma.mutationLog.create({
        data: {
          mutationId: mutation.mutationId,
          projectId,
          clientId,
          clientSeq: mutation.clientSeq,
          kind: mutation.kind,
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
