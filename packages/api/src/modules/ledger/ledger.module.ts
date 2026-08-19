import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { LedgerService } from './ledger.service';

@Module({
  imports: [DatabaseModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
