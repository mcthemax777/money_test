import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { PeopleModule } from '../people/people.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [DatabaseModule, PeopleModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
