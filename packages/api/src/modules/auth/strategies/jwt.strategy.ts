import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '../../../config/config.service';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwtSecret,
    });
  }

  async validate(payload: { sub: string; type?: string }) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // 서버가 토큰을 기억하지 않으므로 폐기 목록 조회가 없다.
    // 유효성은 서명과 만료로만 판단하고, 사용자 존재 확인은 아래에서 한다.
    return this.authService.validateUser(payload.sub);
  }
}
