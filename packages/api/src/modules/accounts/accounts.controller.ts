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
import { AccountsService } from './accounts.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { AccountDto, ReorderRequest } from '@money/types';

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '통장 생성' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AccountDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.accountsService.createAccount(req.user.id, dto, projectId || (req.body as any)?.projectId);
  }

  @Get()
  @ApiOperation({ summary: '통장 목록 (includeInactive=true면 숨긴 통장까지)' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.accountsService.getAccounts(req.user.id, projectId, includeInactive === 'true');
  }

  // ':id' 보다 먼저 선언해야 'reorder'가 id로 잡히지 않는다.
  @Patch('reorder')
  @ApiOperation({ summary: '통장 표시 순서 변경' })
  reorder(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ReorderRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.accountsService.reorderAccounts(req.user.id, dto.ids, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '통장 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.accountsService.getAccountById(id, req.user.id);
  }

  @Get(':id/postings')
  @ApiOperation({ summary: '계좌 원장 (거래별 잔액 추이 포함)' })
  postings(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.accountsService.getAccountPostings(id, req.user.id, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: '통장 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AccountDto.UpdateRequest,
  ) {
    return this.accountsService.updateAccount(id, req.user.id, dto);
  }

  /**
   * 없애기. 기본은 **삭제**이고, `?hide=true` 면 숨기기다.
   *
   * 삭제는 붙은 것이 하나도 없을 때만 된다. 거래내역이 있으면 400 과 코드를 돌려주고,
   * 화면이 그것을 보고 "거래내역이 남아 있습니다 -- 숨기시겠습니까?"로 이어 간다.
   * 사용자가 그러겠다고 하면 같은 자리에 `hide=true` 로 다시 온다.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '통장 삭제 (거래내역이 있으면 거절). hide=true 면 숨기기 (되돌리려면 PATCH isActive=true)',
  })
  delete(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('hide') hide?: string,
  ) {
    return hide === 'true'
      ? this.accountsService.deactivateAccount(id, req.user.id)
      : this.accountsService.deleteAccount(id, req.user.id);
  }
}
