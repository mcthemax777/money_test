import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PushDeviceDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { PushService } from './push.service';

@ApiTags('Push')
@Controller('push/devices')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '이 기기의 푸시 토큰 적기 (로그인할 때)' })
  async register(@Request() req: AuthenticatedRequest, @Body() dto: PushDeviceDto.RegisterRequest) {
    await this.push.register(req.user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '이 기기의 푸시 토큰 지우기 (로그아웃할 때)' })
  async unregister(
    @Request() req: AuthenticatedRequest,
    @Body() dto: PushDeviceDto.UnregisterRequest,
  ) {
    await this.push.unregister(req.user.id, dto);
  }
}

/**
 * 로그인 없이 토큰으로 푸시 기기를 뺀다 (2026-10-21).
 *
 * 앱은 로그아웃하기 전에 위 DELETE 로 토큰을 지운다. 그때 끊겨 있으면 실패하고, 로그아웃한 뒤에는 인증이
 * 없어 다시 부를 수 없었다 -- 앞 사람의 알림이 그 기기에 계속 왔다. 앱이 그 토큰을 적어 두었다가 다음
 * 실행에 이 길로 지운다. FCM 토큰은 그 기기만 아는 값이라, 이를 아는 쪽만 그 기기의 알림을 끌 수 있다.
 */
@ApiTags('Push')
@Controller('push/forget')
export class PushForgetController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '토큰으로 이 기기의 푸시 등록 지우기 (로그아웃 뒤)' })
  async forget(@Body() dto: PushDeviceDto.UnregisterRequest) {
    await this.push.forget(dto);
  }
}
