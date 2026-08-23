import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';

@Module({
  // 순자산이 외화 계좌를 최신 환율로 재평가한다.
  imports: [DatabaseModule, ExchangeRatesModule],
  controllers: [ReportsController],
  providers: [ReportsService, ProjectAccessService],
  exports: [ReportsService],
})
export class ReportsModule {}
