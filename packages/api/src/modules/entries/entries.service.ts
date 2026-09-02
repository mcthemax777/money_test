import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService, EntryInput } from '../ledger/ledger.service';
import { ENTRY_INCLUDE, toListItem } from './entry-view';
import { EntryDto, EntryListItem, parseEntrySearch, zonedMonthRange } from '@money/types';
import { toMoney } from '@/common/money';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  entryKindCondition,
  entrySearchConditions,
  extraPostingCondition,
  parseEntryFilter,
} from '@/common/entry-filter';
import { notFound } from '@/common/app-error';
import { assertYearMonth } from '@/common/year-month';
import { clientId, rejectDuplicateId } from '@/common/client-id';

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
    const entry = await rejectDuplicateId('거래', () =>
      this.ledger.createEntry({ ...input, id: clientId(dto.id, '거래 식별자') }),
    );
    return this.getEntryById(entry.id, userId);
  }

  /** 수정은 전체 교체다. id는 유지된다. */
  async updateEntry(id: string, userId: string, dto: EntryDto.UpdateRequest) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
    await this.projectAccess.verifyUserHasAccessToProject(userId, existing.projectId, 'editor');

    const input = await this.buildInput(existing.projectId, userId, dto);

    await this.ledger.replaceEntry(id, input);
    return this.getEntryById(id, userId);
  }

  /** 삭제. 카드 거래도 다른 거래와 똑같이 지운다. */
  async deleteEntry(id: string, userId: string) {
    const existing = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: true },
    });
    if (!existing) throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
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
    const { id: finalProjectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      projectId,
    );
    const limit = Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.JournalEntryWhereInput = { projectId: finalProjectId };

    // 자산 주인 / 고정·변동 필터. 아무것도 고르지 않았으면 결과가 없어야 한다.
    const filter = parseEntryFilter(query);
    if (filter.matchNothing) Object.assign(where, MATCH_NOTHING);

    // 거래 화면의 검색(분류 여럿 · 자산 여럿). 무리 안은 OR, 무리끼리는 AND.
    const search = parseEntrySearch(query);
    if (search.matchNothing) Object.assign(where, MATCH_NOTHING);

    /*
     * 한 달을 볼 때는 달 이름을 그대로 받는다.
     *
     * 부르는 쪽이 인스턴트로 만들어 넘기면 두 가지가 어긋난다. 달 길이("2026-11-31" 은
     * 오류가 아니라 12월 1일로 넘어간다)와 시차(UTC 자정은 한국의 오전 9시다). 여기서
     * 프로젝트 타임존으로 자르면 월 합계와 같은 경계가 된다.
     */
    if (query.yearMonth) {
      const range = zonedMonthRange(assertYearMonth(query.yearMonth, '연월'), timeZone);
      where.date = { gte: range.start, lt: range.end };
    } else if (query.startDate || query.endDate) {
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
    // 검색이 고른 무리들. 각각이 다리 조건 하나이고 서로 AND 로 이어진다.
    postingFilters.push(...entrySearchConditions(search));

    // 유형은 다리 하나로 표현되지 않아(계좌 다리 두 개를 함께 본다) 전표 조건으로 간다.
    const kindCondition = entryKindCondition(search.kinds);
    if (kindCondition) entryFilters.push(kindCondition);

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
    if (!entry) throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
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

  /**
   * 와이어의 값을 검사해 조립에 넘긴다.
   *
   * 갈래를 나누고 다리를 만드는 규칙은 `@money/types` 의 entry-build 가 갖는다. 기기가
   * 오프라인에서 같은 전표를 만들어야 하기 때문이다. 여기 남는 일은 경계의 일 하나다 --
   * **금액처럼 생기지 않은 것을 걸러 400으로 떨어뜨리는 것.** DTO 가 클래스가 아니라
   * 전역 ValidationPipe 가 타입을 걸러 주지 않아서, 그 검사가 없으면 `{"amount": {}}`
   * 같은 본문 하나로 500이 난다 (common/money.ts 머리말).
   */
  private async buildInput(
    projectId: string,
    userId: string,
    dto: EntryDto.CreateRequest | EntryDto.UpdateRequest,
  ): Promise<EntryInput> {
    const optional = (value: unknown, label: string) =>
      value === undefined || value === null || value === ''
        ? undefined
        : toMoney(value, label).toString();

    return this.ledger.buildFromRequest({
      projectId,
      createdByUserId: userId,
      kind: dto.kind,
      personId: dto.personId,
      date: new Date(dto.date),
      description: dto.description,
      merchant: dto.merchant,
      detailedNote: dto.detailedNote,
      // 통화를 생략하면 원장이 계좌 통화로 본다. 환율을 생략하면 서버 환율을 쓴다.
      currency: dto.currency,
      exchangeRate: optional(dto.exchangeRate, '환율'),
      // 환율 대신 통장에서 빠진 금액을 받을 수 있다. 주면 환율보다 우선한다.
      billedAmount: optional(dto.billedAmount, '청구액'),
      amount: dto.amount === undefined ? undefined : toMoney(dto.amount).toString(),
      categoryId: dto.categoryId,
      extraAmount: optional(dto.extraAmount, '과소비 금액'),
      splits: dto.splits?.map((split) => ({
        categoryId: split.categoryId,
        amount: toMoney(split.amount, '분할 금액').toString(),
        extraAmount: optional(split.extraAmount, '과소비 금액'),
      })),
      accountId: dto.accountId,
      toAccountId: dto.toAccountId,
      cardId: dto.cardId,
      installmentMonths: dto.installmentMonths,
      toAmount: optional(dto.toAmount, '받는 금액'),
      transferFee: optional(dto.transferFee, '이체 수수료'),
      transferFeeCategoryId: dto.transferFeeCategoryId,
      cardTransferDirection: dto.cardTransferDirection,
    });
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
