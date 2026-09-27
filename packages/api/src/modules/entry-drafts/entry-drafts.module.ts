import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/config/database.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { ProjectAccessService } from '@/common/project-access.guard';
import { EntryDraftsController, RecurringRulesController } from './entry-drafts.controller';
import { EntryDraftsService } from './entry-drafts.service';
import { RecurringService } from './recurring.service';

@Module({
  imports: [DatabaseModule, HolidaysModule],
  controllers: [EntryDraftsController, RecurringRulesController],
  providers: [EntryDraftsService, RecurringService, ProjectAccessService],
  exports: [EntryDraftsService, RecurringService],
})
export class EntryDraftsModule {}
