import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/config/database.module';
import { PlansService } from './plans.service';

/** 프로젝트 이용권 권한. 프로젝트 목록과 관리 도구가 함께 쓴다. 결제 웹훅이 붙을 자리다. */
@Module({
  imports: [DatabaseModule],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
