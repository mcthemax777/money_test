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
    throw error;
  }
}

/** Play 스토어의 이 앱 구독 관리 화면. 기간을 바꾸거나 해지하는 곳이다. */
export function openSubscriptionManagement(): void {
  void Linking.openURL(
    `https://play.google.com/store/account/subscriptions?package=${PACKAGE_NAME}&sku=${PLAY_SUBSCRIPTION_ID}`,
  );
}
