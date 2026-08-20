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

  @Get(':year/:month')
  @ApiOperation({ summary: '특정 월의 예산 (오버라이드 포함)' })
  getForMonth(
    @Request() req: AuthenticatedRequest,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query() query: EntryFilterQuery & { projectId?: string },
  ) {
    return this.budgetsService.getBudgetForMonth(
      req.user.id,
      query.projectId!,
      parseInt(year),
      parseInt(month),
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '예산 규칙 삭제' })
  delete(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.budgetsService.deleteBudget(id, req.user.id);
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
