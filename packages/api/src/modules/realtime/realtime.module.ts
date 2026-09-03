/**
 * 동기화 신호를 나르는 모듈.
 *
 * 전역이다. 신호를 보내는 자리(쓰기 요청을 마친 미들웨어)와 받는 자리(SSE 컨트롤러)가
 * 서로 다른 모듈에 있어서, 두 곳이 같은 인스턴스를 보게 하려면 여기서 한 번만 만들어야
 * 한다. 모듈마다 새로 만들면 보낸 신호가 아무에게도 닿지 않는다.
 */
import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '@/config/config.module';
import { SyncEventsService } from './sync-events.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SyncEventsService],
  exports: [SyncEventsService],
})
export class RealtimeModule {}
