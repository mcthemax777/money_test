/**
 * 전표 줄에 다리·태그·할부·페이백을 붙여 목록 화면이 쓰는 모양(`ViewEntry`)으로 만든다.
 */

import { type EntryTag, type ViewEntry, type ViewPosting, shareListOf } from '@money/types';

import type { SqlDriver } from './sql-driver';
import type { Row } from './local-store-types';
import { asInt, asMoney, asText } from './local-store-values';

/** 전표 목록에 그 다리와 태그를 붙인다. */
export async function attachPostings(db: SqlDriver, entries: Row[]): Promise<ViewEntry[]> {
  if (entries.length === 0) return [];

  const ids = entries.map((entry) => String(entry.id));
  const placeholders = ids.map(() => '?').join(', ');
  const postings = await db.all<Row>(
    `SELECT po.*,
            a.id AS accountRowId, a.name AS accountName, a.type AS accountType,
            c.id AS categoryRowId, c.name AS categoryName, c.type AS categoryType,
            c.parentId AS categoryParentId, parent.name AS categoryParentName,
            cd.id AS cardRowId, cd.name AS cardName,
            ip.totalMonths AS installmentMonths, ip.interestBearing AS installmentInterest,
            ip.principalShares AS installmentShares, ip.interestShares AS installmentInterestShares,
            ip.monthlyPayment AS installmentMonthlyPayment, ip.annualRate AS installmentAnnualRate
       FROM posting po
       LEFT JOIN account a ON a.id = po.accountId
       LEFT JOIN category c ON c.id = po.categoryId
       LEFT JOIN category parent ON parent.id = c.parentId
       LEFT JOIN card cd ON cd.id = po.cardId
       LEFT JOIN installment_plan ip ON ip.postingId = po.id
      WHERE po.entryId IN (${placeholders})`,
    ids,
  );

  /*
   * 태그도 한 번에 읽어 붙인다.
   *
   * 이름을 아직 받지 못한 연결은 조인이 비어 빠진다. 지운 태그는 연결도 함께 사라져
   * 여기에 오지 않는다.
   */
  const tagRows = await db.all<Row>(
    `SELECT et.entryId, et.lineKey, t.id, t.name, t.color
       FROM entry_tag et
       JOIN tag t ON t.id = et.tagId
      WHERE et.entryId IN (${placeholders})
      ORDER BY t.sortRank, t.name`,
    ids,
  );

  type TagLink = EntryTag & { lineKey: string | null };
  const tagsByEntry = new Map<string, TagLink[]>();
  for (const row of tagRows) {
    const list = tagsByEntry.get(String(row.entryId)) ?? [];
    list.push({
      id: String(row.id),
      name: String(row.name),
      color: asText(row.color),
      // 어느 줄의 태그인지. 비어 있으면 거래 자체의 것이다.
      lineKey: asText(row.lineKey),
    });
    tagsByEntry.set(String(row.entryId), list);
  }

  const byEntry = new Map<string, ViewPosting[]>();
  for (const row of postings) {
    const list = byEntry.get(String(row.entryId)) ?? [];
    list.push({
      id: String(row.id),
      accountId: asText(row.accountId),
      categoryId: asText(row.categoryId),
      amount: asMoney(row.amount),
      currency: String(row.currency),
      exchangeRate: asMoney(row.exchangeRate),
      baseAmount: asMoney(row.baseAmount),
      cardId: asText(row.cardId),
      lineKey: asText(row.lineKey),
      discountAmount: asText(row.discountAmount),
      account: row.accountRowId
        ? {
            id: String(row.accountRowId),
            name: String(row.accountName),
            type: String(row.accountType) as ViewPosting['account'] extends null
              ? never
              : NonNullable<ViewPosting['account']>['type'],
          }
        : null,
      category: row.categoryRowId
        ? {
            id: String(row.categoryRowId),
            name: String(row.categoryName),
            type: String(row.categoryType) as NonNullable<ViewPosting['category']>['type'],
            parentId: asText(row.categoryParentId),
            parent: row.categoryParentId
              ? { id: String(row.categoryParentId), name: String(row.categoryParentName) }
              : null,
          }
        : null,
      card: row.cardRowId ? { id: String(row.cardRowId), name: String(row.cardName) } : null,
      // 할부가 걸리지 않은 다리는 조인이 비어 null 이 된다.
      installmentPlan:
        row.installmentMonths == null
          ? null
          : {
              totalMonths: asInt(row.installmentMonths),
              interestBearing: Boolean(row.installmentInterest),
              principalShares: shareListOf(row.installmentShares),
              interestShares: shareListOf(row.installmentInterestShares),
              monthlyPayment: asText(row.installmentMonthlyPayment),
              annualRate: asText(row.installmentAnnualRate),
            },
    });
    byEntry.set(String(row.entryId), list);
  }

  /*
   * 페이백이 가리키는 원거래의 날짜. 분석 화면이 그 날짜로 센다 (`EntryListItem.paybackOfDate`).
   * 원거래가 사본에 없으면 비운다 -- 링크가 빈 페이백과 같게 읽힌다.
   */
  const originIds = [
    ...new Set(entries.map((entry) => asText(entry.paybackOfEntryId)).filter((id): id is string => !!id)),
  ];
  const originDates = new Map(
    originIds.length === 0
      ? []
      : (
          await db.all<Row>(
            `SELECT id, date FROM entry WHERE id IN (${originIds.map(() => '?').join(', ')})`,
            originIds,
          )
        ).map((row) => [String(row.id), String(row.date)] as const),
  );

  /*
   * 할부 원거래에 걸린 할부 환불. 회차 기준의 목록이 회차 몫에서 뺀다 (installment-refund).
   * 서버의 ENTRY_INCLUDE.paybacks 와 같은 값이다.
   */
  const entryIds = entries.map((entry) => String(entry.id));
  const cutsByOrigin = new Map<string, Array<{ id: string; paybackOfLineKey: string | null; installmentAdjust: unknown }>>();
  for (let index = 0; index < entryIds.length; index += 500) {
    const chunk = entryIds.slice(index, index + 500);
    const rows = await db.all<Row>(
      `SELECT id, paybackOfEntryId, paybackOfLineKey, installmentAdjust FROM entry
        WHERE installmentAdjust IS NOT NULL
          AND paybackOfEntryId IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    );
    for (const row of rows) {
      const origin = String(row.paybackOfEntryId);
      const list = cutsByOrigin.get(origin) ?? [];
      list.push({
        id: String(row.id),
        paybackOfLineKey: asText(row.paybackOfLineKey),
        installmentAdjust: asText(row.installmentAdjust),
      });
      cutsByOrigin.set(origin, list);
    }
  }

  return entries.map((entry) => ({
    id: String(entry.id),
    date: String(entry.date),
    description: String(entry.description),
    merchant: asText(entry.merchant),
    detailedNote: asText(entry.detailedNote),
    personId: asText(entry.personId),
    person: entry.personName ? { name: String(entry.personName) } : null,
    originalCurrency: asText(entry.originalCurrency),
    originalAmount: asText(entry.originalAmount),
    rateProvisional: Boolean(entry.rateProvisional),
    countsPerformance: Boolean(entry.countsPerformance),
    discountCountsPerformance: Boolean(entry.discountCountsPerformance),
    // 목록 한 줄에 실린다. 서버 창구를 쓰는 화면이 수정할 때 이 값을 되돌려 준다.
    updatedHlc: asText(entry.updatedHlc),
    paybackOfEntryId: asText(entry.paybackOfEntryId),
    paybackOfLineKey: asText(entry.paybackOfLineKey),
    paybackType: asText(entry.paybackType),
    paybackOf: (() => {
      const origin = asText(entry.paybackOfEntryId);
      const date = origin ? originDates.get(origin) : undefined;
      return date ? { date } : null;
    })(),
    installmentAdjust: asText(entry.installmentAdjust),
    paybackCuts: cutsByOrigin.get(String(entry.id)) ?? [],
    postings: byEntry.get(String(entry.id)) ?? [],
    tags: tagsByEntry.get(String(entry.id)) ?? [],
  }));
}
