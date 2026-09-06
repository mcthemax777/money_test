import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { PeopleService } from './people.service';
import { PeopleController } from './people.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';

@Module({
  imports: [DatabaseModule],
  controllers: [PeopleController],
  providers: [PeopleService, ProjectAccessService, ServerClockService],
  exports: [PeopleService],
})
export class PeopleModule {}
