/**
 * 스토어 구독에 직접 거는 일. RevenueCat REST API v1, 비밀 키가 있어야 한다.
 *
 *   - 결제일 미루기(관리자 지급): `POST /subscribers/{app_user_id}/subscriptions/{subscription_id}/defer`
 *     (문서: "Promotional Subscription Extensions"). subscription_id 는 `premium` 만 -- 웹훅의
 *     `premium:month1` 처럼 기본 요금제를 붙이면 "Subscription not found" 가 난다. `expiry_time_ms` 로
 *     새 결제일을 주고, Google 은 한 번에 1년까지 미룬다. 사용자에게 알리지 않는다.
 *   - 해지(계정 삭제): `POST /subscribers/{app_user_id}/subscriptions/{store_transaction_identifier}/cancel`
 *     (문서: API v1 Transactions "Google Play: Cancel a Subscription"). 만료일까지는 유효하고 다음
 *     갱신만 막는다 -- 이미 낸 기간은 돌려주지 않는다(2026-10-10 사용자 결정).
 *   - 고객 정보: `GET /subscribers/{app_user_id}`. 해지가 실패했을 때 아직 갱신될 구독이 남았는지 본다.
 * app_user_id 는 프로젝트 id 다(앱이 결제 전에 logIn 한다).
 */
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PLAY_SUBSCRIPTION_ID } from '@money/types';

import { ConfigService } from '@/config/config.service';

const REVENUECAT_API = 'https://api.revenuecat.com/v1';

/** 이만큼 답이 없으면 실패로 본다. 권한 쓰기 잠금을 잡은 채 기다리기도 하므로 길게 두지 않는다. */
const REQUEST_TIMEOUT_MS = 15_000;

/** 고객 정보의 구독 한 칸에서 읽는 것만. */
interface CustomerSubscription {
  store?: string;
  expires_date?: string | null;
  unsubscribe_detected_at?: string | null;
  refunded_at?: string | null;
}

@Injectable()
export class StoreBillingService {
  private readonly logger = new Logger(StoreBillingService.name);

  constructor(private readonly config: ConfigService) {}

  /** 프로젝트의 Play 구독 다음 결제일을 `expiresAt` 으로 미룬다. 실패하면 던진다. */
  async deferPlaySubscription(projectId: string, expiresAt: Date): Promise<void> {
    await this.call(
      'POST',
      `/subscribers/${encodeURIComponent(projectId)}/subscriptions/${encodeURIComponent(PLAY_SUBSCRIPTION_ID)}/defer`,
      { expiry_time_ms: expiresAt.getTime() },
      'Play 결제일을 미루지',
    );
    this.logger.log(`Play 결제일 미룸 ${projectId} → ${expiresAt.toISOString()}`);
  }

  /** Play 구독을 해지한다(다음 갱신을 막는다). 실패하면 던진다. */
  async cancelPlaySubscription(projectId: string, storeTransactionId: string): Promise<void> {
    await this.call(
      'POST',
      `/subscribers/${encodeURIComponent(projectId)}/subscriptions/${encodeURIComponent(storeTransactionId)}/cancel`,
      undefined,
      'Play 구독을 해지하지',
    );
    this.logger.log(`Play 구독 해지 ${projectId} (${storeTransactionId})`);
  }

  /**
   * 이 프로젝트에 아직 갱신될 Play 구독이 있는가. 해지했거나(unsubscribe_detected_at), 끝났거나,
   * 환불된 것은 갱신되지 않는다. 실패하면 던진다.
   */
  async hasRenewingPlaySubscription(projectId: string, now = new Date()): Promise<boolean> {
    const body = (await this.call(
      'GET',
      `/subscribers/${encodeURIComponent(projectId)}`,
      undefined,
      '구독 상태를 확인하지',
    )) as { subscriber?: { subscriptions?: Record<string, CustomerSubscription> } };
    return Object.values(body.subscriber?.subscriptions ?? {}).some(
      (subscription) =>
        subscription.store === 'play_store' &&
        !subscription.unsubscribe_detected_at &&
        !subscription.refunded_at &&
        !!subscription.expires_date &&
        Date.parse(subscription.expires_date) > now.getTime(),
    );
  }

  /** RevenueCat 을 부른다. 키가 없으면 503, 닿지 못하거나 거절되면 502. 성공하면 본문(JSON). */
  private async call(method: 'GET' | 'POST', path: string, body: unknown, failure: string): Promise<unknown> {
    const secret = this.config.revenueCatSecretKey;
    if (!secret) {
      throw new ServiceUnavailableException(`RevenueCat 비밀 키(REVENUECAT_SECRET_KEY)가 없어 ${failure} 못했습니다.`);
    }

    let response: Response;
    try {
      response = await fetch(`${REVENUECAT_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`RevenueCat ${method} ${path} 요청 실패: ${String(error)}`);
      throw new BadGatewayException(`RevenueCat 에 닿지 못해 ${failure} 못했습니다.`);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      this.logger.error(`RevenueCat ${method} ${path} 거절 ${response.status}: ${text}`);
      throw new BadGatewayException(`${failure} 못했습니다 (${response.status}): ${messageOf(text)}`);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
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
