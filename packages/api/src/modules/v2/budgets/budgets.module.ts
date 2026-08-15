import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, ProjectAccessService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
