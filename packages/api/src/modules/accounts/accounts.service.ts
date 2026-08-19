import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { AccountDto } from '@money/types';

/**
 * 사용자가 "통장"으로 인식하지 않는 내부 계정.
 * credit_card는 카드 화면의 "사용액", opening_balance는 기초잔액 상대편이라
 * 통장 목록에 노출하면 안 된다.
 */
export const HIDDEN_ACCOUNT_TYPES: AccountType[] = [
  AccountType.credit_card,
  AccountType.opening_balance,
];

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
  ) {}

  async createAccount(userId: string, dto: AccountDto.CreateRequest, projectIdParam?: string) {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
    );

    if (HIDDEN_ACCOUNT_TYPES.includes(dto.type as AccountType)) {
      throw new BadRequestException('이 유형의 계정은 직접 만들 수 없습니다.');
    }

    const owner = await this.prisma.person.findUnique({ where: { id: dto.ownerId } });
    if (!owner || owner.projectId !== projectId) {
      throw new NotFoundException('유효한 통장 주인이 아닙니다.');
    }

    const account = await this.prisma.account.create({
      data: {
        projectId,
        ownerId: dto.ownerId,
        type: dto.type as AccountType,
        name: dto.name,
        bankName: dto.bankName ?? null,
        accountNumber: dto.accountNumber ?? null,
        currency: dto.currency ?? 'KRW',
      },
      include: { owner: true },
    });

    // 개설 잔액은 컬럼에 직접 쓰지 않고 전표로 남긴다.
    // 그래야 "잔액 = posting 합계" 불변식이 처음부터 성립한다.
    const opening = dto.openingBalance ? new Prisma.Decimal(dto.openingBalance) : null;
    if (opening && !opening.isZero()) {
      await this.ledger.setOpeningBalance({
        projectId,
        accountId: account.id,
        amount: opening,
        // 기준일을 주지 않으면 오늘. 과거 거래보다 뒤에 놓이면 원장 순서가 어색해지므로
        // 과거 데이터를 넣을 계좌는 호출부에서 앞선 날짜를 지정한다.
        date: dto.openingBalanceDate ? new Date(dto.openingBalanceDate) : new Date(),
        createdByUserId: userId,
      });
      return this.getAccountById(account.id, userId);
    }

    return account;
  }

  /** 통장 목록. 카드 부채와 자본 계정은 제외한다. */
  async getAccounts(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.account.findMany({
      where: {
        projectId: finalProjectId,
        isActive: true,
        type: { notIn: HIDDEN_ACCOUNT_TYPES },
      },
      include: { owner: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAccountById(id: string, userId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { owner: true },
    });
    if (!account) throw new NotFoundException('통장을 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, account.projectId);
    return account;
  }

  async updateAccount(id: string, userId: string, dto: AccountDto.UpdateRequest) {
    const account = await this.getAccountById(id, userId);

    const { balance, ...rest } = dto;

    if (Object.keys(rest).length > 0) {
      await this.prisma.account.update({ where: { id }, data: rest });
    }

    // 잔액 수정은 컬럼 덮어쓰기가 아니라 차액만큼의 조정 전표로 처리한다.
    if (balance !== undefined) {
      await this.ledger.adjustBalanceTo({
        projectId: account.projectId,
        accountId: id,
        targetBalance: new Prisma.Decimal(balance),
        date: new Date(),
        createdByUserId: userId,
      });
    }

    return this.getAccountById(id, userId);
  }

  /**
   * 계좌 원장. 이 계좌를 거쳐간 posting만 시간순으로 준다.
   *
   * 예전에는 `accountId OR toAccountId` 조합에 credit_usage 제외 조건까지 붙여야 했다.
   * 원장 구조에서는 accountId 하나로 끝난다.
   */
  async getAccountPostings(
    id: string,
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    await this.getAccountById(id, userId);
    const limit = Math.min(Number(options.limit) || 50, 200);

    const rows = await this.prisma.posting.findMany({
      where: { accountId: id },
      include: {
        entry: { select: { id: true, date: true, description: true, merchant: true } },
        card: { select: { id: true, name: true } },
      },
      orderBy: [{ entry: { date: 'desc' } }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // 잔액 추이를 함께 준다 (최신부터 거슬러 올라가며 계산)
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id } });
    let running = account.balance;
    const data = page.map((posting) => {
      const balanceAfter = running;
      running = running.sub(posting.amount);
      return {
        postingId: posting.id,
        entryId: posting.entry.id,
        date: posting.entry.date.toISOString(),
        description: posting.entry.description,
        merchant: posting.entry.merchant,
        amount: posting.amount.toString(),
        balanceAfter: balanceAfter.toString(),
        cardId: posting.card?.id ?? null,
        cardName: posting.card?.name ?? null,
      };
    });

    return { data, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * 통장 비활성화. 원장 기록은 남겨야 하므로 하드 삭제하지 않는다.
   */
  async deleteAccount(id: string, userId: string) {
    const account = await this.getAccountById(id, userId);

    const cardCount = await this.prisma.card.count({
      where: { paymentAccountId: id, isActive: true },
    });
    if (cardCount > 0) {
      throw new BadRequestException('이 통장에 연결된 카드가 있어서 삭제할 수 없습니다.');
    }

    const postingCount = await this.prisma.posting.count({ where: { accountId: id } });
    if (postingCount > 0) {
      throw new BadRequestException('이 통장의 거래 기록이 있어서 삭제할 수 없습니다.');
    }

    if (!account.balance.isZero()) {
      throw new BadRequestException('잔액이 남아 있어 삭제할 수 없습니다.');
    }

    return this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
