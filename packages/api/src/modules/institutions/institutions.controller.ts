import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinancialInstitutionType } from '@prisma/client';
import { InstitutionsService } from './institutions.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';

@ApiTags('Institutions')
@Controller('institutions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class InstitutionsController {
  constructor(private readonly institutionsService: InstitutionsService) {}

  @Get()
  @ApiOperation({ summary: '은행/카드사 목록 (기본 제공 + 프로젝트 추가)' })
  list(
    @Request() req: AuthenticatedRequest,
    @Query('type') type?: FinancialInstitutionType,
    @Query('projectId') projectId?: string,
  ) {
    return this.institutionsService.getInstitutions(req.user.id, type, projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '프로젝트 전용 은행/카드사 추가' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: { type: FinancialInstitutionType; name: string; projectId?: string },
    @Query('projectId') projectId?: string,
  ) {
    return this.institutionsService.createInstitution(req.user.id, dto, projectId);
  }
}
