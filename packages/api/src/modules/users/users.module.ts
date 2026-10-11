import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DatabaseModule } from '../../config/database.module';
import { ProjectAccessService } from '../../common/project-access.guard';
import { PlansModule } from '../plans/plans.module';
import { AccountDeletionService } from './account-deletion.service';

@Module({
  imports: [DatabaseModule, PlansModule],
  controllers: [UsersController],
  providers: [UsersService, ProjectAccessService, AccountDeletionService],
  exports: [UsersService, ProjectAccessService],
})
export class UsersModule {}
