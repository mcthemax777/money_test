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
import { TransactionsService } from './transactions.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { TransactionDto } from '@money/types';

@ApiTags('Transactions (v2)')
@Controller('v2/transactions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '거래 생성 (입금/출금) - 통장 잔액 자동 업데이트' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: TransactionDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.transactionsService.createTransaction(req.user.id, dto, projectId || (req.body as any)?.projectId);
  }

  @Get()
  @ApiOperation({ summary: '거래 목록 (필터링 지원)' })
  list(@Request() req: AuthenticatedRequest, @Query() query: TransactionDto.ListQuery, @Query('projectId') projectId?: string) {
    return this.transactionsService.getTransactions(req.user.id, query, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '거래 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.transactionsService.getTransactionById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '거래 수정 (잔액 자동 조정)' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: TransactionDto.UpdateRequest,
  ) {
    return this.transactionsService.updateTransaction(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '거래 삭제 (잔액 역조정)' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.transactionsService.deleteTransaction(id, req.user.id);
  }

  @Get('account/:accountId/stats')
  @ApiOperation({ summary: '통장별 거래 통계' })
  getStats(@Request() req: AuthenticatedRequest, @Param('accountId') accountId: string) {
    return this.transactionsService.getStatistics(req.user.id, accountId);
  }

  @Get('stats/overall')
  @ApiOperation({ summary: '전체 거래 통계' })
  getOverallStats(@Request() req: AuthenticatedRequest) {
    return this.transactionsService.getStatistics(req.user.id);
  }
}
