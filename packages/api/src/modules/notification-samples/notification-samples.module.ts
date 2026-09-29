import { Module } from '@nestjs/common';

import { ProjectAccessService } from '@/common/project-access.guard';
import { DatabaseModule } from '@/config/database.module';
import { NotificationSamplesController } from './notification-samples.controller';
import { NotificationSamplesService } from './notification-samples.service';

/** 알림 표본과 앱별 문구 규칙. 관리 도구가 서비스를 함께 쓴다. */
@Module({
  imports: [DatabaseModule],
  controllers: [NotificationSamplesController],
  providers: [NotificationSamplesService, ProjectAccessService],
  exports: [NotificationSamplesService],
})
export class NotificationSamplesModule {}
