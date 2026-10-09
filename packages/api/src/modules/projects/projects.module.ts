import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { DatabaseModule } from '../../config/database.module';
import { ProjectAccessService } from '../../common/project-access.guard';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  // 기준통화를 바꾸면 저장된 환산액을 다시 매겨야 한다 (ProjectRebaseService).
  // 프로젝트 목록에 이용권 상태를 붙인다 (PlansService).
  imports: [DatabaseModule, ExchangeRatesModule, PlansModule],
  providers: [ProjectsService, ProjectAccessService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
