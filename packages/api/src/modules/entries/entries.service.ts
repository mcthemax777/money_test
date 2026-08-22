import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService, EntryInput } from '../ledger/ledger.service';
import { ENTRY_INCLUDE, toListItem } from './entry-view';
import { EntryDto } from '@money/types';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  fixedPostingCondition,
  parseEntryFilter,
} from '@/common/entry-filter';

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
    await this.syncCategoryDefaults(projectId, dto);
    return this.getEntryById(entry.id, userId);
  }

  /** 수정은 전체 교체다. id는 유지된다. */
  async updateEntry(id: string, userId: string, dto: EntryDto.UpdateRequest) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId);

    const input = await this.buildInput(existing.projectId, userId, dto);

    await this.ledger.replaceEntry(id, input);
    await this.syncCategoryDefaults(existing.projectId, dto);
    return this.getEntryById(id, userId);
  }

  /** 삭제. 카드 거래도 다른 거래와 똑같이 지운다. */
  async deleteEntry(id: string, userId: string) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId);

    await this.ledger.deleteEntry(id, existing.projectId);
    return { id };
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

    // 자산 주인 / 고정·변동 필터. 아무것도 고르지 않았으면 결과가 없어야 한다.
    const filter = parseEntryFilter(query);
    if (filter.matchNothing) Object.assign(where, MATCH_NOTHING);

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    // posting 조건은 "이 전표에 그런 다리가 하나라도 있는가"로 건다.
    const postingFilters: Prisma.PostingWhereInput[] = [];
    // 자산 주인 조건은 다리 하나로 표현되지 않아(부호에 따라 보는 다리가 다르다)
    // 전표 수준 조건으로 따로 모은다.
    const entryFilters: Prisma.JournalEntryWhereInput[] = [];

    const owner = assetOwnerCondition(filter);
    if (owner) entryFilters.push(owner);

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

    // 대분류를 지정하면 소분류 거래까지 포함한다. reports.trendByCategory 와 같은 규칙이다.
    // 정확히 일치로만 걸면 대분류 상세에서 12개월 그래프와 원형차트는 소분류를 합쳐 보여주는데
    // 거래 목록과 일별 누적만 대분류에 직접 기록한 건을 보여줘 금액이 어긋난다.
    if (query.categoryId) {
      postingFilters.push({
        OR: [
          { categoryId: query.categoryId },
          { category: { parentId: query.categoryId } },
        ],
      });
    }
    // 고정/변동 필터. 카테고리 다리에만 걸어야 한다 (계좌 다리는 항상 isFixed=false).
    const fixed = fixedPostingCondition(filter);
    if (fixed) postingFilters.push(fixed);

    // kind='expense'는 이체를 빼지만 categoryType='expense'는 수수료 붙은 이체를 포함한다
    if (query.categoryType) {
      postingFilters.push({ category: { type: query.categoryType as CategoryType } });
    }
    if (postingFilters.length > 0 || entryFilters.length > 0) {
      where.AND = [
        ...postingFilters.map((posting) => ({ postings: { some: posting } })),
        ...entryFilters,
      ];
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

    let data = page.map((entry) => toListItem(entry));
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

    return {
      ...toListItem(entry),
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
          installmentMonths: dto.installmentMonths,
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
          // 이체에서 화면의 고정 체크는 수수료 카테고리에 붙는다 (이체 자체는 지출이 아니다).
          feeIsFixed: dto.isFixed,
        });

      case 'card_payment':
        if (!dto.accountId || !dto.cardId) {
          throw new BadRequestException('카드사 이체는 통장과 카드가 필요합니다.');
        }
        return this.ledger.buildCardTransfer({
          ...common,
          cardId: dto.cardId,
          accountId: dto.accountId,
          amount: new Prisma.Decimal(dto.amount),
          direction: dto.cardTransferDirection ?? 'payment',
        });

      default:
        throw new BadRequestException(`알 수 없는 거래 종류입니다: ${dto.kind}`);
    }
  }

  /**
   * 거래에 쓴 카테고리의 고정 여부 기본값을 갱신한다.
   *
   * 고정/변동은 카테고리 관리 화면이 아니라 거래를 입력하면서 정한다.
   * 예: 공과금>수도요금을 고정으로 체크해 저장하면 수도요금의 defaultIsFixed가 true가 되고,
   * 다음에 같은 소분류를 고르면 화면이 그 값을 읽어 자동으로 체크한다.
   *
   * 대상은 "요청에 isFixed가 명시적으로 담긴 카테고리 다리"뿐이다.
   * 값을 보내지 않은 거래(다른 클라이언트 등)가 기존 설정을 덮어쓰면 안 된다.
   * 이체는 카테고리 다리가 수수료뿐이므로 수수료 카테고리가 대상이 된다.
   */
  private async syncCategoryDefaults(
    projectId: string,
    dto: EntryDto.CreateRequest | EntryDto.UpdateRequest,
  ) {
    const targets: Array<{ categoryId: string; isFixed: boolean }> = [];

    if (dto.kind === 'transfer') {
      if (dto.transferFeeCategoryId && dto.isFixed !== undefined) {
        targets.push({ categoryId: dto.transferFeeCategoryId, isFixed: dto.isFixed });
      }
    } else if (dto.splits?.length) {
      for (const split of dto.splits) {
        if (split.isFixed !== undefined) {
          targets.push({ categoryId: split.categoryId, isFixed: split.isFixed });
        }
      }
    } else if (dto.categoryId && dto.isFixed !== undefined) {
      targets.push({ categoryId: dto.categoryId, isFixed: dto.isFixed });
    }

    if (targets.length === 0) return;

    // projectId 조건을 함께 걸어 다른 프로젝트의 카테고리를 건드리지 못하게 한다.
    await this.prisma.$transaction(
      targets.map((target) =>
        this.prisma.category.updateMany({
          where: { id: target.categoryId, projectId, defaultIsFixed: { not: target.isFixed } },
          data: { defaultIsFixed: target.isFixed },
        }),
      ),
    );
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
