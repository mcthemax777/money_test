import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Auth } from '@money/types';

/*
 * 로그인 경로는 전역 상한(분당 300)보다 훨씬 좁게 잡는다.
 *
 * 사람이 쓰는 빈도는 분당 몇 번을 넘지 않는데, 자동화하면 토큰 대입이나
 * 구글 검증 호출 남용에 그대로 쓰인다. 토큰 갱신은 화면 여러 개가 동시에
 * 401을 받는 순간이 있어 로그인보다 여유를 둔다.
 */
const SIGN_IN_LIMIT = { default: { ttl: 60_000, limit: 10 } };
const REFRESH_LIMIT = { default: { ttl: 60_000, limit: 30 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '구글 로그인 (미등록 사용자는 이때 생성됨)' })
  @ApiOkResponse({ description: '로그인 성공' })
  @ApiBadRequestResponse({ description: 'idToken 누락 또는 이메일 중복' })
  @ApiUnauthorizedResponse({ description: '유효하지 않은 구글 토큰' })
  signInWithGoogle(@Body() dto: Auth.GoogleSignInRequest) {
    return this.authService.signInWithGoogle(dto);
  }

  @Post('refresh')
  @Throttle(REFRESH_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '토큰 갱신 (refreshToken으로 새 토큰 쌍 발급)' })
  @ApiOkResponse({ description: '갱신 성공' })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  refresh(@Body() dto: Auth.RefreshRequest) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 (클라이언트가 토큰을 폐기한다)' })
  @ApiOkResponse({ description: '로그아웃 성공' })
  logout() {
    return this.authService.logout();
  }
}
