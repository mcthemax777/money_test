/**
 * 명령 로그(MutationLog) 행을 잡고, 판정을 적고, 놓는 곳 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 멱등의 자리다. 명령 로그 표를 만지는 코드는 이 파일에만 있다. Nest 공급자가 아니라 재생
 * 서비스가 자기 PrismaService 로 만들어 쓴다 -- 스모크가 재생 서비스를 생성자 인자 순서대로
 * 직접 만들기 때문에, 공급자를 늘리면 그쪽 조립이 모두 바뀐다.
 */
import type { Logger } from '@nestjs/common';
import type { Mutation, MutationResult } from '@money/types';
import type { PrismaService } from '@/config/prisma.service';

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
export type Claim =
  /** 내가 잡았다. 재생해도 된다. */
  | { kind: 'owned' }
  /** 다른 요청이 잡고 있다. 아직 결과를 모른다. */
  | { kind: 'running' }
  /** 이미 판정이 끝났다. 그때 돌려준 결과를 그대로 쓴다. */
  | { kind: 'settled'; result: MutationResult }
  /** 같은 (기기, 순번)을 다른 명령이 이미 썼다. */
  | { kind: 'seqTaken' };

export class MutationClaims {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  /**
   * 재생하기 전에 명령 로그 행을 잡는다.
   *
   * **여기가 멱등의 자리다.** 조회한 뒤 재생하고 마지막에 기록하면, 같은 명령이 동시에
   * 두 번 도착했을 때 둘 다 "본 적 없다"로 읽고 둘 다 재생한다. 행을 먼저 넣으면
   * 유일 제약이 한쪽만 통과시킨다 -- 판정은 데이터베이스가 하고, 진 쪽은 재생하지 않는다.
   */
  async claim(
    userId: string,
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
          userId,
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
     * 행이 없는데 넣지도 못했다면 걸린 제약은 (userId, clientId, clientSeq) 쪽이다.
     * 이 사람의 이 기기에서 같은 순번을 다른 명령 id 가 이미 썼다.
     */
    if (!seen) return { kind: 'seqTaken' };

    /*
     * 같은 명령 id 가 다른 가계부·다른 기기의 것이다 (2026-10-16). 명령 id 는 기기가 뽑는 값이라 정상
     * 경로에는 없다 -- 남의 id 를 알아낸 요청이다. 그 명령의 결과를 돌려주지도, 넘겨받지도 않는다.
     */
    // 보낸 사람이 비어 있는 행은 사람별 순번 이전의 것이다(함께 쓰는 가계부). 가계부·기기만 맞으면 받는다.
    const otherUser = seen.userId !== null && seen.userId !== userId;
    if (seen.projectId !== projectId || seen.clientId !== clientId || otherUser) {
      this.logger.warn(
        `남의 명령 id ${mutation.mutationId} (가계부 ${projectId}, 기기 ${clientId}, 사람 ${userId}) -- 거절한다`,
      );
      return {
        kind: 'settled',
        result: {
          mutationId: mutation.mutationId,
          status: 'rejected',
          code: 'MUTATION_ID_TAKEN',
          error: '이 명령 id 는 이미 다른 기기가 썼습니다.',
        },
      };
    }

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

  /**
   * 잡아 둔 행에 판정을 적는다. 재전송이 이것을 보고 두 번 적히지 않는다.
   *
   * 실패해도 던지지 않는다. 이 시점에는 재생이 이미 끝나 있어서, 여기서 던지면
   * 성공한 명령이 실패로 보고된다. 행이 사라진 경우(정리 스크립트)가 그 예다.
   * 대신 기록이 없으므로 다음 재전송은 다시 재생되고, 그때는 전표 id 가 막는다.
   */
  async settle(mutation: Mutation, result: MutationResult): Promise<void> {
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

  /**
   * 잡은 행을 놓는다. 판정이 아닌 일시 실패라, 다음 재전송이 처음처럼 잡고 재생하게 한다.
   * 놓기가 실패해도 삼킨다 -- 행은 시간이 지나면 죽은 것으로 보고 넘겨받는다.
   */
  async release(mutationId: string): Promise<void> {
    await this.prisma.mutationLog.delete({ where: { mutationId } }).catch(() => undefined);
  }

  /** 이 사람의 이 기기가 쓴 가장 큰 순번. 순번이 부딪힌 기기에 다음 자리를 알려 줄 때 쓴다. */
  async lastClientSeq(userId: string, clientId: string): Promise<number | null> {
    const last = await this.prisma.mutationLog.aggregate({
      where: { userId, clientId },
      _max: { clientSeq: true },
    });
    return last._max.clientSeq;
  }
}
