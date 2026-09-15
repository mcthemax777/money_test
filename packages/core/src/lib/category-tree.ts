/**
 * 분류를 대분류-소분류로 묶는다. 검색 창의 분류 칸이 쓴다.
 *
 * 평평한 목록으로 늘어놓으면 "식비 > 외식" 같은 이름이 수십 개가 되어, 무엇이 대분류이고
 * 어느 것이 그 아래인지 이름을 읽어야 안다. 묶어 두면 대분류 한 줄 아래에 그 소분류들이
 * 붙어 눈으로 구조가 보인다.
 */
import { selfCategoryPick, type CategoryDto } from '@money/types';

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
 *   **소분류를 마지막 하나까지 다 켜면** 그 무리를 대분류 하나로 접는다.
 *
 * 넷째 줄이 요점이다. "식비를 고른 뒤 배달만 빼고 싶다"가 그 뜻이라, 대분류를 그대로
 * 두면 배달이 계속 걸리고 아무 일도 하지 않은 것처럼 보인다.
 *
 * 마지막 줄은 그 되돌림이다. 소분류를 하나씩 켜다 마지막을 켜면 대분류를 누른 것과 같은
 * 상태가 되는데, 대분류 알약만 꺼져 있으면 "다 골랐는데 왜 대분류는 안 켜졌나"로 보인다.
 * 접어 두면 그 무리에서 무엇을 골랐는지가 알약 하나로 읽히고, 다시 하나를 끄면 넷째
 * 줄의 규칙이 나머지를 도로 켠다.
 *
 * **"미분류"도 이 무리의 한 칸이다.** 소분류 없이 대분류에 바로 적은 거래를 가리키는
 * 자리이고(`selfCategoryPick`), 소분류들과 나란히 선다. 그래서 무리의 칸은 소분류 여럿과
 * 미분류 하나이고, 대분류는 **그 칸들을 모두 켠 것과 같은 뜻**이다 -- 접고 펴는 규칙이
 * 정확해진다. 예전에는 미분류를 고를 자리가 없어, 소분류를 다 골라도 대분류에 바로 적은
 * 거래가 빠졌다.
 *
 * 그 덕에 "식비는 미분류만, 교통은 전체"가 한 검색에 담긴다. 검색 전체에 걸리는 스위치로
 * 두면 분류마다 다르게 정할 수가 없다.
 *
 * 소분류가 없는 대분류에는 미분류 칸을 두지 않는다. 그 대분류는 그 자신이 곧 미분류라,
 * 같은 것을 가리키는 알약이 둘이 된다.
 */
export function toggleCategory(
  selected: readonly string[],
  /** 방금 누른 분류 */
  target: { id: string },
  group: CategoryGroup,
): string[] {
  const parent = group.parent;
  const parts = groupParts(group);
  const without = (ids: readonly string[], drop: readonly string[]) => {
    const gone = new Set(drop);
    return ids.filter((id) => !gone.has(id));
  };

  if (parent && target.id === parent.id) {
    return selected.includes(parent.id)
      ? without(selected, [parent.id])
      : [...without(selected, parts), parent.id];
  }

  // 대분류가 켜진 채로 한 칸을 끈다: 대분류를 내리고 나머지 칸을 켠다.
  if (parent && selected.includes(parent.id)) {
    const rest = parts.filter((id) => id !== target.id);
    return [...without(selected, [parent.id]), ...rest];
  }

  if (selected.includes(target.id)) return without(selected, [target.id]);

  const next = [...selected, target.id];

  // 마지막 칸까지 켰다: 같은 뜻인 대분류 하나로 접는다.
  if (parent && parts.length > 0 && parts.every((id) => next.includes(id))) {
    return [...without(next, parts), parent.id];
  }

  return next;
}

/**
 * 한 무리 안에서 대분류가 담고 있는 칸들 -- 소분류 여럿과 미분류 하나.
 *
 * 대분류를 켠 것은 이 칸들을 모두 켠 것과 같은 뜻이다. 접고 펴는 규칙이 이 목록 하나를
 * 본다. 소분류가 없는 대분류는 그 자신이 곧 미분류라 칸이 없다.
 */
export function groupParts(group: CategoryGroup): string[] {
  if (!group.parent || group.children.length === 0) return [];
  return [...group.children.map((child) => child.id), selfCategoryPick(group.parent.id)];
}

/**
 * 알약 하나가 놓인 자리.
 *
 * `covered` 는 "내가 고른 것은 아니지만 함께 걸린다"다. 대분류를 켜면 그 소분류가
 * 그렇게 된다 (태그 고르기의 `partial` 과 같은 자리의 값이다).
 */
export type CategoryPickState = 'on' | 'covered' | 'off';

/**
 * 이 알약이 어떻게 보여야 하는가.
 *
 * **켜진 것과 덮인 것을 가른다.** 예전에는 둘을 같은 파란 알약으로 그렸는데, 그러면
 * 대분류 하나를 눌렀을 때 그 아래 소분류가 전부 파랗게 켜져 "대분류만 고른 상태"를
 * 화면에서 만들 수가 없었다 -- 고른 것이 하나인지 여럿인지 알 길이 없다.
 *
 * 걸리는 범위는 달라지지 않는다. 덮인 소분류의 거래도 여전히 함께 나온다(서버의
 * `entrySearchConditions`). 이 함수가 가르는 것은 **무엇을 골랐는가**뿐이다.
 */
export function categoryPickState(
  selected: readonly string[],
  /** 소분류, 대분류, 또는 미분류 칸(`selfCategoryPick`) */
  category: { id: string },
  group: CategoryGroup,
): CategoryPickState {
  if (selected.includes(category.id)) return 'on';
  if (group.parent && group.parent.id !== category.id && selected.includes(group.parent.id)) {
    return 'covered';
  }
  return 'off';
}

/**
 * 분류 하나를 없앨 때 함께 사라지는 것들.
 *
 * 대분류를 없애면 그 소분류도 함께 없어진다(서버의 `deleteCategory` 와 같은 규칙).
 * 그래서 옮길 곳도 그만큼 골라야 한다 -- 없앨 것마다 한 줄씩이다.
 *
 * 차례는 대분류가 먼저다. 창에서 첫 줄이 "지금 없애려는 그것"이어야, 아래 줄들이
 * 그것에 딸린 것으로 읽힌다.
 */
export function categoriesRemovedWith(
  categories: readonly CategoryDto.Response[],
  targetId: string,
): CategoryDto.Response[] {
  const target = categories.find((row) => row.id === targetId);
  if (!target) return [];

  // 소분류를 없애는 일에는 딸린 것이 없다.
  if (target.parentId) return [target];

  return [target, ...categories.filter((row) => row.parentId === targetId)];
}

/**
 * 옮겨 받을 수 있는 분류.
 *
 * **같은 유형이면 층은 가리지 않는다.** 소분류를 대분류로 합치는 일도(“외식을 그냥
 * 식비로”), 대분류를 남의 소분류로 보내는 일도(“경조사를 생활 > 경조사로”) 사용자가
 * 실제로 하려는 정리다. 유형만은 가른다 -- 지출을 수입으로 옮기면 그 거래의 부호가
 * 뒤집혀 합계가 조용히 어긋난다.
 *
 * 함께 없애는 것은 뺀다. 그리로 옮기면 마지막에 감춘 분류에 거래가 남는다.
 */
export function mergeTargetsOf(
  categories: readonly CategoryDto.Response[],
  removing: readonly string[],
  type: CategoryDto.Response['type'],
): CategoryDto.Response[] {
  const gone = new Set(removing);
  return categories.filter((row) => row.type === type && !gone.has(row.id));
}

/** 옮길 곳 목록에 적을 이름. 소분류는 대분류를 앞에 붙여야 같은 이름끼리 갈린다. */
export function mergeTargetLabel(
  categories: readonly CategoryDto.Response[],
  category: CategoryDto.Response,
): string {
  if (!category.parentId) return category.name;

  const parent = categories.find((row) => row.id === category.parentId);
  return parent ? `${parent.name} > ${category.name}` : category.name;
}
