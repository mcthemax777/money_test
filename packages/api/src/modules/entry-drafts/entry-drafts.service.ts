/**
 * 보관함. 아직 거래가 아닌 후보를 받아 두는 곳.
 *
 * 이 서비스는 **문구를 해석하지 않는다.** 알림을 읽고 캡처에서 글자를 뽑아 값으로
 * 만드는 일은 기기가 하고(core 의 `draft-parse`), 여기는 그 결과를 담아 두었다가
 * 다른 기기와 웹에 나른다. 해석을 두 곳에 두면 같은 문구가 기기와 서버에서 다르게
 * 읽히고, 어느 쪽이 맞는지 판정할 근거가 없다.
 *
 * 거래를 만드는 길도 여기 없다. 후보를 누르면 화면은 **기존 거래 생성 경로**로
 * 거래를 만들고(온라인이면 `POST /entries`, 오프라인이면 아웃박스 명령),
 * 그 다음 `PATCH` 로 후보에 등록 표시만 남긴다. 전표의 검증과 잔액 반영이 한
 * 자리에 남아야 하기 때문이다.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EntryDraftDto,
  RECURRING_CATCH_UP_DAYS,
  addDays,
  zonedDateKey,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { badRequest } from '@/common/app-error';
import { clientId } from '@/common/client-id';
import { toOptionalMoney } from '@/common/money';

/** 한 번에 담을 수 있는 후보. 캡처 한 장에서 이보다 많이 나오면 사람이 볼 수 없다. */
const MAX_BATCH = 100;

/** 목록의 기본 상한. 보관함이 이보다 길면 정리가 먼저 필요하다. */
const DEFAULT_LIMIT = 200;

const SOURCES = ['notification', 'capture', 'recurring'] as const;
const STATUSES = ['pending', 'registered', 'dismissed'] as const;

/** 후보가 담을 수 있는 갈래. 잔액 조정은 사람이 적는 것이 아니라 여기 없다. */
const KINDS = ['expense', 'income', 'transfer', 'card_payment'] as const;

type DraftRow = Prisma.EntryDraftGetPayload<{}>;

@Injectable()
export class EntryDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(
    userId: string,
    query: EntryDraftDto.ListQuery,
    projectIdParam?: string,
  ): Promise<EntryDraftDto.Response[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || query.projectId,
    );

    const source = query.source ? this.checkSource(query.source) : undefined;
    /*
     * 상태를 주지 않으면 대기 중인 것만 준다.
     *
     * 등록·무시된 후보는 같은 알림이 되살아나지 못하게 막는 자리표에 가깝다. 목록의
     * 본론이 아니므로 보이지 않는 것이 옳고, 필요하면 `status=all` 로 볼 수 있다.
     */
    const status =
      query.status === 'all' ? undefined : this.checkStatus(query.status ?? 'pending');

    const rows = await this.prisma.entryDraft.findMany({
      where: { projectId, ...(source ? { source } : {}), ...(status ? { status } : {}) },
      // 새로 온 것이 위다. 알림은 방금 결제한 것이 대개 가장 먼저 찾는 것이다.
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(1, Number(query.limit) || DEFAULT_LIMIT), 1000),
    });

    return rows.map(toResponse);
  }

  /**
   * 기기가 읽어 낸 후보를 담는다. 여러 건을 한 번에 받는다.
   *
   * 같은 것을 두 번 담지 않는다. (프로젝트, dedupeKey) 가 유일하므로 이미 있는 것은
   * 건너뛴다 -- 알림이 재전송되거나 같은 캡처를 두 번 올리는 일이 실제로 있고, 그때
   * 후보가 둘로 늘면 사람이 같은 거래를 두 번 적게 된다.
   *
   * **이미 있는 것을 덮어쓰지 않는다.** 사람이 손봐 둔 값이나 등록 표시가 있을 수
   * 있고, 새로 온 것은 그와 같은 원문에서 나온 같은 값이다.
   */
  async createMany(
    userId: string,
    dto: EntryDraftDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<EntryDraftDto.CreateResponse> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );

    const items = Array.isArray(dto.drafts) ? dto.drafts : [];
    if (items.length === 0) {
      throw badRequest('DRAFTS_REQUIRED', '담을 후보가 없습니다.');
    }
    if (items.length > MAX_BATCH) {
      throw badRequest('DRAFTS_TOO_MANY', `한 번에 ${MAX_BATCH}건까지 담을 수 있습니다.`);
    }

    /*
     * 반복에서 온 후보는 한 번 더 본다.
     *
     * 회차를 만드는 일이 기기에 있으므로, 기기의 시계가 틀렸거나 규칙이 남의 것이면
     * 엉뚱한 날의 후보가 들어온다. 서버가 아는 것으로 가려낸다 -- 이 프로젝트의
     * 규칙인가, 열쇠가 `r:<규칙>:<날짜>` 모양인가, 그 날이 따라잡을 수 있는 구간
     * (오늘부터 31일 전까지) 안인가.
     */
    await this.checkRecurringItems(projectId, items);

    const created: DraftRow[] = [];
    let skipped = 0;

    for (const item of items) {
      const dedupeKey = String(item.dedupeKey ?? '').trim();
      if (!dedupeKey) {
        throw badRequest('DRAFT_DEDUPE_KEY_REQUIRED', '후보의 중복 열쇠가 없습니다.');
      }
      const rawText = String(item.rawText ?? '').trim();
      if (!rawText) {
        throw badRequest('DRAFT_RAW_TEXT_REQUIRED', '읽은 원문이 없습니다.');
      }

      const data: Prisma.EntryDraftUncheckedCreateInput = {
        id: clientId(item.id, '후보 식별자'),
        projectId,
        source: this.checkSource(item.source),
        dedupeKey,
        rawText,
        appPackage: item.appPackage ?? null,
        appTitle: item.appTitle ?? null,
        kind: item.kind ? this.checkKind(item.kind) : null,
        amount: toOptionalMoney(item.amount ?? null, '후보 금액'),
        currency: item.currency ?? null,
        occurredAt: toOptionalDate(item.occurredAt, '거래 시각'),
        merchant: item.merchant ?? null,
        description: item.description ?? null,
        installmentMonths: toOptionalMonths(item.installmentMonths),
        personId: item.personId ?? null,
        categoryId: item.categoryId ?? null,
        accountId: item.accountId ?? null,
        cardId: item.cardId ?? null,
        confidence: clampConfidence(item.confidence),
        parser: item.parser ?? null,
        // 위 검사를 지난 값이다. 반복이 아닌 후보에는 오지 않는다.
        recurringRuleId: item.source === 'recurring' ? (item.recurringRuleId ?? null) : null,
        createdByUserId: userId,
      };

      /*
       * 겹치면 건너뛴다.
       *
       * 먼저 조회해서 가리지 않는다. 두 기기가 같은 알림을 동시에 올리면 그 사이에
       * 끼어들어 둘 다 "없다"로 읽는다. 유일 제약이 잡아 주는 것을 그대로 쓴다.
       */
      try {
        created.push(await this.prisma.entryDraft.create({ data }));
      } catch (error) {
        if (isDedupeConflict(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { created: created.length, skipped, drafts: created.map(toResponse) };
  }

  /**
   * 반복에서 온 후보가 규칙과 오늘에 맞는가.
   *
   * 어긋난 것이 하나라도 있으면 요청 전체를 거절한다. 조용히 건너뛰면 기기가 잘못
   * 셈하고 있다는 사실이 아무 데도 남지 않는다 -- 반복은 사람이 적어 둔 값이라
   * "읽다 실패할" 자리가 없고, 어긋났다면 그것은 시계나 코드의 문제다.
   *
   * 반복이 아닌 후보(알림·캡처)에는 아무 일도 하지 않는다.
   */
  private async checkRecurringItems(
    projectId: string,
    items: EntryDraftDto.CreateItem[],
  ): Promise<void> {
    const recurring = items.filter((item) => item.source === 'recurring');
    if (recurring.length === 0) return;

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { timezone: true },
    });

    // "오늘"은 프로젝트 타임존 기준이다 (거래가 며칟날에 들리는지와 같은 기준).
    const today = zonedDateKey(new Date(), project.timezone);
    const oldest = addDays(today, -RECURRING_CATCH_UP_DAYS);

    const ruleIds = [
      ...new Set(recurring.map((item) => item.recurringRuleId).filter((id): id is string => !!id)),
    ];
    const rules = await this.prisma.recurringRule.findMany({
      where: { projectId, id: { in: ruleIds } },
      select: { id: true },
    });
    const known = new Set(rules.map((rule) => rule.id));

    for (const item of recurring) {
      const ruleId = item.recurringRuleId;
      if (!ruleId || !known.has(ruleId)) {
        throw badRequest('RECURRING_NOT_FOUND', '그 반복 등록을 찾을 수 없습니다.');
      }

      const occurredAt = item.occurredAt ? new Date(item.occurredAt) : null;
      if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
        throw badRequest('DRAFT_RECURRING_INVALID', '반복 후보에 날짜가 없습니다.');
      }

      const dateKey = zonedDateKey(occurredAt, project.timezone);
      if (String(item.dedupeKey ?? '') !== `r:${ruleId}:${dateKey}`) {
        throw badRequest(
          'DRAFT_RECURRING_INVALID',
          '반복 후보의 중복 열쇠가 그 날짜와 맞지 않습니다.',
        );
      }
      /*
       * 오늘보다 뒤인 날은 받지 않는다.
       *
       * 앞당겨진 시계나 잘못된 셈이 "다음 달 월세"를 지금 보관함에 넣는 것을 막는다.
       * 자정 무렵 기기가 몇 분 빠르면 이 자리에서 거절되는데, 다음 번에 올리면
       * 들어간다 -- 만든 것이 없으므로 그 회차가 사라지지는 않는다.
       */
      if (dateKey > today || dateKey < oldest) {
        throw badRequest(
          'DRAFT_RECURRING_INVALID',
          `반복 후보의 날짜(${dateKey})가 만들 수 있는 구간을 벗어났습니다.`,
        );
      }
    }
  }

  /**
   * 후보를 손보거나 처지를 바꾼다. 준 칸만 건드린다.
   *
   * 등록 표시(`status: 'registered'`)는 거래를 만든 화면이 곧바로 이어서 부른다.
   * 그 사이에 앱이 죽으면 거래는 남고 후보는 대기로 남는데, 그 편이 반대보다 낫다 --
   * 사람이 같은 거래를 두 번 적을 위험은 목록에서 눈으로 걸러지지만, 만들지 못한
   * 거래를 등록됨으로 감춰 버리면 아무도 알아채지 못한다.
   */
  async update(
    id: string,
    userId: string,
    dto: EntryDraftDto.UpdateRequest,
  ): Promise<EntryDraftDto.Response> {
    const draft = await this.find(id, userId, 'editor');

    const data: Prisma.EntryDraftUncheckedUpdateInput = {};
    if ('kind' in dto) data.kind = dto.kind ? this.checkKind(dto.kind) : null;
    if ('amount' in dto) data.amount = toOptionalMoney(dto.amount ?? null, '후보 금액');
    if ('currency' in dto) data.currency = dto.currency ?? null;
    if ('occurredAt' in dto) data.occurredAt = toOptionalDate(dto.occurredAt, '거래 시각');
    if ('merchant' in dto) data.merchant = dto.merchant ?? null;
    if ('description' in dto) data.description = dto.description ?? null;
    if ('installmentMonths' in dto) {
      data.installmentMonths = toOptionalMonths(dto.installmentMonths);
    }
    if ('personId' in dto) data.personId = dto.personId ?? null;
    if ('categoryId' in dto) data.categoryId = dto.categoryId ?? null;
    if ('accountId' in dto) data.accountId = dto.accountId ?? null;
    if ('cardId' in dto) data.cardId = dto.cardId ?? null;
    if ('status' in dto && dto.status) data.status = this.checkStatus(dto.status);
    if ('registeredEntryId' in dto) {
      const entryId = dto.registeredEntryId ?? null;
      /*
       * 이 프로젝트의 거래인지 확인한다.
       *
       * 없는 id 를 그대로 넣으면 외래 키가 500 으로 튀고, 남의 프로젝트 거래를
       * 가리키면 그 거래를 지울 때 이쪽 후보가 조용히 풀린다.
       */
      if (entryId) {
        const entry = await this.prisma.journalEntry.findFirst({
          where: { id: entryId, projectId: draft.projectId },
          select: { id: true },
        });
        if (!entry) throw badRequest('ENTRY_NOT_FOUND', '등록한 거래를 찾을 수 없습니다.');
      }
      data.registeredEntryId = entryId;
    }

    const updated = await this.prisma.entryDraft.update({ where: { id }, data });
    return toResponse(updated);
  }

  /**
   * 후보를 지운다. 자리표가 남아 다른 기기의 사본에서도 사라진다.
   *
   * 무시하기(`status: 'dismissed'`)와 다르다. 무시는 "같은 알림이 다시 와도 담지
   * 않는다"는 표시를 남기고, 지우기는 그 표시까지 없앤다. 화면의 기본 동작은 무시다.
   */
  async remove(id: string, userId: string): Promise<{ id: string }> {
    await this.find(id, userId, 'editor');
    await this.prisma.entryDraft.delete({ where: { id } });
    return { id };
  }

  /**
   * 등록·무시된 후보를 걷어낸다. 보관함이 자리표 창고가 되지 않게 한다.
   *
   * 오래된 것만 지운다. 방금 등록한 후보를 곧바로 지우면 같은 알림이 재전송될 때
   * 다시 대기로 살아난다.
   */
  async pruneHandled(
    userId: string,
    days: number,
    projectIdParam?: string,
  ): Promise<{ removed: number }> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam,
      'editor',
    );
    const cutoff = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.entryDraft.deleteMany({
      where: {
        projectId,
        status: { in: ['registered', 'dismissed'] },
        updatedAt: { lt: cutoff },
      },
    });
    return { removed: count };
  }

  /** 그 후보를 볼 수 있는가. 프로젝트 권한을 함께 확인한다. */
  private async find(id: string, userId: string, role?: 'editor'): Promise<DraftRow> {
    const draft = await this.prisma.entryDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('후보를 찾을 수 없습니다.');

    await this.projectAccess.resolveAndVerifyProjectId(userId, draft.projectId, role);
    return draft;
  }

  private checkSource(value: string): (typeof SOURCES)[number] {
    if (!SOURCES.includes(value as (typeof SOURCES)[number])) {
      throw badRequest('DRAFT_SOURCE_INVALID', '후보의 출처가 올바르지 않습니다.');
    }
    return value as (typeof SOURCES)[number];
  }

  private checkStatus(value: string): (typeof STATUSES)[number] {
    if (!STATUSES.includes(value as (typeof STATUSES)[number])) {
      throw badRequest('DRAFT_STATUS_INVALID', '후보의 상태가 올바르지 않습니다.');
    }
    return value as (typeof STATUSES)[number];
  }

  private checkKind(value: string): (typeof KINDS)[number] {
    if (!KINDS.includes(value as (typeof KINDS)[number])) {
      throw badRequest('DRAFT_KIND_INVALID', '후보의 유형이 올바르지 않습니다.');
    }
    return value as (typeof KINDS)[number];
  }
}

/** 와이어로 나가는 모양. 금액과 날짜를 문자열로 편다. */
function toResponse(row: DraftRow): EntryDraftDto.Response {
  return {
    id: row.id,
    projectId: row.projectId,
    source: row.source as EntryDraftDto.Response['source'],
    status: row.status as EntryDraftDto.Response['status'],
    rawText: row.rawText,
    appPackage: row.appPackage,
    appTitle: row.appTitle,
    kind: row.kind as EntryDraftDto.Response['kind'],
    amount: row.amount ? row.amount.toString() : null,
    currency: row.currency,
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    merchant: row.merchant,
    description: row.description,
    installmentMonths: row.installmentMonths,
    personId: row.personId,
    categoryId: row.categoryId,
    accountId: row.accountId,
    cardId: row.cardId,
    confidence: row.confidence,
    parser: row.parser,
    dedupeKey: row.dedupeKey,
    registeredEntryId: row.registeredEntryId,
    recurringRuleId: row.recurringRuleId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 0~100 으로 자른다. 기기가 무엇을 보내도 이 범위를 벗어나지 않는다. */
function clampConfidence(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function toOptionalDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw badRequest('DRAFT_DATE_INVALID', `${label}이 올바르지 않습니다.`);
  }
  return date;
}

/** 할부 개월수. 1 은 일시불이라 담지 않는다 (전표 쪽 규칙과 같다). */
function toOptionalMonths(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const months = Number(value);
  if (!Number.isInteger(months) || months < 2 || months > 60) return null;
  return months;
}

/** (프로젝트, dedupeKey) 가 겹쳤는가. 기본 키 충돌은 여기 들지 않는다. */
function isDedupeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((field) => field.includes('dedupeKey'));
}
