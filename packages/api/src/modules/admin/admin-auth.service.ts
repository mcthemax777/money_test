/**
 * 관리 도구의 로그인. 아이디·비밀번호는 서버 환경 변수에만 있다(한 사람, 한 계정).
 * 비밀번호는 해시(ADMIN_PASSWORD_HASH)나 평문(ADMIN_PASSWORD)으로 둔다.
 *
 * 사용자 로그인(구글)과 섞지 않는다. 토큰의 키도 종류도 다르다(`ConfigService.adminJwtSecret`,
 * `type: 'admin'`). 관리자 토큰은 12시간이면 끝난다 -- 새로 고칠 길을 두지 않는다.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ConfigService } from '@/config/config.service';
import { verifyAdminPassword } from './admin-password';

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface AdminTokenPayload {
  sub: string;
  type: 'admin';
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    const expectedUser = this.config.adminUsername;
    const hash = this.config.adminPasswordHash;
    const plain = this.config.adminPassword;
    if (!expectedUser || (!hash && !plain)) {
      throw new ServiceUnavailableException('관리자 계정이 설정되지 않았습니다.');
    }

    // 아이디가 틀려도 비밀번호 검사를 건너뛰지 않는다. 걸리는 시간으로 아이디를 알아내지 못하게.
    // 해시가 있으면 해시를, 없으면 평문(ADMIN_PASSWORD)을 본다.
    const userOk = sameText(String(username ?? ''), expectedUser);
    const passwordOk = hash
      ? verifyAdminPassword(String(password ?? ''), hash)
      : sameText(String(password ?? ''), plain ?? '');
    if (!userOk || !passwordOk) {
      throw new UnauthorizedException('아이디 또는 비밀번호가 맞지 않습니다.');
    }

    const payload: AdminTokenPayload = { sub: expectedUser, type: 'admin' };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.adminJwtSecret,
      expiresIn: TOKEN_TTL_SECONDS,
    });
    return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString() };
  }

  /** 관리자 토큰을 확인한다. 맞지 않으면 null. */
  async verify(token: string): Promise<AdminTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AdminTokenPayload>(token, {
        secret: this.config.adminJwtSecret,
      });
      return payload.type === 'admin' ? payload : null;
    } catch {
      return null;
    }
  }
}

/** 길이가 달라도 같은 시간이 걸리게, 해시끼리 견준다. */
function sameText(a: string, b: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}
