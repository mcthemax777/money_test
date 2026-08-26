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
import { BudgetsService } from './budgets.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { BudgetDto, EntryFilterQuery } from '@money/types';
import { assertYearMonthParts } from '@/common/year-month';

@ApiTags('Budgets')
@Controller('budgets')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '예산 규칙 생성' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BudgetDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.budgetsService.createBudget(req.user.id, dto, projectId);
  }

  @Get()
  @ApiOperation({ summary: '예산 규칙 목록' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: BudgetDto.ListQuery,
  ) {
    return this.budgetsService.getBudgets(req.user.id, query);
  }

  /* ':year/:month'와 ':id'보다 먼저 둔다. 뒤에 두면 'schedule'이 id로 잡힌다. */
  @Get('schedule')
  @ApiOperation({ summary: '한 분류(또는 전체 예산)의 월별 금액 목록' })
  schedule(
    @Request() req: AuthenticatedRequest,
    @Query() query: BudgetDto.ScheduleQuery,
  ) {
    return this.budgetsService.getBudgetSchedule(req.user.id, query);
  }

  @Get(':year/:month')
  @ApiOperation({ summary: '특정 월의 예산 (오버라이드 포함)' })
  getForMonth(
    @Request() req: AuthenticatedRequest,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query() query: EntryFilterQuery & { projectId?: string },
  ) {
    // parseInt만 하면 "99"가 그대로 내려가 zonedMonthRange가 2034년을 만든다.
    const parsed = assertYearMonthParts(year, month);
    return this.budgetsService.getBudgetForMonth(
      req.user.id,
      query.projectId!,
      parsed.year,
      parsed.month,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '예산 규칙 상세' })
  getById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.budgetsService.getBudgetById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '예산 규칙 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: BudgetDto.UpdateRequest,
  ) {
    return this.budgetsService.updateBudget(id, req.user.id, dto);
  }

  /*
   * 라우트 순서에 주의한다. Delete(':id')보다 먼저 두어야 한다.
   * 뒤에 두면 /budgets 요청이 id 없는 :id로 잡힐 여지가 생긴다.
   */
  @Delete()
  @ApiOperation({ summary: '프로젝트의 예산 전체 삭제 (월별 조정값 포함)' })
  reset(
    @Request() req: AuthenticatedRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.budgetsService.resetBudgets(req.user.id, projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '예산 규칙 삭제 (fromMonth를 주면 그 달부터만)' })
  delete(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('fromMonth') fromMonth?: string,
  ) {
    return this.budgetsService.deleteBudget(id, req.user.id, fromMonth);
  }

  @Post('override')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '월별 예산 오버라이드 설정' })
  createOverride(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BudgetDto.OverrideRequest,
  ) {
    return this.budgetsService.createOverride(req.user.id, dto);
  }

  @Delete('override/:overrideId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '월별 예산 오버라이드 해제' })
  deleteOverride(
    @Request() req: AuthenticatedRequest,
    @Param('overrideId') overrideId: string,
  ) {
    return this.budgetsService.deleteOverride(overrideId, req.user.id);
  }
}
