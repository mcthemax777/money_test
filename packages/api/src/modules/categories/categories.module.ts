import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';

@Module({
  imports: [DatabaseModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, ProjectAccessService, ServerClockService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
