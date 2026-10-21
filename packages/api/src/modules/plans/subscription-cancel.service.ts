import { Injectable, Logger } from '@nestjs/common';
import { badGateway } from '@/common/app-error';
import { PlansService } from './plans.service';
import { StoreBillingService } from './store-billing.service';

/**
 * 지울 가계부의 이어지는 Play 구독을 해지한다. 계정 삭제와 가계부 삭제가 함께 쓴다.
 *
 * 지운 뒤에는 그 결제를 막을 길이 없다 -- 갱신 웹훅이 와도 가계부가 없어 무시되고(`unknown-project`),
 * 사용자는 아무것도 받지 못한 채 계속 낸다. 그래서 **지우기 전에** 부른다.
 *
 * 해지가 거절되면(사용자가 이미 Play 스토어에서 해지했다, 그새 끝났다) RevenueCat 의 고객 정보로
 * 아직 갱신될 구독이 남았는지 다시 본다. 남았거나 확인하지 못하면 던진다 -- 부르는 쪽은 지우지 않는다.
 */
@Injectable()
export class SubscriptionCancelService {
  private readonly logger = new Logger(SubscriptionCancelService.name);

  constructor(
    private readonly plans: PlansService,
    private readonly store: StoreBillingService,
  ) {}

  async cancelRenewing(projects: ReadonlyArray<{ id: string; name: string }>, now = new Date()): Promise<void> {
    const subscriptions = await this.plans.renewingStoreSubscriptions(
      projects.map((project) => project.id),
      now,
    );
    const failed: string[] = [];
    for (const { projectId, transactionId } of subscriptions) {
      try {
        await this.store.cancelPlaySubscription(projectId, transactionId);
      } catch (error) {
        const stillRenewing = await this.store.hasRenewingPlaySubscription(projectId, now).catch(() => true);
        if (!stillRenewing) continue;
        this.logger.warn(`구독 해지 실패 ${projectId}: ${String(error)}`);
        failed.push(projects.find((project) => project.id === projectId)?.name ?? projectId);
      }
    }
    if (failed.length > 0) {
      throw badGateway(
        'ACCOUNT_SUBSCRIPTION_CANCEL_FAILED',
        'Play 구독을 해지하지 못했습니다. Play 스토어에서 구독을 해지한 뒤 다시 시도해 주세요.',
        { projects: failed.join(', ') },
      );
    }
  }
}
