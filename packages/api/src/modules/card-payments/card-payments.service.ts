import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';

@Injectable()
export class CardPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  // 미납 결제 조회
  async getPendingPayments(
    userId: string,
    query: { cardId?: string; projectId?: string },
  ): Promise<any> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);

    const where: any = {
      userId,
      projectId,
      status: 'pending',
    };

    if (query.cardId) {
      where.cardId = query.cardId;
    }

    const payments = await this.prisma.cardPayment.findMany({
      where,
      include: {
        card: true,
        account: true,
        usages: {
          include: {
            cardUsage: true,
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    return {
      data: payments.map((payment) => ({
        id: payment.id,
        cardId: payment.cardId,
        cardName: payment.card.name,
        cardIssuer: payment.card.issuer,
        totalAmount: payment.totalAmount,
        paidAmount: payment.paidAmount,
        pendingAmount: payment.totalAmount - payment.paidAmount,
        paymentDate: payment.paymentDate,
        accountId: payment.accountId,
        accountName: payment.account.name,
        usageCount: payment.usages.length,
        status: payment.status,
        usages: payment.usages.map((u) => ({
          id: u.cardUsage.id,
          merchant: u.cardUsage.merchant,
          amount: u.amount,
          date: u.cardUsage.date,
        })),
      })),
    };
  }

  // 결제 상세 조회
  async getPaymentDetail(paymentId: string, userId: string): Promise<any> {
    const payment = await this.prisma.cardPayment.findUnique({
      where: { id: paymentId },
      include: {
        card: true,
        account: true,
        usages: {
          include: {
            cardUsage: true,
          },
        },
      },
    });

    if (!payment || payment.userId !== userId) {
      throw new NotFoundException('결제 정보를 찾을 수 없습니다.');
    }

    return {
      ...payment,
      pendingAmount: payment.totalAmount - payment.paidAmount,
      usages: payment.usages.map((u) => ({
        id: u.cardUsage.id,
        merchant: u.cardUsage.merchant,
        amount: u.amount,
        date: u.cardUsage.date,
      })),
    };
  }

  // 결제 실행
  async payCardPayment(
    paymentId: string,
    userId: string,
    dto: { amount: number; transactionDate?: string },
  ): Promise<any> {
    const payment = await this.prisma.cardPayment.findUnique({
      where: { id: paymentId },
      include: { card: true, account: true },
    });

    if (!payment || payment.userId !== userId) {
      throw new NotFoundException('결제 정보를 찾을 수 없습니다.');
    }

    const pendingAmount = payment.totalAmount - payment.paidAmount;

    // 금액 유효성 검사
    if (dto.amount <= 0) {
      throw new BadRequestException('결제 금액은 0보다 커야 합니다.');
    }

    if (dto.amount > pendingAmount) {
      throw new BadRequestException(
        `미납액(${pendingAmount}원)을 초과할 수 없습니다.`,
      );
    }

    // 통장 잔액 확인
    const account = await this.prisma.account.findUnique({
      where: { id: payment.accountId },
    });

    if (!account || account.balance < dto.amount) {
      throw new BadRequestException('통장 잔액이 부족합니다.');
    }

    // 거래 날짜 설정
    const transactionDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : new Date();

    // Transaction 생성 (신용카드 결제)
    const transaction = await this.prisma.transaction.create({
      data: {
        projectId: payment.projectId,
        userId,
        accountId: payment.accountId,
        personId: payment.card.userId === userId
          ? (await this.prisma.person.findFirst({
              where: { userId },
              orderBy: { createdAt: 'asc' },
            }))?.id || ''
          : '',
        cardId: payment.cardId,
        cardPaymentId: paymentId,  // 신용카드 결제와 연결
        type: 'credit_payment',
        amount: dto.amount,
        description: `[신용카드 결제] ${payment.card.name} (${payment.card.issuer})`,
        date: transactionDate,
        isFixed: false,
      },
      include: {
        account: true,
        person: true,
        card: true,
      },
    });

    // CardPayment 업데이트
    const newPaidAmount = payment.paidAmount + dto.amount;
    const isFullyPaid = newPaidAmount >= payment.totalAmount;

    const updatedPayment = await this.prisma.cardPayment.update({
      where: { id: paymentId },
      data: {
        paidAmount: newPaidAmount,
        status: isFullyPaid ? 'completed' : 'pending',
      },
      include: {
        card: true,
        account: true,
      },
    });

    // 통장 잔액 감소
    await this.prisma.account.update({
      where: { id: payment.accountId },
      data: { balance: { decrement: dto.amount } },
    });

    return {
      payment: {
        id: updatedPayment.id,
        totalAmount: updatedPayment.totalAmount,
        paidAmount: updatedPayment.paidAmount,
        pendingAmount: updatedPayment.totalAmount - updatedPayment.paidAmount,
        status: updatedPayment.status,
      },
      transaction,
      message: `${dto.amount.toLocaleString()}원이 결제되었습니다.${isFullyPaid ? ' 결제가 완료되었습니다.' : ' 부분 결제되었습니다.'}`,
    };
  }

  // 결제 취소
  async cancelPayment(transactionId: string, userId: string): Promise<any> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundException('거래를 찾을 수 없습니다.');
    }

    if (transaction.type !== 'expense' || !transaction.cardId) {
      throw new BadRequestException('신용카드 결제 거래만 취소 가능합니다.');
    }

    // CardPayment 조회 (Transaction의 cardPaymentId를 통해)
    const payment = await this.prisma.cardPayment.findUnique({
      where: {
        id: transaction.cardPaymentId!,
      },
    });

    if (!payment) {
      throw new NotFoundException('결제 정보를 찾을 수 없습니다.');
    }

    // Transaction 삭제
    await this.prisma.transaction.delete({
      where: { id: transactionId },
    });

    // CardPayment 업데이트
    const newPaidAmount = Math.max(0, payment.paidAmount - transaction.amount);
    await this.prisma.cardPayment.update({
      where: { id: payment.id },
      data: {
        paidAmount: newPaidAmount,
        status: newPaidAmount > 0 ? 'pending' : 'pending',
      },
    });

    // 통장 잔액 복구
    await this.prisma.account.update({
      where: { id: payment.accountId },
      data: { balance: { increment: transaction.amount } },
    });

    return {
      message: `${transaction.amount.toLocaleString()}원 결제가 취소되었습니다.`,
    };
  }

  // 자동 결제 (모든 pending 결제 한 번에 처리)
  async autoPayAllPending(
    userId: string,
    projectId?: string,
  ): Promise<any> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
    );

    const pendingPayments = await this.prisma.cardPayment.findMany({
      where: {
        userId,
        projectId: finalProjectId,
        status: 'pending',
        paymentDate: { lte: new Date() },
      },
      include: { account: true },
    });

    if (pendingPayments.length === 0) {
      return {
        message: '처리할 결제가 없습니다.',
        processed: [],
      };
    }

    const results: any[] = [];

    for (const payment of pendingPayments) {
      const pendingAmount = payment.totalAmount - payment.paidAmount;

      // 통장 잔액 확인
      const account = await this.prisma.account.findUnique({
        where: { id: payment.accountId },
      });

      if (!account || account.balance < pendingAmount) {
        results.push({
          paymentId: payment.id,
          status: 'failed',
          reason: '잔액 부족',
        });
        continue;
      }

      try {
        await this.payCardPayment(payment.id, userId, {
          amount: pendingAmount,
        });

        results.push({
          paymentId: payment.id,
          status: 'success',
          amount: pendingAmount,
        });
      } catch (error) {
        results.push({
          paymentId: payment.id,
          status: 'failed',
          reason: (error as Error).message,
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;

    return {
      message: `${successCount}/${pendingPayments.length}개의 결제가 처리되었습니다.`,
      processed: results,
    };
  }
}
