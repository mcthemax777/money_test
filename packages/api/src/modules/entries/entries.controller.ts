import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EntriesService } from './entries.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { EntryDto } from '@money/types';

@ApiTags('Entries')
@Controller('entries')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '거래 등록 (지출/수입/이체/카드대금 결제)' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: EntryDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.entriesService.createEntry(req.user.id, dto, projectId);
  }

  /*
   * ':id' 보다 먼저 선언해야 'tags' 가 id 로 잡히지 않는다 (카테고리의 'reorder' 와 같다).
   */
  @Post('tags')
  @ApiOperation({ summary: '여러 거래의 태그 바꾸기 (더할 것과 뗄 것을 따로 받는다)' })
  changeTags(
    @Request() req: AuthenticatedRequest,
    @Body() dto: EntryDto.ChangeTagsRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.entriesService.changeTags(req.user.id, dto, projectId);
  }

  @Get()
  @ApiOperation({ summary: '거래 목록 (커서 페이지네이션)' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: EntryDto.ListQuery,
    @Query('projectId') projectId?: string,
  ) {
    return this.entriesService.getEntries(req.user.id, query, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '거래 상세 (postings 포함)' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.entriesService.getEntryById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '거래 수정 (전표 전체 교체)' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: EntryDto.UpdateRequest,
  ) {
    return this.entriesService.updateEntry(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '거래 삭제 (잔액 롤백 포함)' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.entriesService.deleteEntry(id, req.user.id);
  }
}
