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

  // 플랫폼별로 클라이언트 ID가 다르므로 목록으로 받는다 (웹, iOS, Android...).
  // ID 토큰의 aud 검증에 이 목록 전체를 사용한다.
  get googleClientIds(): string[] {
    const raw = this.env.GOOGLE_CLIENT_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!raw?.length) {
      throw new Error('GOOGLE_CLIENT_IDS 환경 변수가 설정되지 않았습니다.');
    }

    return raw;
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
