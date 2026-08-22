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
import { CardsService } from './cards.service';
import { CardLedgerService } from './card-ledger.service';
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { CardDto, ReorderRequest } from '@money/types';

@ApiTags('Cards')
@Controller('cards')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CardsController {
  constructor(
    private readonly cardsService: CardsService,
    private readonly cardLedger: CardLedgerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '카드 생성' })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CardDto.CreateRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.cardsService.createCard(req.user.id, dto, projectId || (req.body as any)?.projectId);
  }

  @Get()
  @ApiOperation({ summary: '카드 목록' })
  list(@Request() req: AuthenticatedRequest, @Query('projectId') projectId?: string) {
    return this.cardsService.getCards(req.user.id, projectId);
  }

  // ':id' 보다 먼저 선언해야 'reorder'가 id로 잡히지 않는다.
  @Patch('reorder')
  @ApiOperation({ summary: '카드 표시 순서 변경' })
  reorder(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ReorderRequest,
    @Query('projectId') projectId?: string,
  ) {
    return this.cardsService.reorderCards(req.user.id, dto.ids, projectId);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: '남은 대금과 마감일 기준 주기별 사용액' })
  usage(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('months') months?: string,
  ) {
    return this.cardLedger.getUsage(id, req.user.id, months ? Number(months) : undefined);
  }

  @Post(':id/transfers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '카드사와 통장 사이 자금 이동 (대금 결제 / 환불 입금)' })
  transfer(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CardDto.TransferRequest,
  ) {
    return this.cardLedger.transfer(id, req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '카드 상세' })
  getById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.cardsService.getCardById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '카드 수정' })
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CardDto.UpdateRequest,
  ) {
    return this.cardsService.updateCard(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '카드 삭제' })
  delete(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.cardsService.deleteCard(id, req.user.id);
  }
}
