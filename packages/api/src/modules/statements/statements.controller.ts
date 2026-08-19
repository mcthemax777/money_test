import {
  Controller,
  Get,
  Post,
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
import { StatementsService } from './statements.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { StatementDto } from '@money/types';

@ApiTags('Statements')
@Controller('statements')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class StatementsController {
  constructor(private readonly statementsService: StatementsService) {}

  @Get()
  @ApiOperation({ summary: '카드 청구서 목록 (미결제액 포함)' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: StatementDto.ListQuery & { projectId?: string; cardId?: string },
  ) {
    return this.statementsService.getStatements(req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '청구서 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.statementsService.getStatementById(id, req.user.id);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '청구서 대금 결제 (금액 생략 시 전액)' })
  pay(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: StatementDto.PayRequest,
  ) {
    return this.statementsService.payStatement(id, req.user.id, dto);
  }
}
