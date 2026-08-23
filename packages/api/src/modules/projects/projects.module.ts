import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { DatabaseModule } from '../../config/database.module';
import { ProjectAccessService } from '../../common/project-access.guard';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';

@Module({
  // 기준통화를 바꾸면 저장된 환산액을 다시 매겨야 한다 (ProjectRebaseService).
  imports: [DatabaseModule, ExchangeRatesModule],
  providers: [ProjectsService, ProjectAccessService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
