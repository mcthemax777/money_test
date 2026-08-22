import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { InstitutionsModule } from '../institutions/institutions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CardsService } from './cards.service';
import { CardLedgerService } from './card-ledger.service';
import { CardsController } from './cards.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, AccountsModule, InstitutionsModule, LedgerModule],
  controllers: [CardsController],
  providers: [CardsService, CardLedgerService, ProjectAccessService],
  exports: [CardsService],
})
export class CardsModule {}
