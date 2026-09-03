/**
 * 데이터를 바꾼 요청이 끝나면 그 프로젝트의 지금 번호를 흘려보낸다.
 *
 * 여기가 실시간의 유일한 발신 자리다. 컨트롤러나 서비스마다 손으로 넣지 않는 이유는
 * 번호 도장을 트리거에 둔 이유와 같다 -- 손으로 넣으면 언젠가 한 곳을 빠뜨리고, 빠뜨린
 * 그 경로는 아무 오류도 내지 않은 채 다른 화면만 늦게 따라붙는다.
 *
 * 세 가지를 지킨다.
 *
 *   1. **성공한 쓰기만.** 4xx·5xx 로 끝난 요청은 바꾼 것이 없다.
 *   2. **응답을 보낸 뒤에.** 신호를 만드는 일이 사용자의 저장을 늦추지 않는다.
 *   3. **실패해도 조용히.** 알림이 안 갔다고 저장이 실패로 보여서는 안 된다. 신호를
 *      놓쳐도 기기는 커서로 따라잡는다.
 */
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { PrismaService } from '@/config/prisma.service';
import { SyncEventsService } from '@/modules/realtime/sync-events.service';
import { createWriteContext, runWithWriteContext } from './project-write-context';

/** 데이터를 바꾸지 않는 메서드. 문맥을 만들 것도 없다. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SyncNotifyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SyncNotifyMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SyncEventsService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (READ_METHODS.has(req.method)) {
      next();
      return;
    }

    const context = createWriteContext();

    /*
     * 문맥 객체를 손에 들고 콜백을 건다.
     *
     * finish 는 다른 비동기 문맥에서 돌기 때문에 그 안에서는 AsyncLocalStorage 를
     * 읽을 수 없다. 객체를 클로저로 잡아 두면 그때도 그대로 읽힌다.
     */
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      void this.notify([...context.projects]);
    });

    runWithWriteContext(context, next);
  }

  private async notify(projectIds: string[]): Promise<void> {
    if (projectIds.length === 0) return;

    try {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, syncVersion: true },
      });

      for (const project of projects) {
        this.events.publish(project.id, project.syncVersion);
      }
    } catch (error) {
      this.logger.warn(
        `동기화 신호를 만들지 못했습니다: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
