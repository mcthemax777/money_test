import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [TagsController],
  providers: [TagsService, ProjectAccessService],
  exports: [TagsService],
})
export class TagsModule {}
