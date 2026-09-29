import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ConfigModule } from '@/config/config.module';
import { AppVersionModule } from '../app-version/app-version.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { NotificationSamplesModule } from '../notification-samples/notification-samples.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

/** 관리 도구. 토큰의 키는 서명·검증할 때마다 넘긴다(`adminJwtSecret`). */
@Module({
  imports: [ConfigModule, HolidaysModule, AppVersionModule, NotificationSamplesModule, JwtModule.register({})],
  controllers: [AdminController],
  providers: [AdminAuthService, AdminGuard],
})
export class AdminModule {}
