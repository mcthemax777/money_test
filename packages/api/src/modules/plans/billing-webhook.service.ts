/**
 * RevenueCat 웹훅을 이용권 권한 줄로 옮긴다.
 *
 * 앱은 결제하기 전에 RevenueCat 의 사용자 id(app_user_id)를 **프로젝트 id** 로 바꾼다. 이용권이
 * 사람이 아니라 프로젝트에 붙기 때문이다. 그래서 웹훅의 app_user_id 가 곧 이용권을 줄 프로젝트다.
 *
 * 자동 갱신 구독이다. 갱신마다 새 줄을 적고(기간은 스토어가 정한 그대로), 구독을 끄는 것
 * (CANCELLATION, 환불이 아닌 것)은 아무것도 하지 않는다 -- 낸 기간이 끝날 때까지 쓴다.
 * 환불만 그 줄을 거둔다.
 *
 * 문서(RevenueCat Event Types and Fields)에 따른 것:
 *   - 새 구독 INITIAL_PURCHASE, 갱신 RENEWAL, 한 번 사는 상품 NON_RENEWING_PURCHASE
 *   - 환불은 CANCELLATION + cancel_reason=CUSTOMER_SUPPORT, 되돌림은 REFUND_REVERSED
 *   - 기간이 밀림 SUBSCRIPTION_EXTENDED, 끝남 EXPIRATION
 *   - Play 구독의 product_id 는 `구독id:기본요금제id`
 * 문서가 말하지 않아 시험 결제로 확인해야 하는 것: 갱신마다 transaction_id 가 바뀌는가.
 * 그래서 결제 번호 열쇠를 `transaction_id@purchased_at_ms` 로 둔다 -- 같은 알림을 다시 받으면
 * 같은 열쇠, 갱신은 산 시각이 달라 새 열쇠다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { isPlanId, planIdOfStoreProduct } from '@money/types';

import { ConfigService } from '@/config/config.service';
import { PrismaService } from '@/config/prisma.service';
import { PlansService } from './plans.service';

/** 웹훅 본문에서 쓰는 칸만. 나머지는 읽지 않는다. */
export interface RevenueCatEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  product_id?: string;
  transaction_id?: string | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  environment?: 'SANDBOX' | 'PRODUCTION' | string;
  store?: string;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  cancel_reason?: string | null;
  subscriber_attributes?: Record<string, { value?: string } | undefined>;
}

/** 처리 결과. 로그와 스모크가 본다. 어느 경우든 응답은 200 이다(아래 controller). */
export type WebhookOutcome =
  | 'granted'
  | 'revoked'
  | 'restored'
  | 'extended'
  | 'shortened'
  | `ignored:${string}`;

const SOURCE = 'google_play' as const;

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly config: ConfigService,
  ) {}

  async handle(event: RevenueCatEvent | undefined, now = new Date()): Promise<WebhookOutcome> {
    const outcome = await this.process(event, now);
    this.logger.log(`RevenueCat ${event?.type ?? '?'} ${event?.id ?? ''} → ${outcome}`);
    return outcome;
  }

  private async process(event: RevenueCatEvent | undefined, now: Date): Promise<WebhookOutcome> {
    if (!event?.type) return 'ignored:no-event';
    if (event.type === 'TEST') return 'ignored:test';
    if (event.environment === 'SANDBOX' && !this.config.revenueCatAcceptSandbox) {
      return 'ignored:sandbox';
    }
    if (event.store !== 'PLAY_STORE') return `ignored:store-${event.store ?? 'none'}`;

    const projectId = event.app_user_id ?? '';
    const project = projectId
      ? await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
      : null;
    // 익명 id($RCAnonymousID:...)나 지운 프로젝트. 줄 자리가 없다.
    if (!project) return 'ignored:unknown-project';

    const transactionId = event.transaction_id ?? '';
    if (!transactionId) return 'ignored:no-transaction';

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'NON_RENEWING_PURCHASE':
        return this.grant(event, projectId, transactionId);
      case 'CANCELLATION':
        // 구독을 끈 것(UNSUBSCRIBE 등)은 낸 기간이 끝날 때까지 쓴다. 환불만 거둔다.
        return event.cancel_reason === 'CUSTOMER_SUPPORT'
          ? this.revokeRefund(event, transactionId)
          : 'ignored:cancel-keeps-period';
      case 'REFUND_REVERSED':
        return this.restore(event, transactionId);
      case 'SUBSCRIPTION_EXTENDED':
      case 'EXPIRATION':
        return this.moveEnd(event, transactionId, now);
      default:
        // UNCANCELLATION, BILLING_ISSUE, PRODUCT_CHANGE 따위. 기간을 주는 일은 뒤따르는
        // RENEWAL/INITIAL_PURCHASE 가 한다.
        return `ignored:${event.type}`;
    }
  }

  private async grant(event: RevenueCatEvent, projectId: string, transactionId: string): Promise<WebhookOutcome> {
    const plan = event.product_id ? planIdOfStoreProduct(event.product_id) : null;
    if (!plan || !isPlanId(plan)) return `ignored:unknown-product-${event.product_id ?? ''}`;
    if (!event.purchased_at_ms) return 'ignored:no-purchase-time';

    const isLifetime = plan === 'lifetime';
    if (!isLifetime && !event.expiration_at_ms) return 'ignored:no-expiration';

    const userId = await this.existingUserId(event.subscriber_attributes?.userId?.value);
    const price = event.price_in_purchased_currency;

    await this.plans.grant({
      projectId,
      plan,
      source: SOURCE,
      userId,
      externalId: externalIdOf(transactionId, event.purchased_at_ms),
      // 환불 알림이 아닌데 음수가 오면(문서상 환불의 표기) 0 으로 둔다. 기록은 원 단위 정수다.
      amount: typeof price === 'number' && price > 0 ? Math.round(price) : 0,
      note: event.environment === 'SANDBOX' ? '시험 결제(SANDBOX)' : null,
      window: {
        startsAt: new Date(event.purchased_at_ms),
        endsAt: isLifetime ? null : new Date(event.expiration_at_ms!),
      },
    });
    return 'granted';
  }

  /** 환불된 결제의 줄을 거둔다. 산 시각이 맞는 줄이 있으면 그것만, 없으면 그 거래의 살아 있는 줄 모두. */
  private async revokeRefund(event: RevenueCatEvent, transactionId: string): Promise<WebhookOutcome> {
    const targets = (await this.matching(event, transactionId)).filter((grant) => !grant.revokedAt);
    if (targets.length === 0) return 'ignored:refund-no-grant';
    for (const grant of targets) {
      await this.plans.revoke(grant.id, '스토어 환불');
    }
    return 'revoked';
  }

  private async restore(event: RevenueCatEvent, transactionId: string): Promise<WebhookOutcome> {
    const targets = (await this.matching(event, transactionId)).filter((grant) => grant.revokedAt);
    if (targets.length === 0) return 'ignored:restore-no-grant';
    for (const grant of targets) await this.plans.unrevoke(grant.id);
    return 'restored';
  }

  /**
   * 끝을 스토어가 알린 시각으로 맞춘다. EXPIRATION 은 앞당길 때만(이미 끝난 줄은 그대로),
   * SUBSCRIPTION_EXTENDED 는 미룰 때만 고친다.
   */
  private async moveEnd(event: RevenueCatEvent, transactionId: string, now: Date): Promise<WebhookOutcome> {
    if (!event.expiration_at_ms) return 'ignored:no-expiration';
    const target = new Date(event.expiration_at_ms);
    const grants = (await this.matching(event, transactionId)).filter(
      (grant) => !grant.revokedAt && grant.endsAt !== null,
    );
    const latest = grants[grants.length - 1];
    if (!latest || !latest.endsAt) return 'ignored:no-grant';

    if (event.type === 'EXPIRATION') {
      // 이미 끝났거나 알린 끝이 더 늦으면 고칠 것이 없다. 일찍 끝난 경우(스토어 회수)만 당긴다.
      if (latest.endsAt <= now || target >= latest.endsAt) return 'ignored:expired-on-time';
      await this.plans.setEndsAt(latest.id, target);
      return 'shortened';
    }
    if (target <= latest.endsAt) return 'ignored:not-later';
    await this.plans.setEndsAt(latest.id, target);
    return 'extended';
  }

  /** 이 알림에 해당하는 줄들. 산 시각까지 맞는 줄이 있으면 그것만, 없으면 같은 거래의 줄 모두. */
  private async matching(event: RevenueCatEvent, transactionId: string) {
    const grants = await this.plans.findStoreGrants(SOURCE, `${transactionId}@`);
    if (event.purchased_at_ms) {
      const exact = grants.filter(
        (grant) => grant.externalId === externalIdOf(transactionId, event.purchased_at_ms!),
      );
      if (exact.length > 0) return exact;
    }
    return grants;
  }

  /** 앱이 남긴 사용자 id. 지워진 사용자면 null -- 없는 id 를 적으면 외래 키에 걸린다. */
  private async existingUserId(userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user?.id ?? null;
  }
}

export function externalIdOf(transactionId: string, purchasedAtMs: number): string {
  return `${transactionId}@${purchasedAtMs}`;
}
