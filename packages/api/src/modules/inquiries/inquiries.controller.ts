import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { APP_PLATFORM_HEADER, APP_VERSION_HEADER, type InquiryDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { InquiriesService } from './inquiries.service';

/** 글을 쓰는 속도의 상한. 사람이 적는 속도면 넉넉하다. */
const WRITE_LIMIT = { default: { ttl: 60_000, limit: 10 } };

/** 사용자 쪽 문의하기. 답하는 길은 관리 도구(`AdminController`)에만 있다. */
@ApiTags('Inquiries')
@Controller('inquiries')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get()
  @ApiOperation({ summary: '내 문의 목록' })
  list(@Request() req: AuthenticatedRequest) {
    return this.inquiries.listMine(req.user.id);
  }

  // ':id' 보다 먼저 선언해야 'unread-count' 가 id 로 잡히지 않는다.
  @Get('unread-count')
  @ApiOperation({ summary: '읽지 않은 답 수 (설정의 배지)' })
  unread(@Request() req: AuthenticatedRequest) {
    return this.inquiries.unreadCount(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '문의 하나 (열면 읽은 것으로 적는다)' })
  get(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.inquiries.getMine(req.user.id, id);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '문의 보내기' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: InquiryDto.CreateRequest,
    @Headers(APP_PLATFORM_HEADER) platform?: string,
    @Headers(APP_VERSION_HEADER) appVersion?: string,
  ) {
    return this.inquiries.create(req.user.id, dto, {
      platform: platform || null,
      appVersion: appVersion || null,
    });
  }

  /*
   * 문의하기를 떠났다. 목록·대화에서 나가거나 앱을 뒤로 보낼 때 웹·앱이 부른다.
   *
   * 몇 초마다 오던 조회가 끊기기만 해서는 서버가 떠난 것을 `INQUIRY_WATCH_MS` 가 지나서야
   * 안다. 그 사이에 온 답은 푸시 없이 묻힌다. 떠나는 순간 알려 곧바로 푸시가 가게 한다.
   */
  @Post('unwatch')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '문의하기를 떠났다 (답장 푸시를 곧바로 다시 보낸다)' })
  async unwatch(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.inquiries.unwatch(req.user.id);
  }

  @Post(':id/messages')
  @Throttle(WRITE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '같은 문의에 덧붙여 묻기' })
  add(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: InquiryDto.MessageRequest) {
    return this.inquiries.addMine(req.user.id, id, dto);
  }
}
