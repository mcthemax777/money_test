import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService, EntryInput } from '../ledger/ledger.service';
import { ENTRY_INCLUDE, toListItem } from './entry-view';
import { EntryDto, EntryListItem } from '@money/types';
import { toMoney } from '@/common/money';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  extraPostingCondition,
  parseEntryFilter,
} from '@/common/entry-filter';

const ZERO = new Prisma.Decimal(0);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/**
 * kind 필터가 걸렸을 때 한 요청에서 커서를 미는 최대 횟수.
 *
 * 조건에 맞는 거래가 아주 드물면 무한정 읽게 된다. 상한을 두고, 채우지 못하면
 * 적게 주되 커서는 유효하게 남겨 클라이언트가 이어서 읽게 한다.
 */
const MAX_FILTER_ROUNDS = 10;

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async createEntry(userId: string, dto: EntryDto.CreateRequest, projectIdParam?: string) {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
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
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId, 'editor');

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
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId, 'editor');

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
      // 쿼리스트링 값은 문자열로 도착한다 (DTO가 인터페이스라 암묵 변환이 없다).
      const exact = query.categoryExact === true || (query.categoryExact as unknown) === 'true';
      postingFilters.push(
        exact
          ? // "미분류": 소분류 없이 대분류에 바로 기록한 건만 본다.
            { categoryId: query.categoryId }
          : {
              OR: [
                { categoryId: query.categoryId },
                { category: { parentId: query.categoryId } },
              ],
            },
      );
    }
    // 일반/과소비 필터. 카테고리 다리에만 걸어야 한다 (계좌 다리는 항상 0이다).
    const extra = extraPostingCondition(filter);
    if (extra) postingFilters.push(extra);

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

    // 목록 금액은 저장 통화로 계산된 뒤 표시 통화로 옮겨진다.
    const show = await this.displayConverter(finalProjectId);
    const cursor = this.decodeCursor(query.cursor);

    /*
     * kind는 postings에서 유도되는 값이라 DB 조건으로 옮길 수 없다. 조립한 뒤
     * 걸러야 하는데, 한 번만 읽고 거르면 요청한 개수보다 적은(때로는 빈) 페이지가
     * 나온다. 빈 페이지를 "끝"으로 읽는 클라이언트는 남은 거래를 못 보게 된다.
     *
     * 그래서 kind가 걸리면 limit을 채우거나 데이터가 떨어질 때까지 커서를 밀며
     * 더 읽는다. kind가 없으면 첫 회에 조건이 성립해 그대로 끝난다.
     */
    const collected: Array<{ item: EntryListItem; date: Date; id: string }> = [];
    let scanned = cursor;
    let scanHasMore = false;

    for (let round = 0; round < MAX_FILTER_ROUNDS; round += 1) {
      const rows = await this.prisma.journalEntry.findMany({
        // 커서: "date|id". 튜플 비교를 Prisma로 표현하기 위해 OR로 편다.
        where: scanned
          ? {
              ...where,
              OR: [
                { date: { lt: scanned.date } },
                { date: scanned.date, id: { lt: scanned.id } },
              ],
            }
          : where,
        include: ENTRY_INCLUDE,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        // 다음 페이지 존재 여부를 알기 위해 하나 더 읽는다.
        take: limit + 1,
      });

      scanHasMore = rows.length > limit;
      const page = scanHasMore ? rows.slice(0, limit) : rows;
      if (page.length === 0) break;

      for (const entry of page) {
        const item = toListItem(entry, show);
        if (!query.kind || item.kind === query.kind) {
          collected.push({ item, date: entry.date, id: entry.id });
        }
      }

      scanned = { date: page[page.length - 1].date, id: page[page.length - 1].id };
      if (collected.length >= limit || !scanHasMore) break;
    }

    // 여러 회 읽으면 limit을 넘길 수 있다. 약속한 개수까지만 준다.
    const kept = collected.slice(0, limit);
    const truncated = collected.length > limit;

    /*
     * 다음 커서는 **실제로 돌려준 마지막 항목**이어야 한다. 마지막으로 읽은
     * 행을 쓰면 잘라낸 항목들을 건너뛰어 그대로 사라진다.
     *
     * 하나도 남지 않았는데 더 읽을 것이 있으면(전부 걸러진 구간) 읽은 지점을
     * 그대로 커서로 준다. 그러지 않으면 클라이언트가 여기서 끝났다고 본다.
     */
    const lastKept = kept[kept.length - 1];
    const nextCursor = truncated || scanHasMore
      ? lastKept
        ? this.encodeCursor(lastKept.date, lastKept.id)
        : scanned
          ? this.encodeCursor(scanned.date, scanned.id)
          : null
      : null;

    return { data: kept.map((row) => row.item), nextCursor };
  }

  async getEntryById(id: string, userId: string): Promise<EntryDto.Detail> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, entry.projectId);

    const show = await this.displayConverter(entry.projectId);
    return {
      ...toListItem(entry, show),
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
        extraAmount: p.extraAmount.toString(),
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
      // 통화를 생략하면 원장이 계좌 통화로 본다. 환율을 생략하면 서버 환율을 쓴다.
      currency: dto.currency,
      exchangeRate: dto.exchangeRate ? toMoney(dto.exchangeRate, '환율') : undefined,
      // 환율 대신 통장에서 빠진 금액을 받을 수 있다. 주면 환율보다 우선한다.
      billedAmount: dto.billedAmount ? toMoney(dto.billedAmount, '청구액') : undefined,
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
          amount: toMoney(dto.amount, '이체 금액'),
          // 통화가 다른 환전에서 실제로 받은 금액. 없으면 서버 환율로 계산한다.
          toAmount: dto.toAmount ? toMoney(dto.toAmount, '받는 금액') : undefined,
          feeAmount: dto.transferFee ? toMoney(dto.transferFee, '이체 수수료') : undefined,
          feeCategoryId: dto.transferFeeCategoryId,
          // 이체에서 화면의 과소비 표시는 수수료 카테고리에 붙는다 (이체 자체는 지출이 아니다).
          feeExtraAmount: dto.extraAmount ? toMoney(dto.extraAmount, '과소비 금액') : undefined,
        });

      case 'card_payment':
        if (!dto.accountId || !dto.cardId) {
          throw new BadRequestException('카드사 이체는 통장과 카드가 필요합니다.');
        }
        return this.ledger.buildCardTransfer({
          ...common,
          cardId: dto.cardId,
          accountId: dto.accountId,
          amount: toMoney(dto.amount, '카드 대금'),
          direction: dto.cardTransferDirection ?? 'payment',
        });

      default:
        throw new BadRequestException(`알 수 없는 거래 종류입니다: ${dto.kind}`);
    }
  }

  /**
   * 거래에 쓴 카테고리의 과소비 기본값을 갱신한다.
   *
   * 과소비·추가 수입은 카테고리 관리 화면이 아니라 거래를 입력하면서 정한다.
   * 예: 취미>게임을 과소비로 적어 저장하면 게임의 defaultIsExtra가 true가 되고,
   * 다음에 같은 소분류를 고르면 화면이 그 값을 읽어 자동으로 체크한다.
   *
   * 대상은 "요청에 extraAmount가 명시적으로 담긴 카테고리 다리"뿐이다.
   * 값을 보내지 않은 거래(다른 클라이언트 등)가 기존 설정을 덮어쓰면 안 된다.
   * 이체는 카테고리 다리가 수수료뿐이므로 수수료 카테고리가 대상이 된다.
   */
  private async syncCategoryDefaults(
    projectId: string,
    dto: EntryDto.CreateRequest | EntryDto.UpdateRequest,
  ) {
    const targets: Array<{ categoryId: string; isExtra: boolean }> = [];
    /** 금액이 조금이라도 있으면 "이 분류는 기본 과소비"로 본다. */
    const isExtra = (amount: string) => toMoney(amount, '과소비 금액').gt(0);

    if (dto.kind === 'transfer') {
      if (dto.transferFeeCategoryId && dto.extraAmount !== undefined) {
        targets.push({
          categoryId: dto.transferFeeCategoryId,
          isExtra: isExtra(dto.extraAmount),
        });
      }
    } else if (dto.splits?.length) {
      for (const split of dto.splits) {
        if (split.extraAmount !== undefined) {
          targets.push({ categoryId: split.categoryId, isExtra: isExtra(split.extraAmount) });
        }
      }
    } else if (dto.categoryId && dto.extraAmount !== undefined) {
      targets.push({ categoryId: dto.categoryId, isExtra: isExtra(dto.extraAmount) });
    }

    if (targets.length === 0) return;

    // projectId 조건을 함께 걸어 다른 프로젝트의 카테고리를 건드리지 못하게 한다.
    await this.prisma.$transaction(
      targets.map((target) =>
        this.prisma.category.updateMany({
          where: { id: target.categoryId, projectId, defaultIsExtra: { not: target.isExtra } },
          data: { defaultIsExtra: target.isExtra },
        }),
      ),
    );
  }

  /** 분할이 있으면 그것을, 없으면 단일 카테고리를 한 줄짜리 분할로 취급한다. */
  private resolveLines(dto: EntryDto.CreateRequest | EntryDto.UpdateRequest) {
    if (dto.splits?.length) {
      return dto.splits.map((s) => ({
        categoryId: s.categoryId,
        amount: toMoney(s.amount, '분할 금액'),
        extraAmount: s.extraAmount ? toMoney(s.extraAmount, '과소비 금액') : undefined,
      }));
    }

    if (!dto.categoryId) {
      throw new BadRequestException('카테고리를 지정해야 합니다.');
    }

    return [
      {
        categoryId: dto.categoryId,
        amount: toMoney(dto.amount),
        extraAmount: dto.extraAmount ? toMoney(dto.extraAmount, '과소비 금액') : undefined,
      },
    ];
  }

  /** 저장 통화 -> 표시 통화. 목록의 금액은 이 환산을 거쳐 나간다. */
  private async displayConverter(projectId: string) {
    const { ledger, display } = await this.projectAccess.getProjectCurrencies(projectId);
    return this.exchangeRates.getDisplayConverter(projectId, ledger, display);
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
