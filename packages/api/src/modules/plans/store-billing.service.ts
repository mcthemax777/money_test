/**
 * 스토어 구독에 직접 거는 일. 지금은 Google Play 결제일 미루기 하나다.
 *
 * RevenueCat REST API v1 `POST /subscribers/{app_user_id}/subscriptions/{subscription_id}/defer`
 * (문서: RevenueCat "Promotional Subscription Extensions"). 비밀 키가 있어야 한다.
 *   - app_user_id 는 프로젝트 id 다(앱이 결제 전에 logIn 한다).
 *   - subscription_id 는 `premium` 만 -- 웹훅의 `premium:month1` 처럼 기본 요금제를 붙이면
 *     "Subscription not found" 가 난다.
 *   - `expiry_time_ms` 로 새 결제일을 준다. Google 은 한 번에 1년까지 미룬다.
 * Google 은 결제일이 바뀐 것을 사용자에게 알리지 않는다.
 */
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PLAY_SUBSCRIPTION_ID } from '@money/types';

import { ConfigService } from '@/config/config.service';

const REVENUECAT_API = 'https://api.revenuecat.com/v1';

/** 이만큼 답이 없으면 실패로 본다. 권한 쓰기 잠금을 잡은 채 기다리므로 길게 두지 않는다. */
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class StoreBillingService {
  private readonly logger = new Logger(StoreBillingService.name);

  constructor(private readonly config: ConfigService) {}

  /** 프로젝트의 Play 구독 다음 결제일을 `expiresAt` 으로 미룬다. 실패하면 던진다. */
  async deferPlaySubscription(projectId: string, expiresAt: Date): Promise<void> {
    const secret = this.config.revenueCatSecretKey;
    if (!secret) {
      throw new ServiceUnavailableException(
        'RevenueCat 비밀 키(REVENUECAT_SECRET_KEY)가 없어 Play 결제일을 미룰 수 없습니다.',
      );
    }

    const url =
      `${REVENUECAT_API}/subscribers/${encodeURIComponent(projectId)}` +
      `/subscriptions/${encodeURIComponent(PLAY_SUBSCRIPTION_ID)}/defer`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiry_time_ms: expiresAt.getTime() }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Play 결제일 미루기 요청 실패 ${projectId}: ${String(error)}`);
      throw new BadGatewayException('RevenueCat 에 닿지 못해 Play 결제일을 미루지 못했습니다.');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Play 결제일 미루기 거절 ${projectId} ${response.status}: ${text}`);
      throw new BadGatewayException(
        `Play 결제일을 미루지 못했습니다 (${response.status}): ${messageOf(text)}`,
      );
    }
    this.logger.log(`Play 결제일 미룸 ${projectId} → ${expiresAt.toISOString()}`);
  }
}

/** RevenueCat 오류 본문의 message. JSON 이 아니면 앞부분만. */
function messageOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // JSON 이 아니다.
  }
  return text.slice(0, 200) || '응답 없음';
}
