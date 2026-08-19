import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, LedgerModule],
  controllers: [EntriesController],
  providers: [EntriesService, ProjectAccessService],
  exports: [EntriesService],
})
export class EntriesModule {}
