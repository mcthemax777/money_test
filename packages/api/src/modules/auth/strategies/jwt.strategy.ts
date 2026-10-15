import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ACCESS_COOKIE, readCookie } from '@/common/session-cookies';
import { ConfigService } from '../../../config/config.service';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      // 앱은 머리글, 웹은 HttpOnly 쿠키(common/session-cookies)로 싣는다.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => readCookie(req, ACCESS_COOKIE) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.jwtSecret,
    });
  }

  async validate(payload: { sub: string; type?: string }) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // 액세스 토큰은 짧게 살아 폐기 목록을 보지 않는다(갱신 토큰은 서버가 기억한다, AuthService.refresh).
    // 유효성은 서명과 만료로만 판단하고, 사용자 존재 확인은 아래에서 한다.
    return this.authService.validateUser(payload.sub);
  }
}
