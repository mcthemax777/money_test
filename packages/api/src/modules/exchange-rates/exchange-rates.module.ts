import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService, ProjectAccessService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
