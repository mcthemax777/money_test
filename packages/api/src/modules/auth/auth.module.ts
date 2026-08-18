import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { DatabaseModule } from '../../config/database.module';
import { RedisModule } from '../../config/redis.module';
import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessService } from '../../common/project-access.guard';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    ConfigModule,
    PassportModule,
    UsersModule,
    ProjectsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.jwtSecret,
        signOptions: { expiresIn: configService.jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ProjectAccessService],
  exports: [AuthService],
})
export class AuthModule {}
