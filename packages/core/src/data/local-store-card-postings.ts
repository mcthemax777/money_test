/**
 * 카드 사용 다리. 주기별 사용액·실적·청구 내역이 읽는 재료다.
 */

import { cardDiscountOf, cardRefundCutsOf, shareListOf } from '@money/types';

import type { SqlDriver } from './sql-driver';
import type { Row, StoredCardLedgerPosting, StoredCardPosting } from './local-store-types';
import { asInt, asMoney, asText, placeholders } from './local-store-values';

/**
 * 카드 다리 한 줄. 실적을 되살릴 차감액을 줄들에서 더해 붙인다.
 *
 * 깎인 금액은 줄마다 적히므로(`posting.discountAmount`) 그 합이 이 결제의 차감액이다.
 * 차감액은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 둘이 갈리는 거래(원화
 * 카드로 한 외화 결제)에서는 더할 수 없어 되살리지 않는다 -- 서버의 `performanceDiscount`
 * 와 한 규칙이다.
 */
const toCardPosting = (row: Row, legs: readonly Row[]): StoredCardPosting => {
  return {
    amount: asMoney(row.amount),
    date: String(row.date),
    installmentMonths: row.totalMonths == null ? null : Number(row.totalMonths),
    installmentShares: shareListOf(row.principalShares),
    installmentInterestShares: shareListOf(row.interestShares),
    countsPerformance: Boolean(row.countsPerformance),
    // 더하는 규칙은 서버 카드 원장과 함께 쓴다 (`cardDiscountOf`). 다리는 분류 줄만 읽어 온다(`usageLegs`).
    discountAmount: cardDiscountOf(asText(row.originalCurrency), legs.map((leg) => asText(leg.discountAmount))),
    discountCountsPerformance: Boolean(row.discountCountsPerformance ?? 1),
    ...cardRefundFields(row),
  };
};

/**
 * 할부 환불이 청구와 실적에 주는 것. 규칙은 서버 카드 원장과 함께 쓴다 (`cardRefundCutsOf`).
 * 걸린 환불의 조정은 레코드 구분자(30)로 이어 붙인 한 칸으로 온다.
 */
function cardRefundFields(row: Row): Pick<StoredCardPosting, 'installmentCuts' | 'refundCut'> {
  return cardRefundCutsOf({
    refundAdjust: asText(row.refundAdjust),
    months: row.totalMonths == null ? null : asInt(row.totalMonths),
    refunds: String(row.installmentCuts ?? '').split(String.fromCharCode(30)).filter(Boolean),
  });
}

/**
 * 신용카드로 쓴 다리. 부채 계정에 걸린 것만 본다.
 *
 * 카테고리 다리가 하나도 없는 전표는 뺀다. 대금 결제와 잔액 조정이 그런 전표인데,
 * 그것은 사용이 아니라 갚은 것이라 주기 사용액에 들면 안 된다 (서버의 같은 조건).
 *
 * 구간을 자르지 않는다. 서버는 질의 비용 때문에 최장 할부만큼 앞에서 자르지만, 사본은
 * 기기 안에 있고 집계 함수가 표시 범위 밖의 주기를 어차피 버린다.
 */
export async function creditCardPostings(
  db: SqlDriver,
  liabilityAccountId: string,
): Promise<StoredCardPosting[]> {
  const rows = await db.all<Row>(
    /*
     * 실적에서 뺀 거래도 함께 읽는다. 나누는 일은 집계(`creditUsagePeriods`)가 한다.
     *
     * 여기서 걸러 버리면 청구액 그래프가 남은 대금과 어긋난다 -- 청구는 되었는데
     * 그래프에는 없는 돈이 생긴다.
     */
    `SELECT p.amount, p.entryId, e.date, e.originalCurrency,
            e.countsPerformance, e.discountCountsPerformance,
            e.installmentAdjust AS refundAdjust,
            (SELECT group_concat(r.installmentAdjust, char(30)) FROM entry r
              WHERE r.paybackOfEntryId = e.id AND r.installmentAdjust IS NOT NULL) AS installmentCuts,
            ip.totalMonths, ip.principalShares, ip.interestShares
       FROM posting p
       JOIN entry e ON e.id = p.entryId
       LEFT JOIN installment_plan ip ON ip.postingId = p.id
      WHERE p.accountId = ?
        AND EXISTS (SELECT 1 FROM posting c WHERE c.entryId = e.id AND c.categoryId IS NOT NULL)`,
    [liabilityAccountId],
  );
  const legs = await usageLegs(db, rows.map((row) => String(row.entryId)));
  return rows.map((row) => toCardPosting(row, legs.get(String(row.entryId)) ?? []));
}

/**
 * 체크카드로 쓴 다리.
 *
 * 연결 통장의 다리에 cardId 가 함께 찍힌다. 통장에서 직접 나간 지출에는 cardId 가
 * 없으므로 이 조건만으로 이 카드로 쓴 것만 걸린다.
 */
export async function debitCardPostings(
  db: SqlDriver,
  cardId: string,
): Promise<StoredCardPosting[]> {
  const rows = await db.all<Row>(
    `SELECT p.amount, p.entryId, e.date, e.originalCurrency,
            e.countsPerformance, e.discountCountsPerformance,
            e.installmentAdjust AS refundAdjust,
            (SELECT group_concat(r.installmentAdjust, char(30)) FROM entry r
              WHERE r.paybackOfEntryId = e.id AND r.installmentAdjust IS NOT NULL) AS installmentCuts,
            NULL AS totalMonths, NULL AS principalShares, NULL AS interestShares
       FROM posting p
       JOIN entry e ON e.id = p.entryId
      WHERE p.cardId = ?`,
    [cardId],
  );
  const legs = await usageLegs(db, rows.map((row) => String(row.entryId)));
  return rows.map((row) => toCardPosting(row, legs.get(String(row.entryId)) ?? []));
}

/**
 * 실적 원장의 재료. 주기별 사용액이 읽는 다리에 화면에 적을 것을 붙여 준다.
 *
 * 신용카드는 부채 계정의 다리를, 체크카드는 그 카드가 찍힌 다리를 읽는다. 고르는
 * 조건은 위의 두 질의와 같아야 한다 -- 실적 표와 그래프가 다른 거래를 세면 목록의
 * 합과 진행률 막대가 갈린다.
 */
export async function cardLedgerPostings(
  db: SqlDriver,
  input: { liabilityAccountId?: string | null; cardId?: string | null },
): Promise<StoredCardLedgerPosting[]> {
  const credit = Boolean(input.liabilityAccountId);
  const rows = await db.all<Row>(
    `SELECT p.id AS postingId, p.amount, e.id AS entryId, e.date, e.description, e.merchant,
            e.countsPerformance, e.discountCountsPerformance, e.originalCurrency,
            e.installmentAdjust AS refundAdjust,
            (SELECT group_concat(r.installmentAdjust, char(30)) FROM entry r
              WHERE r.paybackOfEntryId = e.id AND r.installmentAdjust IS NOT NULL) AS installmentCuts,
            ${
              credit
                ? 'ip.totalMonths, ip.principalShares, ip.interestShares'
                : 'NULL AS totalMonths, NULL AS principalShares, NULL AS interestShares'
            },
            cat.name AS categoryName, parent.name AS parentCategoryName
       FROM posting p
       JOIN entry e ON e.id = p.entryId
       ${credit ? 'LEFT JOIN installment_plan ip ON ip.postingId = p.id' : ''}
       /*
        * 대표 분류. 형제 다리에 붙어 있어 한 줄만 보아서는 알 수 없다.
        * 분할이면 첫 다리를 대표로 삼는다 (서버의 ledgerRowCategory 와 같은 규칙).
        */
       LEFT JOIN posting cp
         ON cp.id = (SELECT c.id FROM posting c
                      WHERE c.entryId = e.id AND c.categoryId IS NOT NULL
                      ORDER BY c.id LIMIT 1)
       LEFT JOIN category cat ON cat.id = cp.categoryId
       LEFT JOIN category parent ON parent.id = cat.parentId
      WHERE ${credit ? 'p.accountId = ?' : 'p.cardId = ?'}
        ${credit ? 'AND cp.id IS NOT NULL' : ''}
      ORDER BY e.date, p.id`,
    [credit ? String(input.liabilityAccountId) : String(input.cardId)],
  );

  const legs = await usageLegs(db, rows.map((row) => String(row.entryId)));
  return rows.map((row) => ({
    ...toCardPosting(row, legs.get(String(row.entryId)) ?? []),
    postingId: String(row.postingId),
    entryId: String(row.entryId),
    description: asText(row.description) ?? '',
    merchant: asText(row.merchant),
    categoryName: asText(row.categoryName),
    parentCategoryName: asText(row.parentCategoryName),
  }));
}

/**
 * 그 전표들의 분류 줄에 적힌 차감액. 실적을 정가로 되살릴 때 쓴다.
 *
 * 깎인 금액은 줄마다 적히므로(분할의 한 줄만 환불될 수 있다) 한 번에 읽어 전표별로
 * 묶는다. 서버도 같은 것을 `USAGE_LEG_SELECT` 로 함께 읽는다.
 */
async function usageLegs(db: SqlDriver, entryIds: readonly string[]): Promise<Map<string, Row[]>> {
  const unique = [...new Set(entryIds)];
  if (unique.length === 0) return new Map();

  const rows = await db.all<Row>(
    `SELECT entryId, discountAmount
       FROM posting
      WHERE entryId IN (${placeholders(unique.length)}) AND categoryId IS NOT NULL
      ORDER BY id`,
    [...unique],
  );

  const byEntry = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byEntry.get(String(row.entryId)) ?? [];
    list.push(row);
    byEntry.set(String(row.entryId), list);
  }
  return byEntry;
}
