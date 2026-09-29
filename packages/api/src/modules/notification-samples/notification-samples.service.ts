/**
 * 알림 표본과 앱별 문구 규칙.
 *
 * 표본은 기기가 올리고(`createMany`) 관리 도구만 읽는다. 규칙은 관리 도구가 만들고 기기가
 * 내려받는다(`listEnabledRules`). 표본을 규칙으로 바꾸는 일(맞대기·칸 짐작)은 관리 도구의
 * 브라우저에서 `@money/core` 의 `notification-rule` 이 한다 -- 서버는 토막이 규칙으로 쓸
 * 만한지만 본다(`notificationRuleProblem`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NOTIFICATION_RULE_LIMITS,
  notificationRuleProblem,
  type EntryKind,
  type NotificationRule,
  type NotificationRuleDto,
  type NotificationRuleSegment,
  type NotificationSampleDto,
  type NotificationSampleParsed,
} from '@money/types';

import { badRequest, notFound } from '@/common/app-error';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PrismaService } from '@/config/prisma.service';

/** 한 번에 받는 표본 수. 기기 버퍼의 상한(200)과 같다. */
const MAX_BATCH = 200;
const MAX_TEXT = 4000;
const MAX_TITLE = 500;
const MAX_SHORT = 200;
/** 기기가 읽은 결과의 크기 상한. 값 몇 개라 이 정도면 넉넉하다. */
const MAX_PARSED_JSON = 2000;
const KINDS: EntryKind[] = ['expense', 'income', 'transfer'];

type RuleRow = Prisma.NotificationRuleGetPayload<object>;

@Injectable()
export class NotificationSamplesService {
  private readonly logger = new Logger(NotificationSamplesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 기기가 모은 표본을 담는다.
   *
   * **모양이 어긋난 표본은 건너뛰고 요청은 받는다.** 400 으로 통째로 거절하면 기기가 그
   * 알림들을 버퍼에 남긴 채 매번 다시 보낸다. 같은 열쇠는 한 번만 담긴다(skipDuplicates).
   */
  async createMany(
    userId: string,
    dto: NotificationSampleDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<NotificationSampleDto.CreateResponse> {
    const items = Array.isArray(dto?.samples) ? dto.samples : null;
    if (!items) throw badRequest('NOTIFICATION_SAMPLE_INVALID', '표본 목록이 없습니다.');
    if (items.length > MAX_BATCH) {
      throw badRequest('NOTIFICATION_SAMPLE_INVALID', `한 번에 ${MAX_BATCH}건까지 담을 수 있습니다.`);
    }

    // 가계부는 기록일 뿐이라, 이 사람의 것이 아니면 비워 두고 표본은 받는다.
    const projectId = projectIdParam
      ? await this.projectAccess
          .resolveAndVerifyProjectId(userId, projectIdParam)
          .catch(() => null)
      : null;

    const rows = items.flatMap((item) => {
      const row = sampleRow(item);
      return row ? [{ ...row, userId, projectId }] : [];
    });
    const invalid = items.length - rows.length;
    if (invalid > 0) this.logger.warn(`알림 표본 ${invalid}건의 모양이 어긋나 건너뛰었습니다 (user=${userId}).`);
    if (rows.length === 0) return { created: 0, skipped: items.length };

    const { count } = await this.prisma.notificationSample.createMany({ data: rows, skipDuplicates: true });
    return { created: count, skipped: items.length - count };
  }

  /** 관리 도구의 표본 목록. 알림이 온 시각의 새 것부터. */
  async list(query: NotificationSampleDto.ListQuery): Promise<NotificationSampleDto.ListResponse> {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const where: Prisma.NotificationSampleWhereInput = {
      ...(query.packageName ? { packageName: String(query.packageName) } : {}),
      ...(query.parsed === 'yes' ? { parsed: { not: Prisma.AnyNull } } : {}),
      ...(query.parsed === 'no' ? { parsed: { equals: Prisma.AnyNull } } : {}),
      ...(q
        ? {
            OR: [
              { text: { contains: q, mode: 'insensitive' as const } },
              { title: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.notificationSample.findMany({
      where,
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: String(query.cursor) }, skip: 1 } : {}),
      include: { user: { select: { name: true } } },
    });

    const page = rows.slice(0, limit);
    return {
      samples: page.map((row) => ({
        id: row.id,
        packageName: row.packageName,
        title: row.title,
        text: row.text,
        postedAt: row.postedAt.toISOString(),
        parsed: (row.parsed as NotificationSampleParsed | null) ?? null,
        deviceName: row.deviceName,
        appVersion: row.appVersion,
        userName: row.user?.name ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** 앱별 표본 수. 규칙이 있는 앱은 표본이 없어도 목록에 남긴다. */
  async packages(): Promise<NotificationSampleDto.PackageSummary[]> {
    const [all, parsed, rules] = await Promise.all([
      this.prisma.notificationSample.groupBy({
        by: ['packageName'],
        _count: { _all: true },
        _max: { postedAt: true },
      }),
      this.prisma.notificationSample.groupBy({
        by: ['packageName'],
        where: { parsed: { not: Prisma.AnyNull } },
        _count: { _all: true },
      }),
      this.prisma.notificationRule.groupBy({ by: ['packageName'], _count: { _all: true } }),
    ]);

    const parsedOf = new Map(parsed.map((row) => [row.packageName, row._count._all]));
    const rulesOf = new Map(rules.map((row) => [row.packageName, row._count._all]));
    const names = new Set([...all.map((row) => row.packageName), ...rulesOf.keys()]);
    const allOf = new Map(all.map((row) => [row.packageName, row]));

    return [...names]
      .map((packageName) => {
        const row = allOf.get(packageName);
        return {
          packageName,
          count: row?._count._all ?? 0,
          parsedCount: parsedOf.get(packageName) ?? 0,
          ruleCount: rulesOf.get(packageName) ?? 0,
          lastPostedAt: row?._max.postedAt?.toISOString() ?? '',
        };
      })
      .sort((a, b) => b.count - a.count || a.packageName.localeCompare(b.packageName));
  }

  async removeSample(id: string): Promise<void> {
    await this.prisma.notificationSample.deleteMany({ where: { id } });
  }

  // 규칙 ------------------------------------------------------------------

  async listRules(packageName?: string): Promise<NotificationRule[]> {
    const rows = await this.prisma.notificationRule.findMany({
      where: packageName ? { packageName } : {},
      orderBy: [{ packageName: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRule);
  }

  /**
   * 기기가 내려받는 규칙. 켜 둔 것만, 만든 차례로 -- 기기는 처음 맞은 규칙을 쓰므로
   * 차례가 곧 우선이다.
   */
  async listEnabledRules(): Promise<NotificationRule[]> {
    const rows = await this.prisma.notificationRule.findMany({
      where: { enabled: true },
      orderBy: [{ packageName: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRule);
  }

  async createRule(dto: NotificationRuleDto.SaveRequest): Promise<NotificationRule> {
    const row = await this.prisma.notificationRule.create({ data: ruleData(dto) });
    return toRule(row);
  }

  async updateRule(id: string, dto: Partial<NotificationRuleDto.SaveRequest>): Promise<NotificationRule> {
    const existing = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!existing) throw notFound('NOTIFICATION_RULE_NOT_FOUND', '규칙을 찾을 수 없습니다.');

    // 켜고 끄기만 오는 일이 많다. 온 칸만 바꾸되, 검사는 합친 모양으로 한다.
    const merged: NotificationRuleDto.SaveRequest = { ...toRule(existing), ...dto };
    const row = await this.prisma.notificationRule.update({ where: { id }, data: ruleData(merged) });
    return toRule(row);
  }

  async removeRule(id: string): Promise<void> {
    const { count } = await this.prisma.notificationRule.deleteMany({ where: { id } });
    if (count === 0) throw notFound('NOTIFICATION_RULE_NOT_FOUND', '규칙을 찾을 수 없습니다.');
  }
}

/** 기기가 보낸 표본 하나를 표의 줄로. 모양이 어긋나면 null. */
function sampleRow(item: NotificationSampleDto.CreateItem) {
  if (!item || typeof item !== 'object') return null;
  const packageName = shortText(item.packageName, MAX_SHORT);
  const sampleKey = shortText(item.sampleKey, MAX_SHORT);
  const text = typeof item.text === 'string' ? item.text.slice(0, MAX_TEXT) : '';
  const postedAt = new Date(Number(item.postedAt));
  if (!packageName || !sampleKey || !text.trim() || Number.isNaN(postedAt.getTime())) return null;

  const parsed = item.parsed && typeof item.parsed === 'object' ? item.parsed : null;
  if (parsed && JSON.stringify(parsed).length > MAX_PARSED_JSON) return null;

  return {
    packageName,
    sampleKey,
    title: typeof item.title === 'string' ? item.title.slice(0, MAX_TITLE) : null,
    text,
    postedAt,
    parsed: parsed ? (parsed as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    deviceName: shortText(item.deviceName, 100),
    appVersion: shortText(item.appVersion, 50),
  };
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** 저장할 규칙 값. 어긋나면 400. */
function ruleData(dto: NotificationRuleDto.SaveRequest) {
  const packageName = shortText(dto?.packageName, MAX_SHORT);
  if (!packageName) throw badRequest('NOTIFICATION_RULE_INVALID', '앱 이름(packageName)을 적어 주세요.');

  const name = shortText(dto.name, NOTIFICATION_RULE_LIMITS.nameLength);
  if (!name) throw badRequest('NOTIFICATION_RULE_INVALID', '규칙 이름을 적어 주세요.');

  const problem = notificationRuleProblem(dto.segments);
  if (problem) throw badRequest('NOTIFICATION_RULE_INVALID', problem);

  if (dto.kind !== null && dto.kind !== undefined && !KINDS.includes(dto.kind)) {
    throw badRequest('NOTIFICATION_RULE_INVALID', '갈래는 expense, income, transfer 중 하나입니다.');
  }
  const currency = dto.currency ? String(dto.currency).trim().toUpperCase() : null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw badRequest('NOTIFICATION_RULE_INVALID', '통화는 KRW 처럼 세 글자로 적어 주세요.');
  }

  // 토막은 필요한 칸만 남겨 담는다. 딸려 온 다른 값이 기기로 내려가지 않게.
  const segments: NotificationRuleSegment[] = dto.segments.map((segment) =>
    'field' in segment ? { field: segment.field } : { literal: segment.literal },
  );

  return {
    packageName,
    name,
    segments: segments as unknown as Prisma.InputJsonValue,
    kind: dto.kind ?? null,
    currency,
    enabled: dto.enabled ?? true,
    note: shortText(dto.note, NOTIFICATION_RULE_LIMITS.noteLength),
    learnedFrom: Math.max(0, Math.floor(Number(dto.learnedFrom) || 0)),
  };
}

function toRule(row: RuleRow): NotificationRule {
  return {
    id: row.id,
    packageName: row.packageName,
    name: row.name,
    segments: row.segments as unknown as NotificationRuleSegment[],
    kind: (row.kind as EntryKind | null) ?? null,
    currency: row.currency,
    enabled: row.enabled,
    note: row.note,
    learnedFrom: row.learnedFrom,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
