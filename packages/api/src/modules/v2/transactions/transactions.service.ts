import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { TransactionDto } from '@money/types';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  // 결제일 계산 (카드의 billingDayOfMonth 기반)
  private calculatePaymentDate(transactionDate: Date, billingDayOfMonth: number): Date {
    const year = transactionDate.getFullYear();
    const month = transactionDate.getMonth();
    const day = transactionDate.getDate();

    // 결제일이 이미 지났으면 다음달
    let paymentMonth = month;
    let paymentYear = year;

    if (day > billingDayOfMonth) {
      paymentMonth += 1;
      if (paymentMonth > 11) {
        paymentMonth = 0;
        paymentYear += 1;
      }
    }

    // 해당 월의 billingDayOfMonth일 생성 (유효성 체크: 31일 카드지만 2월인 경우 등)
    let paymentDay = billingDayOfMonth;
    const lastDayOfMonth = new Date(paymentYear, paymentMonth + 1, 0).getDate();
    if (paymentDay > lastDayOfMonth) {
      paymentDay = lastDayOfMonth;
    }

    return new Date(paymentYear, paymentMonth, paymentDay);
  }

  async createTransaction(
    userId: string,
    dto: TransactionDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<any> {
    // projectId 결정 + 권한 확인 (한 줄로)
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || (dto as any).projectId || dto.projectId,
    );

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

    // 카드 정보 조회 (신용카드 여부 판단)
    let card: any = null;
    if (dto.cardId) {
      card = await this.prisma.card.findUnique({
        where: { id: dto.cardId },
      });
    }

    // 신용카드인 경우 CardUsage와 Transaction 모두 생성
    if (card?.cardType === 'credit' && dto.cardId) {
      console.log(`[CardTransaction] Creating card transaction for card ${dto.cardId}, amount: ${dto.amount}, description: ${dto.description}`);

      // CardUsage 생성
      const cardUsage = await this.prisma.cardUsage.create({
        data: {
          projectId,
          userId,
          cardId: dto.cardId!,
          amount: dto.amount,
          merchant: dto.description,
          date: transactionDate,
          status: 'completed',
          isPaymentDue: true,
        },
      });

      // Transaction 생성 (거래 기록)
      const transaction = await this.prisma.transaction.create({
        data: {
          projectId,
          userId,
          accountId: null,  // 신용카드 사용은 아직 계좌와 무관
          personId: dto.personId,
          cardId: dto.cardId!,
          type: 'credit_usage',  // 신용카드 사용 타입
          amount: dto.amount,
          description: `신용카드 사용 - ${dto.description}`,
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
          card: true,
          mainCategory: true,
          subCategory: true,
        },
      });

      console.log(`[CardTransaction] Created transaction with type: ${transaction.type}, amount: ${transaction.amount}`);

      // 신용카드 미납 결제 정보 생성/업데이트
      // 카드의 billingDayOfMonth를 기반으로 결제일 계산
      const paymentDate = this.calculatePaymentDate(transactionDate, card!.billingDayOfMonth);
      let cardPayment = await this.prisma.cardPayment.findFirst({
        where: {
          cardId: dto.cardId,
          paymentDate,
          status: 'pending',
        },
      });

      if (!cardPayment) {
        cardPayment = await this.prisma.cardPayment.create({
          data: {
            projectId,
            userId,
            cardId: dto.cardId!,
            accountId: dto.accountId,
            totalAmount: dto.amount,
            paidAmount: 0,
            status: 'pending',
            paymentDate,
          },
        });
      } else {
        // 기존 결제에 금액 추가
        await this.prisma.cardPayment.update({
          where: { id: cardPayment.id },
          data: {
            totalAmount: { increment: dto.amount },
          },
        });
      }

      // CardPaymentUsage로 연결
      await this.prisma.cardPaymentUsage.create({
        data: {
          cardPaymentId: cardPayment.id,
          cardUsageId: cardUsage.id,
          amount: dto.amount,
        },
      });

      return transaction;
    }

    // 통장간 이체인 경우 대상 계좌 확인
    if (dto.type === 'transfer' && dto.toAccountId) {
      const toAccount = await this.prisma.account.findUnique({
        where: { id: dto.toAccountId },
      });

      if (!toAccount || toAccount.userId !== userId) {
        throw new NotFoundException('유효한 대상 통장이 아닙니다.');
      }
    }

    // 체크카드 또는 계좌이체인 경우 Transaction 생성
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
        merchant: dto.merchant,
        detailedNote: dto.detailedNote,
        toAccountId: dto.type === 'transfer' ? dto.toAccountId : null,
        date: transactionDate,
        // 이체는 카테고리 불필요
        mainCategoryId: dto.type === 'transfer' ? null : dto.mainCategoryId,
        subCategoryId: dto.type === 'transfer' ? null : dto.subCategoryId,
        tags: dto.tags,
        isRecurring: dto.isRecurring || false,
        recurringPattern: dto.recurringPattern,
        isFixed: dto.isFixed !== undefined ? dto.isFixed : defaultIsFixed,
      },
      include: {
        account: true,
        toAccount: true,
        person: true,
        card: true,
      },
    });

    // 체크카드인 경우 CardUsage 생성
    if (card?.cardType === 'debit' && dto.cardId) {
      await this.prisma.cardUsage.create({
        data: {
          projectId,
          userId,
          cardId: dto.cardId!,
          amount: dto.amount,
          merchant: dto.merchant || dto.description,
          date: transactionDate,
          status: 'completed',
          isPaymentDue: false,
        },
      });
    }

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
    } else if (dto.type === 'transfer' && dto.toAccountId) {
      // 통장간 이체: 출금 계좌에서 차감, 입금 계좌에 입금
      const totalDeduction = dto.amount + (dto.transferFee || 0);
      await this.prisma.account.update({
        where: { id: dto.accountId },
        data: { balance: { decrement: totalDeduction } },
      });
      await this.prisma.account.update({
        where: { id: dto.toAccountId },
        data: { balance: { increment: dto.amount } },
      });

      // 이체 수수료가 있으면 자동으로 expense 거래 생성
      if (dto.transferFee && dto.transferFee > 0) {
        // transferFeeMainCategoryId는 필수
        if (!dto.transferFeeMainCategoryId) {
          throw new BadRequestException('이체 수수료가 있으면 수수료 카테고리를 선택해주세요.');
        }

        // 수수료 거래 생성
        const feeTransaction = await this.prisma.transaction.create({
          data: {
            projectId,
            userId,
            accountId: dto.accountId,
            personId: dto.personId,
            type: 'expense',
            amount: dto.transferFee,
            description: '이체 수수료',
            date: transactionDate,
            mainCategoryId: dto.transferFeeMainCategoryId,
            subCategoryId: dto.transferFeeSubCategoryId || null,
            relatedTransactionId: transaction.id,
            tags: [],
            isRecurring: false,
            isFixed: false,
          },
        });

        // 이체 거래에 relatedTransactionId 업데이트
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { relatedTransactionId: feeTransaction.id },
        });
      }
    }

    return transaction;
  }

  async getTransactions(
    userId: string,
    query: TransactionDto.ListQuery,
    projectId?: string,
  ): Promise<any> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);
    const where: any = { userId, projectId: finalProjectId };

    if (query.accountId) where.accountId = query.accountId;
    if (query.personId) where.personId = query.personId;
    if (query.type) where.type = query.type;
    if (query.mainCategoryId) where.mainCategoryId = query.mainCategoryId;
    if (query.subCategoryId) where.subCategoryId = query.subCategoryId;

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const data = await this.prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        account: true,
        person: true,
        card: true,
        mainCategory: true,
        subCategory: true,
      },
    });

    return {
      data,
      pagination: {
        total: data.length,
        page: 1,
        limit: data.length,
        totalPages: 1,
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

    // 기존 카드 정보
    const oldCard = transaction.cardId ? await this.prisma.card.findUnique({ where: { id: transaction.cardId } }) : null;

    // 새 카드 정보
    const newCard = dto.cardId ? await this.prisma.card.findUnique({ where: { id: dto.cardId } }) : null;

    // 금액 변경 시 통장 잔액 조정
    let balanceAdjustment = 0;
    if (dto.amount && dto.amount !== transaction.amount) {
      const difference = dto.amount - transaction.amount;
      if ((transaction.type === 'income' || transaction.type === 'credit_usage') && transaction.accountId) {
        balanceAdjustment = difference;
      } else if ((transaction.type === 'expense') && transaction.accountId) {
        balanceAdjustment = -difference;
      }
    }

    // 카드 변경 처리
    const oldCardType = oldCard?.cardType;
    const newCardType = newCard?.cardType;
    const cardChanged = oldCardType !== newCardType;

    // 기존 카드 데이터 삭제 (카드 변경 시)
    if (cardChanged && transaction.cardId) {
      if (oldCardType === 'credit') {
        // 신용카드 → 다른 것: CardPayment, CardPaymentUsage, CardUsage 삭제
        const cardUsage = await this.prisma.cardUsage.findFirst({
          where: { cardId: transaction.cardId, date: transaction.date, amount: transaction.amount },
        });
        if (cardUsage) {
          // CardPaymentUsage 삭제
          await this.prisma.cardPaymentUsage.deleteMany({
            where: { cardUsageId: cardUsage.id },
          });
          // CardUsage 삭제
          await this.prisma.cardUsage.delete({ where: { id: cardUsage.id } });
        }

        // CardPayment에서 금액 차감
        const cardPayments = await this.prisma.cardPayment.findMany({
          where: { cardId: transaction.cardId, status: 'pending' },
        });
        for (const payment of cardPayments) {
          await this.prisma.cardPayment.update({
            where: { id: payment.id },
            data: { totalAmount: { decrement: transaction.amount } },
          });
        }
      } else if (oldCardType === 'debit') {
        // 체크카드 → 다른 것: CardUsage 삭제
        const cardUsage = await this.prisma.cardUsage.findFirst({
          where: { cardId: transaction.cardId, date: transaction.date, amount: transaction.amount },
        });
        if (cardUsage) {
          await this.prisma.cardUsage.delete({ where: { id: cardUsage.id } });
        }
      }
    }

    // Transaction 업데이트
    const data: any = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.merchant !== undefined) data.merchant = dto.merchant;
    if (dto.detailedNote !== undefined) data.detailedNote = dto.detailedNote;
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

    // 새 카드 데이터 생성 (카드 변경 시)
    if (cardChanged && newCard) {
      const newDate = dto.date ? new Date(dto.date) : transaction.date;
      const newAmount = dto.amount ?? transaction.amount;
      const newDescription = dto.description ?? transaction.description;

      if (newCardType === 'credit') {
        // 신용카드로 변경: CardUsage, CardPayment, CardPaymentUsage 생성
        const cardUsage = await this.prisma.cardUsage.create({
          data: {
            projectId: transaction.projectId,
            userId,
            cardId: newCard.id,
            amount: newAmount,
            merchant: newDescription,
            date: newDate,
            status: 'completed',
            isPaymentDue: true,
          },
        });

        // CardPayment 찾기 또는 생성
        const paymentDate = this.calculatePaymentDate(newDate, newCard.billingDayOfMonth);
        let cardPayment = await this.prisma.cardPayment.findFirst({
          where: {
            cardId: newCard.id,
            paymentDate,
            status: 'pending',
          },
        });

        if (!cardPayment) {
          cardPayment = await this.prisma.cardPayment.create({
            data: {
              projectId: transaction.projectId,
              userId,
              cardId: newCard.id,
              accountId: transaction.accountId,
              totalAmount: newAmount,
              paidAmount: 0,
              status: 'pending',
              paymentDate,
            },
          });
        } else {
          await this.prisma.cardPayment.update({
            where: { id: cardPayment.id },
            data: { totalAmount: { increment: newAmount } },
          });
        }

        // CardPaymentUsage 생성
        await this.prisma.cardPaymentUsage.create({
          data: {
            cardPaymentId: cardPayment.id,
            cardUsageId: cardUsage.id,
            amount: newAmount,
          },
        });
      } else if (newCardType === 'debit') {
        // 체크카드로 변경: CardUsage 생성
        await this.prisma.cardUsage.create({
          data: {
            projectId: transaction.projectId,
            userId,
            cardId: newCard.id,
            amount: newAmount,
            merchant: newDescription,
            date: newDate,
            status: 'completed',
            isPaymentDue: false,
          },
        });
      }
    } else if (!cardChanged && transaction.cardId && (oldCardType === 'debit' || oldCardType === 'credit')) {
      // 카드는 같은데 금액/날짜/설명이 변경된 경우
      const cardUsage = await this.prisma.cardUsage.findFirst({
        where: {
          cardId: transaction.cardId,
          date: transaction.date,
          amount: transaction.amount,
        },
      });

      if (cardUsage) {
        const updateData: any = {};
        if (dto.amount !== undefined) updateData.amount = dto.amount;
        if (dto.description !== undefined) updateData.merchant = dto.description;
        if (dto.date !== undefined) updateData.date = new Date(dto.date);

        if (Object.keys(updateData).length > 0) {
          await this.prisma.cardUsage.update({
            where: { id: cardUsage.id },
            data: updateData,
          });
        }

        // 신용카드인 경우 CardPayment도 업데이트
        if (oldCardType === 'credit' && dto.amount && dto.amount !== transaction.amount) {
          const difference = dto.amount - transaction.amount;
          const cardPayments = await this.prisma.cardPayment.findMany({
            where: { cardId: transaction.cardId, status: 'pending' },
          });
          for (const payment of cardPayments) {
            await this.prisma.cardPayment.update({
              where: { id: payment.id },
              data: { totalAmount: { increment: difference } },
            });
          }
        }
      }
    }

    // 통장 잔액 조정
    if (balanceAdjustment !== 0 && updated.accountId) {
      if (balanceAdjustment > 0) {
        await this.prisma.account.update({
          where: { id: updated.accountId },
          data: { balance: { increment: balanceAdjustment } },
        });
      } else {
        await this.prisma.account.update({
          where: { id: updated.accountId },
          data: { balance: { decrement: Math.abs(balanceAdjustment) } },
        });
      }
    }

    return updated;
  }

  async deleteTransaction(id: string, userId: string): Promise<any> {
    const transaction = await this.getTransactionById(id, userId);

    // 체크카드 사용 기록 삭제
    if (transaction.cardId && transaction.card?.cardType === 'debit') {
      const cardUsage = await this.prisma.cardUsage.findFirst({
        where: {
          cardId: transaction.cardId,
          date: transaction.date,
          amount: transaction.amount,
        },
      });

      if (cardUsage) {
        await this.prisma.cardUsage.delete({
          where: { id: cardUsage.id },
        });
      }
    }

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
    } else if (transaction.type === 'transfer' && transaction.toAccountId) {
      // 통장간 이체 역조정
      await this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { increment: transaction.amount } },
      });
      await this.prisma.account.update({
        where: { id: transaction.toAccountId },
        data: { balance: { decrement: transaction.amount } },
      });

      // 연결된 수수료 거래도 함께 삭제
      if (transaction.relatedTransactionId) {
        await this.prisma.transaction.delete({
          where: { id: transaction.relatedTransactionId },
        });
      }
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
