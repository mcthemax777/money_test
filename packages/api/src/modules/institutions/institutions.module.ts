import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/config/database.module';
import { InstitutionsService } from './institutions.service';
import { InstitutionsController } from './institutions.controller';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [InstitutionsController],
  providers: [InstitutionsService, ProjectAccessService],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
