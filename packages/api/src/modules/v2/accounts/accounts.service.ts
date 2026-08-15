import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { AccountDto } from '@money/types';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createAccount(userId: string, dto: AccountDto.CreateRequest, projectIdParam?: string): Promise<AccountDto.Response> {
    // 통장 주인이 존재하는지 확인
    const owner = await this.prisma.person.findUnique({
      where: { id: dto.ownerId },
    });

    if (!owner || owner.userId !== userId) {
      throw new NotFoundException('유효한 통장 주인이 아닙니다.');
    }

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || (dto as any).projectId || dto.projectId,
    );

    return this.prisma.account.create({
      data: {
        projectId: finalProjectId,
        userId,
        ownerId: dto.ownerId,
        name: dto.name,
        accountNumber: dto.accountNumber || null,
        balance: dto.balance,
        bankName: dto.bankName,
        currency: dto.currency || 'KRW',
      },
      include: { owner: true },
    });
  }

  async getAccounts(userId: string, projectId?: string): Promise<AccountDto.Response[]> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.account.findMany({
      where: { userId, projectId: finalProjectId, isActive: true },
      include: { owner: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAccountById(id: string, userId: string): Promise<AccountDto.Response> {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('통장을 찾을 수 없습니다.');
    }

    return account;
  }

  async updateAccount(
    id: string,
    userId: string,
    dto: AccountDto.UpdateRequest,
  ): Promise<AccountDto.Response> {
    await this.getAccountById(id, userId);

    return this.prisma.account.update({
      where: { id },
      data: dto,
      include: { owner: true },
    });
  }

  async deleteAccount(id: string, userId: string): Promise<AccountDto.Response> {
    const account = await this.getAccountById(id, userId);

    // 카드가 연결되어 있는지 확인
    const cardCount = await this.prisma.card.count({
      where: { accountId: id, isActive: true },
    });

    if (cardCount > 0) {
      throw new BadRequestException('이 통장에 연결된 카드가 있어서 삭제할 수 없습니다.');
    }

    // 거래가 있는지 확인
    const transactionCount = await this.prisma.transaction.count({
      where: { accountId: id },
    });

    if (transactionCount > 0) {
      throw new BadRequestException('이 통장의 거래 기록이 있어서 삭제할 수 없습니다.');
    }

    return this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // 통장 잔액 차감 (거래 시 - 마이너스 허용)
  async deductBalance(accountId: string, userId: string, amount: number): Promise<void> {
    await this.getAccountById(accountId, userId);

    await this.prisma.account.update({
      where: { id: accountId },
      data: { balance: { decrement: amount } },
    });
  }

  // 통장 잔액 증가 (입금 시)
  async addBalance(accountId: string, userId: string, amount: number): Promise<void> {
    await this.getAccountById(accountId, userId);

    await this.prisma.account.update({
      where: { id: accountId },
      data: { balance: { increment: amount } },
    });
  }

  // 통계
  async getAccountStats(accountId: string, userId: string): Promise<AccountDto.WithBalance> {
    const account = await this.getAccountById(accountId, userId);

    const totalIncome = await this.prisma.transaction.aggregate({
      where: { accountId, userId, type: 'income' },
      _sum: { amount: true },
    });

    const totalExpense = await this.prisma.transaction.aggregate({
      where: { accountId, userId, type: 'expense' },
      _sum: { amount: true },
    });

    return {
      ...account,
      currentBalance: account.balance,
      totalIncome: totalIncome._sum.amount || 0,
      totalExpense: totalExpense._sum.amount || 0,
    };
  }
}
