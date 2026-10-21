import { Module } from '@nestjs/common';

import { ConfigModule } from '@/config/config.module';
import { DatabaseModule } from '@/config/database.module';
import { PushController, PushForgetController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [PushController, PushForgetController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
