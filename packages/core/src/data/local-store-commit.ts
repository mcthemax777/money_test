/**
 * 로컬 커밋. 기기에서 적은 전표와 설정 한 줄을 사본에 곧바로 쓴다. 명령은 부르는 쪽이 따로 쌓는다.
 */

import { type BuiltEntry, rankAfter, zonedDateKey, zonedYearMonth } from '@money/types';

import type { SqlDriver, SqlValue } from './sql-driver';
import { mergeClocks } from './local-store-clocks';
import type { Row, SettingTable } from './local-store-types';
import { asFlag, asText } from './local-store-values';
import { dropEntryLegs, upsert } from './local-store-writes';

/**
 * 조립한 전표를 사본에 적는다. 화면은 이 값을 곧바로 본다.
 *
 * 서버의 `replaceEntry` 와 같은 방식이다 -- 다리를 통째로 갈아 끼운다. 다리 수가 바뀌는
 * 수정(수수료 추가, 분할 변경)까지 한 경로로 처리되고, 만들 때와 고칠 때의 코드가
 * 갈리지 않는다.
 *
 * 잔액(account.balance)은 건드리지 않는다. 파생값이라 동기화하지 않기로 했고(D7),
 * 기기가 여기서 증분을 더하면 서버 값이 도착할 때 드리프트가 남는다. 읽는 쪽이 그때그때
 * 다리를 세는 것이 그 자리다 (`accountBalances`) -- 세는 값에는 드리프트가 남지 않는다.
 */
export async function writeEntry(
  db: SqlDriver,
  entryId: string,
  built: BuiltEntry,
  options: {
    timeZone: string;
    hlc: string;
    makeId: () => string;
    /**
     * **거래 자체**에 붙는 태그. 분류 줄이 없는 전표에만 쓴다 (이체, 카드 대금 결제).
     *
     * 지출·수입의 태그는 조립이 줄에 실어 온다 (`BuiltPosting.tagIds`). 다리와 같이
     * 통째로 갈아 끼운다.
     */
    tagIds?: string[];
  },
): Promise<void> {
  const instant = built.date instanceof Date ? built.date : new Date(built.date);

  await db.transaction(async () => {
    await upsert(db, 'entry', {
      id: entryId,
      projectId: built.projectId,
      personId: built.personId,
      date: instant.toISOString(),
      dateKey: zonedDateKey(instant, options.timeZone),
      yearMonth: zonedYearMonth(instant, options.timeZone),
      description: built.description,
      merchant: built.merchant ?? null,
      detailedNote: built.detailedNote ?? null,
      originalCurrency: built.originalCurrency ?? null,
      originalAmount: built.originalAmount ? built.originalAmount.toString() : null,
      rateProvisional: asFlag(built.rateProvisional),
      countsPerformance: asFlag(built.countsPerformance ?? true),
      discountCountsPerformance: asFlag(built.discountCountsPerformance ?? true),
      createdByUserId: null,
      // 이 편집의 시계. 다음에 이 전표를 고칠 때 이 값보다 뒤를 발급한다.
      updatedHlc: options.hlc,
      /*
       * 번호는 0 이다. 서버가 아직 이 전표를 모르기 때문이다.
       *
       * 다음 pull 이 서버가 찍은 번호로 이 줄을 덮어쓴다. 0 을 넣어 두면 그때까지
       * "아직 서버에 없다"가 값으로 남는다.
       */
      updatedVersion: 0,
      // 페이백의 원거래. 조립이 사본에서 원거래를 찾지 못했으면 이미 비워 왔다.
      paybackOfEntryId: built.paybackOfEntryId ?? null,
      paybackOfLineKey: built.paybackOfLineKey ?? null,
      paybackType: built.paybackType ?? null,
      installmentAdjust: built.installmentAdjust ? JSON.stringify(built.installmentAdjust) : null,
    });

    await dropEntryLegs(db, entryId);

    /*
     * 태그 연결도 다리와 같이 통째로 갈아 끼운다. 주지 않으면 비운다.
     *
     * 줄에 붙는 태그는 아래 다리 고리에서 그 줄의 키로 넣는다. 여기 넣는 것은 분류
     * 줄이 없는 전표의 것뿐이다.
     */
    await db.run(`DELETE FROM entry_tag WHERE entryId = ?`, [entryId]);
    // 겹친 id 는 한 번만 (줄 키가 NULL 이라 기본 키가 겹침을 막지 못한다).
    for (const tagId of new Set(options.tagIds ?? built.tagIds ?? [])) {
      await db.run(
        `INSERT OR IGNORE INTO entry_tag (entryId, lineKey, tagId) VALUES (?, NULL, ?)`,
        [entryId, tagId],
      );
    }

    for (const posting of built.postings) {
      const postingId = options.makeId();
      await upsert(db, 'posting', {
        id: postingId,
        entryId,
        accountId: posting.accountId ?? null,
        categoryId: posting.categoryId ?? null,
        amount: posting.amount.toString(),
        quantity: posting.quantity ? posting.quantity.toString() : null,
        currency: posting.currency,
        baseAmount: posting.baseAmount.toString(),
        exchangeRate: posting.exchangeRate.toString(),
        cardId: posting.cardId ?? null,
        // 줄 키는 화면이 만든 값이다. 조립이 그대로 실어 온다.
        lineKey: posting.lineKey ?? null,
        discountAmount: posting.discountAmount ? posting.discountAmount.toString() : null,
      });

      // 이 줄에 붙는 태그. 줄 키가 있어야 가리킬 수 있다.
      if (posting.lineKey && posting.tagIds) {
        for (const tagId of posting.tagIds) {
          await db.run(
            `INSERT OR IGNORE INTO entry_tag (entryId, lineKey, tagId) VALUES (?, ?, ?)`,
            [entryId, posting.lineKey, tagId],
          );
        }
      }

      /*
       * 할부는 카드 다리에 붙는다. 서버의 `saveInstallmentPlan` 과 같은 조건이다.
       *
       * 회차 금액은 담지 않는다. 총액과 개월수에서 다시 계산되는 파생값이다 (D7).
       */
      if (
        built.installmentMonths &&
        built.installmentMonths >= 2 &&
        posting.cardId &&
        posting.amount.isNegative()
      ) {
        await upsert(db, 'installment_plan', {
          id: options.makeId(),
          postingId,
          totalMonths: built.installmentMonths,
          interestBearing: built.installmentInterest ? 1 : 0,
          // 적어 둔 회차 금액. 없으면 읽는 쪽이 개월수로 나눈다.
          principalShares: built.installmentShares ? JSON.stringify(built.installmentShares) : null,
          /*
           * 회차별 이자와 그것을 만든 입력. 유이자 할부에만 담긴다.
           *
           * 서버의 `saveInstallmentPlan` 과 같은 값이 들어가야 한다 -- 여기서 빠지면
           * 오프라인에서 적은 할부의 이자가 다음 pull 까지 화면에서 사라진다.
           */
          interestShares: built.installmentInterestShares
            ? JSON.stringify(built.installmentInterestShares)
            : null,
          monthlyPayment: built.installmentMonthlyPayment ?? null,
          annualRate: built.installmentAnnualRate ?? null,
          updatedVersion: 0,
        });
      }
    }
  });
}

/**
 * 자산 한 줄을 사본에 쓴다 (구성원·통장·카드).
 *
 * 전표와 달리 **필드별 병합**이라, 바꾼 필드의 시계만 지도에 찍는다. 그 지도를 그대로
 * 서버가 쓰는 모양(JSON 문자열)으로 담아 두어야, 다음 편집의 시계를 지금 값보다 뒤로
 * 매길 수 있다.
 *
 * 새로 만드는 경우와 고치는 경우를 한 함수로 둔다 -- 사본에 적는 일이 같고, 다른 것은
 * 아웃박스에 쌓는 명령의 종류뿐이다(그쪽은 부르는 사람이 정한다).
 */
export async function writeAsset(
  db: SqlDriver,
  table: SettingTable,
  id: string,
  values: Record<string, SqlValue>,
  hlc: string,
): Promise<void> {
  /*
   * 순서 값이 없는 표가 있다 (예산과 예산 조정). 그쪽은 목록을 드래그하지 않으므로
   * 자리를 계산할 것이 없다.
   */
  const hasRank = table !== 'budget' && table !== 'budget_override';
  /*
   * 시각 칸(createdAt·updatedAt)도 그 둘에는 없다. 서버의 예산 행이 그 값을 싣지 않아 사본의
   * 표에 칸을 두지 않았다. 적으려 들면 "no column named updatedAt" 로 쓰기가 통째로 실패한다
   * -- 앱은 온라인에서도 이 길로 적으므로, 예산 저장이 늘 실패로 보이고 명령만 큐에 남았다.
   */
  const hasTimestamps = hasRank;
  /*
   * 예산 조정에는 projectId 칸도 없다 -- 부모 예산을 거쳐 프로젝트를 찾는다 (서버 표와 같다).
   * 부르는 쪽(설정 명령)은 늘 projectId 를 실어 오므로 여기서 걸러 낸다. 그대로 두면 "no
   * column named projectId" 로 그 달 조정이 한 번도 사본에 적히지 못했다.
   */
  const { projectId: _projectId, ...ownValues } = values;
  const writable = table === 'budget_override' ? ownValues : values;

  await db.transaction(async () => {
    const rows = await db.all<Row>(
      `SELECT fieldHlc${hasRank ? ', sortRank' : ''} FROM ${table} WHERE id = ?`,
      [id],
    );
    const existing = rows[0];

    /*
     * 새 줄은 목록 맨 뒤에 붙인다. 지금 마지막 순서 뒤에 값을 하나 만든다 -- 서버가
     * 매기는 자리와 같은 규칙이라(rankAfter), 동기화 뒤에도 자리가 움직이지 않는다.
     */
    const lastRank = hasRank
      ? asText(
          (
            await db.all<Row>(
              `SELECT MAX(sortRank) AS last FROM ${table} WHERE projectId = ?`,
              [String(values.projectId ?? '')],
            )
          )[0]?.last,
        )
      : null;

    /*
     * 순서 값을 셋 중 하나로 정한다.
     *
     *   1. 명령이 자리를 옮기는 것이면 그 값 (드래그).
     *   2. 이미 있는 줄이면 지금 값 그대로 (이름만 고치는 경우).
     *   3. 새 줄이면 목록 맨 뒤 (서버의 createPerson 과 같은 규칙).
     */
    const sortRank = hasRank
      ? asText(values.sortRank) ??
        (existing ? asText(existing.sortRank) : null) ??
        rankAfter(lastRank)
      : null;

    const clocks = mergeClocks(asText(existing?.fieldHlc), Object.keys(values), hlc);
    const now = new Date().toISOString();

    const row: Record<string, SqlValue> = {
      ...writable,
      id,
      ...(hasRank ? { sortRank } : {}),
      fieldHlc: clocks,
      ...(hasTimestamps ? { updatedAt: now } : {}),
      // 아직 서버를 거치지 않은 줄이다. 다음 pull 이 진짜 번호로 덮는다.
      updatedVersion: 0,
    };

    /*
     * 이미 있는 줄은 **덮어쓰지 않고 고친다.**
     *
     * 고치기 명령은 바꾼 필드만 들고 온다(필드별 병합). 그것을 통째로 넣으려 들면
     * 담기지 않은 NOT NULL 컬럼이 비어 실패한다 -- upsert 의 INSERT 시도가 먼저
     * 검사에 걸린다.
     */
    if (existing) {
      /*
       * 번호(updatedVersion)는 그대로 둔다. 0 은 "서버가 아직 모르는 줄"이라는 뜻이고 계좌에서는
       * 잔액 칸을 기초 잔액 씨앗으로 다시 세게 한다(`openingSeed`). 예전에는 고칠 때마다 0 을 적어,
       * 서버가 아는 통장의 이름만 바꿔도 기초 잔액이 한 번 더 더해져 잔액이 두 배로 보였다.
       */
      const columns = Object.keys(row).filter((column) => column !== 'id' && column !== 'updatedVersion');
      await db.run(
        `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
        [...columns.map((column) => row[column]), id],
      );
      return;
    }

    await upsert(
      db,
      table,
      hasTimestamps ? { ...row, createdAt: asText(values.createdAt) ?? now } : row,
    );
  });
}
