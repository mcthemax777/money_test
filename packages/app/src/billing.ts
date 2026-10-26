/**
 * 이용권 결제 (Google Play, RevenueCat).
 *
 * 이용권은 프로젝트에 붙는다. 그래서 결제하기 직전에 RevenueCat 의 사용자 id 를 **프로젝트 id**
 * 로 바꾼다(logIn). 서버 웹훅이 그 id 로 어느 프로젝트에 줄지 안다(BillingWebhookService).
 * 결제한 사람은 따로 속성(userId)으로 남긴다.
 *
 * 권한은 앱이 아니라 서버가 정한다. 결제가 끝나도 앱은 스스로 이용권을 켜지 않고, 웹훅이
 * 서버에 적은 뒤 프로젝트 목록을 다시 받아 안다 -- 앱이 켜면 서버와 어긋날 수 있다.
 *
 * **API 키.** RevenueCat 대시보드의 Android 앱 공개 SDK 키(goog_ 로 시작)를 아래에 적는다.
 * 비어 있으면 결제를 열지 않는다.
 */
import { Linking } from 'react-native';
import Purchases, { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { PLAN_STORE_PRODUCT_IDS, PLAY_SUBSCRIPTION_ID, type PlanId } from '@money/types';

const REVENUECAT_ANDROID_API_KEY = '';

/** 결제를 열 수 있는가. 키가 없으면 결제 단추가 "준비 중"을 알린다. */
export const isBillingConfigured = REVENUECAT_ANDROID_API_KEY !== '';

/** 이 앱의 패키지 이름. Play 의 구독 관리 화면을 열 때 쓴다. */
const PACKAGE_NAME = 'online.bboyong.app';

export type PurchaseOutcome =
  | 'purchased'
  | 'cancelled'
  /** 이미 이 구독을 쓰는 중이다(다른 기간으로 바꾸기는 Play 구독 관리에서). */
  | 'already-subscribed'
  /** 평생 이용권을 사려는데 이 가계부에 이어지는 구독이 있다. 구독을 먼저 해지해야 한다. */
  | 'subscription-active'
  /** 결제가 아직 확정되지 않았다(현금 결제 따위). 확정되면 웹훅이 이용권을 준다. */
  | 'payment-pending'
  | 'product-missing';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  Purchases.configure({ apiKey: REVENUECAT_ANDROID_API_KEY });
  configured = true;
}

/**
 * 결제한다. 사용자가 창을 닫으면 'cancelled'. 그 밖의 실패(연결, 스토어 오류)는 던진다.
 */
export async function purchasePlan(input: {
  projectId: string;
  plan: PlanId;
  userId: string | null;
}): Promise<PurchaseOutcome> {
  if (!isBillingConfigured) throw new Error('결제가 설정되지 않았습니다.');
  ensureConfigured();

  await Purchases.logIn(input.projectId);
  if (input.userId) await Purchases.setAttributes({ userId: input.userId });

  /*
   * 구독 중에 평생 이용권을 사면 구독은 그대로 결제된다 (Play 는 둘을 따로 본다, 2026-10-25). 관리 도구의 지급도
   * 같은 경우를 막는다(plans.service). 이어지는 구독이 있으면 사지 않고 해지를 먼저 안내한다.
   */
  if (input.plan === 'lifetime') {
    const info = await Purchases.getCustomerInfo();
    if (info.activeSubscriptions.length > 0) return 'subscription-active';
  }

  const productId = PLAN_STORE_PRODUCT_IDS[input.plan];
  const category =
    input.plan === 'lifetime' ? PRODUCT_CATEGORY.NON_SUBSCRIPTION : PRODUCT_CATEGORY.SUBSCRIPTION;
  const products = await Purchases.getProducts([productId], category);
  const product = products.find((candidate) => candidate.identifier === productId);
  if (!product) return 'product-missing';

  try {
    await Purchases.purchaseStoreProduct(product);
    return 'purchased';
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    if (code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) return 'already-subscribed';
    // 실패가 아니다. 예전에는 "결제하지 못했다"로 보여, 사람이 다시 결제할 수 있었다.
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'payment-pending';
    throw error;
  }
}

/**
 * 스토어가 정한 이용권 가격 글자 (이용권 -> "₩3,900"). 결제 창이 보여 준다 (2026-10-25).
 *
 * 코드에 적어 둔 가격(`PLANS`)과 스토어의 가격이 다르면 사용자가 본 값과 결제되는 값이 갈린다. 스토어가 지역과
 * 통화에 맞춰 낸 글자를 그대로 쓴다. 결제가 설정되지 않았거나 받지 못하면 빈 표다 -- 그때는 코드의 가격을 쓴다.
 */
export async function loadStorePrices(): Promise<Partial<Record<PlanId, string>>> {
  if (!isBillingConfigured) return {};
  try {
    ensureConfigured();
    const entries = Object.entries(PLAN_STORE_PRODUCT_IDS) as Array<[PlanId, string]>;
    const [subscriptions, oneTime] = await Promise.all([
      Purchases.getProducts(
        entries.filter(([plan]) => plan !== 'lifetime').map(([, id]) => id),
        PRODUCT_CATEGORY.SUBSCRIPTION,
      ),
      Purchases.getProducts(
        entries.filter(([plan]) => plan === 'lifetime').map(([, id]) => id),
        PRODUCT_CATEGORY.NON_SUBSCRIPTION,
      ),
    ]);
    const priceOf = new Map([...subscriptions, ...oneTime].map((product) => [product.identifier, product.priceString]));
    return Object.fromEntries(
      entries.flatMap(([plan, id]) => (priceOf.has(id) ? [[plan, priceOf.get(id)!]] : [])),
    );
  } catch (error) {
    console.warn('스토어 가격을 받지 못했습니다:', error);
    return {};
  }
}

/** Play 스토어의 이 앱 구독 관리 화면. 기간을 바꾸거나 해지하는 곳이다. */
export function openSubscriptionManagement(): void {
  // 열지 못해도(스토어 앱이 없는 기기) 던지지 않는다 (2026-10-16 -- 처리되지 않은 거절로 남았다).
  Linking.openURL(
    `https://play.google.com/store/account/subscriptions?package=${PACKAGE_NAME}&sku=${PLAY_SUBSCRIPTION_ID}`,
  ).catch((error) => console.warn('구독 관리 화면을 열지 못했습니다:', error));
}
