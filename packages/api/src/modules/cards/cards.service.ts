import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountType, CardType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { CardDto } from '@money/types';

/** 금액은 와이어에서 문자열로 오간다. 경계에서 한 번만 Decimal로 바꾼다. */
function toDecimal(value: string | undefined): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  return new Prisma.Decimal(value);
}

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 카드를 등록한다.
   *
   * 결제 통장은 사용자가 반드시 골라야 하며 여기서 새로 만들지 않는다.
   * 신용카드일 때만 "사용액"을 담을 부채 계정을 함께 만든다. 이 계정은 은행 통장이 아니라
   * 카드사에 갚아야 할 금액을 기록하는 칸이고, 통장 목록에는 노출하지 않는다
   * (조회 시 AccountType.credit_card 를 제외하면 된다).
   */
  async createCard(userId: string, dto: CardDto.CreateRequest, projectIdParam?: string) {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectIdParam);

    const paymentAccount = await this.prisma.account.findUnique({
      where: { id: dto.paymentAccountId },
    });
    if (!paymentAccount || paymentAccount.projectId !== projectId) {
      throw new NotFoundException('통장을 찾을 수 없습니다.');
    }
    if (paymentAccount.type === AccountType.credit_card) {
      throw new BadRequestException('카드 부채 계정은 결제 통장으로 쓸 수 없습니다.');
    }

    if (dto.cardType === CardType.credit) {
      if (!dto.statementClosingDay || !dto.paymentDueDay) {
        throw new BadRequestException('신용카드는 마감일과 결제일을 설정해야 합니다.');
      }
      this.assertDayOfMonth(dto.statementClosingDay, '마감일');
      this.assertDayOfMonth(dto.paymentDueDay, '결제일');
    }

    // 카드와 부채 계정은 함께 존재해야 하므로 한 트랜잭션에서 만든다.
    return this.prisma.$transaction(async (tx) => {
      let liabilityAccountId: string | undefined;

      if (dto.cardType === CardType.credit) {
        const liability = await tx.account.create({
          data: {
            projectId,
            // 부채도 결제 통장 주인의 것이다.
            ownerId: paymentAccount.ownerId,
            type: AccountType.credit_card,
            name: dto.name,
            currency: paymentAccount.currency,
          },
        });
        liabilityAccountId = liability.id;
      }

      return tx.card.create({
        data: {
          projectId,
          paymentAccountId: dto.paymentAccountId,
          liabilityAccountId,
          name: dto.name,
          cardType: dto.cardType,
          issuer: dto.issuer,
          cardNumber: dto.cardNumber ?? null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          creditLimit: toDecimal(dto.creditLimit),
          statementClosingDay: dto.statementClosingDay ?? null,
          paymentDueDay: dto.paymentDueDay ?? null,
        },
        include: { paymentAccount: true, liabilityAccount: true },
      });
    });
  }

  /** 카드 목록. 신용카드는 부채 계정 잔액을 "사용액"으로 환산해 함께 준다. */
  async getCards(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    const cards = await this.prisma.card.findMany({
      where: { projectId: finalProjectId, isActive: true },
      include: { paymentAccount: true, liabilityAccount: true },
      orderBy: { createdAt: 'desc' },
    });

    return cards.map((card) => this.toResponse(card));
  }

  async getCardById(id: string, userId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { paymentAccount: true, liabilityAccount: true },
    });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);
    return this.toResponse(card);
  }

  async updateCard(id: string, userId: string, dto: CardDto.UpdateRequest) {
    const card = await this.prisma.card.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    if (dto.statementClosingDay !== undefined) {
      this.assertDayOfMonth(dto.statementClosingDay, '마감일');
    }
    if (dto.paymentDueDay !== undefined) {
      this.assertDayOfMonth(dto.paymentDueDay, '결제일');
    }

    const { creditLimit, ...rest } = dto;
    const data = {
      ...rest,
      ...(creditLimit !== undefined ? { creditLimit: toDecimal(creditLimit) } : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.card.update({
        where: { id },
        data,
        include: { paymentAccount: true, liabilityAccount: true },
      });

      // 카드 이름은 부채 계정 이름과 함께 움직인다 (사용자에게는 같은 대상이므로)
      if (dto.name && updated.liabilityAccountId) {
        await tx.account.update({
          where: { id: updated.liabilityAccountId },
          data: { name: dto.name },
        });
      }

      return this.toResponse(updated);
    });
  }

  /**
   * 카드 비활성화. 갚지 않은 사용액이 남아 있으면 막는다.
   * 원장 기록은 남겨야 하므로 하드 삭제하지 않는다 (부채 계정도 그대로 둔다).
   */
  async deleteCard(id: string, userId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { liabilityAccount: true },
    });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);

    if (card.liabilityAccount && !card.liabilityAccount.balance.isZero()) {
      throw new BadRequestException('갚지 않은 카드 사용액이 남아 있어 삭제할 수 없습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (card.liabilityAccountId) {
        await tx.account.update({
          where: { id: card.liabilityAccountId },
          data: { isActive: false },
        });
      }
      return tx.card.update({ where: { id }, data: { isActive: false } });
    });
  }

  private assertDayOfMonth(day: number, label: string) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new BadRequestException(`${label}은 1~31 사이여야 합니다.`);
    }
  }

  private toResponse(card: {
    cardNumber: string | null;
    liabilityAccount: { balance: Prisma.Decimal } | null;
    [key: string]: unknown;
  }) {
    const { cardNumber, liabilityAccount, ...rest } = card;

    return {
      ...rest,
      cardNumberMasked: cardNumber ? `****-****-****-${cardNumber.slice(-4)}` : '',
      // 부채 잔액은 음수(빚)로 저장되므로 화면에 쓰는 "사용액"은 부호를 뒤집어 준다.
      currentUsage: liabilityAccount ? liabilityAccount.balance.neg() : null,
    };
  }
}
