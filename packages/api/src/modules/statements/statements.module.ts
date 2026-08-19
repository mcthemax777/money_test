import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StatementsService } from './statements.service';
import { StatementsController } from './statements.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, LedgerModule],
  controllers: [StatementsController],
  providers: [StatementsService, ProjectAccessService],
  exports: [StatementsService],
})
export class StatementsModule {}
