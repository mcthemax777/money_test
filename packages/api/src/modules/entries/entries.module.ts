import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  // 목록 금액을 표시 통화로 옮긴다.
  imports: [DatabaseModule, LedgerModule, ExchangeRatesModule],
  controllers: [EntriesController],
  providers: [EntriesService, ProjectAccessService],
  exports: [EntriesService],
})
export class EntriesModule {}
