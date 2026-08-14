import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { TransactionDto } from '@money/types';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserDefaultProjectId(userId: string): Promise<string> {
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, role: 'owner' },
      select: { projectId: true },
    });

    if (!member) {
      throw new BadRequestException('기본 프로젝트를 찾을 수 없습니다.');
    }

    return member.projectId;
  }

  async createTransaction(
    userId: string,
    dto: TransactionDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<any> {
    // 통장 확인
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('유효한 통장이 아닙니다.');
    }

    // 사람 확인
    const person = await this.prisma.person.findUnique({
      where: { id: dto.personId },
    });

    if (!person || person.userId !== userId) {
      throw new NotFoundException('유효한 사용자가 아닙니다.');
    }

    const projectId = projectIdParam || (dto as any).projectId || dto.projectId || (await this.getUserDefaultProjectId(userId));

    // 소분류가 있으면 소분류의 defaultIsFixed 사용, 없으면 대분류의 defaultIsFixed 사용
    let defaultIsFixed = false;
    if (dto.subCategoryId) {
      const subCategory = await this.prisma.category.findUnique({
        where: { id: dto.subCategoryId },
      });
      defaultIsFixed = subCategory?.defaultIsFixed || false;
    } else {
      const mainCategory = await this.prisma.category.findUnique({
        where: { id: dto.mainCategoryId },
      });
      defaultIsFixed = mainCategory?.defaultIsFixed || false;
    }

    // 거래 생성
    let transactionDate: Date;
    if (typeof dto.date === 'string') {
      transactionDate = new Date(dto.date);
      if (isNaN(transactionDate.getTime())) {
        throw new BadRequestException('유효한 거래 날짜가 아닙니다.');
      }
    } else {
      transactionDate = new Date(dto.date);
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        projectId,
        userId,
        accountId: dto.accountId,
        personId: dto.personId,
        cardId: dto.cardId,
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        date: transactionDate,
        mainCategoryId: dto.mainCategoryId,
        subCategoryId: dto.subCategoryId,
        tags: dto.tags,
        isRecurring: dto.isRecurring || false,
        recurringPattern: dto.recurringPattern,
        isFixed: dto.isFixed !== undefined ? dto.isFixed : defaultIsFixed,
      },
      include: {
        account: true,
        person: true,
      },
    });

    // 통장 잔액 업데이트
    if (dto.type === 'income') {
      await this.prisma.account.update({
        where: { id: dto.accountId },
        data: { balance: { increment: dto.amount } },
      });
    } else if (dto.type === 'expense') {
      await this.prisma.account.update({
        where: { id: dto.accountId },
        data: { balance: { decrement: dto.amount } },
      });
    }

    return transaction;
  }

  async getTransactions(
    userId: string,
    query: TransactionDto.ListQuery,
    projectId?: string,
  ): Promise<any> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const finalProjectId = projectId || (await this.getUserDefaultProjectId(userId));
    const where: any = { userId, projectId: finalProjectId };

    if (query.accountId) where.accountId = query.accountId;
    if (query.personId) where.personId = query.personId;
    if (query.type) where.type = query.type;
    if (query.mainCategoryId) where.mainCategoryId = query.mainCategoryId;

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          account: true,
          person: true,
          card: true,
          mainCategory: true,
          subCategory: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTransactionById(id: string, userId: string): Promise<any> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        account: true,
        person: true,
        card: true,
        mainCategory: true,
        subCategory: true,
      },
    });

    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundException('거래를 찾을 수 없습니다.');
    }

    return transaction;
  }

  async updateTransaction(
    id: string,
    userId: string,
    dto: TransactionDto.UpdateRequest,
  ): Promise<any> {
    const transaction = await this.getTransactionById(id, userId);

    // 금액이 변경되면 통장 잔액도 조정
    let balanceAdjustment = 0;
    if (dto.amount && dto.amount !== transaction.amount) {
      const difference = dto.amount - transaction.amount;

      if (transaction.type === 'income') {
        balanceAdjustment = difference;
      } else if (transaction.type === 'expense') {
        balanceAdjustment = -difference;
      }

      // 잔액 확인
      const account = await this.prisma.account.findUnique({
        where: { id: transaction.accountId },
      });

      if (account && account.balance + balanceAdjustment < 0) {
        throw new BadRequestException('잔액이 부족합니다.');
      }
    }

    const data: any = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.personId !== undefined) data.personId = dto.personId;
    if (dto.cardId !== undefined) data.cardId = dto.cardId;
    if (dto.mainCategoryId !== undefined) data.mainCategoryId = dto.mainCategoryId;
    if (dto.subCategoryId !== undefined) data.subCategoryId = dto.subCategoryId;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.isFixed !== undefined) data.isFixed = dto.isFixed;

    const updated = await this.prisma.transaction.update({
      where: { id },
      data,
      include: {
        account: true,
        person: true,
        card: true,
        mainCategory: true,
        subCategory: true,
      },
    });

    // 통장 잔액 조정
    if (balanceAdjustment !== 0) {
      if (balanceAdjustment > 0) {
        await this.prisma.account.update({
          where: { id: transaction.accountId },
          data: { balance: { increment: balanceAdjustment } },
        });
      } else {
        await this.prisma.account.update({
          where: { id: transaction.accountId },
          data: { balance: { decrement: Math.abs(balanceAdjustment) } },
        });
      }
    }

    return updated;
  }

  async deleteTransaction(id: string, userId: string): Promise<any> {
    const transaction = await this.getTransactionById(id, userId);

    // 통장 잔액 역조정
    if (transaction.type === 'income') {
      await this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { decrement: transaction.amount } },
      });
    } else if (transaction.type === 'expense') {
      await this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { increment: transaction.amount } },
      });
    }

    return this.prisma.transaction.delete({
      where: { id },
    });
  }

  async getStatistics(userId: string, accountId?: string): Promise<TransactionDto.Statistics> {
    const where: any = { userId };
    if (accountId) where.accountId = accountId;

    const totalIncome = await this.prisma.transaction.aggregate({
      where: { ...where, type: 'income' },
      _sum: { amount: true },
    });

    const totalExpense = await this.prisma.transaction.aggregate({
      where: { ...where, type: 'expense' },
      _sum: { amount: true },
    });

    const byCategory = await this.prisma.transaction.groupBy({
      by: ['mainCategoryId'],
      where: { ...where, type: 'expense' },
      _sum: { amount: true },
    });

    const byPerson = await this.prisma.transaction.groupBy({
      by: ['personId'],
      where,
      _sum: { amount: true },
    });

    // Category와 Person 정보 추가
    const categoryMap: Record<string, string> = {};
    const personMap: Record<string, string> = {};

    const categoryIds = byCategory.filter(c => c.mainCategoryId).map(c => c.mainCategoryId!);
    if (categoryIds.length > 0) {
      const categories = await this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
      });
      categories.forEach(c => {
        categoryMap[c.id] = c.name;
      });
    }

    const personIds = byPerson.map(p => p.personId);
    const people = await this.prisma.person.findMany({
      where: { id: { in: personIds } },
    });

    people.forEach(p => {
      personMap[p.id] = p.name;
    });

    return {
      totalIncome: totalIncome._sum.amount || 0,
      totalExpense: totalExpense._sum.amount || 0,
      net: (totalIncome._sum.amount || 0) - (totalExpense._sum.amount || 0),
      byCategory: Object.fromEntries(
        byCategory.map(item => [categoryMap[item.mainCategoryId!] || item.mainCategoryId || 'Unknown', item._sum?.amount || 0]),
      ),
      byPerson: Object.fromEntries(
        byPerson.map(item => [personMap[item.personId] || item.personId, item._sum?.amount || 0]),
      ),
    };
  }
}
