/**
 * 전표 명령의 재생 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 만들기·바꾸기·지우기·태그·분류·청구액 확정. 온라인 요청과 같은 원장·전표 서비스로
 * 흘려보내고, 병합(시계 견주기)과 거절의 모양만 여기서 정한다. Nest 공급자가 아니라
 * 재생 서비스가 자기 의존성으로 만들어 쓴다 (mutation-claim.ts 머리말과 같은 까닭).
 */
import { HttpException } from '@nestjs/common';
import {
  type EntryCategoryPayload,
  type EntryDeletePayload,
  type EntryMutationPayload,
  type EntryRestatePayload,
  type EntryTagsPayload,
  type Mutation,
  type MutationResult,
  encodeHlc,
  hlcNext,
  isAfterHlc,
} from '@money/types';
import type { PrismaService } from '@/config/prisma.service';
import type { LedgerService } from '../ledger/ledger.service';
import type { EntriesService } from '../entries/entries.service';
import type { CardLedgerService } from '../cards/card-ledger.service';
import { appliedResult } from './mutation-results';
import { isEntryModified } from './mutation-shape';

export class EntryMutations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly entries: EntriesService,
    private readonly cardLedger: CardLedgerService,
  ) {}

  async createEntry(
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
    await this.ledger.createEntry({ ...input, id: payload.id });
    return appliedResult(this.prisma, mutation, projectId);
  }

  async replaceEntry(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryMutationPayload;

    /*
     * 시계를 견준 판 그대로일 때만 바꾼다 (2026-10-16).
     *
     * 견주기는 원장 잠금 밖이다. 그 사이 다른 기기의 재생이나 온라인 편집이 먼저 커밋하면, 늦게 커밋한
     * 쪽이 시계와 상관없이 덮고 둘 다 "적용"이 된다. 그래서 견준 판(`baseHlc`)을 함께 넘겨 잠금 아래에서
     * 다시 보게 하고, 그 사이 바뀌었으면 처음부터 다시 견준다 -- 이번에는 더 늦은 편집이 있으면 충돌이다.
     */
    for (let attempt = 0; ; attempt += 1) {
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
      try {
        // 시계가 없는 옛 전표(null)는 견줄 판이 없다. 지금처럼 그대로 바꾼다.
        await this.ledger.replaceEntry(payload.id, {
          ...input,
          baseHlc: existing.updatedHlc ?? undefined,
        });
        return appliedResult(this.prisma, mutation, projectId);
      } catch (error) {
        if (!isEntryModified(error)) throw error;
        if (attempt < 2) continue;
        /*
         * 세 번 다 그 사이 다른 편집이 끼었다. 규칙 위반이 아니라 충돌이다 -- 그대로 던지면 거절로 분류돼
         * 기기가 보류 칸에 넣었다. 위의 "더 늦게 고쳤다"와 같은 갈래로 돌려준다.
         */
        return {
          mutationId: mutation.mutationId,
          status: 'conflict',
          error: '다른 기기에서 이 거래를 같은 때에 고치고 있습니다.',
        };
      }
    }
  }

  async deleteEntry(
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
    return appliedResult(this.prisma, mutation, projectId);
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
  async changeEntryTags(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryTagsPayload;

    /*
     * 떼려던 태그가 그 사이 지워졌으면 이미 뗀 것과 같다 (`liveTagIds`). 예전에는 그것도 거절이라 대상
     * 거래들이 막혀 그 뒤 편집까지 보류됐다. 붙이려던 태그가 없는 것은 그대로 거절한다 -- 사용자가
     * 표시가 된 줄 알면 안 된다(아래 catch 의 까닭).
     */
    const addTagIds = payload.addTagIds ?? [];
    const liveRemoves = await this.liveTagIds(projectId, payload.removeTagIds ?? []);
    const removeTagIds = (payload.removeTagIds ?? []).filter((id) => liveRemoves.has(id));
    if (addTagIds.length === 0 && removeTagIds.length === 0) {
      return appliedResult(this.prisma, mutation, projectId);
    }

    let skipped: Array<{ entryId: string; lineKey?: string | null }> = [];
    try {
      const result = await this.entries.changeTags(
        userId,
        {
          targets: payload.targets ?? [],
          addTagIds,
          removeTagIds,
        },
        projectId,
        { hlc: mutation.hlc },
      );
      skipped = result.skipped;
    } catch (error) {
      /*
       * 태그가 없어졌거나 남의 프로젝트 것이면 거절이다.
       *
       * 여기서 조용히 넘기면 사용자는 표시가 된 줄 알고, 다음 동기화가 그 전표를 다시
       * 받아 태그 없는 모습으로 덮는다. 그때는 무엇이 사라졌는지 알 길이 없다 (D6).
       */
      // 규칙의 거절(HTTP 예외)만 여기서 돌려준다. DB 오류는 위로 올려 일시 실패는 미루고 원문은 감춘다 (applyOne).
      if (!(error instanceof HttpException)) throw error;
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'TAG_CHANGE_FAILED',
        error: error.message,
      };
    }

    const result = await appliedResult(this.prisma, mutation, projectId);
    // 사라진 줄이 있었으면 함께 돌려준다. 기기가 그 사실을 한 번 알린다.
    return skipped.length > 0 ? { ...result, skippedTagTargets: skipped } : result;
  }

  /**
   * 여러 줄의 분류를 바꾼다. 온라인과 같은 서비스를 재생 모드로 부른다.
   *
   * 병합은 서비스가 정한다 -- 그 사이 다른 기기가 고친 전표는 건너뛰고(새 편집이 이긴다), 지워진
   * 전표와 사라진 줄도 건너뛴다. 건너뛴 전표는 번호가 올라 기기가 서버의 값을 다시 받는다.
   * 분류가 없어졌으면 거절이다. 조용히 넘기면 사용자는
   * 바뀐 줄 알고, 다음 동기화가 옛 분류로 덮을 때에야 알게 된다 (태그 바꾸기와 같은 까닭).
   */
  async changeEntryCategory(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryCategoryPayload;

    try {
      await this.entries.changeCategory(
        userId,
        { targets: payload.targets ?? [], categoryId: payload.categoryId },
        projectId,
        { hlc: mutation.hlc },
      );
    } catch (error) {
      // 규칙의 거절(HTTP 예외)만 여기서 돌려준다. DB 오류는 위로 올려 일시 실패는 미루고 원문은 감춘다 (applyOne).
      if (!(error instanceof HttpException)) throw error;
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'CATEGORY_CHANGE_FAILED',
        error: error.message,
      };
    }

    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 외화 결제의 청구액 확정.
   *
   * 병합은 전표 수정과 같다 -- 담긴 전표 가운데 하나라도 이 명령보다 늦게 고쳐졌으면
   * 통째로 충돌이다. 명세서 한 장을 한 번에 맞추는 일이라 일부만 적용하면 남은 대금이
   * 어중간해진다. 진 쪽은 기기가 충돌 목록에 남겨 사람이 고른다 (D6).
   *
   * 확정 자체는 온라인 요청과 같은 서비스가 한다. 카드의 거래인지, 원 통화 금액이 있는지,
   * 모든 다리가 기준통화인지를 거기서 다시 본다. 시계는 명령의 것을 찍는다.
   */
  async restateEntries(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as EntryRestatePayload;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!payload?.cardId || items.length === 0) {
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        error: '확정할 거래가 없습니다.',
      };
    }

    const entryIds = items.map((item) => item.entryId);
    const existing = await this.prisma.journalEntry.findMany({
      where: { id: { in: entryIds } },
      select: { id: true, projectId: true, updatedHlc: true },
    });
    const byId = new Map(existing.map((entry) => [entry.id, entry]));

    /*
     * 그 사이 지워진 거래가 있으면 거절이다.
     *
     * 태그 명령처럼 건너뛰지 않는다. 명세서 금액을 맞추는 중이라 한 건이 빠진 채 나머지만
     * 확정하면, 사용자가 보고 맞춘 합계와 원장이 조용히 갈린다.
     */
    if (entryIds.some((id) => byId.get(id)?.projectId !== projectId)) {
      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'ENTRY_NOT_FOUND',
        error: '거래를 찾을 수 없습니다.',
      };
    }
    if (existing.some((entry) => isAfterHlc(entry.updatedHlc, mutation.hlc))) {
      return {
        mutationId: mutation.mutationId,
        status: 'conflict',
        error: '다른 기기에서 이 거래를 더 늦게 고쳤습니다.',
      };
    }

    try {
      await this.cardLedger.settleRates(
        payload.cardId,
        userId,
        { items: items.map((item) => ({ entryId: item.entryId, billedAmount: item.billedAmount })) },
        { hlc: mutation.hlc },
      );
    } catch (error) {
      // 위의 견주기 뒤, 잠그기 전에 더 늦은 편집이 들어왔다 (`restateForeignEntry`). 위와 같은 충돌이다.
      if (isEntryModified(error)) {
        return {
          mutationId: mutation.mutationId,
          status: 'conflict',
          error: '다른 기기에서 이 거래를 더 늦게 고쳤습니다.',
        };
      }
      throw error;
    }
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 짐에 든 태그 중 이 가계부에 아직 있는 것. 끊긴 사이 다른 기기가 지운 태그를 걸러 낸다.
   *
   * 지운 태그를 그대로 넘기면 원장이 거래 전체를 TAG_NOT_IN_PROJECT 로 거절하고, 기기가 다시 보내도
   * 같은 짐이라 영영 거절된다 -- 결국 거래를 버려야 했다. 태그는 이미 없으니 그 태그만 빠진
   * 거래가 사용자가 바란 것에 가장 가깝다. 남의 가계부 태그도 여기서 함께 빠진다.
   */
  private async liveTagIds(projectId: string, ids: Iterable<string | undefined | null>): Promise<Set<string>> {
    const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string' && id !== ''))];
    if (wanted.length === 0) return new Set();
    const found = await this.prisma.tag.findMany({
      where: { id: { in: wanted }, projectId },
      select: { id: true },
    });
    return new Set(found.map((tag) => tag.id));
  }

  /** 명령의 짐을 조립 입구가 받는 모양으로. 검증은 조립이 한다. */
  private async buildInput(
    userId: string,
    projectId: string,
    payload: EntryMutationPayload,
    hlc: string,
  ) {
    const live = await this.liveTagIds(projectId, [
      ...(payload.tagIds ?? []),
      ...(payload.splits ?? []).flatMap((split) => split.tagIds ?? []),
    ]);
    const keepLive = (ids: string[] | undefined) => ids?.filter((id) => live.has(id));
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
      splits: payload.splits?.map((split) => ({ ...split, tagIds: keepLive(split.tagIds) })),
      accountId: payload.accountId,
      toAccountId: payload.toAccountId,
      cardId: payload.cardId,
      installmentMonths: payload.installmentMonths,
      installmentInterest: payload.installmentInterest,
      installmentShares: payload.installmentShares,
      installmentInterestShares: payload.installmentInterestShares,
      installmentMonthlyPayment: payload.installmentMonthlyPayment,
      installmentAnnualRate: payload.installmentAnnualRate,
      toAmount: payload.toAmount,
      transferFee: payload.transferFee,
      transferFeeCategoryId: payload.transferFeeCategoryId,
      cardTransferDirection: payload.cardTransferDirection,
      /*
       * 줄에 달린 것들. 기기가 조립한 전표와 같은 모양이 나와야 한다.
       *
       * 줄 키를 그대로 옮기는 것이 요점이다. 서버가 새로 만들면 기기 사본의 태그와
       * 차감이 그 줄을 가리키지 못하고, 다음 pull 이 사본을 덮을 때 조용히 사라진다.
       */
      lineKey: payload.lineKey,
      transferFeeLineKey: payload.transferFeeLineKey,
      discountAmount: payload.discountAmount,
      // 페이백의 링크. 그 사이 원거래가 지워졌으면 조립이 비우고 독립 페이백으로 들인다.
      paybackOfEntryId: payload.paybackOfEntryId,
      paybackOfLineKey: payload.paybackOfLineKey,
      paybackType: payload.paybackType,
      installmentCut: payload.installmentCut,
      id: payload.id,
      countsPerformance: payload.countsPerformance,
      discountCountsPerformance: payload.discountCountsPerformance,
      // 태그도 조립이 줄에 실어 준다. 그 사이 지워진 태그만 빼고 옮긴다 (`liveTagIds`).
      tagIds: keepLive(payload.tagIds) ?? [],
    });

    return {
      ...input,
      updatedHlc: hlc || encodeHlc(hlcNext(null, 'server')),
      // 끊긴 기기들이 따로 적은 환불·페이백은 합이 넘어도 받는다 (EntryInput.allowOverPayback).
      allowOverPayback: true,
    };
  }
}
