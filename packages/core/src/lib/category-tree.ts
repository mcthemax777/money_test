/**
 * 분류를 대분류-소분류로 묶는다. 검색 창의 분류 칸이 쓴다.
 *
 * 평평한 목록으로 늘어놓으면 "식비 > 외식" 같은 이름이 수십 개가 되어, 무엇이 대분류이고
 * 어느 것이 그 아래인지 이름을 읽어야 안다. 묶어 두면 대분류 한 줄 아래에 그 소분류들이
 * 붙어 눈으로 구조가 보인다.
 */
import type { CategoryDto } from '@money/types';

export interface CategoryGroup {
  /**
   * 대분류. 목록에 없으면 null 이다.
   *
   * 숨긴 대분류의 소분류가 그렇다. 감추면 거를 수 있는 분류가 조용히 사라지므로,
   * 이름 없는 묶음으로 모아 그대로 보여 준다.
   */
  parent: CategoryDto.Response | null;
  /** 그 대분류의 소분류들. 없으면 빈 배열이다. */
  children: CategoryDto.Response[];
}

/**
 * 대분류별로 묶는다. 묶음의 차례도, 묶음 안의 차례도 받은 목록을 그대로 따른다
 * (사용자가 분류 화면에서 정한 순서다).
 */
export function groupCategories(categories: CategoryDto.Response[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const indexOf = new Map<string, number>();

  for (const category of categories) {
    if (category.parentId) continue;
    indexOf.set(category.id, groups.length);
    groups.push({ parent: category, children: [] });
  }

  /** 대분류를 찾지 못한 소분류들. 마지막에 이름 없는 묶음으로 붙인다. */
  const orphans: CategoryDto.Response[] = [];

  for (const category of categories) {
    if (!category.parentId) continue;
    const found = indexOf.get(category.parentId);
    if (found === undefined) orphans.push(category);
    else groups[found].children.push(category);
  }

  if (orphans.length > 0) groups.push({ parent: null, children: orphans });

  return groups;
}

/** 지출 칸과 수입 칸. 화면이 이 차례로 그린다. */
export interface CategoryTypeSection {
  type: 'expense' | 'income';
  groups: CategoryGroup[];
}

/**
 * 지출과 수입을 갈라 묶는다.
 *
 * **차례는 등록한 순서(sortOrder)를 그대로 따르되, 유형으로 먼저 가른다.** 서버가 주는
 * 목록은 유형마다 0부터 매긴 순서라 그대로 늘어놓으면 "급여(수입 0) · 식비(지출 0) ·
 * 공과금(지출 1) · 상여금(수입 1)"처럼 둘이 번갈아 나온다. 분류 화면에서 정한 차례와
 * 달라 보이는 까닭이 그것이다.
 *
 * 지출을 앞에 둔다. 홈과 가계의 탭이 모두 지출부터라 화면끼리 차례가 어긋나지 않는다.
 * 한쪽이 비어 있으면 그 칸은 만들지 않는다.
 */
export function groupCategoriesByType(
  categories: CategoryDto.Response[],
): CategoryTypeSection[] {
  const order: Array<CategoryTypeSection['type']> = ['expense', 'income'];

  return order
    .map((type) => ({
      type,
      groups: groupCategories(categories.filter((category) => category.type === type)),
    }))
    .filter((section) => section.groups.length > 0);
}

/**
 * 알약 하나를 눌렀을 때의 다음 상태.
 *
 * **대분류를 고르면 그 소분류는 함께 걸린다** (서버의 entrySearchConditions 규칙). 그래서
 * 이 무리 안에서는 대분류 하나와 소분류 여럿이 같은 것을 가리키는 자리가 생긴다. 규칙을
 * 한 줄로 적으면 이렇다.
 *
 *   대분류를 켜면   그 무리의 소분류는 목록에서 뺀다 (대분류가 이미 담고 있다).
 *   대분류를 끄면   그 무리에서 아무것도 고르지 않은 상태가 된다.
 *   소분류를 켜고 끄면  평소처럼 그것 하나만 오간다.
 *   **대분류가 켜진 채로 소분류를 끄면** 대분류를 내리고 나머지 소분류를 모두 켠다.
 *
 * 마지막 줄이 요점이다. "식비를 고른 뒤 배달만 빼고 싶다"가 그 뜻이라, 대분류를 그대로
 * 두면 배달이 계속 걸리고 아무 일도 하지 않은 것처럼 보인다.
 *
 * 한 가지는 알고 써야 한다. 그렇게 바꾼 뒤에는 **소분류 없이 대분류에 바로 적은 거래**가
 * 빠진다. 고른 것이 소분류들뿐이기 때문이다. 그것까지 담으려면 "대분류에 바로 적은 것"을
 * 따로 고르는 자리가 있어야 하는데, 지금 검색에는 그 자리가 없다.
 */
export function toggleCategory(
  selected: readonly string[],
  /** 방금 누른 분류 */
  target: { id: string },
  group: CategoryGroup,
): string[] {
  const parent = group.parent;
  const childIds = group.children.map((child) => child.id);
  const without = (ids: readonly string[], drop: readonly string[]) => {
    const gone = new Set(drop);
    return ids.filter((id) => !gone.has(id));
  };

  if (parent && target.id === parent.id) {
    return selected.includes(parent.id)
      ? without(selected, [parent.id])
      : [...without(selected, childIds), parent.id];
  }

  // 대분류가 켜진 채로 소분류를 끈다: 대분류를 내리고 나머지 소분류를 켠다.
  if (parent && selected.includes(parent.id)) {
    const rest = childIds.filter((id) => id !== target.id);
    return [...without(selected, [parent.id]), ...rest];
  }

  return selected.includes(target.id)
    ? without(selected, [target.id])
    : [...selected, target.id];
}

/**
 * 이 알약이 켜져 보여야 하는가.
 *
 * 대분류가 켜져 있으면 그 소분류도 켜진 것으로 보인다 -- 실제로 함께 걸리기 때문이다.
 */
export function isCategoryPicked(
  selected: readonly string[],
  category: { id: string },
  group: CategoryGroup,
): boolean {
  if (selected.includes(category.id)) return true;
  return Boolean(group.parent) && selected.includes(group.parent!.id);
}
