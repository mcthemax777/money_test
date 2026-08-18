import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, ProjectAccessService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
