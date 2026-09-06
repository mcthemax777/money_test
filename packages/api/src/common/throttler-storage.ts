/**
 * 요청 상한을 인스턴스 사이에서 함께 센다.
 *
 * `@nestjs/throttler` 의 기본 저장소는 프로세스 메모리다. 인스턴스가 하나일 때는 그것으로
 * 맞지만, 넷을 띄우면 **한도가 네 배가 된다** -- 로드 밸런서가 요청을 흩어 놓아 각
 * 프로세스가 자기 몫만 세기 때문이다. 로그인처럼 값싸게 반복할 수 있는 경로에 좁게 걸어
 * 둔 상한이 특히 그렇다. 그 상한은 인스턴스 수와 상관없이 같은 뜻이어야 한다.
 *
 * 그래서 레디스에서 센다. 신호(SSE)를 나르는 그 레디스다.
 *
 * **레디스가 없거나 죽으면 프로세스 메모리로 되돌아간다.** 그때 상한은 다시 인스턴스마다
 * 따로 세어져 느슨해지지만, 요청은 막히지 않는다. 이 장치의 목적은 자동화된 대량 호출을
 * 끊는 것이지 정확한 계량이 아니라서, 레디스 한 대가 죽었다고 서비스가 멈추는 쪽이 훨씬
 * 나쁘다. 되살아나면 다음 요청부터 다시 함께 센다.
 */
import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
// 이 모양은 패키지의 index 가 다시 내보내지 않는다. 파일을 곧바로 가리킨다.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from 'ioredis';

import { ConfigModule } from '@/config/config.module';
import { ConfigService } from '@/config/config.service';

/** 남의 키와 섞이지 않게. 같은 레디스를 신호가 함께 쓴다. */
const PREFIX = 'money:throttle:';

/**
 * 한 번의 왕복으로 세고 만료를 건다.
 *
 * 세기와 만료 걸기를 두 명령으로 나누면, 그 사이에 프로세스가 죽었을 때 만료가 없는 키가
 * 남는다. 그런 키는 영원히 남아 그 사용자를 영영 막는다. 스크립트 하나로 묶으면 레디스가
 * 통째로 실행하므로 그 틈이 없다.
 *
 * 만료는 **처음 세는 순간에만** 건다. 매번 다시 걸면 요청이 이어지는 동안 창이 끝나지
 * 않아 한 번 걸린 사람이 풀려나지 못한다.
 */
const INCREMENT = `
  local hits = redis.call('INCR', KEYS[1])
  if hits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { hits, redis.call('PTTL', KEYS[1]) }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /**
   * 레디스가 없거나 끊겼을 때 쓰는 자리. 기본 저장소를 그대로 쓴다.
   *
   * 직접 만드는 것이라 Nest 가 생명주기를 부르지 않는다. 끝날 때 여기서 대신 정리한다
   * (그 저장소는 세는 값마다 타이머를 잡아 둔다).
   */
  private readonly local = new ThrottlerStorageService();

  private client: Redis | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    /*
     * 두 번 불릴 수 있다.
     *
     * 이 인스턴스는 하나지만 그것을 가리키는 provider 는 둘이다 -- 이 모듈이 등록한 것과
     * `ThrottlerModule.forRootAsync` 가 옵션에 꽂으며 등록하는 것. Nest 는 생명주기 훅을
     * **provider 마다** 부르므로 같은 객체 위에서 이 함수가 두 번 돈다. 막지 않으면
     * 연결이 둘 생기고, 뒤엣것이 앞엣것을 덮어 앞 연결은 닫히지도 않는다.
     * (연결 수를 세어 보고 알았다.)
     */
    if (this.client) return;

    const url = this.config.redisUrl;
    if (!url) {
      this.logger.log('REDIS_URL 이 없습니다. 요청 상한을 이 프로세스 안에서만 셉니다.');
      return;
    }

    this.client = new Redis(url, {
      /*
       * 끊겼을 때 명령을 쌓아 두지 않는다.
       *
       * 쌓아 두면 레디스가 죽어 있는 동안 요청이 그 큐에서 기다리다 타임아웃으로 죽는다.
       * 세는 일 때문에 요청을 세울 수는 없다 -- 곧바로 실패하고 메모리로 되돌아간다.
       */
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
    });

    this.client.on('error', (error: Error) => {
      // 재연결은 ioredis 가 맡는다. 여기서 하는 일은 알리는 것뿐이다.
      this.logger.warn(`레디스 오류: ${error.message}`);
    });
    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('레디스에 연결했습니다. 요청 상한을 인스턴스 사이에서 함께 셉니다.');
    });
    this.client.on('close', () => {
      this.ready = false;
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.local.onApplicationShutdown();
    if (!this.client) return;

    try {
      await this.client.quit();
    } catch {
      // 이미 끊긴 연결이다. 종료를 막을 이유가 없다.
      this.client.disconnect();
    }
  }

  /**
   * 이 키를 한 번 세고, 지금까지의 횟수와 창이 끝나기까지 남은 초를 돌려준다.
   *
   * `ttl` 은 밀리초, 돌려주는 `timeToExpire` 는 **초**다. 기본 저장소가 그렇게 하고
   * 가드가 그 값을 Retry-After 헤더에 그대로 싣는다.
   */
  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    if (!this.client || !this.ready) return this.local.increment(key, ttl);

    try {
      const [hits, remaining] = (await this.client.eval(
        INCREMENT,
        1,
        `${PREFIX}${key}`,
        String(ttl),
      )) as [number, number];

      return { totalHits: hits, timeToExpire: Math.floor(Math.max(0, remaining) / 1000) };
    } catch (error) {
      /*
       * 세지 못했다고 요청을 막지 않는다.
       *
       * 여기서 던지면 500 이 되어, 레디스 한 대가 죽는 순간 모든 요청이 죽는다.
       * 메모리로 세면 한도가 인스턴스마다 따로 잡혀 느슨해질 뿐이다.
       */
      this.logger.warn(`레디스로 세지 못해 이 프로세스에서 셉니다: ${describe(error)}`);
      return this.local.increment(key, ttl);
    }
  }

  /** 지금 레디스로 세고 있는가. 상태 점검과 검증이 본다. */
  get isRedisConnected(): boolean {
    return this.ready;
  }
}

/**
 * 저장소만 내보내는 모듈.
 *
 * `ThrottlerModule.forRootAsync` 가 이것을 주입받아 자기 옵션에 꽂고, 그 모듈이 다시
 * `ThrottlerStorage` 토큰으로 내보낸다(가드가 그 토큰을 본다). 전역으로 두는 이유는
 * 가드가 앱 어디에나 걸리기 때문이다.
 *
 * **`{ provide: ThrottlerStorage, useExisting: ... }` 를 여기 두면 안 된다.** 별칭도
 * 하나의 provider 라 Nest 가 생명주기 훅을 그 몫만큼 더 부르고, `onModuleInit` 이 두 번
 * 돌아 레디스 연결이 둘 생긴다(뒤엣것이 앞엣것을 덮어 앞 연결은 닫히지도 않는다).
 * 실제로 그렇게 만들었다가 연결 수를 세어 보고 알았다.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlerStorageModule {}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
