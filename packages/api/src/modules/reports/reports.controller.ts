import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { ReportDto } from '@money/types';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  @ApiOperation({ summary: '월 수입/지출 합계 (고정·변동 구분 포함)' })
  summary(@Request() req: AuthenticatedRequest, @Query() query: ReportDto.PeriodQuery) {
    return this.reportsService.getSummary(req.user.id, query);
  }

  @Get('category-breakdown')
  @ApiOperation({ summary: '카테고리별 구성비' })
  categoryBreakdown(
    @Request() req: AuthenticatedRequest,
    @Query() query: ReportDto.CategoryBreakdownQuery,
  ) {
    return this.reportsService.getCategoryBreakdown(req.user.id, query);
  }

  @Get('daily-expense')
  @ApiOperation({ summary: '날짜별 지출·수입 (일반/과소비). 누적 그래프의 재료' })
  dailyExpense(
    @Request() req: AuthenticatedRequest,
    @Query() query: ReportDto.DailyExpenseQuery,
  ) {
    return this.reportsService.getDailyExpense(req.user.id, query);
  }

  @Get('net-worth')
  @ApiOperation({ summary: '순자산 (현금성 + 투자 시가 - 부채), 사람별 소계 포함' })
  netWorth(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string) {
    return this.reportsService.getNetWorth(req.user.id, projectId);
  }

  @Get('balance-history')
  @ApiOperation({ summary: '자산 잔액 추이 (전체 또는 계좌별, 년/월/일 단위)' })
  balanceHistory(
    @Request() req: AuthenticatedRequest,
    @Query() query: ReportDto.BalanceHistoryQuery,
  ) {
    return this.reportsService.getBalanceHistory(req.user.id, query);
  }

  @Get('trend')
  @ApiOperation({ summary: '월별 시계열 (카테고리/계좌/카드/전체)' })
  trend(@Request() req: AuthenticatedRequest, @Query() query: ReportDto.TrendQuery) {
    return this.reportsService.getTrend(req.user.id, query);
  }

  @Get('account-profit')
  @ApiOperation({ summary: '투자·저축 계좌의 누적 수익 (이체로 넣은 원금은 제외)' })
  accountProfit(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.reportsService.getAccountProfit(req.user.id, { projectId });
  }

  @Get('payment-methods')
  @ApiOperation({ summary: '결제수단별 지출 (통장/체크카드/신용카드)' })
  paymentMethods(@Request() req: AuthenticatedRequest, @Query() query: ReportDto.PeriodQuery) {
    return this.reportsService.getPaymentMethods(req.user.id, query);
  }
}
