import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { LedgerService } from './ledger.service';

@Module({
  // 원장은 통화 환산을 위해 프로젝트 기준통화와 환율을 읽는다.
  imports: [DatabaseModule, ExchangeRatesModule],
  providers: [LedgerService, ProjectAccessService],
  exports: [LedgerService],
})
export class LedgerModule {}
