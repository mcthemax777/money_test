/**
 * 푸시 알림.
 *
 * 기기가 로그인하면 FCM 토큰을 적어 두고(`register`), 보관함에 알림 후보가 담기면 그
 * 가계부 구성원의 기기 **전부**에 알린다(`notifyDrafts`). 후보를 만든 기기도 받는다 --
 * 알림을 잡은 그 폰이 "담겼다"는 것을 알아야 사람이 보관함을 연다.
 *
 * **푸시는 곁들이는 것이다.** 키가 없거나 FCM 이 실패해도 후보를 담는 요청은 성공한다.
 * 알림이 안 와도 보관함에는 후보가 있다.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
export class PushService {
  private readonly logger = new Logger(PushService.name);
  /** 키 파일이 없으면 null. 한 번 만들어 두면 접근 토큰을 알아서 갱신한다. */
  private readonly auth: GoogleAuth | null;

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
   * 보관함에 알림 후보가 담겼다고 구성원 기기 전부에 알린다.
   *
   * 기다리지 않고 부르게 되어 있다(부르는 쪽이 `void`). 실패는 기록만 하고 삼킨다.
   */
  async notifyDrafts(projectId: string, drafts: EntryDraftDto.Response[]): Promise<void> {
    if (!this.auth || drafts.length === 0) return;

    try {
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
          this.send(firebaseProjectId, accessToken, device.token, {
            ...messageFor(localeOf(device.user.locale), drafts),
            projectId,
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(`푸시를 보내지 못했습니다: ${String(error)}`);
    }
  }

  /**
   * 한 기기에 보낸다 (FCM HTTP v1).
   *
   * **앱을 지운 기기의 토큰은 지운다.** FCM 이 UNREGISTERED 로 답하면 그 토큰으로는 다시
   * 닿지 않는다. 남겨 두면 보낼 때마다 헛요청이 하나씩 는다.
   */
  private async send(
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
function messageFor(locale: Locale, drafts: EntryDraftDto.Response[]): { title: string; body: string } {
  const text = TEXT[locale];
  const [first] = drafts;
  const summary = [first.merchant || first.appTitle || '', formatAmount(locale, first)]
    .filter(Boolean)
    .join(' ');
  const rest = drafts.length - 1;

  return {
    title: rest > 0 ? text.many(drafts.length) : text.one,
    body: `${summary}${rest > 0 ? text.more(rest) : ''}`.trim(),
  };
}

/** 금액을 그 언어의 통화 표기로. 못 읽은 금액은 비운다. */
function formatAmount(locale: Locale, draft: EntryDraftDto.Response): string {
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
