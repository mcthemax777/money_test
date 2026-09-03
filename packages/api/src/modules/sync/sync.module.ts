import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ProjectAccessService } from '@/common/project-access.guard';
import { EntriesModule } from '../entries/entries.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { MutationReplayService } from './mutation-replay.service';

@Module({
  /*
   * 재생은 온라인 쓰기와 같은 서비스를 쓴다. 그래서 여기서 원장과 전표 모듈을 들여온다.
   * 새 쓰기 경로를 만들지 않는 것이 2단계의 전제다 (설계 문서의 D3).
   */
  /*
   * 실시간 신호(SyncEventsService)는 RealtimeModule 이 전역으로 내보낸다. 보내는 쪽
   * (쓰기 미들웨어)과 받는 쪽(이 컨트롤러)이 같은 인스턴스를 보아야 하기 때문이다.
   */
  imports: [DatabaseModule, LedgerModule, EntriesModule],
  controllers: [SyncController],
  providers: [SyncService, MutationReplayService, ProjectAccessService],
  exports: [SyncService, MutationReplayService],
})
export class SyncModule {}
