import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  MessageEvent,
  Post,
  Query,
  Request,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Observable,
  defer,
  filter,
  finalize,
  from,
  interval,
  map,
  merge,
  switchMap,
  takeUntil,
  throwError,
  timer,
} from 'rxjs';
import { type PushRequest, SyncDto } from '@money/types';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { ACCESS_COOKIE, readCookie } from '@/common/session-cookies';
import { ProjectAccessService } from '@/common/project-access.guard';
import { SyncEventsService } from '@/modules/realtime/sync-events.service';
import { holidayCountryOf } from '@money/types';
import { SyncService } from './sync.service';
import { HolidaysService } from '../holidays/holidays.service';
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
    private readonly holidays: HolidaysService,
  ) {}

  @Get('pull')
  @ApiOperation({ summary: '마지막으로 받은 번호 뒤의 변경분' })
  async pull(
    @Request() req: AuthenticatedRequest,
    @Query() query: SyncDto.PullQuery,
    @Query('projectId') projectId?: string,
  ): Promise<SyncDto.PullResponse> {
    const response = await this.syncService.pull(req.user.id, query, projectId);
    /*
     * 가계부 나라의 공휴일을 덧붙인다 (PullResponse.publicHolidays). 반복 등록의 "휴일이면
     * 앞·뒤로" 를 기기가 끊긴 동안에도 서버와 같게 셈한다. 서비스가 캐시해 두어 가볍다.
     * 권한은 위 pull 이 이미 보았다.
     */
    const timeZone = await this.projectAccess.getProjectTimeZone(response.projectId);
    const holidays = await this.holidays.publicHolidays(holidayCountryOf(timeZone));
    return { ...response, publicHolidays: [...holidays].sort() };
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
  /*
   * nginx 에게 이 응답은 모아 두지 말라고 일러 둔다.
   *
   * nginx 는 `proxy_buffering` 이 기본으로 켜져 있고, 내용 유형이 text/event-stream 이어도
   * 스스로 끄지 않는다. 그러면 신호가 nginx 의 버퍼에 앉아 있다가 버퍼가 차거나 연결이
   * 끊길 때에야 한꺼번에 나가, 기기는 "바뀌었다"를 제때 듣지 못한다 -- 웹에서 만든 태그가
   * 앱에 나타나지 않고 그 반대도 같은 자리다.
   *
   * 이 헤더는 nginx 만 보고 다른 것들은 그냥 지나친다. 서버 앞의 설정에 기대지 않고
   * 코드에서 끝내려고 여기 둔다 (배포마다 nginx 를 고칠 수는 없다).
   */
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: '변경 알림 (SSE). 번호만 보내고 데이터는 pull 로 받는다' })
  events(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectIdParam?: string,
  ): Observable<MessageEvent> {
    const userId = req.user.id;
    /*
     * 붙어 있는 동안에도 지킬 것 셋 (2026-10-16). 예전에는 붙는 순간에만 확인해, 가계부에서 내보내진
     * 사람도 연결을 쥔 채 변경 신호를 계속 받았고, 만료된 토큰으로도 연결이 이어졌다.
     *
     *   - 멤버 다시 확인: RECHECK_MS 마다. 빠졌으면 오류로 끝낸다.
     *   - 토큰 만료: 붙을 때 쓴 액세스 토큰이 끝나는 순간 연결을 닫는다. 기기는 곧바로 다시 붙으며
     *     토큰을 새로 받는다(core sync-events 의 getToken) -- 사람에게는 끊김이 보이지 않는다.
     *   - 사람당 연결 수: MAX_STREAMS_PER_USER 를 넘으면 받지 않는다. 열기만 하고 닫지 않는 클라이언트가
     *     서버의 연결을 다 쥐지 못하게.
     *
     * 권한은 흐름 안에서 확인한다. @Sse 핸들러는 Observable 을 곧바로 돌려주어야 해서 여기서 await 할 수
     * 없다. 권한이 없으면 Nest 가 그 오류를 error 이벤트로 내보낸다.
     */
    // 웹은 토큰을 머리글이 아니라 HttpOnly 쿠키로 싣는다 (common/session-cookies).
    const cookieToken = readCookie(req, ACCESS_COOKIE);
    const expiresAt = accessTokenExpiry(
      req.headers.authorization ?? (cookieToken ? `Bearer ${cookieToken}` : undefined),
    );
    return defer(() => {
      const open = this.openStreams.get(userId) ?? 0;
      if (open >= MAX_STREAMS_PER_USER) {
        return throwError(() => new HttpException('실시간 연결이 너무 많습니다.', 429));
      }
      this.openStreams.set(userId, open + 1);
      const verify = () => this.projectAccess.resolveAndVerifyProjectId(userId, projectIdParam);

      return from(verify()).pipe(
        switchMap((projectId) =>
          merge(
            from(this.syncService.currentVersion(projectId)).pipe(map(toVersionMessage)),
            this.syncEvents.watch(projectId).pipe(map((event) => toVersionMessage(event.version))),
            interval(KEEPALIVE_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
            // 내보낼 것은 없다. 다시 확인이 실패하면 그 오류가 흐름을 끝낸다.
            interval(RECHECK_MS).pipe(
              switchMap(() => from(verify())),
              filter((): boolean => false),
              map(() => ({ type: 'ping', data: '' }) as MessageEvent),
            ),
          ),
        ),
        takeUntil(timer(expiresAt ? Math.max(expiresAt - Date.now(), 0) : MAX_STREAM_MS)),
        finalize(() => {
          const left = (this.openStreams.get(userId) ?? 1) - 1;
          if (left > 0) this.openStreams.set(userId, left);
          else this.openStreams.delete(userId);
        }),
      );
    });
  }

  /** 사람마다 지금 열린 실시간 연결 수. 한 서버 안에서만 센다. */
  private readonly openStreams = new Map<string, number>();
}

/** 붙어 있는 동안 멤버인지 다시 확인하는 간격. */
const RECHECK_MS = 5 * 60 * 1000;
/** 한 사람이 한 서버에 동시에 열 수 있는 실시간 연결 수. 기기·탭 몇 개면 넉넉하다. */
const MAX_STREAMS_PER_USER = 10;
/** 토큰 만료를 읽지 못했을 때 연결을 닫는 상한. 다시 붙으면 그만이다. */
const MAX_STREAM_MS = 60 * 60 * 1000;

/**
 * 붙을 때 쓴 액세스 토큰이 끝나는 때(ms). 가드가 이미 서명을 확인한 토큰이라 몸통만 읽는다.
 * 읽을 수 없으면 null.
 */
function accessTokenExpiry(authorization: string | undefined): number | null {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const body = token?.split('.')[1];
  if (!body) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function toVersionMessage(version: number): MessageEvent {
  return { type: 'sync', data: { version } };
}
