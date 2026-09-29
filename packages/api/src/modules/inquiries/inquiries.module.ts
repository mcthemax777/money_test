import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/config/database.module';
import { PushModule } from '../push/push.module';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';

/** 문의하기. 관리 도구가 서비스를 함께 쓴다(답하기). */
@Module({
  imports: [DatabaseModule, PushModule],
  controllers: [InquiriesController],
  providers: [InquiriesService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
