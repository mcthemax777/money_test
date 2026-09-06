import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { ServerClockService } from '@/common/server-clock';
import { LedgerService, EntryInput } from '../ledger/ledger.service';
import { ENTRY_INCLUDE, toListItem } from './entry-view';
import {
  EntryDto,
  EntryListItem,
  applyTagChange,
  parseEntrySearch,
  zonedMonthRange,
} from '@money/types';
import { toMoney } from '@/common/money';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  MATCH_NOTHING,
  assetOwnerCondition,
  entryKindCondition,
  entryPersonCondition,
  entryTagCondition,
  entryTextCondition,
  entrySearchConditions,
  extraPostingCondition,
  parseEntryFilter,
} from '@/common/entry-filter';
import { badRequest, notFound } from '@/common/app-error';
import { assertYearMonth } from '@/common/year-month';
import { clientId, rejectDuplicateId } from '@/common/client-id';

const ZERO = new Prisma.Decimal(0);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * 한 번에 태그를 붙일 수 있는 거래 수.
 *
 * 목록 조회의 상한과 같은 값이다. 화면이 고를 수 있는 것은 그 한 번에 받아 온 목록이라,
 * 그보다 많이 보낸 요청은 화면이 만든 것이 아니다.
 */
const MAX_TAG_TARGETS = 200;

/**
 * 아웃박스의 명령을 재생하는 중이라는 표시.
 *
 * 지금 눌러서 보내는 요청과 며칠 전에 쌓인 명령은 같은 규칙으로 다룰 수 없다. 그 사이
 * 세상이 달라졌기 때문이다 -- 다른 기기가 거래를 지웠을 수 있다. 그리고 시계는 재생하는
 * 오늘이 아니라 **적을 때의 것**을 써야, 뒤늦게 도착한 명령이 그 뒤의 편집을 이기지 않는다.
 */
export interface ReplayOptions {
  /** 그 기기가 적을 때의 시계 (hlc). 없으면 서버가 지금 찍는다. */
  hlc?: string;
}
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
    private readonly clock: ServerClockService,
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

  /**
   * 여러 거래의 태그를 한 번에 바꾼다. 더할 것과 뗄 것을 따로 받는다.
   *
   * 어느 쪽에도 없는 태그는 건드리지 않는다. 고른 거래마다 붙은 태그가 다를 수 있어,
   * 목록 하나를 "이것이 전부다"로 받으면 화면에 보이지 않던 태그가 사라진다.
   *
   * 전표는 건드리지 않는다. 연결만 넣고 빼므로 금액·다리·분할이 그대로 남는다. 다만
   * **전표의 변경 번호는 올려야 한다** -- 그러지 않으면 기기가 이 변화를 영영 받지
   * 못한다. 태그 연결에는 번호가 없어 전표에 실려 오기 때문이다.
   */
  async changeTags(
    userId: string,
    dto: EntryDto.ChangeTagsRequest,
    projectIdParam?: string,
    replay?: ReplayOptions,
  ) {
    const entryIds = [...new Set(dto.entryIds ?? [])];
    const addTagIds = [...new Set(dto.addTagIds ?? [])];
    const removeTagIds = [...new Set(dto.removeTagIds ?? [])];

    if (entryIds.length === 0 || (addTagIds.length === 0 && removeTagIds.length === 0)) {
      throw badRequest('TAG_TARGETS_REQUIRED', '거래와 태그를 함께 골라주세요.');
    }
    if (entryIds.length > MAX_TAG_TARGETS) {
      throw badRequest('TAG_TARGETS_TOO_MANY', '한 번에 표시할 수 있는 거래 수를 넘었습니다.');
    }
    /*
     * 같은 태그를 더하면서 떼라는 요청은 거절한다.
     *
     * 어느 쪽을 먼저 적용하느냐로 결과가 갈리는데, 그 순서는 사용자가 정한 것이 아니다.
     * 화면이 만들 수 없는 요청이므로 조용히 한쪽을 고르는 대신 되돌려 보낸다.
     */
    if (addTagIds.some((id) => removeTagIds.includes(id))) {
      throw badRequest('TAG_ADD_AND_REMOVE', '같은 태그를 더하면서 뗄 수는 없습니다.');
    }

    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );

    return this.prisma.$transaction(async (tx) => {
      /*
       * 남의 프로젝트 것이 섞였는지 먼저 본다.
       *
       * 하나라도 어긋나면 통째로 거절한다. 되는 것만 적용하면 사용자는 몇 건이 왜 빠졌는지
       * 알 수 없고, 그 상태를 되돌릴 방법도 없다.
       */
      const tagIds = [...addTagIds, ...removeTagIds];
      const [entries, tags] = await Promise.all([
        tx.journalEntry.findMany({ where: { id: { in: entryIds }, projectId }, select: { id: true } }),
        tx.tag.findMany({ where: { id: { in: tagIds }, projectId }, select: { id: true } }),
      ]);
      /*
       * 재생일 때는 사라진 거래를 건너뛴다.
       *
       * 온라인 요청과 다르게 다루는 이유가 있다. 지금 눌러서 보내는 요청이라면 하나라도
       * 어긋날 때 통째로 거절하는 편이 낫다 -- 사용자가 무엇이 빠졌는지 알 수 없기
       * 때문이다. 반대로 며칠 전 오프라인에서 쌓인 명령은 그 사이 다른 기기가 거래
       * 하나를 지웠다는 것만으로 나머지 스무 건의 표시까지 영영 막는다.
       */
      const present = new Set(entries.map((entry) => entry.id));
      const targets = replay ? entryIds.filter((id) => present.has(id)) : entryIds;
      if (!replay && entries.length !== entryIds.length) {
        throw notFound('ENTRY_NOT_FOUND', '거래를 찾을 수 없습니다.');
      }
      if (targets.length === 0) return { added: 0, removed: 0, entries: 0 };
      if (tags.length !== tagIds.length) {
        throw badRequest('TAG_NOT_IN_PROJECT', '이 프로젝트에 없는 태그가 포함되어 있습니다.');
      }

      // 지금 붙어 있는 것. 무엇이 실제로 달라지는지 세려면 이것부터 알아야 한다.
      const existing = await tx.entryTag.findMany({
        where: { entryId: { in: targets }, tagId: { in: tagIds } },
        select: { entryId: true, tagId: true },
      });
      const currentOf = new Map<string, Set<string>>();
      for (const row of existing) {
        const set = currentOf.get(row.entryId) ?? new Set<string>();
        set.add(row.tagId);
        currentOf.set(row.entryId, set);
      }

      /*
       * 무엇이 달라지는지는 기기와 **같은 함수**가 정한다 (`applyTagChange`).
       *
       * 각자 판단하면 오프라인에서 본 결과와 여기서 재생한 결과가 갈리고, 그 어긋남은
       * 다음 동기화가 사본을 덮을 때에야 드러난다.
       */
      const touched = new Set<string>();
      const rows: Array<{ entryId: string; tagId: string }> = [];
      let removed = 0;
      for (const entryId of targets) {
        const change = applyTagChange(currentOf.get(entryId) ?? [], addTagIds, removeTagIds);
        for (const tagId of change.added) rows.push({ entryId, tagId });
        removed += change.removed.length;
        if (change.changed) touched.add(entryId);
      }

      /*
       * 떼는 것은 한 문장으로 지운다. 뗄 태그 목록이 전표마다 같으므로 줄마다 도는 것과
       * 결과가 같고, 왕복이 하나로 줄어든다.
       */
      if (removeTagIds.length > 0) {
        await tx.entryTag.deleteMany({
          where: { entryId: { in: targets }, tagId: { in: removeTagIds } },
        });
      }

      if (rows.length > 0) await tx.entryTag.createMany({ data: rows });

      if (touched.size === 0) return { added: 0, removed: 0, entries: 0 };

      /*
       * 바뀐 전표에 번호와 시계를 찍는다.
       *
       * `updatedAt` 을 건드리면 그 행의 트리거가 도장을 새로 찍는다(sync_stamp). 값 자체는
       * 뜻이 없고 트리거를 깨우는 것이 목적이다 -- 번호를 손으로 넣으면 발급기(Project.
       * syncVersion)를 거치지 않아 다른 쓰기와 순서가 어긋난다.
       *
       * 시계도 함께 찍는다. 태그도 전표라는 한 덩어리의 일부다 (설계 문서의 D5). 찍지
       * 않으면 오프라인 기기의 옛 편집이 나중에 도착해 이기고, 방금 붙인 태그가 아무 말
       * 없이 사라진다. 한 요청이 여러 전표를 건드려도 시계는 하나면 된다 -- 같은 편집이기
       * 때문이다.
       *
       * **다만 시계는 뒤로 가지 않는다.** 재생에서만 생기는 일이다. 며칠 전 오프라인에서
       * 붙인 태그가 오늘 도착했는데 그 사이 다른 기기가 같은 전표를 고쳤다면, 여기서 옛
       * 시계를 덮어쓰는 순간 그 편집이 없던 일이 된다 -- 뒤이어 도착하는 더 옛 명령이
       * 이겨 버린다. 그런 전표는 번호만 올린다. 태그가 실제로 달라졌으니 기기는 그 전표를
       * 어느 쪽이든 다시 받아야 한다.
       */
      const changed = [...touched];
      const stamp = replay?.hlc || this.clock.now();
      await tx.journalEntry.updateMany({
        where: {
          id: { in: changed },
          OR: [{ updatedHlc: null }, { updatedHlc: { lt: stamp } }],
        },
        data: { updatedAt: new Date(), updatedHlc: stamp },
      });
      await tx.journalEntry.updateMany({
        where: { id: { in: changed }, updatedHlc: { gte: stamp } },
        data: { updatedAt: new Date() },
      });

      return { added: rows.length, removed, entries: touched.size };
    });
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

    // 태그도 전표에 붙으므로 유형과 같은 자리에 온다. "태그 없음"도 이 무리다.
    const tagCondition = entryTagCondition(search.tagIds, search.noTag);
    if (tagCondition) entryFilters.push(tagCondition);

    // 거래를 낸 사람. 자산주인 필터와 다른 자리다.
    const personCondition = entryPersonCondition(search.entryPersonIds);
    if (personCondition) entryFilters.push(personCondition);

    // 설명의 글자도 전표에 있다.
    const textCondition = entryTextCondition(search.text);
    if (textCondition) entryFilters.push(textCondition);

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

    const input = await this.ledger.buildFromRequest({
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

    /*
     * 태그는 조립 규칙(entry-build)이 다루지 않는다. 다리를 하나도 바꾸지 않기 때문이다.
     *
     * **생략은 "비운다"다.** 수정이 전표를 통째로 갈아 끼우는 것과 같은 규칙이라,
     * 여기만 "생략은 유지"로 두면 태그를 다 뗀 수정을 표현할 길이 없다.
     */
    return { ...input, tagIds: dto.tagIds ?? [] };
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
