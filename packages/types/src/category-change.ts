/**
 * 여러 줄의 분류를 한 번에 바꾸는 규칙 (2026-10-09 사용자 요청 -- 태그 손보기처럼).
 *
 * 서버(`EntriesService.changeCategory`)와 기기 사본(`LocalStore.changeEntryCategory`)이 함께
 * 쓴다. 두 곳이 각자 판단하면 오프라인에서 본 결과와 서버가 재생한 결과가 갈린다
 * (`tag-change` 와 같은 까닭).
 *
 * 규칙은 넷이다.
 *
 *   1. **줄을 가리지 않은 대상은 그 전표의 분류 줄 전부다.** 목록에서 달을 통째로 골랐을 때
 *      화면은 그 거래들의 줄 키를 모른다. 태그와 같은 규칙이다.
 *   2. **같은 유형의 분류로만 바꾼다.** 지출 줄을 수입 분류로 옮기면 그 거래의 부호가 뒤집혀
 *      합계가 조용히 어긋난다 (분류 통합의 `CATEGORY_MERGE_TYPE_MISMATCH` 와 같은 까닭).
 *      유형이 다른 줄과 분류 줄이 없는 거래(이체, 카드 대금 결제)는 건드리지 않고 센다.
 *   3. **사라진 줄은 건너뛰고 돌려준다.** 그 사이 다른 기기가 분할을 고친 자리다.
 *   4. **이미 그 분류인 줄은 달라짐이 아니다.** 같은 명령을 두 번 재생해도 안전하다.
 *   5. **환불·페이백은 원거래 줄의 분류를 따른다** (원장의 `rebindPaybacks` 와 같은 규칙).
 *      원거래 줄을 바꾸면 그 줄에 걸린 환불·페이백도 함께 옮기고, 원거래에 걸린 환불·페이백을
 *      따로 고르면 바꾸지 않고 센다 -- 혼자 바꾸면 원거래 분류의 지출만 줄고 다른 분류가 음수가 된다.
 */
import type { CategoryType } from './entities';
import type { TagTarget } from './mutations';

/** 전표의 분류 줄 하나. 지금 걸린 분류와 그 유형을 함께 든다. */
export interface CategoryChangeLine {
  entryId: string;
  lineKey: string | null;
  categoryId: string;
  categoryType: CategoryType;
  /** 원거래에 걸린 환불·페이백의 줄인가. 그 분류는 원거래 줄의 것을 따른다. */
  linkedPayback?: boolean;
}

/** 원거래 줄에 걸린 환불·페이백. 원거래 줄이 바뀌면 함께 옮긴다. */
export interface CategoryFollower {
  id: string;
  paybackOfEntryId: string;
  paybackOfLineKey: string | null;
}

export interface CategoryChangePlan {
  /** 실제로 바꿀 줄. */
  lines: Array<{ entryId: string; lineKey: string | null }>;
  /** 분류가 하나라도 바뀌는 거래 (고른 것). */
  entryIds: string[];
  /** 바뀐 원거래 줄을 따라 함께 옮길 환불·페이백 전표. */
  followerIds: string[];
  /** 사라져 적용하지 못한 대상 (전표나 줄이 없다). */
  skipped: TagTarget[];
  /** 유형이 달라서, 또는 분류 줄이 없는 거래라서 건드리지 않은 줄(거래)의 수. */
  excluded: number;
}

export function planCategoryChange(
  targets: readonly TagTarget[],
  /** 대상 전표들의 분류 줄. 사본·서버가 각자 읽어 넘긴다. */
  lines: readonly CategoryChangeLine[],
  /** 전표가 있는지. 분류 줄이 없는 전표(이체)와 사라진 전표를 가른다. */
  present: ReadonlySet<string>,
  to: { id: string; type: CategoryType },
  /** 대상 전표들에 걸린 환불·페이백. 없으면 빈 배열이다. */
  followers: readonly CategoryFollower[] = [],
): CategoryChangePlan {
  const linesOf = new Map<string, CategoryChangeLine[]>();
  for (const line of lines) {
    const list = linesOf.get(line.entryId) ?? [];
    list.push(line);
    linesOf.set(line.entryId, list);
  }

  const picked = new Map<string, CategoryChangeLine>();
  const skipped: TagTarget[] = [];
  let excluded = 0;

  for (const target of targets) {
    if (!present.has(target.entryId)) {
      skipped.push(target);
      continue;
    }
    const own = linesOf.get(target.entryId) ?? [];
    // 분류 줄이 없는 거래(이체, 카드 대금 결제). 바꿀 분류가 없다.
    if (own.length === 0) {
      excluded += 1;
      continue;
    }

    const chosen =
      target.lineKey === undefined ? own : own.filter((line) => line.lineKey === target.lineKey);
    if (chosen.length === 0) {
      skipped.push(target);
      continue;
    }

    for (const line of chosen) {
      if (line.linkedPayback || line.categoryType !== to.type) {
        excluded += 1;
        continue;
      }
      if (line.categoryId === to.id) continue;
      picked.set(`${line.entryId}\u0000${line.lineKey ?? ''}`, line);
    }
  }

  const chosenLines = [...picked.values()].map(({ entryId, lineKey }) => ({ entryId, lineKey }));
  const changedLines = new Set(chosenLines.map((line) => `${line.entryId}\u0000${line.lineKey ?? ''}`));
  const followerIds = followers
    .filter(
      (follower) =>
        follower.paybackOfLineKey !== null &&
        changedLines.has(`${follower.paybackOfEntryId}\u0000${follower.paybackOfLineKey}`),
    )
    .map((follower) => follower.id);
  return {
    lines: chosenLines,
    entryIds: [...new Set(chosenLines.map((line) => line.entryId))],
    followerIds: [...new Set(followerIds)],
    skipped,
    excluded,
  };
}
