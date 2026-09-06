import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';

@Module({
  imports: [DatabaseModule],
  controllers: [TagsController],
  providers: [TagsService, ProjectAccessService, ServerClockService],
  exports: [TagsService],
})
export class TagsModule {}
