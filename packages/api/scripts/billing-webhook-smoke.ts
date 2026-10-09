/**
 * RevenueCat 웹훅 → 이용권 권한 줄 (2026-10-09).
 *
 * 구독 시작·갱신은 줄을 더하고, 같은 알림을 다시 받아도 한 줄이며, 구독을 끈 것은 기간을 남기고
 * 환불만 거둔다. 시험 결제는 설정이 켜져 있을 때만 받는다.
 *
 * 서비스를 바로 부르므로 서버를 띄우지 않아도 돈다.
 */
import { PLAN_STORE_PRODUCT_IDS } from '@money/types';

import { BillingWebhookService, type RevenueCatEvent } from '../src/modules/plans/billing-webhook.service';
import { PlansService } from '../src/modules/plans/plans.service';
import { runSmoke } from './smoke-harness';

runSmoke('billing-webhook', async (ctx) => {
  let acceptSandbox = false;
  const config = { get revenueCatAcceptSandbox() { return acceptSandbox; } };
  const plans = new PlansService(ctx.prisma as any);
  const webhook = new BillingWebhookService(ctx.prisma as any, plans, config as any);

  const project = await ctx.createProject();
  const user = await ctx.createUser();
  const day = 24 * 60 * 60 * 1000;
  const t0 = Date.UTC(2026, 9, 9, 3, 0, 0);
  const base = (over: Partial<RevenueCatEvent>): RevenueCatEvent => ({
    id: `evt-${Math.random()}`,
    app_user_id: project.id,
    store: 'PLAY_STORE',
    environment: 'PRODUCTION',
    product_id: PLAN_STORE_PRODUCT_IDS.month1,
    transaction_id: 'GPA.1111',
    purchased_at_ms: t0,
    expiration_at_ms: t0 + 30 * day,
    price_in_purchased_currency: 2900,
    currency: 'KRW',
    subscriber_attributes: { userId: { value: user.id } },
    ...over,
  });
  const at = (ms: number) => new Date(ms);
  const status = (ms: number) => plans.statusOf(project.id, at(ms));
  const grants = () => plans.listGrants(project.id);

  ctx.check('TEST 는 넘긴다', await webhook.handle({ type: 'TEST' }), 'ignored:test');

  // 구독 시작
  ctx.check('INITIAL_PURCHASE', await webhook.handle(base({ type: 'INITIAL_PURCHASE' })), 'granted');
  ctx.check('같은 알림을 다시 받아도', await webhook.handle(base({ type: 'INITIAL_PURCHASE' })), 'granted');
  ctx.check('줄은 하나', (await grants()).length, 1);
  const first = (await grants())[0];
  ctx.check('결제한 사람', first.userId, user.id);
  ctx.check('금액', first.amount, 2900);
  ctx.check('출처', first.source, 'google_play');
  ctx.check('구독 중', (await status(t0 + day)).kind, 'period');

  // 갱신: 거래번호가 같아도(문서가 말하지 않는다) 산 시각이 다르면 새 줄
  const renewal = base({ type: 'RENEWAL', purchased_at_ms: t0 + 30 * day, expiration_at_ms: t0 + 60 * day });
  ctx.check('RENEWAL', await webhook.handle(renewal), 'granted');
  ctx.check('갱신은 새 줄', (await grants()).length, 2);
  ctx.check('갱신 뒤 끝', (await status(t0 + 31 * day)).endsAt, at(t0 + 60 * day).toISOString());

  // 구독을 끈 것은 기간을 남긴다
  ctx.check(
    '구독 끄기',
    await webhook.handle(base({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', purchased_at_ms: t0 + 30 * day })),
    'ignored:cancel-keeps-period',
  );
  ctx.check('끈 뒤에도 기간 안은 구독 중', (await status(t0 + 40 * day)).kind, 'period');

  // 환불은 그 결제만 거둔다
  ctx.check(
    '환불',
    await webhook.handle(base({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', purchased_at_ms: t0 + 30 * day })),
    'revoked',
  );
  ctx.check('환불한 갱신 기간은 무료', (await status(t0 + 40 * day)).kind, 'free');
  ctx.check('첫 기간은 그대로', (await status(t0 + day)).kind, 'period');
  ctx.check(
    '같은 환불을 다시 받아도',
    await webhook.handle(base({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', purchased_at_ms: t0 + 30 * day })),
    'ignored:refund-no-grant',
  );
  ctx.check(
    '환불 되돌림',
    await webhook.handle(base({ type: 'REFUND_REVERSED', purchased_at_ms: t0 + 30 * day })),
    'restored',
  );
  ctx.check('되돌린 뒤 다시 구독 중', (await status(t0 + 40 * day)).kind, 'period');

  // 기간이 밀리고 당겨진다
  ctx.check(
    '기간 연장',
    await webhook.handle(base({ type: 'SUBSCRIPTION_EXTENDED', purchased_at_ms: t0 + 30 * day, expiration_at_ms: t0 + 70 * day })),
    'extended',
  );
  ctx.check('연장 뒤 끝', (await status(t0 + 31 * day)).endsAt, at(t0 + 70 * day).toISOString());
  ctx.check(
    '일찍 끝남',
    await webhook.handle(base({ type: 'EXPIRATION', purchased_at_ms: t0 + 30 * day, expiration_at_ms: t0 + 50 * day })),
    'shortened',
  );
  ctx.check('당긴 뒤 끝', (await status(t0 + 31 * day)).endsAt, at(t0 + 50 * day).toISOString());

  // 평생 이용권
  ctx.check(
    '평생 구매',
    await webhook.handle(
      base({
        type: 'NON_RENEWING_PURCHASE',
        product_id: PLAN_STORE_PRODUCT_IDS.lifetime,
        transaction_id: 'GPA.2222',
        expiration_at_ms: null,
        price_in_purchased_currency: 3900,
      }),
    ),
    'granted',
  );
  ctx.check('평생', (await status(t0 + 500 * day)).kind, 'lifetime');

  // 넘기는 것들
  ctx.check('모르는 상품', await webhook.handle(base({ type: 'INITIAL_PURCHASE', product_id: 'other:month1', transaction_id: 'GPA.3' })), 'ignored:unknown-product-other:month1');
  ctx.check('익명 사용자', await webhook.handle(base({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc' })), 'ignored:unknown-project');
  ctx.check('다른 스토어', await webhook.handle(base({ type: 'INITIAL_PURCHASE', store: 'APP_STORE' })), 'ignored:store-APP_STORE');
  ctx.check('시험 결제(설정 꺼짐)', await webhook.handle(base({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX', transaction_id: 'GPA.4' })), 'ignored:sandbox');
  acceptSandbox = true;
  ctx.check('시험 결제(설정 켜짐)', await webhook.handle(base({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX', transaction_id: 'GPA.4' })), 'granted');
  const sandbox = (await grants()).find((grant) => grant.externalId?.startsWith('GPA.4@'));
  ctx.check('시험 결제 표시', sandbox?.note, '시험 결제(SANDBOX)');
  ctx.check('사라진 사용자는 비운다', (await webhook.handle(base({ type: 'INITIAL_PURCHASE', transaction_id: 'GPA.5', subscriber_attributes: { userId: { value: 'gone' } } }))), 'granted');
  ctx.check('비운 결제한 사람', (await grants()).find((grant) => grant.externalId?.startsWith('GPA.5@'))?.userId ?? null, null);
});
