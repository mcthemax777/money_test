import { Module } from '@nestjs/common';

import { ConfigModule } from '@/config/config.module';
import { DatabaseModule } from '@/config/database.module';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingWebhookService } from './billing-webhook.service';
import { PlansService } from './plans.service';
import { StoreBillingService } from './store-billing.service';

/** 프로젝트 이용권 권한. 프로젝트 목록과 관리 도구가 함께 쓰고, 결제 웹훅(RevenueCat)이 적는다. */
@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [BillingWebhookController],
  providers: [PlansService, BillingWebhookService, StoreBillingService],
  exports: [PlansService],
})
export class PlansModule {}
