import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  // 예산액을 저장 통화 <-> 표시 통화로 옮긴다.
  imports: [DatabaseModule, ExchangeRatesModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, ProjectAccessService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
