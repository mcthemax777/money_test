/**
 * 거래내역 엑셀 가져오기·내보내기. 열의 모양은 `@money/types` 의 `entry-sheet`, 행을 거래로
 * 옮기는 규칙은 `entry-sheet-io` 한 곳이다 (기기 사본도 같은 함수를 쓴다).
 *
 * 엑셀 파일을 읽고 쓰는 일은 화면(core 의 `entry-sheet`)이 하고, 여기는 이 가계부의 이름표를
 * 읽어 오고(`entrySheetCatalog`) 없는 것을 서비스로 만드는 손(`EntrySheetMaker`)을 준다.
 * 만드는 길이 화면이 쓰는 서비스 그대로라 변경 피드와 다른 기기 알림이 평소처럼 돈다.
 */
import { HttpException, Injectable } from '@nestjs/common';
import { AccountType, CardType, CategoryType, FinancialInstitutionType } from '@prisma/client';
import {
  isDateKey,
  EntrySheetDto,
  entrySheetCatalog,
  entrySheetRowsOf,
  importEntrySheetRows,
  numberEntrySheetRows,
  zonedDateStringToUtc,
  type EntrySheetMaker,
  type EntrySheetRow,
  nextDateKey,
} from '@money/types';

import { isPrismaError } from '@/common/prisma-error';
import { badRequest } from '@/common/app-error';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PrismaService } from '@/config/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { CardsService } from '../cards/cards.service';
import { CategoriesService } from '../categories/categories.service';
import { ENTRY_INCLUDE, toViewEntry } from '../entries/entry-view';
import { EntriesService } from '../entries/entries.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { PeopleService } from '../people/people.service';
import { TagsService } from '../tags/tags.service';

/** 내보낼 때 한 번에 읽는 거래 수. */
const EXPORT_BATCH = 500;

@Injectable()
export class EntrySheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly entries: EntriesService,
    private readonly people: PeopleService,
    private readonly accounts: AccountsService,
    private readonly cards: CardsService,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
    private readonly institutions: InstitutionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // 가져오기
  // ---------------------------------------------------------------------------

  async import(
    userId: string,
    dto: EntrySheetDto.ImportRequest,
    projectIdParam?: string,
  ): Promise<EntrySheetDto.ImportResponse> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      projectIdParam,
      'editor',
    );
    const rows = Array.isArray(dto?.rows) ? dto.rows : null;
    if (!rows) throw badRequest('ENTRY_SHEET_INVALID', '행 목록이 없습니다.');
    if (rows.length > EntrySheetDto.MAX_ROWS) {
      throw badRequest('ENTRY_SHEET_INVALID', `한 번에 ${EntrySheetDto.MAX_ROWS}행까지 보낼 수 있습니다.`);
    }

    const [member, people, accounts, cards, categories, tags, issuers] = await Promise.all([
      this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { personId: true },
      }),
      this.prisma.person.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { sortRank: 'asc' } }),
      this.prisma.account.findMany({
        where: { projectId },
        select: { id: true, name: true, type: true, ownerId: true },
        orderBy: { sortRank: 'asc' },
      }),
      this.prisma.card.findMany({ where: { projectId }, select: { id: true, name: true, cardType: true } }),
      this.prisma.category.findMany({
        where: { projectId },
        select: { id: true, name: true, type: true, parentId: true },
      }),
      this.prisma.tag.findMany({ where: { projectId }, select: { id: true, name: true } }),
      this.prisma.financialInstitution.findMany({
        where: {
          type: FinancialInstitutionType.card_issuer,
          OR: [{ projectId: null }, { projectId }],
        },
        select: { id: true, name: true },
      }),
    ]);
    const catalog = entrySheetCatalog({
      timeZone,
      myPersonId: member?.personId ?? null,
      people,
      accounts,
      cards,
      categories,
      tags,
      issuers,
    });
    return importEntrySheetRows(rows, catalog, this.makerFor(userId, projectId));
  }

  /** 없는 것을 화면이 쓰는 서비스 그대로 만든다. */
  private makerFor(userId: string, projectId: string): EntrySheetMaker {
    return {
      createPerson: async (name) => (await this.people.createPerson(userId, { name }, projectId)).id,
      createAccount: async ({ name, type, ownerId }) =>
        (await this.accounts.createAccount(userId, { name, type: type as AccountType, ownerId }, projectId)).id,
      createCard: async (input) =>
        (await this.cards.createCard(userId, { ...input, cardType: input.cardType as CardType }, projectId)).id,
      createIssuer: async (name) =>
        (
          await this.institutions.createInstitution(
            userId,
            { type: FinancialInstitutionType.card_issuer, name },
            projectId,
          )
        ).id,
      createCategory: async ({ name, type, parentId }) =>
        (
          await this.categories.createCategory(
            userId,
            { name, type: type as CategoryType, ...(parentId ? { parentId } : {}) },
            projectId,
          )
        ).id,
      createTag: async (name) => (await this.tags.createTag(userId, { name }, projectId)).id,
      createEntry: async (request) => {
        await this.entries.createEntry(userId, request, projectId);
      },
      reasonOf,
    };
  }

  // ---------------------------------------------------------------------------
  // 내보내기
  // ---------------------------------------------------------------------------

  /**
   * 거래를 행으로. 오래된 것부터, 분할 거래는 줄마다 한 행이다.
   *
   * 금액은 **정가**다(차감 전). 차감은 할인 칸에 따로 적는다 -- 가져오기가 금액에서 할인을
   * 빼므로, 차감 뒤의 값을 적으면 다시 가져올 때 두 번 빠진다. 한 줄짜리 외화 결제는 원래
   * 통화 금액과 청구액을 적고, 분할된 외화 결제는 장부 통화로 적는다(줄마다의 원래 통화
   * 금액이 저장되어 있지 않다).
   */
  async export(userId: string, query: EntrySheetDto.ExportQuery, projectIdParam?: string): Promise<EntrySheetRow[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(userId, projectIdParam);
    const cards = await this.prisma.card.findMany({ where: { projectId }, select: { id: true, cardType: true } });
    const cardTypeOf = new Map(cards.map((card) => [card.id, card.cardType as string]));

    const dateFilter = {
      ...(query.startDate ? { gte: zonedDateStringToUtc(checkDay(query.startDate), timeZone) } : {}),
      // 끝은 다음 날의 시작이다. 24시간을 더하면 서머타임이 바뀌는 날에 한 시간이 빠지거나 더해졌다.
      ...(query.endDate ? { lt: zonedDateStringToUtc(nextDateKey(checkDay(query.endDate)), timeZone) } : {}),
    };

    const rows: EntrySheetRow[] = [];
    let cursor: { date: Date; id: string } | null = null;
    for (;;) {
      const batch = await this.readBatch(projectId, dateFilter, cursor);
      if (batch.length === 0) break;
      for (const entry of batch) rows.push(...entrySheetRowsOf(toViewEntry(entry), timeZone, cardTypeOf));
      const last = batch[batch.length - 1];
      cursor = { date: last.date, id: last.id };
      if (batch.length < EXPORT_BATCH) break;
    }
    return numberEntrySheetRows(rows);
  }

  private readBatch(projectId: string, dateFilter: { gte?: Date; lt?: Date }, cursor: { date: Date; id: string } | null) {
    return this.prisma.journalEntry.findMany({
      where: {
        projectId,
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        ...(cursor ? { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] } : {}),
      },
      include: ENTRY_INCLUDE,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: EXPORT_BATCH,
    });
  }
}

/** 서비스가 던진 것을 사람이 읽을 문장으로. */
function reasonOf(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  // 원장 규칙의 오류(코드가 붙은 LedgerBuildError)는 사람이 읽을 문장이라 그대로 보낸다.
  // Prisma 오류도 문자열 코드를 달고 오지만 규칙이 아니다 (`isPrismaError`) -- 원문에 질의가 실려 있다.
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    !isPrismaError(error)
  ) {
    return error.message;
  }
  // 규칙이 거절한 것이 아니면(DB 오류 따위) 원문을 보내지 않는다 -- 서버 내부가 드러난다 (2026-10-16).
  console.error('엑셀 가져오기 줄 처리 실패:', error);
  return '이 줄을 처리하지 못했습니다.';
}

function checkDay(value: string): string {
  // 달력에 있는 날만 받는다 (`isDateKey`). 모양만 보면 2026-02-31 이 3월로 넘어갔다.
  if (!isDateKey(value)) throw badRequest('ENTRY_SHEET_INVALID', '날짜는 2026-09-30 처럼 보내 주세요.');
  return value;
}

