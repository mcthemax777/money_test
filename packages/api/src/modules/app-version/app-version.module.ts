import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/config/database.module';
import { AppVersionController } from './app-version.controller';
import { AppVersionGuard } from './app-version.guard';
import { AppVersionService } from './app-version.service';

/** 앱·웹 버전 정책. 전역 검사(`AppVersionGuard`)는 AppModule 이 APP_GUARD 로 건다. */
@Module({
  imports: [DatabaseModule],
  controllers: [AppVersionController],
  providers: [AppVersionService, AppVersionGuard],
  exports: [AppVersionService, AppVersionGuard],
})
export class AppVersionModule {}
