import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { PeopleModule } from '../people/people.module';
import { LedgerModule } from '../ledger/ledger.module';
import { InstitutionsModule } from '../institutions/institutions.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';

@Module({
  imports: [DatabaseModule, PeopleModule, LedgerModule, InstitutionsModule, ExchangeRatesModule],
  controllers: [AccountsController],
  providers: [AccountsService, ProjectAccessService, ServerClockService],
  exports: [AccountsService],
})
export class AccountsModule {}
