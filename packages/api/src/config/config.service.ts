import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class ConfigService {
  private readonly env = process.env;

  get nodeEnv(): string {
    return this.env.NODE_ENV || 'development';
  }

  get port(): number {
    return parseInt(this.env.PORT || '3001', 10);
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/money';
  }

  get jwtSecret(): string {
    return this.env.JWT_SECRET || 'your-secret-key';
  }

  get jwtExpiresIn(): string {
    return this.env.JWT_EXPIRES_IN || '24h';
  }

  get refreshTokenExpiresIn(): string {
    return this.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
  }

  get redisUrl(): string {
    return this.env.REDIS_URL || 'redis://localhost:6379';
  }

  get corsOrigin(): string[] {
    return this.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get logLevel(): string {
    return this.env.LOG_LEVEL || 'debug';
  }
}
