import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { StatementDto, StatementStatus, zonedParts } from '@money/types';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * 청구서 목록.
   *
   * 미결제액은 `SUM(Posting.amount WHERE statementId = X)` 한 번으로 나온다.
   * 부채 계정 posting은 사용이 음수, 상환이 양수이므로 합계가 0이면 완납이다.
   * 기존 CardPayment/CardPaymentUsage 두 테이블과 pending 루프가 이 계산으로 대체된다.
   */
  async getStatements(
    userId: string,
    query: StatementDto.ListQuery & { projectId?: string; cardId?: string },
  ): Promise<StatementDto.Response[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, query.projectId);

    const statements = await this.prisma.cardStatement.findMany({
      where: {
        card: { projectId, ...(query.cardId ? { id: query.cardId } : {}) },
      },
      include: { card: { select: { name: true } } },
      orderBy: { periodEnd: 'desc' },
    });

    if (statements.length === 0) return [];

    const totals = await this.sumByStatement(statements.map((s) => s.id));
    const today = todayMarker(await this.projectAccess.getProjectTimeZone(projectId));

    const rows = statements.map((statement) => {
      const { charged, paid } = totals.get(statement.id) ?? { charged: ZERO, paid: ZERO };
      const outstanding = charged.sub(paid);

      return {
        id: statement.id,
        cardId: statement.cardId,
        cardName: statement.card.name,
        periodStart: statement.periodStart.toISOString(),
        periodEnd: statement.periodEnd.toISOString(),
        dueDate: statement.dueDate.toISOString(),
        status: deriveStatus(statement.periodEnd, today, charged, paid),
        chargedAmount: charged.toString(),
        paidAmount: paid.toString(),
        outstanding: outstanding.toString(),
      };
    });

    return query.status ? rows.filter((row) => row.status === query.status) : rows;
  }

  async getStatementById(id: string, userId: string): Promise<StatementDto.Response> {
    const statement = await this.prisma.cardStatement.findUnique({
      where: { id },
      include: { card: { select: { name: true, projectId: true } } },
    });
    if (!statement) throw new NotFoundException('청구서를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, statement.card.projectId);

    const totals = await this.sumByStatement([id]);
    const { charged, paid } = totals.get(id) ?? { charged: ZERO, paid: ZERO };

    return {
      id: statement.id,
      cardId: statement.cardId,
      cardName: statement.card.name,
      periodStart: statement.periodStart.toISOString(),
      periodEnd: statement.periodEnd.toISOString(),
      dueDate: statement.dueDate.toISOString(),
      status: deriveStatus(
        statement.periodEnd,
        todayMarker(await this.projectAccess.getProjectTimeZone(statement.card.projectId)),
        charged,
        paid,
      ),
      chargedAmount: charged.toString(),
      paidAmount: paid.toString(),
      outstanding: charged.sub(paid).toString(),
    };
  }

  /** 청구서 대금 결제. 금액을 생략하면 미결제 전액을 갚는다. */
  async payStatement(id: string, userId: string, dto: StatementDto.PayRequest) {
    const statement = await this.getStatementById(id, userId);
    const outstanding = new Prisma.Decimal(statement.outstanding);

    if (outstanding.lte(ZERO)) {
      throw new BadRequestException('이미 완납된 청구서입니다.');
    }

    const amount = dto.amount ? new Prisma.Decimal(dto.amount) : outstanding;
    if (amount.gt(outstanding)) {
      throw new BadRequestException(
        `미결제액(${outstanding.toString()})보다 큰 금액은 결제할 수 없습니다.`,
      );
    }

    const card = await this.prisma.card.findUniqueOrThrow({ where: { id: statement.cardId } });

    return this.ledger.createCardPayment({
      projectId: card.projectId,
      personId: dto.personId,
      date: dto.date ? new Date(dto.date) : new Date(),
      description: dto.description ?? `${statement.cardName} 결제`,
      createdByUserId: userId,
      cardId: statement.cardId,
      accountId: dto.accountId,
      amount,
      statementId: id,
    });
  }

  /**
   * 청구서별 사용액/결제액 합계.
   * 청구서 개수만큼 쿼리를 돌리지 않고 groupBy 두 번으로 끝낸다.
   */
  private async sumByStatement(ids: string[]) {
    const [charges, payments] = await Promise.all([
      this.prisma.posting.groupBy({
        by: ['statementId'],
        where: { statementId: { in: ids }, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.posting.groupBy({
        by: ['statementId'],
        where: { statementId: { in: ids }, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
    ]);

    const result = new Map<string, { charged: Prisma.Decimal; paid: Prisma.Decimal }>();
    for (const id of ids) result.set(id, { charged: ZERO, paid: ZERO });

    for (const row of charges) {
      if (!row.statementId) continue;
      // 사용은 음수로 기록되므로 표시용으로 부호를 뒤집는다
      result.get(row.statementId)!.charged = (row._sum.amount ?? ZERO).neg();
    }
    for (const row of payments) {
      if (!row.statementId) continue;
      result.get(row.statementId)!.paid = row._sum.amount ?? ZERO;
    }

    return result;
  }
}

/** 상태는 저장하지 않고 마감일과 금액에서 유도한다. */
function deriveStatus(
  periodEnd: Date,
  today: Date,
  charged: Prisma.Decimal,
  paid: Prisma.Decimal,
): StatementStatus {
  if (periodEnd.getTime() >= today.getTime()) return 'open';
  if (charged.lte(paid)) return 'paid';
  if (paid.gt(ZERO)) return 'partial';
  return 'closed';
}

/**
 * 오늘의 달력 날짜 표시자.
 *
 * periodEnd는 `@db.Date`라 "그 지역의 달력 날짜 + UTC 자정"으로 저장된다.
 * 비교 대상인 오늘도 같은 형태여야 하므로 인스턴트가 아니라 표시자를 만든다.
 */
function todayMarker(timeZone: string): Date {
  const { year, month, day } = zonedParts(new Date(), timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}
