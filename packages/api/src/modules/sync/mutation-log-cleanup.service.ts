import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

/** 명령 기록을 얼마나 남기는가. 기기가 응답을 못 받고 다시 보내는 일은 몇 분 안에 일어난다. */
const MUTATION_LOG_RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 서버가 막 떠서 바쁜 때를 피한다. */
const CLEANUP_FIRST_DELAY_MS = 5 * 60 * 1000;

/**
 * 오래된 명령 기록(`MutationLog`)을 하루에 한 번 지운다 (2026-10-25).
 *
 * 그 표는 같은 명령이 다시 와도 한 번만 적용되게 하는 열쇠라(재전송에는 적어 둔 결과를 돌려준다) 기기가 결과를
 * 받기 전까지만 있으면 된다. 지우는 곳이 없어 줄마다 결과 JSON 을 단 채 쌓였다 -- 사용자가 늘면 하루에 수십만 줄이다.
 * 잡혀 있는 줄(running)은 지우지 않는다. 서버가 여럿 떠도 같은 삭제를 겹쳐 할 뿐이다.
 */
@Injectable()
export class MutationLogCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MutationLogCleanupService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const first = setTimeout(() => void this.purgeOld(), CLEANUP_FIRST_DELAY_MS);
    const daily = setInterval(() => void this.purgeOld(), CLEANUP_INTERVAL_MS);
    // 기다리는 시계 때문에 프로세스가 끝나지 못하면 안 된다.
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** 보관 기간이 지난 줄을 지운다. 지운 수를 돌려준다. 실패해도 서버를 멈추지 않는다. */
  async purgeOld(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - MUTATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.mutationLog.deleteMany({
        where: { createdAt: { lt: cutoff }, status: { not: 'running' } },
      });
      if (count > 0) this.logger.log(`오래된 명령 기록 ${count}건을 지웠습니다.`);
      return count;
    } catch (error) {
      this.logger.error('오래된 명령 기록을 지우지 못했습니다.', error as Error);
      return 0;
    }
  }
}
