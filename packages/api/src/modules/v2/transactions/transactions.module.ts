import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, AccountsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, ProjectAccessService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
