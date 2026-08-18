import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { CardPaymentsService } from './card-payments.service';
import { CardPaymentsController } from './card-payments.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [CardPaymentsController],
  providers: [CardPaymentsService, ProjectAccessService],
  exports: [CardPaymentsService],
})
export class CardPaymentsModule {}
