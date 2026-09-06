import { Module } from '@nestjs/common';

import { ConfigModule } from './config.module';
import { PrismaService } from './prisma.service';

@Module({
  // PrismaService 가 연결 수를 ConfigService 에서 읽는다.
  imports: [ConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
