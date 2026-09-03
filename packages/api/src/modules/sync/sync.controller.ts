import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Post,
  Query,
  Request,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, from, interval, map, merge, switchMap } from 'rxjs';
import { type PushRequest, SyncDto } from '@money/types';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { ProjectAccessService } from '@/common/project-access.guard';
import { SyncEventsService } from '@/modules/realtime/sync-events.service';
import { SyncService } from './sync.service';
import { MutationReplayService } from './mutation-replay.service';

/**
 * 살아 있는 연결임을 알리는 간격.
 *
 * 중간의 프록시와 로드밸런서는 조용한 연결을 끊는다(ALB 의 기본 유휴 시간이 60초다).
 * 끊겨도 기기가 다시 붙지만, 그때마다 붙고 끊기를 반복하면 연결이 늘 새것이라
 * 신호를 놓치는 창이 계속 생긴다.
 */
const KEEPALIVE_MS = 25_000;

@ApiTags('Sync')
@Controller('sync')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly replay: MutationReplayService,
    private readonly syncEvents: SyncEventsService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('pull')
  @ApiOperation({ summary: '마지막으로 받은 번호 뒤의 변경분' })
  pull(
    @Request() req: AuthenticatedRequest,
    @Query() query: SyncDto.PullQuery,
    @Query('projectId') projectId?: string,
  ) {
    return this.syncService.pull(req.user.id, query, projectId);
  }

  @Post('push')
  @ApiOperation({ summary: '기기가 오프라인에서 쌓아 둔 명령을 재생한다' })
  push(
    @Request() req: AuthenticatedRequest,
    @Body() body: PushRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.replay.push(req.user.id, body, projectId);
  }

  /**
   * 이 프로젝트가 바뀌면 번호를 흘려보낸다.
   *
   * **데이터는 담지 않는다.** 기기는 번호만 보고 /sync/pull 로 받아 간다. 그래서 신호를
   * 놓쳐도 값이 어긋나지 않고(다음 pull 이 커서로 따라잡는다), 온라인과 오프라인이
   * 같은 코드를 그대로 쓴다.
   *
   * 흘려보내는 것은 셋이다.
   *   - 붙는 순간의 지금 번호. 끊겨 있던 동안의 변경을 그때 받아 간다.
   *   - 그 뒤의 변경 신호.
   *   - 25초마다의 ping. 중간의 프록시가 조용한 연결을 끊지 않게 한다.
   */
  @Sse('events')
  @ApiOperation({ summary: '변경 알림 (SSE). 번호만 보내고 데이터는 pull 로 받는다' })
  events(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectIdParam?: string,
  ): Observable<MessageEvent> {
    /*
     * 권한은 흐름 안에서 확인한다. @Sse 핸들러는 Observable 을 곧바로 돌려주어야 해서
     * 여기서 await 할 수 없다. 권한이 없으면 Nest 가 그 오류를 error 이벤트로 내보내고,
     * 기기는 그것을 보고 다시 붙기를 그만둔다.
     */
    return from(this.projectAccess.resolveAndVerifyProjectId(req.user.id, projectIdParam)).pipe(
      switchMap((projectId) =>
        merge(
          from(this.syncService.currentVersion(projectId)).pipe(map(toVersionMessage)),
          this.syncEvents.watch(projectId).pipe(map((event) => toVersionMessage(event.version))),
          interval(KEEPALIVE_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
        ),
      ),
    );
  }
}

function toVersionMessage(version: number): MessageEvent {
  return { type: 'sync', data: { version } };
}
