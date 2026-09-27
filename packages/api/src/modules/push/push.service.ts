/**
 * 푸시 알림.
 *
 * 기기가 로그인하면 FCM 토큰을 적어 두고(`register`), 보관함에 알림 후보나 서버가 만든
 * 반복 회차가 담기면 그 가계부 구성원의 기기 **전부**에 알린다. 후보를 만든 기기도
 * 받는다 -- 알림을 잡은 그 폰이 "담겼다"는 것을 알아야 사람이 보관함을 연다. 캡처와
 * 사람이 "만들기"를 누른 회차는 알리지 않는다(누른 사람이 이미 화면을 보고 있다).
 *
 * **담기자마자 보내지 않는다.** 한 결제에 알림이 1분 안에 여럿 오고(카드사·은행), 기기는
 * 뒤에 온 것이 더 자세하면 새 후보를 담고 옛 것을 지운다. 곧바로 보내면 그때마다 폰이
 * 한 번 더 울린다. 그 가계부가 조용해지면 그때 **아직 대기 중인 후보만** 한 번에 알린다.
 *
 * **모으는 자리는 DB 다** (`EntryDraft.notifiedAt`). 서버마다 몇 초에 한 번 조용해진
 * 가계부의 알리지 않은 후보를 한 문장으로 차지하고, 차지한 서버만 보낸다. 서버가 여럿이어도
 * 한 번만 나가고, 서버가 다시 떠도 보낼 것이 사라지지 않는다.
 *
 * **푸시는 곁들이는 것이다.** 키가 없거나 FCM 이 실패해도 후보를 담는 요청은 성공한다.
 * 알림이 안 와도 보관함에는 후보가 있다.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import type { EntryDraftDto, PushDeviceDto } from '@money/types';

import { ConfigService } from '@/config/config.service';
import { PrismaService } from '@/config/prisma.service';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** 앱이 만드는 알림 채널. 앱의 `app.json` 의 expo-notifications `defaultChannel` 과 같아야 한다. */
const DRAFT_CHANNEL_ID = 'drafts';

/** FCM 토큰의 상한. 실제로는 200자 남짓이다. 이보다 길면 토큰이 아니다. */
const MAX_TOKEN_LENGTH = 4096;

const PLATFORMS: PushDeviceDto.Platform[] = ['android', 'ios'];

/**
 * 가계부에 마지막 알림 후보가 담긴 뒤 이만큼 조용하면 보낸다.
 *
 * 기기가 같은 결제로 보는 창(`NOTIFICATION_DUPLICATE_WINDOW_MS`, 1분)에 기기가 모으는
 * 5초와 올리는 시간을 더했다. 그 안에 온 중복은 이미 갈아 끼워져 있다.
 */
const DRAFT_NOTICE_QUIET_SECONDS = 70;

/** 후보가 줄줄이 와서 조용해지지 않아도 첫 후보로부터 이만큼 지나면 보낸다. */
const DRAFT_NOTICE_MAX_WAIT_SECONDS = 3 * 60;

/**
 * 이보다 오래된 후보는 알리지 않는다. 서버가 오래 멈췄다 떠서 지난 결제가 한꺼번에
 * "방금 담겼다"고 울리지 않게 한다. 그 후보는 보관함에만 있다.
 */
const DRAFT_NOTICE_STALE_SECONDS = 60 * 60;

/** 조용해진 가계부를 찾는 간격. 푸시는 조용해진 뒤 이만큼까지 늦을 수 있다. */
const DRAFT_NOTICE_POLL_MS = 10 * 1000;

/** 알림 문구에 쓰는 후보의 값. */
type NoticeDraft = Pick<
  EntryDraftDto.Response,
  'merchant' | 'appTitle' | 'description' | 'amount' | 'currency'
>;

/** 차지한 후보 한 줄. */
interface ClaimedDraft extends NoticeDraft {
  projectId: string;
}

/** 알림 문구. 받는 사람의 화면 언어로 보낸다 (`User.locale`). */
const TEXT = {
  ko: {
    one: '보관함에 거래 후보가 담겼습니다',
    many: (count: number) => `거래 후보 ${count}건이 담겼습니다`,
    more: (count: number) => ` 외 ${count}건`,
  },
  en: {
    one: 'New transaction in your inbox',
    many: (count: number) => `${count} new transactions in your inbox`,
    more: (count: number) => ` and ${count} more`,
  },
  ja: {
    one: '受信箱に取引候補が届きました',
    many: (count: number) => `取引候補が${count}件届きました`,
    more: (count: number) => ` ほか${count}件`,
  },
} as const;

type Locale = keyof typeof TEXT;

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  /** 키 파일이 없으면 null. 한 번 만들어 두면 접근 토큰을 알아서 갱신한다. */
  private readonly auth: GoogleAuth | null;
  private poller: NodeJS.Timeout | null = null;
  /** 한 서버 안에서 차례가 겹치지 않게 한다. 느린 FCM 뒤에 다음 차례가 쌓이지 않는다. */
  private flushing = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const keyFile = config.fcmServiceAccountFile;
    this.auth = keyFile ? new GoogleAuth({ keyFile, scopes: [FCM_SCOPE] }) : null;
    if (!this.auth) {
      this.logger.warn('FCM_SERVICE_ACCOUNT_FILE 이 없어 푸시를 보내지 않습니다.');
    }
  }

  onModuleInit(): void {
    // 키가 없으면 보낼 수 없으므로 후보를 차지하지도 않는다.
    if (!this.auth) return;
    this.poller = setInterval(() => void this.flushDraftNotices(), DRAFT_NOTICE_POLL_MS);
    // 기다리는 푸시 때문에 프로세스가 끝나지 못하면 안 된다.
    this.poller.unref();
  }

  onModuleDestroy(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /**
   * 이 기기의 토큰을 적는다. 이미 있으면 주인을 바꾼다.
   *
   * 한 기기에서 계정을 바꾸면 같은 토큰이 새 사용자로 온다. 옛 행을 남기면 앞 사람의
   * 가계부 알림이 이 기기의 잠금 화면에 계속 뜬다.
   */
  async register(userId: string, dto: PushDeviceDto.RegisterRequest): Promise<void> {
    const token = String(dto?.token ?? '').trim();
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      throw new BadRequestException('푸시 토큰이 올바르지 않습니다.');
    }
    if (!PLATFORMS.includes(dto.platform)) {
      throw new BadRequestException('기기 종류가 올바르지 않습니다.');
    }

    await this.prisma.pushDevice.upsert({
      where: { token },
      create: { userId, token, platform: dto.platform },
      update: { userId, platform: dto.platform },
    });
  }

  /**
   * 이 기기의 토큰을 지운다. 로그아웃할 때 부른다.
   *
   * 자기 것만 지운다 -- 남의 토큰을 알아도 그 사람의 알림을 끊을 수는 없어야 한다.
   * 없어도 성공이다(두 번 눌린 로그아웃).
   */
  async unregister(userId: string, dto: PushDeviceDto.UnregisterRequest): Promise<void> {
    const token = String(dto?.token ?? '').trim();
    if (!token) return;
    await this.prisma.pushDevice.deleteMany({ where: { token, userId } });
  }

  /**
   * 조용해진 가계부의 알리지 않은 후보를 차지해 가계부마다 한 번씩 알린다.
   *
   * 차지와 고르기가 한 문장이다. 서버 둘이 같은 순간에 돌면 Postgres 가 같은 행을 두 번
   * 고치지 못하게 뒤 문장을 기다리게 하고, 기다린 문장은 `notifiedAt` 이 채워진 것을 보고
   * 그 행을 건너뛴다. 그래서 후보 하나는 한 서버만 가져간다.
   *
   * 대기 중인 것만 가져간다 -- 더 자세한 알림으로 갈아 끼워져 지워진 후보, 사람이 벌써
   * 등록·무시한 후보는 빠진다. 실패는 기록만 하고 삼킨다(차지한 뒤 FCM 이 실패하면 그
   * 푸시는 다시 보내지 않는다. 후보는 보관함에 있다).
   */
  private async flushDraftNotices(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const claimed = await this.prisma.$queryRaw<
        Array<ClaimedDraft & { occurredAt: Date | null; createdAt: Date }>
      >(Prisma.sql`
        UPDATE "EntryDraft"
        SET "notifiedAt" = now()
        WHERE "source" IN ('notification', 'recurring')
          AND "status" = 'pending'
          AND "notifiedAt" IS NULL
          AND "createdAt" >= now() - make_interval(secs => ${DRAFT_NOTICE_STALE_SECONDS})
          AND "projectId" IN (
            SELECT "projectId" FROM "EntryDraft"
            WHERE "source" IN ('notification', 'recurring')
              AND "status" = 'pending'
              AND "notifiedAt" IS NULL
              AND "createdAt" >= now() - make_interval(secs => ${DRAFT_NOTICE_STALE_SECONDS})
            GROUP BY "projectId"
            HAVING max("createdAt") <= now() - make_interval(secs => ${DRAFT_NOTICE_QUIET_SECONDS})
                OR min("createdAt") <= now() - make_interval(secs => ${DRAFT_NOTICE_MAX_WAIT_SECONDS})
          )
        RETURNING "projectId", "merchant", "appTitle", "description",
                  "amount"::text AS "amount", "currency", "occurredAt", "createdAt"
      `);
      if (claimed.length === 0) return;

      // 본문은 첫 후보로 쓴다. 방금 결제한 것이 위다 (보관함 목록과 같은 차례).
      claimed.sort(
        (a, b) =>
          (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
      const byProject = new Map<string, NoticeDraft[]>();
      for (const { projectId, merchant, appTitle, description, amount, currency } of claimed) {
        const drafts = byProject.get(projectId) ?? [];
        drafts.push({ merchant, appTitle, description, amount, currency });
        byProject.set(projectId, drafts);
      }

      await Promise.all(
        [...byProject].map(([projectId, drafts]) =>
          this.send(projectId, drafts).catch((error) =>
            this.logger.warn(`푸시를 보내지 못했습니다: ${String(error)}`),
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(`보낼 푸시를 고르지 못했습니다: ${String(error)}`);
    } finally {
      this.flushing = false;
    }
  }

  /** 구성원 기기 전부에 보낸다. */
  private async send(projectId: string, drafts: NoticeDraft[]): Promise<void> {
    if (!this.auth || drafts.length === 0) return;

    const devices = await this.prisma.pushDevice.findMany({
      where: { user: { projectMembers: { some: { projectId } } } },
      select: { token: true, user: { select: { locale: true } } },
    });
    if (devices.length === 0) return;

    const [accessToken, firebaseProjectId] = await Promise.all([
      this.auth.getAccessToken(),
      this.auth.getProjectId(),
    ]);
    if (!accessToken) {
      this.logger.warn('FCM 접근 토큰을 받지 못해 푸시를 건너뜁니다.');
      return;
    }

    await Promise.all(
      devices.map((device) =>
        this.sendToDevice(firebaseProjectId, accessToken, device.token, {
          ...messageFor(localeOf(device.user.locale), drafts),
          projectId,
        }),
      ),
    );
  }

  /**
   * 한 기기에 보낸다 (FCM HTTP v1).
   *
   * **앱을 지운 기기의 토큰은 지운다.** FCM 이 UNREGISTERED 로 답하면 그 토큰으로는 다시
   * 닿지 않는다. 남겨 두면 보낼 때마다 헛요청이 하나씩 는다.
   */
  private async sendToDevice(
    firebaseProjectId: string,
    accessToken: string,
    token: string,
    message: { title: string; body: string; projectId: string },
  ): Promise<void> {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            // 앱이 눌렸을 때 어디로 갈지 가리는 값. FCM 의 data 는 문자열만 받는다.
            data: { type: 'entry-draft', projectId: message.projectId },
            android: { priority: 'high', notification: { channel_id: DRAFT_CHANNEL_ID } },
          },
        }),
      },
    );
    if (response.ok) return;

    const detail = await response.text().catch(() => '');
    if (response.status === 404 || detail.includes('UNREGISTERED')) {
      await this.prisma.pushDevice.deleteMany({ where: { token } });
      return;
    }
    this.logger.warn(`FCM 이 거절했습니다 (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/** 모르는 언어는 한국어로. 서버의 기본 언어와 같다 (`User.locale` 의 기본값). */
function localeOf(value: string | null | undefined): Locale {
  return value && value in TEXT ? (value as Locale) : 'ko';
}

/**
 * 알림의 제목과 본문.
 *
 * 본문은 첫 후보의 가맹점과 금액이다 -- 잠금 화면에서 그것만 보고도 무슨 결제인지 안다.
 * 여러 건이면 "외 n건"을 붙인다.
 */
function messageFor(locale: Locale, drafts: NoticeDraft[]): { title: string; body: string } {
  const text = TEXT[locale];
  const [first] = drafts;
  // 반복 후보는 가맹점이 비는 일이 많다. 그때는 사람이 붙인 이름("월세")을 쓴다.
  const label = first.merchant || first.appTitle || first.description || '';
  const summary = [label, formatAmount(locale, first)]
    .filter(Boolean)
    .join(' ');
  const rest = drafts.length - 1;

  return {
    title: rest > 0 ? text.many(drafts.length) : text.one,
    body: `${summary}${rest > 0 ? text.more(rest) : ''}`.trim(),
  };
}

/** 금액을 그 언어의 통화 표기로. 못 읽은 금액은 비운다. */
function formatAmount(locale: Locale, draft: NoticeDraft): string {
  if (!draft.amount) return '';
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: draft.currency || 'KRW',
    }).format(amount);
  } catch {
    // 모르는 통화 코드. 숫자만 적는다.
    return amount.toLocaleString(locale);
  }
}
