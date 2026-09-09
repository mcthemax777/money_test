import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EntryDraftDto, RecurringRuleDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { EntryDraftsService } from './entry-drafts.service';
import { RecurringService } from './recurring.service';

/**
 * 보관함. 아직 거래가 아닌 후보를 담고 꺼내는 창구.
 *
 * 등록(후보 -> 거래)에 해당하는 엔드포인트가 없다. 거래는 `POST /entries` 로 만들고
 * 여기에는 `PATCH` 로 등록 표시만 남긴다 (서비스의 주석에 이유를 적었다).
 */
@ApiTags('EntryDrafts')
@Controller('entry-drafts')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class EntryDraftsController {
  constructor(private readonly drafts: EntryDraftsService) {}

  @Get()
  @ApiOperation({ summary: '보관함 후보 목록' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: EntryDraftDto.ListQuery,
    @Query('projectId') projectId?: string,
  ) {
    return this.drafts.list(req.user.id, query, projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '기기가 읽어 낸 후보 담기 (여러 건)' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: EntryDraftDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.drafts.createMany(req.user.id, dto, projectId);
  }

  // ':id' 보다 먼저 선언해야 'prune' 이 id 로 잡히지 않는다.
  @Delete('prune')
  @ApiOperation({ summary: '처리가 끝난 오래된 후보 걷어내기' })
  prune(
    @Request() req: AuthenticatedRequest,
    @Query('days') days?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.drafts.pruneHandled(req.user.id, Number(days) || 30, projectId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '후보 손보기 / 등록·무시 표시' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: EntryDraftDto.UpdateRequest,
  ) {
    return this.drafts.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '후보 지우기' })
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.drafts.remove(id, req.user.id);
  }
}

/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보가 만들어지는 규칙.
 *
 * 보관함과 한 파일에 둔다 -- 만들어지는 것이 후보이고, 화면에서도 보관함의 한 탭이다.
 *
 * **규칙을 담고 꺼내는 길만 있다.** 회차를 만드는 길(`POST /recurring-rules/run`)은
 * 두지 않았다 -- 기기가 이 목록을 읽어 밀린 날을 셈해 `POST /entry-drafts` 로 올린다.
 */
@ApiTags('EntryDrafts')
@Controller('recurring-rules')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class RecurringRulesController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @ApiOperation({ summary: '반복 등록 목록 (다음 예정일 포함)' })
  list(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string) {
    return this.recurring.list(req.user.id, projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '반복 등록 만들기' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: RecurringRuleDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.recurring.create(req.user.id, dto, projectId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '반복 등록 고치기 / 켜고 끄기' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RecurringRuleDto.UpdateRequest,
  ) {
    return this.recurring.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '반복 등록 지우기 (만들어진 후보는 남는다)' })
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.recurring.remove(id, req.user.id);
  }
}
