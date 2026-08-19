import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService, EntryInput } from '../ledger/ledger.service';
import { ENTRY_INCLUDE, toListItem } from './entry-view';
import { EntryDto } from '@money/types';

const ZERO = new Prisma.Decimal(0);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
  ) {}

  async createEntry(userId: string, dto: EntryDto.CreateRequest, projectIdParam?: string) {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
    );

    const input = await this.buildInput(projectId, userId, dto);
    const entry = await this.ledger.createEntry(input);
    return this.getEntryById(entry.id, userId);
  }

  /**
   * 수정은 전체 교체다. id는 유지된다.
   *
   * 이미 결제된 청구서의 금액을 바꾸는 수정은 거부한다.
   * 설명·카테고리·거래처처럼 청구서와 무관한 값은 그대로 고칠 수 있다.
   */
  async updateEntry(id: string, userId: string, dto: EntryDto.UpdateRequest) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId);

    const input = await this.buildInput(existing.projectId, userId, dto);
    await this.assertSettledStatementsUnchanged(existing.postings, input.postings);

    await this.ledger.replaceEntry(id, input);
    return this.getEntryById(id, userId);
  }

  /**
   * 삭제.
   *
   * 결제가 끝난 청구서에 속한 카드 사용 내역은 지울 수 없다.
   * 지우면 청구액만 사라지고 결제 기록은 남아 카드 부채가 유령 잔액으로 뜬다.
   */
  async deleteEntry(id: string, userId: string) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId);

    // 삭제는 청구액을 전부 없애므로 결제된 청구서가 걸려 있으면 무조건 막는다
    await this.assertSettledStatementsUnchanged(existing.postings, []);

    await this.ledger.deleteEntry(id, existing.projectId);
    return { id };
  }

  /**
   * 결제가 시작된 청구서의 금액이 바뀌지 않는지 확인한다.
   *
   * 날짜를 바꾸면 다른 청구서로 옮겨가고, 금액이나 카드를 바꾸면 청구액이 달라진다.
   * 셋 다 "청구서별 기여 금액"이 달라지는 것으로 한 번에 잡힌다.
   * 청구서와 무관한 값만 고치면 기여 금액이 그대로라 통과한다.
   *
   * 나가는 쪽과 들어오는 쪽을 모두 본다.
   * 미결제 내역이라도 이미 완납한 청구서로 옮기면 그 청구서가 되살아나기 때문이다.
   */
  private async assertSettledStatementsUnchanged(
    oldPostings: Array<{ statementId: string | null; amount: Prisma.Decimal }>,
    newPostings: Array<{ statementId?: string; amount: Prisma.Decimal }>,
  ) {
    const touched = [
      ...oldPostings.map((p) => p.statementId),
      ...newPostings.map((p) => p.statementId),
    ].filter((id): id is string => Boolean(id));

    const settled = await this.findSettledStatementIds(touched);
    if (settled.size === 0) return;

    const oldByStatement = sumByStatement(
      oldPostings.map((p) => ({ statementId: p.statementId ?? undefined, amount: p.amount })),
    );
    const newByStatement = sumByStatement(newPostings);

    for (const statementId of settled) {
      const before = oldByStatement.get(statementId) ?? ZERO;
      const after = newByStatement.get(statementId) ?? ZERO;
      if (!before.equals(after)) {
        throw new BadRequestException(
          '이미 결제한 청구서에 포함된 내역입니다. 금액, 날짜, 카드는 바꿀 수 없습니다.',
        );
      }
    }
  }

  /** 결제가 한 번이라도 이루어진 청구서. 부분 결제도 포함한다. */
  private async findSettledStatementIds(statementIds: string[]): Promise<Set<string>> {
    if (statementIds.length === 0) return new Set();

    // 부채 계정 posting에서 양수는 상환이다
    const payments = await this.prisma.posting.groupBy({
      by: ['statementId'],
      where: { statementId: { in: statementIds }, amount: { gt: 0 } },
      _sum: { amount: true },
    });

    return new Set(
      payments
        .filter((row) => row.statementId && (row._sum.amount ?? ZERO).gt(ZERO))
        .map((row) => row.statementId as string),
    );
  }

  /**
   * 목록 조회. 커서 기반 페이지네이션이다.
   * (date desc, id desc) 순서이며 @@index([projectId, date, id])가 뒷받침한다.
   */
  async getEntries(
    userId: string,
    query: EntryDto.ListQuery,
    projectId?: string,
  ): Promise<EntryDto.ListResponse> {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);
    const limit = Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.JournalEntryWhereInput = { projectId: finalProjectId };

    if (query.personId) where.personId = query.personId;

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    // posting 조건은 "이 전표에 그런 다리가 하나라도 있는가"로 건다.
    const postingFilters: Prisma.PostingWhereInput[] = [];

    // 원장 관점: 이 계좌/카드가 얽힌 전표 전부
    if (query.accountId) postingFilters.push({ accountId: query.accountId });
    if (query.cardId) postingFilters.push({ cardId: query.cardId });

    // 결제수단 관점: 이 수단으로 실제 돈이 나간 전표.
    // 체크카드 결제는 연결 통장에도 걸리므로 카드가 붙은 건을 빼고,
    // 이체 받는 계좌(+)가 걸리지 않도록 음수 다리만 본다.
    // reports.trendByPaymentMethod 와 같은 규칙이다.
    if (query.paymentAccountId) {
      postingFilters.push({
        accountId: query.paymentAccountId,
        cardId: null,
        amount: { lt: 0 },
      });
    }
    if (query.paymentCardId) {
      postingFilters.push({ cardId: query.paymentCardId, amount: { lt: 0 } });
    }

    if (query.categoryId) postingFilters.push({ categoryId: query.categoryId });
    // kind='expense'는 이체를 빼지만 categoryType='expense'는 수수료 붙은 이체를 포함한다
    if (query.categoryType) {
      postingFilters.push({ category: { type: query.categoryType as CategoryType } });
    }
    if (postingFilters.length > 0) {
      where.AND = postingFilters.map((filter) => ({ postings: { some: filter } }));
    }

    // 커서: "date|id". 튜플 비교를 Prisma로 표현하기 위해 OR로 편다.
    const cursor = this.decodeCursor(query.cursor);
    if (cursor) {
      where.OR = [
        { date: { lt: cursor.date } },
        { date: cursor.date, id: { lt: cursor.id } },
      ];
    }

    // 다음 페이지 존재 여부를 알기 위해 하나 더 읽는다.
    const rows = await this.prisma.journalEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // 이 페이지에 걸린 청구서 중 결제가 시작된 것을 한 번에 조회한다 (전표마다 묻지 않는다)
    const settled = await this.findSettledStatementIds(
      page.flatMap((entry) =>
        entry.postings.map((p) => p.statementId).filter((id): id is string => Boolean(id)),
      ),
    );

    let data = page.map((entry) => toListItem(entry, settled));
    // kind는 postings에서 유도되는 값이라 DB에서 거를 수 없다. 조립 후 거른다.
    if (query.kind) data = data.filter((item) => item.kind === query.kind);

    const last = page[page.length - 1];
    return {
      data,
      nextCursor: hasMore && last ? this.encodeCursor(last.date, last.id) : null,
    };
  }

  async getEntryById(id: string, userId: string): Promise<EntryDto.Detail> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, entry.projectId);

    const settled = await this.findSettledStatementIds(
      entry.postings.map((p) => p.statementId).filter((id): id is string => Boolean(id)),
    );

    return {
      ...toListItem(entry, settled),
      postings: entry.postings.map((p) => ({
        id: p.id,
        entryId: p.entryId,
        accountId: p.accountId,
        categoryId: p.categoryId,
        amount: p.amount.toString(),
        quantity: p.quantity?.toString() ?? null,
        currency: p.currency,
        baseAmount: p.baseAmount.toString(),
        exchangeRate: p.exchangeRate.toString(),
        isFixed: p.isFixed,
        statementId: p.statementId,
        cardId: p.cardId,
      })),
    };
  }

  /** 화면 개념(kind)을 전표 입력값으로 번역한다. */
  private async buildInput(
    projectId: string,
    userId: string,
    dto: EntryDto.CreateRequest | EntryDto.UpdateRequest,
  ): Promise<EntryInput> {
    const common = {
      projectId,
      personId: dto.personId,
      date: new Date(dto.date),
      description: dto.description,
      merchant: dto.merchant,
      detailedNote: dto.detailedNote,
      createdByUserId: userId,
    };

    switch (dto.kind) {
      case 'expense':
        return this.ledger.buildExpense({
          ...common,
          lines: this.resolveLines(dto),
          accountId: dto.accountId,
          cardId: dto.cardId,
        });

      case 'income':
        if (!dto.accountId) {
          throw new BadRequestException('수입은 입금 계좌가 필요합니다.');
        }
        return this.ledger.buildIncome({
          ...common,
          lines: this.resolveLines(dto),
          accountId: dto.accountId,
        });

      case 'transfer':
        if (!dto.accountId || !dto.toAccountId) {
          throw new BadRequestException('이체는 보내는 계좌와 받는 계좌가 필요합니다.');
        }
        return this.ledger.buildTransfer({
          ...common,
          fromAccountId: dto.accountId,
          toAccountId: dto.toAccountId,
          amount: new Prisma.Decimal(dto.amount),
          feeAmount: dto.transferFee ? new Prisma.Decimal(dto.transferFee) : undefined,
          feeCategoryId: dto.transferFeeCategoryId,
        });

      case 'card_payment':
        if (!dto.accountId || !dto.cardId) {
          throw new BadRequestException('카드대금 결제는 결제 통장과 카드가 필요합니다.');
        }
        return this.ledger.buildCardPayment({
          ...common,
          cardId: dto.cardId,
          accountId: dto.accountId,
          amount: new Prisma.Decimal(dto.amount),
          statementId: dto.statementId,
        });

      default:
        throw new BadRequestException(`알 수 없는 거래 종류입니다: ${dto.kind}`);
    }
  }

  /** 분할이 있으면 그것을, 없으면 단일 카테고리를 한 줄짜리 분할로 취급한다. */
  private resolveLines(dto: EntryDto.CreateRequest | EntryDto.UpdateRequest) {
    if (dto.splits?.length) {
      return dto.splits.map((s) => ({
        categoryId: s.categoryId,
        amount: new Prisma.Decimal(s.amount),
        isFixed: s.isFixed,
      }));
    }

    if (!dto.categoryId) {
      throw new BadRequestException('카테고리를 지정해야 합니다.');
    }

    return [
      {
        categoryId: dto.categoryId,
        amount: new Prisma.Decimal(dto.amount),
        isFixed: dto.isFixed,
      },
    ];
  }

  private encodeCursor(date: Date, id: string): string {
    return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url');
  }

  private decodeCursor(cursor?: string): { date: Date; id: string } | null {
    if (!cursor) return null;
    const [dateText, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const date = new Date(dateText);
    if (!id || Number.isNaN(date.getTime())) {
      throw new BadRequestException('잘못된 커서입니다.');
    }
    return { date, id };
  }
}

/** 청구서별 금액 합계 */
function sumByStatement(
  postings: Array<{ statementId?: string | null; amount: Prisma.Decimal }>,
): Map<string, Prisma.Decimal> {
  const result = new Map<string, Prisma.Decimal>();
  for (const posting of postings) {
    if (!posting.statementId) continue;
    result.set(
      posting.statementId,
      (result.get(posting.statementId) ?? ZERO).add(posting.amount),
    );
  }
  return result;
}
