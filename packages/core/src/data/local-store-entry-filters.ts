/**
 * 전표 목록 질의의 WHERE 조각. 기간·사람·검색·분류·카드·페이백 조건을 SQL 과 자리표 값으로 만든다.
 *
 * 무엇을 고를지는 서버와 같은 규칙이고(`@money/types` 의 `parseEntrySearch` 가 읽는다), 그것을 문장으로
 * 옮기는 일만 여기서 한다. 조건은 모두 별칭 `e` 의 entry 를 본다.
 */

import { NO_PERSON, type ParsedEntrySearch } from '@money/types';

import type { MirrorEntryScope } from './local-store-types';

/**
 * 원거래 조건. 그 원거래에 걸린 페이백만.
 */
export function paybackOfFilter(paybackOf?: string): { sql: string; params: string[] } {
  if (!paybackOf) return { sql: '', params: [] };
  return { sql: ' AND e.paybackOfEntryId = ?', params: [paybackOf] };
}

/**
 * 분류 조건. 그 분류(대분류면 소분류까지)의 다리, 또는 그 유형의 분류 다리를 가진 전표만.
 *
 * 서버 목록(`entries.service` 의 categoryId·categoryExact·categoryType)과 같은 규칙이다 --
 * 다리 하나가 맞으면 전표가 통째로 든다. 둘을 함께 주면 둘 다 맞아야 한다(다리는 서로 달라도 된다).
 */
function categoryLegFilter(
  category?: { id: string; exact: boolean },
  categoryType?: 'income' | 'expense',
): { sql: string; params: string[] } {
  let sql = '';
  const params: string[] = [];
  if (category) {
    sql += category.exact
      ? ` AND EXISTS (SELECT 1 FROM posting cp WHERE cp.entryId = e.id AND cp.categoryId = ?)`
      : ` AND EXISTS (SELECT 1 FROM posting cp JOIN category cc ON cc.id = cp.categoryId
                       WHERE cp.entryId = e.id AND (cc.id = ? OR cc.parentId = ?))`;
    params.push(...(category.exact ? [category.id] : [category.id, category.id]));
  }
  if (categoryType) {
    sql += ` AND EXISTS (SELECT 1 FROM posting tp JOIN category tc ON tc.id = tp.categoryId
                          WHERE tp.entryId = e.id AND tc.type = ?)`;
    params.push(categoryType);
  }
  return { sql, params };
}

/**
 * 카드 조건. 그 카드가 찍힌 다리를 가진 전표만.
 *
 * 체크카드 사용은 연결 통장의 다리에, 신용카드 사용은 부채 계정의 다리에 카드가 찍힌다.
 * 어느 쪽이든 이 조건 하나로 그 카드의 거래만 걸린다 (서버의 목록 필터와 같다).
 */
function cardFilter(cardId?: string): { sql: string; params: string[] } {
  if (!cardId) return { sql: '', params: [] };
  return {
    sql: ' AND EXISTS (SELECT 1 FROM posting cp WHERE cp.entryId = e.id AND cp.cardId = ?)',
    params: [cardId],
  };
}

/**
 * 목록을 좁히는 분류·카드 조건을 함께. 전체 목록(`viewEntries`)과 쪽 목록(`viewEntriesPage`)이
 * 같은 조건을 걸어야 한다 -- 예전에는 앞의 것이 카드를, 뒤의 것이 분류를 말없이 버렸다.
 */
export function narrowFilter(scope: MirrorEntryScope): { sql: string; params: string[] } {
  const category = categoryLegFilter(scope.category, scope.categoryType);
  const card = cardFilter(scope.cardId);
  return { sql: category.sql + card.sql, params: [...category.params, ...card.params] };
}

/**
 * 기간 조건. 달 이름이 있으면 그것이 앞선다.
 *
 * 분석 기준(`dateBasis: 'analysis'`)이면 연결된 페이백을 원거래의 날짜로 고른다. 원거래가
 * 사본에 없으면(지워졌는데 비운 링크가 아직 오지 않았다) 자기 날짜로 본다 -- 서버가 링크를
 * 비운 뒤와 같은 결과다. 서버 `analysisDateCondition` 의 짝이다.
 */
export function periodFilter(range: MirrorEntryScope): { sql: string; params: string[] } {
  const own = range.yearMonth
    ? { sql: 'e.yearMonth = ?', params: [range.yearMonth] }
    : { sql: 'e.dateKey >= ? AND e.dateKey <= ?', params: [range.fromDateKey, range.toDateKey] };
  if (range.dateBasis !== 'analysis') return { sql: ` AND ${own.sql}`, params: own.params };

  const original = range.yearMonth
    ? { sql: 'o.yearMonth = ?', params: [range.yearMonth] }
    : { sql: 'o.dateKey >= ? AND o.dateKey <= ?', params: [range.fromDateKey, range.toDateKey] };
  return {
    sql: ` AND ((${own.sql} AND NOT EXISTS (SELECT 1 FROM entry o WHERE o.id = e.paybackOfEntryId))
           OR EXISTS (SELECT 1 FROM entry o WHERE o.id = e.paybackOfEntryId AND ${original.sql}))`,
    params: [...own.params, ...original.params],
  };
}

/**
 * 유형 조건. 고른 유형끼리 OR 로 잇는다. 서버의 `entryKindCondition` 과 같은 규칙이다.
 *
 * **지출·수입은 카테고리 기준, 이체·카드정산은 자금 이동 기준이다.**
 *
 *   지출     지출 카테고리 다리(0 이상)가 있는 전표
 *   수입     수입 카테고리 다리가 있는 전표
 *   페이백   지출 카테고리 다리가 음수인 전표 (지출을 되돌려 받은 돈)
 *   이체     계좌 사이를 옮긴 돈 (신용카드·기초잔액이 끼지 않은)
 *   카드정산 계좌 사이를 옮긴 돈 중 신용카드 부채 계정이 끼는 것
 *   조정     기초잔액 계정이 끼는 것
 *
 * 지출을 `classifyEntry` 와 다르게 두는 이유는 **수수료가 붙은 이체**다. 그 전표는 표시
 * 유형이 이체지만 수수료는 지출 카테고리 다리이고, 지출 합계는 카테고리 기준이라 그
 * 수수료를 이미 센다. 표시 유형으로 지출을 고르면 그 전표가 빠져 합계가 갈린다.
 *
 * "계좌 다리가 둘 이상"은 **부호가 다른 계좌 다리가 둘 다 있는가**로 본다. 전표는
 * 균형을 이루므로 계좌 사이를 옮긴 돈은 한쪽이 음수, 다른 쪽이 양수다. 부호는 문자열의
 * 첫 글자로 읽는다 (ownerFilter 와 같은 규칙).
 */
function kindFilter(kinds?: readonly string[]): string {
  if (!kinds || kinds.length === 0) return '';

  const leg = (extra: string) =>
    `EXISTS (SELECT 1 FROM posting kp WHERE kp.entryId = e.id AND ${extra})`;
  const negative = leg(`kp.accountId IS NOT NULL AND substr(kp.amount, 1, 1) = '-'`);
  const positive = leg(
    `kp.accountId IS NOT NULL AND substr(kp.amount, 1, 1) != '-' AND kp.amount != '0'`,
  );
  const moves = `(${negative} AND ${positive})`;
  const accountType = (type: string) =>
    `EXISTS (
       SELECT 1 FROM posting kp JOIN account ka ON ka.id = kp.accountId
        WHERE kp.entryId = e.id AND ka.type = '${type}'
     )`;
  const categoryType = (type: string, extra = '') =>
    `EXISTS (
       SELECT 1 FROM posting kp JOIN category kc ON kc.id = kp.categoryId
        WHERE kp.entryId = e.id AND kc.type = '${type}'${extra}
     )`;
  // 지출과 페이백은 같은 지출 분류를 쓰고 부호로 갈린다 (서버 entryKindCondition 과 같다).
  const paybackLeg = ` AND substr(kp.baseAmount, 1, 1) = '-'`;
  const expenseLeg = ` AND substr(kp.baseAmount, 1, 1) != '-'`;

  const of = (kind: string): string => {
    switch (kind) {
      case 'card_payment':
        return `(${moves} AND ${accountType('credit_card')})`;
      case 'adjustment':
        return `(${moves} AND NOT ${accountType('credit_card')} AND ${accountType('opening_balance')})`;
      case 'transfer':
        return `(${moves} AND NOT ${accountType('credit_card')} AND NOT ${accountType('opening_balance')})`;
      case 'income':
        return categoryType('income');
      case 'payback':
        return categoryType('expense', paybackLeg);
      default:
        return categoryType('expense', expenseLeg);
    }
  };

  return `
        AND (${kinds.map(of).join(' OR ')})`;
}

/**
 * 모양 조건. 고른 모양끼리 OR 로 잇는다. 서버의 `entryFeatureCondition` 과 같은 규칙이다.
 *
 *   분할  분류 다리가 둘 이상인 전표
 *   할부  할부 계획이 붙은 다리를 가진 전표
 *   차감  깎인 금액이 0 보다 큰 다리를 가진 전표 (금액은 TEXT 라 수로 바꿔 견준다)
 *
 * 서버는 분할을 셀 수 없어 id 목록을 따로 받아 오지만(Prisma 의 관계 조건은 some/every/
 * none 뿐이다), 여기서는 하위 질의가 그 자리에서 센다. 세는 규칙은 같다.
 */
function featureFilter(features?: readonly string[]): string {
  if (!features || features.length === 0) return '';

  const branches: string[] = [];
  if (features.includes('installment')) {
    branches.push(`EXISTS (
          SELECT 1 FROM posting fp JOIN installment_plan fi ON fi.postingId = fp.id
           WHERE fp.entryId = e.id
        )`);
  }
  if (features.includes('split')) {
    branches.push(`(
          SELECT COUNT(*) FROM posting fp
           WHERE fp.entryId = e.id AND fp.categoryId IS NOT NULL
        ) > 1`);
  }
  if (features.includes('discount')) {
    branches.push(`EXISTS (
          SELECT 1 FROM posting fp
           WHERE fp.entryId = e.id AND CAST(fp.discountAmount AS REAL) > 0
        )`);
  }

  return `
        AND (${branches.join(' OR ')})`;
}

/**
 * 검색을 SQL 조건으로. 무리 안은 OR, 무리끼리는 AND.
 *
 * 무리 하나가 EXISTS 하나다. 무리를 쪼개 EXISTS 를 여럿 걸면 "식비 다리가 있고
 * 교통비 다리도 있는 전표"가 되어 분할 거래만 걸린다.
 *
 * 부호는 문자열의 첫 글자로 본다. 금액이 표준 십진 표기로 담기므로 음수는 언제나
 * '-' 로 시작한다. TEXT 를 숫자로 바꿔 비교하면 정밀도를 잃는 자리가 생긴다
 * (ownerFilter 와 같은 규칙이다).
 */
export function searchFilter(search?: ParsedEntrySearch): { sql: string; params: string[] } {
  if (!search) return { sql: '', params: [] };

  let sql = '';
  const params: string[] = [];

  const categoryIds = search.categoryIds ?? [];
  const categorySelfIds = search.categorySelfIds ?? [];
  if (categoryIds.length > 0 || categorySelfIds.length > 0) {
    /*
     * 분류 한 무리. 두 갈래를 OR 로 잇는다. 서버의 entrySearchConditions 와 같은 규칙이다.
     *
     *   `categoryIds`      대분류를 고르면 소분류까지.
     *   `categorySelfIds`  그 분류에 **직접** 적은 것만 (미분류).
     *
     * 둘이 한 무리라 "식비 미분류 또는 교통 전체"가 그대로 표현된다.
     */
    const branches: string[] = [];
    if (categoryIds.length > 0) {
      const list = categoryIds.map(() => '?').join(', ');
      branches.push(`sp.categoryId IN (${list}) OR sc.parentId IN (${list})`);
      params.push(...categoryIds, ...categoryIds);
    }
    if (categorySelfIds.length > 0) {
      branches.push(`sp.categoryId IN (${categorySelfIds.map(() => '?').join(', ')})`);
      params.push(...categorySelfIds);
    }

    sql += `
        AND EXISTS (
          SELECT 1 FROM posting sp LEFT JOIN category sc ON sc.id = sp.categoryId
           WHERE sp.entryId = e.id AND (${branches.join(' OR ')})
        )`;
  }

  const accountIds = search.paymentAccountIds ?? [];
  const cardIds = search.paymentCardIds ?? [];
  if (accountIds.length > 0 || cardIds.length > 0 || search.noAccount) {
    const branches: string[] = [];

    if (accountIds.length > 0) {
      /*
       * 이 통장의 관점이다. **이 통장에서 오간 돈 전부**를 본다 -- 나간 것도, 들어온 것도,
       * 0원짜리도. 이체로 들어온 돈도 들고, 전액을 깎아 빠져나간 돈이 0인 결제도 든다
       * (0을 빼면 그 결제가 통째로 사라진다). 서버의 `entrySearchConditions` 와 같은
       * 규칙이라 온라인·오프라인이 같은 목록을 낸다 (그 자리에 까닭이 적혀 있다).
       *
       * 그래서 금액은 아예 보지 않는다. 카드가 붙은 다리만 뺀다 -- 체크카드 결제가
       * 연결 통장 다리에도 걸려 카드와 통장에 두 번 세어지기 때문이다.
       *
       * 기초잔액 전표는 뺀다. 사용자가 적은 거래가 아닌 자본 전표라, 두면 통장을 고를
       * 때마다 목록에 끼어든다 (서버의 같은 자리에 까닭이 적혀 있다).
       */
      branches.push(
        `(mp.accountId IN (${accountIds.map(() => '?').join(', ')}) AND mp.cardId IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
             WHERE op.entryId = e.id AND oa.type = 'opening_balance'
          ))`,
      );
      params.push(...accountIds);
    }
    if (cardIds.length > 0) {
      /*
       * 이 카드의 관점이다. **쓴 것과 갚은 것 둘 다** 본다. 대금 결제는 부채가 줄어드는
       * 일이라 카드 다리가 양수로 남으므로, 나간 쪽만 보면 그 줄이 통째로 빠진다.
       * 서버의 `entrySearchConditions` 와 같은 규칙이다 (그 자리에 까닭이 적혀 있다).
       */
      branches.push(`(mp.cardId IN (${cardIds.map(() => '?').join(', ')}))`);
      params.push(...cardIds);
    }
    /*
     * 결제수단을 고르지 않은 지출·수입. 미지정 계정에 붙어 있어 유형으로 찾는다.
     * 서버의 `entrySearchConditions` 와 같은 규칙이다.
     */
    if (search.noAccount) {
      branches.push(
        `EXISTS (SELECT 1 FROM account ma WHERE ma.id = mp.accountId AND ma.type = 'unassigned')`,
      );
    }

    sql += `
        AND EXISTS (
          SELECT 1 FROM posting mp
           WHERE mp.entryId = e.id AND (${branches.join(' OR ')})
        )`;
  }

  /*
   * 태그. 무리 안은 OR 다.
   *
   * 다리가 아니라 전표를 본다 -- 태그는 전표에 붙는다. 서버의 `entryTagCondition` 과
   * 같은 규칙이라, 같은 검색이 온라인과 오프라인에서 같은 목록을 낸다.
   */
  const tagIds = search.tagIds ?? [];
  if (tagIds.length > 0 || search.noTag) {
    const branches: string[] = [];

    if (tagIds.length > 0) {
      branches.push(`EXISTS (
            SELECT 1 FROM entry_tag et
             WHERE et.entryId = e.id AND et.tagId IN (${tagIds.map(() => '?').join(', ')})
          )`);
      params.push(...tagIds);
    }
    // 태그가 하나도 붙지 않은 전표. 고른 태그들과 OR 로 이어진다 (무리 안은 OR).
    if (search.noTag) {
      branches.push(`NOT EXISTS (SELECT 1 FROM entry_tag et WHERE et.entryId = e.id)`);
    }

    sql += `
        AND (${branches.join(' OR ')})`;
  }

  /*
   * 거래를 낸 사람. 전표의 personId 를 그대로 본다.
   *
   * 자산주인 필터(ownerFilter)와 다른 자리다. 그쪽은 돈이 오간 계좌의 주인을 보고,
   * 이쪽은 거래를 적을 때 고른 사람을 본다.
   */
  const entryPersonIds = search.entryPersonIds ?? [];
  if (entryPersonIds.length > 0) {
    // 미지정(`NO_PERSON`)은 사람을 비운 전표다. 고른 사람들과 OR 로 잇는다 (서버와 같다).
    const ids = entryPersonIds.filter((id) => id !== NO_PERSON);
    const branches: string[] = [];
    if (ids.length > 0) {
      branches.push(`e.personId IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    if (ids.length < entryPersonIds.length) branches.push('e.personId IS NULL');
    sql += ` AND (${branches.join(' OR ')})`;
  }

  /*
   * 설명에 든 글자. 다리가 아니라 전표를 본다 -- 설명은 전표에 있다.
   *
   * LIKE 는 아스키 대소문자를 가리지 않는다(서버의 insensitive 와 같은 자리에서 같은
   * 일을 한다). 사용자가 적은 글자 안의 `%` `_` 는 그대로 찾도록 이스케이프한다 --
   * 털어 내지 않으면 "50%"를 적은 사람이 아무 글자나 걸리는 결과를 보게 된다.
   */
  if (search.text) {
    const escaped = search.text.replace(/[\\%_]/g, (mark) => `\\${mark}`);
    sql += ` AND e.description LIKE ? ESCAPE '\\'`;
    params.push(`%${escaped}%`);
  }

  // 유형. 값이 상수뿐이라 자리표를 쓰지 않는다 (`parseEntrySearch` 가 아는 값만 남긴다).
  sql += kindFilter(search.kinds);
  // 모양(분할·할부)도 값이 상수뿐이다.
  sql += featureFilter(search.features);

  return { sql, params };
}

/**
 * 자산 주인 조건. 서버의 `assetOwnerCondition` 과 같은 규칙이다.
 *
 *   - 돈이 나간 다리(음수)의 계좌 주인을 본다. 이체는 보내는 계좌가 기준이다.
 *   - 나간 다리가 없으면(수입, 잔액 증가 조정) 들어온 다리를 본다.
 *   - 자본 계정은 주인이 없어 "나간 다리" 판단에서 제외된다(ownerId IS NOT NULL).
 *
 * 부호는 문자열의 첫 글자로 본다. 금액은 표준 십진 표기로 담기므로 음수는 언제나
 * '-' 로 시작한다. TEXT 를 숫자로 바꿔 비교하면 정밀도를 잃는 자리가 생긴다.
 */
export function ownerFilter(ownerIds?: string[]): { sql: string; params: string[] } {
  if (!ownerIds || ownerIds.length === 0) return { sql: '', params: [] };

  const list = ownerIds.map(() => '?').join(', ');
  /*
   * 돈이 나간 쪽. **0 도 여기 든다.**
   *
   * 전액을 깎은 결제는 그 통장에서 빠져나간 돈이 0 이다. 음수만 보면 나간 쪽이 없는
   * 전표가 되고, 들어온 쪽도 없어 아무에게도 속하지 않는다 -- 사람을 고른 목록에서
   * 통째로 사라진다. 서버의 `assetOwnerCondition` 과 같은 판단이다.
   *
   * 그래서 들어온 쪽은 0 을 뺀다. 양쪽이 0 을 받으면 같은 전표가 두 가지에 함께 걸려
   * 나간 쪽 주인과 들어온 쪽 주인 양쪽 목록에 나온다.
   */
  const outgoing = `(substr(op.amount, 1, 1) = '-' OR op.amount = '0')`;
  const positive = `substr(op.amount, 1, 1) != '-' AND op.amount != '0'`;

  const sql = `
        AND (
          EXISTS (
            SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
             WHERE op.entryId = e.id AND ${outgoing} AND oa.ownerId IN (${list})
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
               WHERE op.entryId = e.id AND ${outgoing} AND oa.ownerId IS NOT NULL
            )
            AND EXISTS (
              SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
               WHERE op.entryId = e.id AND ${positive} AND oa.ownerId IN (${list})
            )
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM posting op JOIN account oa ON oa.id = op.accountId
               WHERE op.entryId = e.id AND oa.ownerId IS NOT NULL
            )
            AND e.personId IN (${list})
          )
        )`;

  /*
   * 셋째 가지: 주인 있는 계좌 다리가 하나도 없으면 거래를 낸 사람으로 본다. 결제수단을
   * 고르지 않은 지출·수입이 그렇다. 서버의 `assetOwnerCondition` 과 같은 판단이다.
   */
  return { sql, params: [...ownerIds, ...ownerIds, ...ownerIds] };
}
