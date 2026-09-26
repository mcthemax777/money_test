import { Body, Controller, Delete, HttpCode, HttpStatus, Put, Request, UseGuards } from '@nestjs/common';
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
