import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/config/database.module';
import { HolidaysService } from './holidays.service';

@Module({
  imports: [DatabaseModule],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
