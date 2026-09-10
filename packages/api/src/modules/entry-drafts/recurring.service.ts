/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보가 만들어지는 규칙.
 *
 * **거래를 만들지 않는다.** 만들어지는 것은 후보(EntryDraft)이고, 사용자가 보관함에서
 * 눌러야 전표가 된다. 자동으로 장부에 적히면 그 달의 합계가 사람 모르게 움직인다 --
 * 반복은 "적는 것을 잊지 않게" 하는 장치이지 "대신 적는" 장치가 아니다.
 *
 * **회차를 만드는 일은 이 서비스가 하지 않는다.** 기기가 목록을 읽어 밀린 날을 셈하고
 * (core 의 `recurring-drafts`) 알림·캡처 후보와 **같은 길**(`POST /entry-drafts`)로
 * 올린다. 서버가 하는 일은 그것을 받아 겹침을 막고(프로젝트, dedupeKey 유일 제약),
 * 올라온 날이 규칙과 오늘에 맞는지 보는 것이다(`entry-drafts.service` 의 구간 검사).
 *
 * 그래서 이 표에는 "어디까지 만들었는가"를 적는 칸이 없다. 그 답은 후보 자신의 열쇠
 * (`r:<규칙>:<날짜>`)에 있고, 목록을 줄 때 그 최댓값을 세어 `lastMadeOn` 으로 싣는다.
 * 표를 따로 들고 있으면 올리다 끊긴 회차가 "만들었다"로 남아 아무도 그 날을 다시
 * 만들지 않는다.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RecurringRuleDto,
  checkRecurring,
  nextOccurrence,
  zonedDateKey,
  type RecurringSchedule,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { badRequest } from '@/common/app-error';
import { clientId } from '@/common/client-id';
import { toOptionalMoney } from '@/common/money';

/** 태그까지 함께 읽은 규칙 한 줄. 화면에 나갈 때 그 id 만 배열로 펴 준다. */
type RuleRow = Prisma.RecurringRuleGetPayload<{
  include: { tags: { select: { tagId: true } } };
}>;

/** 후보가 담을 수 있는 갈래. 잔액 조정은 사람이 적는 것이 아니라 여기 없다. */
const KINDS = ['expense', 'income', 'transfer', 'card_payment'] as const;

@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(userId: string, projectIdParam?: string): Promise<RecurringRuleDto.Response[]> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectIdParam);
    const project = await this.projectOf(projectId);

    const rows = await this.prisma.recurringRule.findMany({
      where: { projectId },
      // 태그는 다리 표에 있다. 줄마다 따로 물으면 규칙 수만큼 조회가 늘어난다.
      include: { tags: { select: { tagId: true } } },
      // 켜져 있는 것이 위다. 꺼 둔 것은 지금 아무 일도 하지 않는다.
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    const today = zonedDateKey(new Date(), project.timezone);
    const made = await this.lastMadeOn(
      projectId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toResponse(row, today, made.get(row.id) ?? null));
  }

  /**
   * 반복마다 후보를 만든 마지막 날.
   *
   * 후보의 열쇠가 `r:<규칙>:<날짜>` 라 **열쇠의 최댓값이 곧 마지막 날**이다(한 규칙
   * 안에서는 앞부분이 같아 사전순 비교가 날짜 비교다). 규칙마다 묻지 않고 한 번에
   * 묶어 센다.
   *
   * 처지는 가리지 않는다. 등록했든 무시했든 그 회차는 이미 만들어진 것이다. 사람이
   * **지운** 회차만 다시 만들어지는데, 그것은 알림 후보의 지우기와 같은 뜻이다
   * ("표시까지 없앤다").
   */
  private async lastMadeOn(projectId: string, ruleIds: string[]): Promise<Map<string, string>> {
    const made = new Map<string, string>();
    if (ruleIds.length === 0) return made;

    const rows = await this.prisma.entryDraft.groupBy({
      by: ['recurringRuleId'],
      where: { projectId, recurringRuleId: { in: ruleIds } },
      _max: { dedupeKey: true },
    });

    for (const row of rows) {
      if (!row.recurringRuleId) continue;
      const dateKey = dateFromDedupeKey(row._max.dedupeKey);
      if (dateKey) made.set(row.recurringRuleId, dateKey);
    }
    return made;
  }

  async create(
    userId: string,
    dto: RecurringRuleDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<RecurringRuleDto.Response> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );
    const project = await this.projectOf(projectId);

    const description = String(dto.description ?? '').trim();
    if (!description) {
      throw badRequest('RECURRING_DESCRIPTION_REQUIRED', '무엇을 적을지 이름을 넣어 주세요.');
    }
    this.checkSchedule(dto);

    const tagIds = await this.checkTags(projectId, dto.tagIds);

    const rule = await this.prisma.recurringRule.create({
      include: { tags: { select: { tagId: true } } },
      data: {
        id: clientId(dto.id, '반복 식별자'),
        projectId,
        isActive: dto.isActive ?? true,
        ...this.scheduleData(dto),
        kind: this.checkKind(dto.kind),
        amount: toOptionalMoney(dto.amount ?? null, '반복 금액'),
        currency: dto.currency ?? null,
        description,
        merchant: dto.merchant ?? null,
        personId: dto.personId ?? null,
        categoryId: dto.categoryId ?? null,
        accountId: dto.accountId ?? null,
        cardId: dto.cardId ?? null,
        installmentMonths: toOptionalMonths(dto.installmentMonths),
        ...(tagIds ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
        createdByUserId: userId,
      },
    });

    /*
     * 밀린 회차는 여기서 만들지 않는다.
     *
     * 시작일을 지난 날짜로 두고 만드는 일이 흔한데("지난 25일부터 월세"), 그 회차는
     * 저장 직후 화면이 목록을 다시 읽으면서 올린다. 만든 것이 아직 없으므로
     * `lastMadeOn` 은 null 이다.
     */
    const today = zonedDateKey(new Date(), project.timezone);
    return toResponse(rule, today, null);
  }

  async update(
    id: string,
    userId: string,
    dto: RecurringRuleDto.UpdateRequest,
  ): Promise<RecurringRuleDto.Response> {
    const rule = await this.find(id, userId, 'editor');
    const project = await this.projectOf(rule.projectId);

    // 일정 칸을 하나라도 건드리면 바뀐 뒤의 모습으로 검사한다.
    const merged = { ...toSchedule(rule), ...schedulePatch(dto) };
    this.checkSchedule(merged);

    const data: Prisma.RecurringRuleUncheckedUpdateInput = {};
    if ('isActive' in dto) data.isActive = Boolean(dto.isActive);
    if ('frequency' in dto || 'everyDays' in dto || 'dayOfMonth' in dto || 'month' in dto) {
      Object.assign(data, this.scheduleData(merged));
    }
    if ('startDate' in dto) data.startDate = merged.startDate;
    if ('endDate' in dto) data.endDate = merged.endDate ?? null;
    if ('timeOfDay' in dto) data.timeOfDay = dto.timeOfDay ?? null;

    if ('kind' in dto && dto.kind) data.kind = this.checkKind(dto.kind);
    if ('amount' in dto) data.amount = toOptionalMoney(dto.amount ?? null, '반복 금액');
    if ('currency' in dto) data.currency = dto.currency ?? null;
    if ('description' in dto) {
      const description = String(dto.description ?? '').trim();
      if (!description) {
        throw badRequest('RECURRING_DESCRIPTION_REQUIRED', '무엇을 적을지 이름을 넣어 주세요.');
      }
      data.description = description;
    }
    if ('merchant' in dto) data.merchant = dto.merchant ?? null;
    if ('personId' in dto) data.personId = dto.personId ?? null;
    if ('categoryId' in dto) data.categoryId = dto.categoryId ?? null;
    if ('accountId' in dto) data.accountId = dto.accountId ?? null;
    if ('cardId' in dto) data.cardId = dto.cardId ?? null;
    if ('installmentMonths' in dto) {
      data.installmentMonths = toOptionalMonths(dto.installmentMonths);
    }

    /*
     * 태그는 준 배열로 통째로 갈아 끼운다.
     *
     * 생략과 빈 배열을 가른다 -- 생략은 "그대로 둔다", 빈 배열은 "전부 뗀다" 다.
     * 전표의 태그 저장과 같은 규칙이다(`ledger.service` 의 saveTags).
     */
    const tagIds = 'tagIds' in dto ? await this.checkTags(rule.projectId, dto.tagIds) : null;

    const updated = await this.prisma.recurringRule.update({
      where: { id },
      include: { tags: { select: { tagId: true } } },
      data: {
        ...data,
        ...(tagIds
          ? { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
    });

    // 껐다 켜거나 일정을 앞당겨 밀린 회차가 생겼으면, 화면이 목록을 다시 읽을 때 올린다.
    const today = zonedDateKey(new Date(), project.timezone);
    const made = await this.lastMadeOn(updated.projectId, [updated.id]);
    return toResponse(updated, today, made.get(updated.id) ?? null);
  }

  /**
   * 반복을 지운다. **이미 만들어진 후보는 남는다.**
   *
   * 사용자가 아직 처리하지 않은 후보까지 사라지면 "어제 만들어진 것이 왜 없지"가 된다.
   * 연결만 풀린다(SetNull).
   */
  async remove(id: string, userId: string): Promise<{ id: string }> {
    await this.find(id, userId, 'editor');
    await this.prisma.recurringRule.delete({ where: { id } });
    return { id };
  }

  private async find(id: string, userId: string, role?: 'editor'): Promise<RuleRow> {
    const rule = await this.prisma.recurringRule.findUnique({
      where: { id },
      include: { tags: { select: { tagId: true } } },
    });
    if (!rule) throw new NotFoundException('반복 등록을 찾을 수 없습니다.');

    await this.projectAccess.resolveAndVerifyProjectId(userId, rule.projectId, role);
    return rule;
  }

  private async projectOf(projectId: string): Promise<{ id: string; timezone: string }> {
    return this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, timezone: true },
    });
  }

  /** 일정이 저장할 수 있는 모양인가. 화면과 **같은 함수**로 본다. */
  private checkSchedule(schedule: RecurringSchedule | RecurringRuleDto.Body): void {
    const found = checkRecurring(schedule as RecurringSchedule);
    if (found) {
      throw badRequest('RECURRING_INVALID', `반복 일정이 올바르지 않습니다 (${found.code}).`);
    }
  }

  /** 일정 칸만 골라 저장 모양으로. 갈래에 뜻이 없는 칸은 비운다. */
  private scheduleData(schedule: RecurringSchedule | RecurringRuleDto.Body) {
    const frequency = schedule.frequency;
    return {
      frequency,
      everyDays: frequency === 'daily' ? Math.max(1, Number(schedule.everyDays ?? 1)) : null,
      // 주기가 없으면 셋 다 비운다. 저절로 오는 날이 없어 정할 것이 없다.
      dayOfMonth:
        frequency === 'monthly' || frequency === 'yearly' ? Number(schedule.dayOfMonth) : null,
      month: frequency === 'yearly' ? Number(schedule.month) : null,
      startDate: schedule.startDate,
      endDate: schedule.endDate ?? null,
      /*
       * 시각은 정해진 날의 몇 시로 담을지다. 주기가 없으면 그 날이 없다 -- 사람이
       * 누르는 그 순간의 시각으로 담기므로(core 의 `manualDraftItem`) 적어 둔 값을
       * 아무도 보지 않는다. 남겨 두면 표에 쓰이지 않는 값이 남는다.
       */
      timeOfDay:
        frequency === 'none' ? null : ((schedule as RecurringRuleDto.Body).timeOfDay ?? null),
    };
  }

  /**
   * 이 프로젝트의 태그인가. 아니면 거절한다.
   *
   * 남의 프로젝트 태그를 그대로 심으면 다리 표의 외래 키는 통과한다 -- 그 태그가
   * 실재하기 때문이다. 그러면 이 가계부의 반복이 남의 태그를 들고 있게 되고, 그 규칙이
   * 만든 후보를 거래로 적을 때 전표 쪽 검사(TAG_NOT_IN_PROJECT)가 그때야 막는다.
   *
   * 준 것이 없으면 null 을 돌려준다. 부르는 쪽이 "건드리지 않는다" 로 읽는다.
   */
  private async checkTags(projectId: string, tagIds?: string[]): Promise<string[] | null> {
    if (tagIds === undefined) return null;

    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];

    const found = await this.prisma.tag.findMany({
      where: { id: { in: unique }, projectId },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw badRequest('TAG_NOT_IN_PROJECT', '이 프로젝트에 없는 태그가 포함되어 있습니다.');
    }
    return unique;
  }

  private checkKind(value: string): (typeof KINDS)[number] {
    if (!KINDS.includes(value as (typeof KINDS)[number])) {
      throw badRequest('DRAFT_KIND_INVALID', '반복의 유형이 올바르지 않습니다.');
    }
    return value as (typeof KINDS)[number];
  }
}

/**
 * 저장된 행에서 일정 부분만. 셈하는 함수가 받는 모양이다.
 *
 * `lastMadeOn` 은 행에 없다(후보에서 센다). 다음 예정일을 셈할 때만 밖에서 받는다.
 */
function toSchedule(rule: RuleRow, lastMadeOn: string | null = null): RecurringSchedule {
  return {
    frequency: rule.frequency as RecurringSchedule['frequency'],
    everyDays: rule.everyDays,
    dayOfMonth: rule.dayOfMonth,
    month: rule.month,
    startDate: rule.startDate,
    endDate: rule.endDate,
    lastMadeOn,
  };
}

/** 수정 요청에서 일정 칸만. 준 것만 담아 합칠 수 있게 한다. */
function schedulePatch(dto: RecurringRuleDto.UpdateRequest): Partial<RecurringSchedule> {
  const patch: Partial<RecurringSchedule> = {};
  if ('frequency' in dto && dto.frequency) patch.frequency = dto.frequency;
  if ('everyDays' in dto) patch.everyDays = dto.everyDays ?? null;
  if ('dayOfMonth' in dto) patch.dayOfMonth = dto.dayOfMonth ?? null;
  if ('month' in dto) patch.month = dto.month ?? null;
  if ('startDate' in dto && dto.startDate) patch.startDate = dto.startDate;
  if ('endDate' in dto) patch.endDate = dto.endDate ?? null;
  return patch;
}

/** 와이어로 나가는 모양. 다음 예정일과 마지막으로 만든 날을 함께 싣는다. */
function toResponse(
  rule: RuleRow,
  todayKey: string,
  lastMadeOn: string | null,
): RecurringRuleDto.Response {
  return {
    id: rule.id,
    projectId: rule.projectId,
    isActive: rule.isActive,
    frequency: rule.frequency as RecurringRuleDto.Response['frequency'],
    everyDays: rule.everyDays,
    dayOfMonth: rule.dayOfMonth,
    month: rule.month,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timeOfDay: rule.timeOfDay,
    kind: rule.kind as RecurringRuleDto.Response['kind'],
    amount: rule.amount ? rule.amount.toString() : null,
    currency: rule.currency,
    description: rule.description,
    merchant: rule.merchant,
    personId: rule.personId,
    categoryId: rule.categoryId,
    accountId: rule.accountId,
    cardId: rule.cardId,
    installmentMonths: rule.installmentMonths,
    tagIds: rule.tags.map((row) => row.tagId),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    // 꺼 둔 반복은 아무 날도 오지 않는다.
    nextRunOn: rule.isActive ? nextOccurrence(toSchedule(rule, lastMadeOn), todayKey) : null,
    lastMadeOn,
  };
}

/**
 * 후보 열쇠(`r:<규칙>:<날짜>`)에서 날짜만.
 *
 * 뒤에 표가 하나 더 붙는 열쇠도 있다(`r:<규칙>:<날짜>:<표>`). 사람이 "만들기"를 눌러
 * 만든 회차인데, 같은 날짜로 여러 건이 생길 수 있어 날짜만으로는 열쇠가 겹친다.
 * 그래서 마지막 토막이 아니라 **날짜 모양인 토막**을 찾는다 -- 마지막을 집으면 그
 * 열쇠에서 표를 날짜로 읽는다.
 *
 * 모양이 어긋난 열쇠는 없는 것으로 본다. 그러면 그 회차를 한 번 더 올리게 되지만,
 * 유일 제약이 잡아 주므로 후보가 늘지는 않는다.
 */
function dateFromDedupeKey(key: string | null): string | null {
  const found = key?.match(/:(\d{4}-\d{2}-\d{2})(?::|$)/);
  return found ? found[1] : null;
}

/** 할부 개월수. 1 은 일시불이라 담지 않는다 (전표 쪽 규칙과 같다). */
function toOptionalMonths(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const months = Number(value);
  if (!Number.isInteger(months) || months < 2 || months > 60) return null;
  return months;
}
