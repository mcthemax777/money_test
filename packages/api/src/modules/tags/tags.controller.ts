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
import { TagsService } from './tags.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { TagDto, ReorderRequest } from '@money/types';

@ApiTags('Tags')
@Controller('tags')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '태그 생성' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: TagDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.tagsService.createTag(req.user.id, dto, projectId || dto.projectId);
  }

  @Get()
  @ApiOperation({ summary: '태그 목록' })
  list(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string) {
    return this.tagsService.getTags(req.user.id, projectId);
  }

  // ':id' 보다 먼저 선언해야 'reorder'가 id로 잡히지 않는다.
  @Patch('reorder')
  @ApiOperation({ summary: '태그 표시 순서 변경' })
  reorder(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ReorderRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.tagsService.reorderTags(req.user.id, dto.ids, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '태그 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.tagsService.getTagById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '태그 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: TagDto.UpdateRequest,
  ) {
    return this.tagsService.updateTag(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '태그 삭제' })
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.tagsService.deleteTag(id, req.user.id);
  }
}
