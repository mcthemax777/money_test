import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DatabaseModule } from '../../config/database.module';
import { ProjectAccessService } from '../../common/project-access.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService, ProjectAccessService],
  exports: [UsersService, ProjectAccessService],
})
export class UsersModule {}
