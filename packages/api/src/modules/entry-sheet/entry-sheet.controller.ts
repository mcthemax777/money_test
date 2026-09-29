import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EntrySheetDto } from '@money/types';

import { AuthenticatedRequest } from '@/common/authenticated-request';
import { EntrySheetService } from './entry-sheet.service';

/**
 * 거래내역 엑셀. 파일은 화면이 읽고 쓰고, 여기는 글자로 된 행을 오간다.
 *
 * 가져오기는 한 번에 `EntrySheetDto.MAX_ROWS` 행까지다. 화면이 나눠 보낸다.
 */
@ApiTags('EntrySheet')
@Controller('entry-sheet')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class EntrySheetController {
  constructor(private readonly sheet: EntrySheetService) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '엑셀 행을 거래로 (없는 구성원·자산·분류·태그는 만든다)' })
  import(
    @Request() req: AuthenticatedRequest,
    @Body() dto: EntrySheetDto.ImportRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.sheet.import(req.user.id, dto, projectId);
  }

  @Get('export')
  @ApiOperation({ summary: '거래를 엑셀 행으로 (오래된 것부터, 분할은 줄마다)' })
  export(
    @Request() req: AuthenticatedRequest,
    @Query() query: EntrySheetDto.ExportQuery,
    @Query('projectId') projectId?: string,
  ) {
    return this.sheet.export(req.user.id, query, projectId);
  }
}
