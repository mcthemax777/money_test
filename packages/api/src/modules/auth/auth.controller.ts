import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  isCookieMode,
  readCookie,
  respondWithSession,
} from '@/common/session-cookies';
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
  async signInWithGoogle(
    @Body() dto: Auth.GoogleSignInRequest,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    // 웹(쿠키 방식)이면 토큰을 HttpOnly 쿠키로 내리고 본문에서는 뺀다 (common/session-cookies).
    return respondWithSession(req, res, await this.authService.signInWithGoogle(dto));
  }

  @Post('refresh')
  @Throttle(REFRESH_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '토큰 갱신 (refreshToken으로 새 토큰 쌍 발급)' })
  @ApiOkResponse({ description: '갱신 성공' })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  async refresh(
    @Body() dto: Auth.RefreshRequest,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    // 웹은 갱신 토큰을 본문이 아니라 HttpOnly 쿠키로 든다.
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    const refreshToken = dto?.refreshToken || cookieToken;
    if (!refreshToken) throw new UnauthorizedException('Invalid refresh token');
    try {
      return respondWithSession(req, res, await this.authService.refresh({ refreshToken }));
    } catch (error) {
      // 끝난 세션의 쿠키를 남겨 두면 웹이 "로그인한 상태"로 읽고 같은 갱신을 되풀이한다. 거절된 것이
      // 쿠키의 토큰일 때만 지운다 -- 본문의 옛 토큰(쿠키 세션으로 옮기기)이 거절되었다고 같은 브라우저의
      // 살아 있는 쿠키 세션을 지우지 않는다.
      if (isCookieMode(req) && refreshToken === cookieToken) clearSessionCookies(req, res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 (그 기기의 갱신 토큰 묶음을 끊는다)' })
  @ApiOkResponse({ description: '로그아웃 성공' })
  async logout(
    @Request() req: ExpressRequest & { user: { id: string } },
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    // 그 기기의 갱신 토큰 묶음을 끊는다. 싣지 않은 옛 클라이언트면 끊을 것이 없을 뿐이다.
    // 웹은 갱신 토큰을 쿠키로 들고, 끝나면 그 쿠키를 지운다.
    const result = await this.authService.logout(
      req.user.id,
      body?.refreshToken || readCookie(req, REFRESH_COOKIE),
    );
    clearSessionCookies(req, res);
    return result;
  }
}
