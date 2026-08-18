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
import { AuthenticatedRequest } from '@/common/authenticated-request';
import { CardDto } from '@money/types';

@ApiTags('Cards')
@Controller('cards')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

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
