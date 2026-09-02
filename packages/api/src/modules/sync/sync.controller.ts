import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type PushRequest, SyncDto } from '@money/types';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { SyncService } from './sync.service';
import { MutationReplayService } from './mutation-replay.service';

@ApiTags('Sync')
@Controller('sync')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly replay: MutationReplayService,
  ) {}

  @Get('pull')
  @ApiOperation({ summary: '마지막으로 받은 번호 뒤의 변경분' })
  pull(
    @Request() req: AuthenticatedRequest,
    @Query() query: SyncDto.PullQuery,
    @Query('projectId') projectId?: string,
  ) {
    return this.syncService.pull(req.user.id, query, projectId);
  }

  @Post('push')
  @ApiOperation({ summary: '기기가 오프라인에서 쌓아 둔 명령을 재생한다' })
  push(
    @Request() req: AuthenticatedRequest,
    @Body() body: PushRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.replay.push(req.user.id, body, projectId);
  }
}
