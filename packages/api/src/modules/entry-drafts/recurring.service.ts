/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보가 만들어지는 규칙.
 *
 * **거래를 만들지 않는다.** 만들어지는 것은 후보(EntryDraft)이고, 사용자가 보관함에서
 * 눌러야 전표가 된다. 자동으로 장부에 적히면 그 달의 합계가 사람 모르게 움직인다 --
 * 반복은 "적는 것을 잊지 않게" 하는 장치이지 "대신 적는" 장치가 아니다.
 *
 * **밀린 회차는 이 서비스가 만든다** (`generateDue`). 정각마다 켜진 규칙을 모두 훑고,
 * 규칙을 저장하는 요청 안에서도 그 규칙의 것을 곧바로 만든다. 누가 보관함을 열지
 * 않아도, 보기 권한만 있는 구성원뿐이어도 회차가 생기고 푸시가 나간다. 기기는 주기 없는
 * 반복의 "만들기"만 올린다.
 *
 * 몇 번을 돌아도, 서버가 여러 대여도 후보는 늘지 않는다 -- 열쇠(`r:<규칙>:<날짜>`)가
 * (프로젝트, dedupeKey) 유일 제약에 걸린다.
 *
 * 그래서 이 표에는 "어디까지 만들었는가"를 적는 칸이 없다. 그 답은 후보 자신의 열쇠
 * (`r:<규칙>:<날짜>`)에 있고, 목록을 줄 때 그 최댓값을 세어 `lastMadeOn` 으로 싣는다.
 * 표를 따로 들고 있으면 올리다 끊긴 회차가 "만들었다"로 남아 아무도 그 날을 다시
 * 만들지 않는다.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RecurringRuleDto,
  checkRecurring,
  nextOccurrence,
  recurringDraftItems,
  zonedDateKey,
  type RecurringSchedule,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { badRequest } from '@/common/app-error';
import { clientId } from '@/common/client-id';
import { toOptionalMoney } from '@/common/money';
import { EntryDraftsService } from './entry-drafts.service';

/** 태그까지 함께 읽은 규칙 한 줄. 화면에 나갈 때 그 id 만 배열로 펴 준다. */
type RuleRow = Prisma.RecurringRuleGetPayload<{
  include: { tags: { select: { tagId: true } } };
}>;

/** 후보가 담을 수 있는 갈래. 잔액 조정은 사람이 적는 것이 아니라 여기 없다. */
const KINDS = ['expense', 'income', 'transfer', 'card_payment'] as const;

/**
 * 일정에 시각을 붙인 모양. 표에 저장하는 칸이 이만큼이다.
 *
 * 셈하는 함수(`dueOccurrences`·`nextOccurrence`)는 날짜만 보므로 `RecurringSchedule`
 * 에는 시각이 없다. 하지만 저장은 둘을 함께 쓰므로, 저장 모양을 만드는 자리에서는
 * 시각이 빠지지 않게 타입으로 못을 박는다.
 */
type ScheduleWithTime = RecurringSchedule & { timeOfDay?: string | null };

/** 정각에서 이만큼 지나 돈다. 정각 시각(09:00)으로 적어 둔 회차가 그 차례에 들어온다. */
const GENERATE_OFFSET_MS = 5 * 1000;

/** 서버가 뜬 뒤 첫 차례까지. 멈춰 있던 동안 밀린 회차를 곧바로 따라잡는다. */
const GENERATE_BOOT_DELAY_MS = 30 * 1000;

@Injectable()
export class RecurringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringService.name);
  private timer: NodeJS.Timeout | null = null;
  /** 한 서버 안에서 차례가 겹치지 않게 한다. */
  private generating = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly drafts: EntryDraftsService,
  ) {}

  onModuleInit(): void {
    this.schedule(GENERATE_BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 다음 차례를 건다. 돌고 나면 다음 정각(+5초)에 다시 건다. */
  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.generateDue()
        .catch((error) => this.logger.warn(`반복 회차를 만들지 못했습니다: ${String(error)}`))
        .finally(() => this.schedule(untilNextHour()));
    }, delay);
    // 기다리는 차례 때문에 프로세스가 끝나지 못하면 안 된다.
    this.timer.unref();
  }

  /**
   * 켜진 규칙의 밀린 회차를 만든다. 만든 수를 돌려준다.
   *
   * **오늘 회차는 정해 둔 시각이 지나야 만든다** (시각이 없으면 정오). 날짜만 보면 자정
   * 직후에 "월세" 푸시가 울린다. 시각 전이면 이번에 건너뛰고, 만든 것이 없으니
   * `lastMadeOn` 이 그대로라 다음 차례에 들어온다.
   *
   * **다만 규칙을 저장하는 자리에서는 오늘 시작하는 규칙의 오늘 회차를 시각과 상관없이
   * 만든다** (`onSave`). 오늘부터 쓰려고 방금 만든 규칙인데 보관함이 비어 있으면 안 된다.
   * 정각 작업에는 이 예외가 없다 -- 며칠 전에 "오늘부터"로 만들어 둔 규칙이 자정에 울린다.
   *
   * @param ruleIds 이 규칙들만. 저장 직후에 그 규칙만 돌릴 때 준다.
   */
  async generateDue(ruleIds?: string[], options: { onSave?: boolean } = {}): Promise<number> {
    if (!ruleIds && this.generating) return 0;
    if (!ruleIds) this.generating = true;
    try {
      const rows = await this.prisma.recurringRule.findMany({
        where: {
          isActive: true,
          // 주기 없는 반복은 저절로 오는 날이 없다. 사람이 "만들기"로만 만든다.
          frequency: { not: 'none' },
          ...(ruleIds ? { id: { in: ruleIds } } : {}),
        },
        include: {
          tags: { select: { tagId: true } },
          project: { select: { timezone: true } },
        },
      });
      if (rows.length === 0) return 0;

      const made = await this.lastMadeOn(rows.map((row) => row.id));
      const now = Date.now();

      // 가계부마다 오늘이 다르다(시간대). 가계부 단위로 셈해 담는다.
      const byProject = new Map<string, typeof rows>();
      for (const row of rows) {
        byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row]);
      }

      let created = 0;
      for (const [projectId, projectRows] of byProject) {
        const timeZone = projectRows[0].project.timezone;
        const today = zonedDateKey(new Date(now), timeZone);
        const rules = projectRows.map((row) => toResponse(row, today, made.get(row.id) ?? null));
        const startsToday = new Set(
          rules.filter((rule) => rule.startDate === today).map((rule) => rule.id),
        );
        const items = recurringDraftItems(rules, today, timeZone).filter(
          (item) =>
            !item.occurredAt ||
            Date.parse(item.occurredAt) <= now ||
            (options.onSave && !!item.recurringRuleId && startsToday.has(item.recurringRuleId)),
        );
        if (items.length === 0) continue;

        try {
          created += await this.drafts.createFromServer(projectId, items);
        } catch (error) {
          // 한 가계부의 실패(지워진 태그 등)가 다른 가계부의 회차를 막지 않게 한다.
          this.logger.warn(`반복 회차를 담지 못했습니다 (${projectId}): ${String(error)}`);
        }
      }
      return created;
    } finally {
      if (!ruleIds) this.generating = false;
    }
  }

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
    const made = await this.lastMadeOn(rows.map((row) => row.id));
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
  private async lastMadeOn(ruleIds: string[]): Promise<Map<string, string>> {
    const made = new Map<string, string>();
    if (ruleIds.length === 0) return made;

    const rows = await this.prisma.entryDraft.groupBy({
      by: ['recurringRuleId'],
      where: { recurringRuleId: { in: ruleIds } },
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
     * 밀린 회차를 곧바로 만든다.
     *
     * 시작일을 지난 날짜로 두고 만드는 일이 흔하다("지난 25일부터 월세"). 다음 정각을
     * 기다리게 하면 저장하고 보관함을 봐도 비어 있다.
     */
    return this.respondAfterGenerating(rule, project.timezone);
  }

  async update(
    id: string,
    userId: string,
    dto: RecurringRuleDto.UpdateRequest,
  ): Promise<RecurringRuleDto.Response> {
    const rule = await this.find(id, userId, 'editor');
    const project = await this.projectOf(rule.projectId);

    /*
     * 일정 칸을 하나라도 건드리면 바뀐 뒤의 모습으로 검사한다.
     *
     * **시각도 함께 들고 온다.** `scheduleData` 가 일정 칸과 한 덩어리로 시각을
     * 내놓으므로, 합치는 값에 시각이 없으면 "며칠마다"만 고쳐도 적어 둔 시각이 null 로
     * 지워진다. 그러면 그 뒤의 회차가 조용히 정오로 담긴다 -- 9:30 으로 적어 둔 반복이
     * 12:00 짜리 후보를 만든다.
     */
    const merged = { ...toSchedule(rule), timeOfDay: rule.timeOfDay, ...schedulePatch(dto) };
    this.checkSchedule(merged);

    const data: Prisma.RecurringRuleUncheckedUpdateInput = {};
    if ('isActive' in dto) data.isActive = Boolean(dto.isActive);
    if ('frequency' in dto || 'everyDays' in dto || 'dayOfMonth' in dto || 'month' in dto) {
      Object.assign(data, this.scheduleData(merged));
    }
    if ('startDate' in dto) data.startDate = merged.startDate;
    if ('endDate' in dto) data.endDate = merged.endDate ?? null;
    /*
     * 시각만 고칠 때는 위의 일정 저장이 돌지 않으므로 여기서 넣는다.
     *
     * 주기 없는 반복에는 정해진 날이 없어 비운다 -- `scheduleData` 와 같은 규칙이라야
     * "며칠마다와 함께 고칠 때"와 "시각만 고칠 때"의 결과가 같다.
     */
    if ('timeOfDay' in dto) {
      data.timeOfDay = merged.frequency === 'none' ? null : (merged.timeOfDay ?? null);
    }

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

    // 껐다 켜거나 일정을 앞당겨 밀린 회차가 생겼으면 곧바로 만든다.
    return this.respondAfterGenerating(updated, project.timezone);
  }

  /**
   * 그 규칙의 밀린 회차를 만들고, 만든 뒤의 모습(`lastMadeOn`·다음 예정일)으로 답한다.
   *
   * 회차를 만들다 실패해도 규칙 저장은 이미 끝났다. 실패를 기록하고 저장 결과로 답한다
   * -- 다음 정각에 다시 만든다.
   */
  private async respondAfterGenerating(
    rule: RuleRow,
    timeZone: string,
  ): Promise<RecurringRuleDto.Response> {
    try {
      await this.generateDue([rule.id], { onSave: true });
    } catch (error) {
      this.logger.warn(`반복 회차를 만들지 못했습니다 (${rule.id}): ${String(error)}`);
    }
    const today = zonedDateKey(new Date(), timeZone);
    const made = await this.lastMadeOn([rule.id]);
    return toResponse(rule, today, made.get(rule.id) ?? null);
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

  /**
   * 일정 칸만 골라 저장 모양으로. 갈래에 뜻이 없는 칸은 비운다.
   *
   * **시각까지 함께 내놓는다.** 부르는 쪽은 그것을 빠뜨린 채로 주면 안 된다 -- 여기서
   * `?? null` 로 읽히므로 적어 둔 시각이 조용히 지워진다.
   */
  private scheduleData(schedule: ScheduleWithTime) {
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
      timeOfDay: frequency === 'none' ? null : (schedule.timeOfDay ?? null),
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

/** 다음 정각(+5초)까지 남은 시간. */
function untilNextHour(now: number = Date.now()): number {
  const hour = 60 * 60 * 1000;
  return hour - (now % hour) + GENERATE_OFFSET_MS;
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

/**
 * 수정 요청에서 일정 칸만. 준 것만 담아 합칠 수 있게 한다.
 *
 * 시각도 여기 담는다. 셈하는 함수는 그 값을 보지 않지만(`RecurringSchedule` 에 없다)
 * 저장 모양을 만드는 `scheduleData` 는 본다.
 */
function schedulePatch(dto: RecurringRuleDto.UpdateRequest): Partial<ScheduleWithTime> {
  const patch: Partial<ScheduleWithTime> = {};
  if ('timeOfDay' in dto) patch.timeOfDay = dto.timeOfDay ?? null;
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
