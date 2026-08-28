import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AccountType,
  CardType,
  FinancialInstitutionType,
  Prisma,
  ProjectRole,
} from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { InstitutionsService } from '../institutions/institutions.service';
import { CardDto, isCardColor } from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { toCardResponse } from './card-view';
import { toOptionalMoney } from '@/common/money';

/** 카드 응답에 함께 실어 주는 관계. 응답 모양을 한곳에서 정한다. */
const CARD_INCLUDE = {
  paymentAccount: true,
  liabilityAccount: true,
  issuer: true,
} satisfies Prisma.CardInclude;

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly institutions: InstitutionsService,
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
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam,
      'editor',
    );

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

    this.assertCardColor(dto.color);

    await this.institutions.assertUsable(
      dto.issuerId,
      projectId,
      FinancialInstitutionType.card_issuer,
    );

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

      // 카드는 결제 통장 아래에 묶여 보이고 드래그도 그 안에서 이뤄진다.
      // 같은 결제 통장의 마지막 번호 다음을 준다.
      const lastOrder = await tx.card.aggregate({
        where: { projectId, paymentAccountId: dto.paymentAccountId },
        _max: { sortOrder: true },
      });

      return tx.card.create({
        data: {
          projectId,
          paymentAccountId: dto.paymentAccountId,
          liabilityAccountId,
          sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
          name: dto.name,
          cardType: dto.cardType,
          issuerId: dto.issuerId,
          cardNumber: dto.cardNumber ?? null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          creditLimit: toOptionalMoney(dto.creditLimit, '카드 한도'),
          // 실적은 체크카드에도 있다. 세는 구간만 달라진다 (달력 월).
          performanceAmount: toOptionalMoney(dto.performanceAmount, '카드 실적 기준액'),
          statementClosingDay: dto.statementClosingDay ?? null,
          paymentDueDay: dto.paymentDueDay ?? null,
          // 고르지 않으면 null이다. 종류별 기본색은 화면이 정한다.
          color: dto.color ?? null,
        },
        include: CARD_INCLUDE,
      });
    });
  }

  /**
   * 카드 목록. 신용카드는 부채 계정 잔액을 "사용액"으로 환산해 함께 준다.
   * includeInactive를 주면 숨긴 카드까지 함께 준다 (되돌리기 화면용).
   */
  async getCards(userId: string, projectId?: string, includeInactive = false) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    const cards = await this.prisma.card.findMany({
      where: {
        projectId: finalProjectId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: CARD_INCLUDE,
      // 사용자가 드래그로 정한 순서. 같으면 최근에 만든 것부터.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    return cards.map((card) => toCardResponse(card));
  }

  /** 드래그로 바꾼 표시 순서 저장 */
  async reorderCards(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
      'editor',
    );

    const rows = await this.prisma.card.findMany({
      where: { projectId: finalProjectId },
      select: { id: true },
    });
    assertReorderIds(ids, new Set(rows.map((row) => row.id)));

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.card.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.getCards(userId, finalProjectId);
  }

  async getCardById(id: string, userId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: CARD_INCLUDE,
    });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId);
    return toCardResponse(card);
  }

  async updateCard(id: string, userId: string, dto: CardDto.UpdateRequest) {
    const card = await this.prisma.card.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId, 'editor');

    if (dto.statementClosingDay !== undefined) {
      this.assertDayOfMonth(dto.statementClosingDay, '마감일');
    }
    if (dto.paymentDueDay !== undefined) {
      this.assertDayOfMonth(dto.paymentDueDay, '결제일');
    }
    this.assertCardColor(dto.color);

    // 요청 본문을 스프레드로 Prisma에 넘기면 안 된다.
    // DTO가 인터페이스라 ValidationPipe(whitelist: false)가 낯선 키를 지우지 않으므로
    // `{"issuer": {"connect": {"id": "fi_bank_shinhan"}}}` 같은 관계 조작이 그대로 통과해
    // 아래 issuerId 검증을 우회한다. 그래서 허용 컬럼만 골라 담는다.
    const data: Prisma.CardUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // 카드 번호는 응답에 마스킹만 나가므로 화면이 원래 값을 되돌려 보낼 수 없다.
    // 키가 없으면 그대로 두고, 빈 문자열이면 지운다.
    if (dto.cardNumber !== undefined) data.cardNumber = dto.cardNumber || null;
    if (dto.expiryDate !== undefined) {
      data.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    }
    if (dto.statementClosingDay !== undefined) data.statementClosingDay = dto.statementClosingDay;
    if (dto.paymentDueDay !== undefined) data.paymentDueDay = dto.paymentDueDay;
    // 빈 문자열은 "기본색으로 되돌리기"다. 색 선택은 비울 수 있어야 한다.
    if (dto.color !== undefined) data.color = dto.color || null;
    if (dto.creditLimit !== undefined) data.creditLimit = toOptionalMoney(dto.creditLimit, '카드 한도');
    if (dto.performanceAmount !== undefined) {
      data.performanceAmount = toOptionalMoney(dto.performanceAmount, '카드 실적 기준액');
    }

    // 생성과 같은 검증을 거쳐야 한다. 검증 없이 저장하면 다른 프로젝트의 기관이나
    // 은행을 카드사 자리에 넣을 수 있다.
    if (dto.issuerId !== undefined) {
      await this.institutions.assertUsable(
        dto.issuerId,
        card.projectId,
        FinancialInstitutionType.card_issuer,
      );
      data.issuer = { connect: { id: dto.issuerId } };
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.card.update({
        where: { id },
        data,
        include: CARD_INCLUDE,
      });

      // 카드 이름은 부채 계정 이름과 함께 움직인다 (사용자에게는 같은 대상이므로)
      if (dto.name && updated.liabilityAccountId) {
        await tx.account.update({
          where: { id: updated.liabilityAccountId },
          data: { name: dto.name },
        });
      }

      // 표시 여부도 함께 움직여야 한다. 카드를 숨길 때 부채 계정을 함께 내리므로
      // (deactivateCard) 다시 표시할 때도 함께 올리지 않으면 사용액이 계산되지 않는다.
      if (dto.isActive !== undefined && updated.liabilityAccountId) {
        await tx.account.update({
          where: { id: updated.liabilityAccountId },
          data: { isActive: dto.isActive },
        });
      }

      return toCardResponse(updated);
    });
  }

  /**
   * 카드 숨기기. 갚지 않은 사용액이 남아 있으면 막는다.
   * 원장 기록은 남겨야 하므로 하드 삭제하지 않는다 (부채 계정도 그대로 둔다).
   */
  async deactivateCard(id: string, userId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { liabilityAccount: true },
    });
    if (!card) throw new NotFoundException('카드를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, card.projectId, 'editor');

    if (card.liabilityAccount && !card.liabilityAccount.balance.isZero()) {
      throw new BadRequestException('갚지 않은 카드 사용액이 남아 있어 숨길 수 없습니다.');
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

  /**
   * 아는 색 열쇠말인지 본다.
   *
   * 화면은 이 값으로 tailwind 클래스를 고르므로, 모르는 값이 저장되면 그 카드는
   * 색 없이 그려진다. 저장 전에 막는다. 생략과 빈 문자열은 "기본색"이라 통과시킨다.
   */
  private assertCardColor(color: string | undefined) {
    if (color === undefined || color === '') return;
    if (!isCardColor(color)) {
      throw new BadRequestException('카드 색을 알 수 없습니다.');
    }
  }

}
