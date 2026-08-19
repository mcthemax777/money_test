import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { PeopleModule } from '../people/people.module';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, PeopleModule, LedgerModule],
  controllers: [AccountsController],
  providers: [AccountsService, ProjectAccessService],
  exports: [AccountsService],
})
export class AccountsModule {}
