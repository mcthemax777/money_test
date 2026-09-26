import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { InstitutionsModule } from '../institutions/institutions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CardsService } from './cards.service';
import { CardLedgerService } from './card-ledger.service';
import { CardsController } from './cards.controller';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';

@Module({
  imports: [DatabaseModule, AccountsModule, InstitutionsModule, LedgerModule],
  controllers: [CardsController],
  providers: [CardsService, CardLedgerService, ProjectAccessService, ServerClockService],
  // 재생(sync)이 청구액 확정을 온라인과 같은 서비스로 돌린다.
  exports: [CardsService, CardLedgerService],
})
export class CardsModule {}
