import { Module } from '@nestjs/common';

import { ConfigModule } from '@/config/config.module';
import { DatabaseModule } from '@/config/database.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
