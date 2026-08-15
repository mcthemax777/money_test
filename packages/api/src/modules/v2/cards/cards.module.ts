import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, AccountsModule],
  controllers: [CardsController],
  providers: [CardsService, ProjectAccessService],
  exports: [CardsService],
})
export class CardsModule {}
