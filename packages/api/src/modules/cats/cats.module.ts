import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ProjectAccessService } from '@/common/project-access.guard';
import { BudgetsModule } from '../budgets/budgets.module';
import { ReportsModule } from '../reports/reports.module';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';

@Module({
  // 달 단위 미션(예산 지키기·순수입)이 홈과 같은 합계를 쓴다.
  imports: [DatabaseModule, BudgetsModule, ReportsModule],
  controllers: [CatsController],
  providers: [CatsService, ProjectAccessService],
  exports: [CatsService],
})
export class CatsModule {}
