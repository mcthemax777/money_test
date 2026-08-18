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
import { AccountDto } from '@money/types';

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
  @ApiOperation({ summary: '통장 목록' })
  list(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string) {
    return this.accountsService.getAccounts(req.user.id, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: '통장 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.accountsService.getAccountById(id, req.user.id);
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '통장 삭제' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.accountsService.deleteAccount(id, req.user.id);
  }
}
