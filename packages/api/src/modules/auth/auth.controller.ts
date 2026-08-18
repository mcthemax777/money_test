import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
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
import { AuthenticatedRequest } from '../../common/authenticated-request';
import { Auth } from '@money/types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '구글 로그인 (미등록 사용자는 이때 생성됨)' })
  @ApiOkResponse({ description: '로그인 성공' })
  @ApiBadRequestResponse({ description: 'idToken 누락 또는 이메일 중복' })
  @ApiUnauthorizedResponse({ description: '유효하지 않은 구글 토큰' })
  signInWithGoogle(@Body() dto: Auth.GoogleSignInRequest) {
    return this.authService.signInWithGoogle(dto);
  }

  @Post('refresh')
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
  @ApiOperation({ summary: '로그아웃 (현재 토큰 무효화)' })
  @ApiOkResponse({ description: '로그아웃 성공' })
  logout(@Request() req: AuthenticatedRequest, @Body() dto: Auth.LogoutRequest) {
    const accessToken = req.headers.authorization?.replace('Bearer ', '') ?? '';
    return this.authService.logout(accessToken, dto.refreshToken);
  }
}
