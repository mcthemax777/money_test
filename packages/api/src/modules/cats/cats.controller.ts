import { Body, Controller, Get, Put, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CatDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { CatsService } from './cats.service';

/** 고양이 엠블럼. 읽을 때마다 미션을 다시 판정한다 (`CatsService`). */
@ApiTags('Cats')
@Controller('cats')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CatsController {
  constructor(private readonly cats: CatsService) {}

  @Get()
  @ApiOperation({ summary: '이 가계부가 모은 고양이와 내가 데리고 다니는 고양이' })
  get(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string): Promise<CatDto.State> {
    return this.cats.getState(req.user.id, projectId);
  }

  @Put('parade')
  @ApiOperation({ summary: '데리고 다닐 고양이 정하기' })
  setParade(
    @Request() req: AuthenticatedRequest,
    @Body() body: CatDto.ParadeRequest,
    @Query('projectId') projectId?: string,
  ): Promise<CatDto.State> {
    return this.cats.setParade(req.user.id, projectId, body);
  }
}
