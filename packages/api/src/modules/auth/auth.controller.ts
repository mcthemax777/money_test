import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
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

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '회원가입' })
  @ApiCreatedResponse({ description: '회원가입 성공' })
  @ApiBadRequestResponse({ description: 'Email already exists' })
  signUp(@Body() dto: Auth.SignUpRequest) {
    return this.authService.signUp(dto);
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '로그인' })
  @ApiOkResponse({ description: '로그인 성공' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  signIn(@Body() dto: Auth.SignInRequest) {
    return this.authService.signIn(dto);
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
