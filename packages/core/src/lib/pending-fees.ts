/**
 * 수수료를 적지 않은 할부 회차를 화면에 올리는 셈.
 *
 * 웹과 앱이 같은 묶음을 보여 줘야 해서 여기 둔다 -- 한쪽만 고치면 같은 명세서를 두
 * 화면에서 다르게 채우게 된다 (`pending-rates` 와 같은 자리다).
 */
import type { CardDto } from '@money/types';

/** 한 거래의 밀린 회차들. */
export interface PendingFeeGroup {
  /** 그 할부의 계획 id. 목록 열쇠로 쓴다. */
  planId: string;
  /** 원 거래. 눌러서 열어 본다. */
  entryId: string;
  /** 줄에 적을 이름. 설명이 비면 가맹점, 그것도 없으면 분류다. */
  title: string;
  description: string;
  merchant: string | null;
  categoryName: string | null;
  purchaseDate: string;
  months: number;
  /** 밀린 회차. 오래된 것이 앞이다. */
  items: CardDto.PendingFeeItem[];
}

/**
 * 묶음에 적을 이름.
 *
 * 설명을 적지 않고 지나가는 일이 흔하다. 목록 한 줄이 쓰는 규칙과 같은 차례로 가린다 --
 * 설명, 가맹점, 분류. 셋 다 없으면 빈 글자를 돌려주고 화면이 "(내용 없음)"을 세운다.
 */
export function pendingFeeTitle(
  item: Pick<CardDto.PendingFeeItem, 'description' | 'merchant' | 'categoryName'>,
): string {
  return item.description?.trim() || item.merchant?.trim() || item.categoryName?.trim() || '';
}

/**
 * **거래별로 묶는다.** 사용자가 명세서에서 찾는 단위가 그 거래이기 때문이다.
 *
 * 묶지 않으면 밀린 회차가 결제일 순으로 섞여 선다. 할부가 둘만 되어도 "냉장고 2회차,
 * 자동차 5회차, 냉장고 3회차"처럼 늘어서, 어느 줄이 어느 거래의 것인지 설명 글자를
 * 하나하나 읽어야 알 수 있다.
 *
 * 묶음 차례는 가장 오래 밀린 회차가 앞이다. 밀린 것부터 적는 것이 순서라서다.
 */
export function groupPendingFeesByEntry(
  items: readonly CardDto.PendingFeeItem[],
): PendingFeeGroup[] {
  const byPlan = new Map<string, PendingFeeGroup>();

  for (const item of items) {
    const group = byPlan.get(item.planId);
    if (group) {
      group.items.push(item);
      continue;
    }
    byPlan.set(item.planId, {
      planId: item.planId,
      entryId: item.entryId,
      title: pendingFeeTitle(item),
      description: item.description,
      merchant: item.merchant,
      categoryName: item.categoryName,
      purchaseDate: item.purchaseDate,
      months: item.months,
      items: [item],
    });
  }

  for (const group of byPlan.values()) {
    group.items.sort((a, b) => a.sequence - b.sequence);
  }

  return [...byPlan.values()].sort((a, b) => {
    const left = a.items[0];
    const right = b.items[0];
    if (left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
    return left.sequence - right.sequence;
  });
}
