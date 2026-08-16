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

  // 카드 사용 (체크/신용 로직 분리)
  async useCard(
    cardId: string,
    userId: string,
    personId: string,
    amount: number,
    merchant: string,
    description: string,
    date: Date,
    mainCategoryId: string,
    subCategoryId?: string,
  ) {
    const card = await this.getCardById(cardId, userId);

    if (!card.isActive) {
      throw new BadRequestException('비활성화된 카드입니다.');
    }

    // 체크카드: 즉시 통장에서 차감
    if (card.cardType === 'debit') {
      // 거래 생성
      const projectId = await this.projectAccess.getDefaultProjectId(userId);
      const transaction = await this.prisma.transaction.create({
        data: {
          projectId,
          userId,
          accountId: card.accountId,
          personId,
          cardId,
          type: 'expense',
          amount,
          description,
          date,
          mainCategoryId,
          subCategoryId,
        },
      });

      // 통장 잔액 차감 (마이너스 허용)
      await this.prisma.account.update({
        where: { id: card.accountId },
        data: { balance: { decrement: amount } },
      });

      return { type: 'debit', transaction };
    }

    // 신용카드: 사용액 기록
    if (card.cardType === 'credit') {
      // 한도 확인
      if (card.currentBalance! + amount > card.creditLimit!) {
        throw new BadRequestException('신용카드 한도를 초과했습니다.');
      }

      // CardUsage 생성
      const projectId = await this.projectAccess.getDefaultProjectId(userId);
      const usage = await this.prisma.cardUsage.create({
        data: {
          projectId,
          userId,
          cardId,
          amount,
          merchant,
          date,
        },
      });

      // 카드 사용액 증가
      await this.prisma.card.update({
        where: { id: cardId },
        data: { currentBalance: { increment: amount } },
      });

      return { type: 'credit', usage };
    }
  }

  // 신용카드 결제
  async payCard(cardId: string, userId: string, accountId: string): Promise<any> {
    const card = await this.getCardById(cardId, userId);

    if (card.cardType !== 'credit') {
      throw new BadRequestException('신용카드만 결제 가능합니다.');
    }

    const totalAmount = card.currentBalance || 0;

    if (totalAmount === 0) {
      throw new BadRequestException('결제할 금액이 없습니다.');
    }

    // 통장 확인
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('유효한 통장이 아닙니다.');
    }

    const projectId = account.projectId;

    // 거래 생성
    const transaction = await this.prisma.transaction.create({
      data: {
        projectId,
        userId,
        accountId,
        personId: account.ownerId,
        cardId,
        type: 'expense',
        amount: totalAmount,
        description: `${card.name} 신용카드 결제`,
        date: new Date(),
        mainCategoryId: null,
      },
    });

    // 통장 잔액 차감
    await this.prisma.account.update({
      where: { id: accountId },
      data: { balance: { decrement: totalAmount } },
    });

    // 카드 사용액 초기화
    await this.prisma.card.update({
      where: { id: cardId },
      data: { currentBalance: 0 },
    });

    // CardPayment 기록
    const payment = await this.prisma.cardPayment.create({
      data: {
        projectId,
        userId,
        cardId,
        accountId,
        totalAmount,
        paidAmount: totalAmount,
        status: 'completed',
        paymentDate: new Date(),
      },
    });

    return payment;
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
