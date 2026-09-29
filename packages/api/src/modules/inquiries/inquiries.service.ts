/**
 * 문의하기. 사용자가 보내고 관리자가 답한다.
 *
 * 관리자가 답하면 그 사용자의 기기 전부에 푸시를 보낸다(`PushService.notifyUser`). 푸시가
 * 실패해도 답은 담긴다 -- 사용자는 설정의 "문의하기" 배지로도 안다.
 *
 * 읽지 않은 답 = 문의의 `userReadAt` 보다 늦게 온 관리자의 글. 사용자가 문의를 열면
 * (`getMine`) 지금으로 당긴다.
 *
 * 문의 목록이나 대화를 띄워 둔 화면은 `INQUIRY_POLL_MS` 마다 `listMine`·`getMine` 을 부르고,
 * 그때마다 `userWatchedAt` 이 당겨진다. 그 값이 막 당겨졌으면 사용자가 지금 문의하기를 보고
 * 있는 것이라 답장 푸시를 보내지 않는다 -- 답은 다음 조회에 화면에 곧바로 선다. 떠날 때는
 * 화면이 `unwatch` 를 불러 표시를 지우므로 그 뒤의 답은 곧바로 푸시된다.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  INQUIRY_BODY_MAX,
  INQUIRY_WATCH_MS,
  type InquiryAuthor,
  type InquiryDto,
  type InquiryStatus,
} from '@money/types';

import { badRequest, notFound } from '@/common/app-error';
import { PrismaService } from '@/config/prisma.service';
import { INQUIRY_CHANNEL_ID, PushService, type PushLocale } from '../push/push.service';

/** 목록에 보이는 첫 글의 길이. */
const PREVIEW_LENGTH = 80;

/** 푸시 문구. 본문은 답장의 앞부분이다. */
const REPLY_TITLE: Record<PushLocale, string> = {
  ko: '문의에 답장이 왔습니다',
  en: 'You have a reply to your inquiry',
  ja: 'お問い合わせに返信が届きました',
};

type InquiryRow = Prisma.InquiryGetPayload<{ include: { messages: true } }>;

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // 사용자 ------------------------------------------------------------------

  /** 내 문의 목록. 목록을 보고 있다는 표시로 모든 문의의 `userWatchedAt` 을 당긴다. */
  async listMine(userId: string): Promise<InquiryDto.Summary[]> {
    await this.prisma.inquiry.updateMany({ where: { userId }, data: { userWatchedAt: new Date() } });
    const rows = await this.prisma.inquiry.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const unread = await this.unreadByInquiry(userId);
    return rows.map((row) => ({ ...summaryOf(row), unreadCount: unread.get(row.id) ?? 0 }));
  }

  /** 설정의 배지. 읽지 않은 관리자의 답 수. */
  async unreadCount(userId: string): Promise<InquiryDto.UnreadResponse> {
    const unread = await this.unreadByInquiry(userId);
    let count = 0;
    for (const value of unread.values()) count += value;
    return { count };
  }

  /** 문의하기를 떠났다. 보고 있다는 표시를 지워, 다음 답부터 곧바로 푸시가 가게 한다. */
  async unwatch(userId: string): Promise<void> {
    await this.prisma.inquiry.updateMany({ where: { userId }, data: { userWatchedAt: null } });
  }

  /** 문의 하나. 여는 것이 곧 읽는 것이라 `userReadAt` 을, 보고 있으니 `userWatchedAt` 을 당긴다. */
  async getMine(userId: string, id: string): Promise<InquiryDto.Detail> {
    const row = await this.prisma.inquiry.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw notFound('INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
    const now = new Date();
    await this.prisma.inquiry.update({ where: { id }, data: { userReadAt: now, userWatchedAt: now } });
    return { ...summaryOf(row), unreadCount: 0, messages: row.messages.map(messageOf) };
  }

  async create(
    userId: string,
    dto: InquiryDto.CreateRequest,
    client: { platform: string | null; appVersion: string | null },
  ): Promise<InquiryDto.Detail> {
    const body = checkBody(dto?.body);
    const row = await this.prisma.inquiry.create({
      data: {
        userId,
        platform: client.platform?.slice(0, 20) ?? null,
        appVersion: client.appVersion?.slice(0, 50) ?? null,
        messages: { create: { author: 'user', body } },
      },
      include: { messages: true },
    });
    return { ...summaryOf(row), unreadCount: 0, messages: row.messages.map(messageOf) };
  }

  /** 같은 문의에 덧붙여 묻는다. */
  async addMine(userId: string, id: string, dto: InquiryDto.MessageRequest): Promise<InquiryDto.Detail> {
    const body = checkBody(dto?.body);
    const exists = await this.prisma.inquiry.count({ where: { id, userId } });
    if (!exists) throw notFound('INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
    await this.append(id, 'user', body);
    return this.getMine(userId, id);
  }

  // 관리자 -----------------------------------------------------------------

  /** 답을 기다리는 것이 위, 그 안에서는 오래 기다린 것이 위다. 답한 것은 최근 것이 위. */
  async adminList(query: InquiryDto.AdminListQuery): Promise<InquiryDto.AdminSummary[]> {
    const rows = await this.prisma.inquiry.findMany({
      where: query.status === 'waiting' ? { lastAuthor: 'user' } : query.status === 'answered' ? { lastAuthor: 'admin' } : {},
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
        user: { select: { name: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 500,
    });
    const summaries = rows.map((row) => ({
      ...summaryOf(row),
      userName: row.user.name,
      userEmail: row.user.email,
      platform: row.platform,
      appVersion: row.appVersion,
      messageCount: row._count.messages,
    }));
    const waiting = summaries.filter((row) => row.status === 'waiting').reverse();
    return [...waiting, ...summaries.filter((row) => row.status === 'answered')];
  }

  async adminGet(id: string): Promise<InquiryDto.AdminDetail> {
    const row = await this.prisma.inquiry.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { name: true, email: true } },
      },
    });
    if (!row) throw notFound('INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
    return {
      ...summaryOf(row),
      userName: row.user.name,
      userEmail: row.user.email,
      platform: row.platform,
      appVersion: row.appVersion,
      messageCount: row.messages.length,
      messages: row.messages.map(messageOf),
    };
  }

  /**
   * 관리자의 답. 담은 뒤 그 사용자의 기기로 푸시를 보낸다(기다리지 않는다).
   *
   * 사용자가 그 대화를 지금 보고 있으면 보내지 않는다(`isWatching`).
   */
  async reply(id: string, dto: InquiryDto.MessageRequest): Promise<InquiryDto.AdminDetail> {
    const body = checkBody(dto?.body);
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      select: { userId: true, userWatchedAt: true },
    });
    if (!inquiry) throw notFound('INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');

    await this.append(id, 'admin', body);
    if (isWatching(inquiry, new Date())) return this.adminGet(id);
    void this.push.notifyUser(
      inquiry.userId,
      (locale) => ({ title: REPLY_TITLE[locale], body: body.replace(/\s+/g, ' ').slice(0, 100) }),
      { type: 'inquiry-reply', inquiryId: id },
      INQUIRY_CHANNEL_ID,
    );
    return this.adminGet(id);
  }

  // 공통 -------------------------------------------------------------------

  /** 글을 담고 문의의 마지막 글 칸을 함께 고친다. */
  private async append(inquiryId: string, author: InquiryAuthor, body: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.inquiryMessage.create({ data: { inquiryId, author, body } });
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: {
          lastAuthor: author,
          lastMessageAt: message.createdAt,
          // 사용자가 쓴 글은 사용자가 이미 본 것이다.
          ...(author === 'user' ? { userReadAt: message.createdAt } : {}),
        },
      });
    });
  }

  /** 문의마다 읽지 않은 관리자의 답 수. 두 표의 시각을 견줘야 해서 SQL 로 센다. */
  private async unreadByInquiry(userId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ inquiryId: string; count: number }>>(Prisma.sql`
      SELECT m."inquiryId", count(*)::int AS "count"
        FROM "InquiryMessage" m
        JOIN "Inquiry" i ON i."id" = m."inquiryId"
       WHERE i."userId" = ${userId}
         AND m."author" = 'admin'
         AND m."createdAt" > i."userReadAt"
       GROUP BY m."inquiryId"
    `);
    return new Map(rows.map((row) => [row.inquiryId, row.count]));
  }
}

/**
 * 사용자가 문의 목록이나 그 대화를 지금 보고 있는가. 마지막 조회가 `INQUIRY_WATCH_MS` 안이면 그렇다.
 *
 * 글을 보내는 것은 표시를 당기지 않는다. 그것은 "보냈다"이지 "보고 있다"가 아니다. 화면에
 * 남아 있으면 다음 조회가 당긴다.
 */
function isWatching(inquiry: { userWatchedAt: Date | null }, now: Date): boolean {
  if (!inquiry.userWatchedAt) return false;
  return now.getTime() - inquiry.userWatchedAt.getTime() <= INQUIRY_WATCH_MS;
}

function checkBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) throw badRequest('INQUIRY_BODY_REQUIRED', '문의 내용을 적어 주세요.');
  if (body.length > INQUIRY_BODY_MAX) {
    throw badRequest('INQUIRY_BODY_TOO_LONG', `문의는 ${INQUIRY_BODY_MAX}자까지 적을 수 있습니다.`);
  }
  return body;
}

function summaryOf(row: Pick<InquiryRow, 'id' | 'lastAuthor' | 'lastMessageAt' | 'createdAt' | 'messages'>) {
  const first = row.messages[0]?.body ?? '';
  const status: InquiryStatus = row.lastAuthor === 'admin' ? 'answered' : 'waiting';
  return {
    id: row.id,
    preview: first.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH),
    status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function messageOf(row: InquiryRow['messages'][number]): InquiryDto.Message {
  return {
    id: row.id,
    author: row.author === 'admin' ? 'admin' : 'user',
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
