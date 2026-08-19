import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [ReportsController],
  providers: [ReportsService, ProjectAccessService],
  exports: [ReportsService],
})
export class ReportsModule {}
