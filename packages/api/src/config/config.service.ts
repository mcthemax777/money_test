import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

/** HS256 서명 키의 최소 길이. 이보다 짧으면 오프라인 대입 공격을 견디지 못한다. */
const MIN_JWT_SECRET_LENGTH = 32;

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

  /**
   * 토큰 서명 키. 기본값을 두지 않는다.
   *
   * 예전에는 미설정 시 'your-secret-key'로 넘어갔다. 그 값은 공개 저장소에 있는
   * 문자열이라, 환경 변수 하나를 빠뜨리면 누구나 임의의 사용자로 로그인하는
   * 토큰을 만들 수 있었다. 조용히 약한 키로 뜨느니 부팅에 실패하는 편이 낫다.
   * JwtModule.registerAsync가 기동 때 읽으므로 실패는 즉시 드러난다.
   */
  get jwtSecret(): string {
    const secret = this.env.JWT_SECRET?.trim();

    if (!secret) {
      throw new Error('JWT_SECRET 환경 변수가 설정되지 않았습니다.');
    }

    // 짧은 키는 오프라인 대입에 취약하다. `openssl rand -base64 48` 정도를 쓴다.
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET이 너무 짧습니다. ${MIN_JWT_SECRET_LENGTH}자 이상이어야 합니다 ` +
          '(예: openssl rand -base64 48).',
      );
    }

    return secret;
  }

  get jwtExpiresIn(): string {
    return this.env.JWT_EXPIRES_IN || '24h';
  }

  get refreshTokenExpiresIn(): string {
    return this.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
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
