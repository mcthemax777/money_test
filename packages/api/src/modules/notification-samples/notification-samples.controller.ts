import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { NotificationSampleDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { NotificationSamplesService } from './notification-samples.service';

/**
 * 기기 쪽 창구. 표본을 올리고 규칙을 내려받는다.
 *
 * 표본을 읽고 규칙을 만드는 길은 관리 도구(`AdminController`)에만 있다.
 */
@ApiTags('NotificationSamples')
@Controller()
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationSamplesController {
  constructor(private readonly samples: NotificationSamplesService) {}

  @Post('notification-samples')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '기기가 모은 알림 원문 담기 (돈 표기가 있는 것)' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: NotificationSampleDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.samples.createMany(req.user.id, dto, projectId);
  }

  @Get('notification-rules')
  @ApiOperation({ summary: '켜 둔 앱별 알림 문구 규칙 (기기가 알림을 읽을 때 먼저 대 본다)' })
  rules() {
    return this.samples.listEnabledRules();
  }
}
