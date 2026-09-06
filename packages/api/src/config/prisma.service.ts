import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { ConfigService } from './config.service';

/**
 * 이 프로세스가 데이터베이스에 열어 둘 연결 수를 주소에 박는다.
 *
 * Prisma 는 풀 크기를 주소의 질의 문자열(`?connection_limit=`)에서 읽고, 없으면 스스로
 * **코어 × 2 + 1** 로 정한다. 그 기본값이 인스턴스마다 따로 잡히므로, 여럿을 띄우면
 * 그 수만큼 곱해져 포스트그레스의 상한에 닿는다.
 *
 * 이미 주소에 적혀 있으면 건드리지 않는다. 배포마다 주소를 통째로 넘기는 곳이 있고,
 * 거기 적힌 값이 환경 변수보다 그 배포에 가깝다.
 */
export function withConnectionLimit(url: string, limit: number | null): string {
  if (limit === null) return url;

  /*
   * URL 로 파싱하지 않고 글자로 본다.
   *
   * 비밀번호에 `#` 이나 `?` 가 들어간 주소를 `new URL` 로 돌리면 조용히 다른 주소가
   * 된다. 여기서 하려는 일은 질의 문자열에 칸 하나를 더하는 것뿐이다.
   */
  if (/[?&]connection_limit=/.test(url)) return url;

  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({ datasourceUrl: withConnectionLimit(config.databaseUrl, config.databaseConnectionLimit) });
  }

  async onModuleInit() {
    await this.$connect();

    /*
     * 풀 크기를 로그에 남긴다.
     *
     * 연결이 모자라 나는 오류("too many clients")는 질의하던 요청 쪽에서 터져서, 원인이
     * 풀 설정이라는 것이 드러나지 않는다. 인스턴스마다 이 줄이 찍혀 있으면 `pm2 logs` 에서
     * 곧바로 곱셈을 해 볼 수 있다.
     */
    const limit = this.config.databaseConnectionLimit;
    this.logger.log(
      limit === null
        ? '✅ Prisma connected (연결 수는 Prisma 기본값 = 코어 × 2 + 1. 인스턴스를 늘리면 DATABASE_CONNECTION_LIMIT 을 정할 것)'
        : `✅ Prisma connected (이 프로세스의 연결 수 ${limit})`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('❌ Prisma disconnected from database');
  }
}
