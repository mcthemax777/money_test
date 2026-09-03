/**
 * "이 프로젝트가 바뀌었다"를 인스턴스 너머로 나르는 자리.
 *
 * 기기는 번호(Project.syncVersion)를 커서로 들고 변경분을 받아 간다. 그래서 여기서 나를
 * 것은 데이터가 아니라 **신호 하나**다. 화면에 그릴 값은 언제나 /sync/pull 이 가져온다.
 * 그 덕에 신호가 유실되어도 정확성이 상하지 않는다 -- 다음 동기화가 커서로 따라잡는다.
 * 신호는 화면이 얼마나 빨리 따라붙는지만 정한다.
 *
 * 전달 방법은 둘이다.
 *
 *   - **REDIS_URL 이 없으면** 이 프로세스 안에서만 흘린다. 인스턴스가 하나인 배포에서는
 *     이것으로 충분하고, 새로 띄울 것이 없다.
 *   - **REDIS_URL 이 있으면** 레디스 pub/sub 으로 보낸다. 쓰기를 받은 인스턴스와 SSE
 *     연결을 들고 있는 인스턴스가 다를 수 있기 때문이다. 자기가 보낸 것도 구독으로
 *     되돌아 받는다. 경로를 하나로 두어야 "내 것만 두 번 도착하는" 종류의 버그가 없다.
 *
 * 레디스가 끊긴 동안에는 자기 프로세스 안으로만 흘린다. 그 사이 다른 인스턴스에 붙은
 * 화면은 늦게 따라붙지만, 쓰기는 막히지 않는다. **알림 때문에 저장이 실패해서는 안 된다.**
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable, Subject, filter } from 'rxjs';

import { ConfigService } from '@/config/config.service';

/** 프로젝트 하나가 어느 번호까지 갔는지. */
export interface SyncEvent {
  projectId: string;
  version: number;
}

/** 모든 프로젝트가 한 채널을 함께 쓴다. 프로젝트별 채널은 구독이 사용자 수만큼 늘어난다. */
const CHANNEL = 'money:sync';

@Injectable()
export class SyncEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncEventsService.name);

  /** 이 프로세스에 붙어 있는 구독자들. SSE 응답 하나가 구독 하나다. */
  private readonly stream = new Subject<SyncEvent>();

  /** 레디스는 구독 모드에 들어가면 다른 명령을 받지 못한다. 그래서 연결을 둘 둔다. */
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  /** 지금 레디스로 보낼 수 있는가. 아니면 이 프로세스 안으로만 흘린다. */
  private redisReady = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.redisUrl;
    if (!url) {
      this.logger.log('REDIS_URL 이 없습니다. 동기화 신호를 이 프로세스 안에서만 흘립니다.');
      return;
    }

    this.publisher = this.connect(url, 'publisher');
    this.subscriber = this.connect(url, 'subscriber');

    /*
     * 구독은 연결될 때마다 다시 건다.
     *
     * 레디스가 끊겼다 붙으면 구독이 사라진 채 연결만 살아난다. 그때 다시 걸지 않으면
     * 조용히 아무 신호도 받지 못하는 인스턴스가 된다 -- 오류가 나지 않아 알아채기 어렵다.
     */
    this.subscriber.on('ready', () => {
      this.subscriber?.subscribe(CHANNEL).catch((error: unknown) => {
        this.logger.error(`구독 실패: ${describe(error)}`);
      });
    });

    this.subscriber.on('message', (channel: string, payload: string) => {
      if (channel !== CHANNEL) return;

      const event = parseEvent(payload);
      if (!event) {
        this.logger.warn(`알 수 없는 신호를 버립니다: ${payload.slice(0, 200)}`);
        return;
      }
      this.stream.next(event);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stream.complete();
    await Promise.all([close(this.publisher), close(this.subscriber)]);
  }

  /**
   * 신호를 보낸다.
   *
   * 절대 던지지 않고 기다리지도 않는다. 부르는 쪽은 이미 커밋을 끝낸 쓰기 경로다.
   */
  publish(projectId: string, version: number): void {
    const event: SyncEvent = { projectId, version };

    if (!this.publisher || !this.redisReady) {
      // 레디스를 쓰지 않거나 지금 끊겨 있다. 적어도 이 인스턴스의 화면은 따라붙는다.
      this.stream.next(event);
      return;
    }

    this.publisher.publish(CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn(`신호를 보내지 못했습니다: ${describe(error)}`);
      this.stream.next(event);
    });
  }

  /** 이 프로젝트의 신호만 흘려보내는 흐름. SSE 응답이 이것을 구독한다. */
  watch(projectId: string): Observable<SyncEvent> {
    return this.stream.asObservable().pipe(filter((event) => event.projectId === projectId));
  }

  /** 지금 레디스로 나가고 있는가. 상태 점검과 검증이 본다. */
  get isRedisConnected(): boolean {
    return this.redisReady;
  }

  private connect(url: string, role: 'publisher' | 'subscriber'): Redis {
    const client = new Redis(url, {
      /*
       * 끊겼을 때 명령을 쌓아 두지 않는다.
       *
       * 쌓아 두면 레디스가 오래 죽어 있는 동안 신호가 메모리에 밀리고, 되살아나는 순간
       * 지난 신호가 한꺼번에 쏟아진다. 신호는 "지금 번호"를 알리는 것이라 지난 것을
       * 뒤늦게 보내는 데 뜻이 없다. 구독 쪽은 예외다 -- 다시 붙을 때 SUBSCRIBE 명령이
       * 나가야 한다.
       */
      enableOfflineQueue: role === 'subscriber',
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
    });

    client.on('error', (error: Error) => {
      // 재연결은 ioredis 가 맡는다. 여기서 하는 일은 알리는 것뿐이다.
      this.logger.warn(`레디스 ${role} 오류: ${error.message}`);
    });

    if (role === 'publisher') {
      client.on('ready', () => {
        this.redisReady = true;
        this.logger.log('레디스에 연결했습니다. 동기화 신호를 인스턴스 사이로 흘립니다.');
      });
      client.on('close', () => {
        this.redisReady = false;
      });
    }

    return client;
  }
}

function parseEvent(payload: string): SyncEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SyncEvent>;
    if (typeof parsed?.projectId !== 'string' || typeof parsed?.version !== 'number') return null;
    return { projectId: parsed.projectId, version: parsed.version };
  } catch {
    return null;
  }
}

async function close(client: Redis | null): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // 이미 끊긴 연결이다. 종료를 막을 이유가 없다.
    client.disconnect();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
