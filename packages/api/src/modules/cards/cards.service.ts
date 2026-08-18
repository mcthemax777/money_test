import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { CardDto } from '@money/types';

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createCard(userId: string, dto: CardDto.CreateRequest, projectIdParam?: string): Promise<CardDto.Response> {
    // 통장 확인
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('유효한 통장이 아닙니다.');
    }

    // 신용카드는 한도 필수
    if (dto.cardType === 'credit' && !dto.creditLimit) {
      throw new BadRequestException('신용카드는 한도를 설정해야 합니다.');
    }

    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || (dto as any).projectId || dto.projectId,
    );

    const card = await this.prisma.card.create({
      data: {
        projectId,
        userId,
        accountId: dto.accountId,
        name: dto.name,
        cardNumber: dto.cardNumber || null,
        cardType: dto.cardType,
        issuer: dto.issuer,
        expiryDate: dto.expiryDate || null,
        creditLimit: dto.creditLimit,
        billingDayOfMonth: dto.billingDayOfMonth || 1,
      },
    });

    return this.formatCardResponse(card);
  }

  async getCards(userId: string, projectId?: string): Promise<CardDto.Response[]> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    const cards = await this.prisma.card.findMany({
      where: { userId, projectId: finalProjectId, isActive: true },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });

    return cards.map(card => this.formatCardResponse(card));
  }

  async getCardById(id: string, userId: string): Promise<CardDto.Response> {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { account: true },
    });

    if (!card || card.userId !== userId) {
      throw new NotFoundException('카드를 찾을 수 없습니다.');
    }

    return this.formatCardResponse(card);
  }

  async updateCard(
    id: string,
    userId: string,
    dto: CardDto.UpdateRequest,
  ): Promise<CardDto.Response> {
    await this.getCardById(id, userId);

    const card = await this.prisma.card.update({
      where: { id },
      data: dto,
      include: { account: true },
    });

    return this.formatCardResponse(card);
  }

  async deleteCard(id: string, userId: string): Promise<CardDto.Response> {
    const card = await this.getCardById(id, userId);

    // 거래에서 이 카드가 사용되고 있는지 확인
    const transactionCount = await this.prisma.transaction.count({
      where: { cardId: id },
    });

    if (transactionCount > 0) {
      throw new BadRequestException('이 카드를 사용하는 거래가 있어서 삭제할 수 없습니다.');
    }

    // 신용카드 사용액이 있는지 확인
    if (card.currentBalance && card.currentBalance > 0) {
      throw new BadRequestException('신용카드 사용액이 남아 있어서 삭제할 수 없습니다.');
    }

    const deletedCard = await this.prisma.card.update({
      where: { id },
      data: { isActive: false },
      include: { account: true },
    });

    return this.formatCardResponse(deletedCard);
  }

  private maskCardNumber(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');
    if (cleaned.length < 8) {
      throw new BadRequestException('유효한 카드번호가 아닙니다.');
    }
    return cleaned.slice(0, 4) + '*'.repeat(cleaned.length - 8) + cleaned.slice(-4);
  }

  private formatCardResponse(card: any): CardDto.Response {
    return {
      ...card,
      cardNumberMasked: card.cardNumber,
    };
  }
}
