/**
 * 변경 피드(`GET /sync/pull`)의 응답을 사본에 적는다.
 */

import { FIRST_RANK, SyncDto, zonedDateKey, zonedYearMonth } from '@money/types';

import type { SqlDriver } from './sql-driver';
import type { Row } from './local-store-types';
import { recurringRow } from './local-store-mappers';
import { TOMBSTONE_TABLES } from './local-store-schema-shape';
import { asFlag, asInt, asIso, asJson, asMoney, asText, placeholders } from './local-store-values';
import { forgetRow, upsert } from './local-store-writes';

/**
 * 변경 피드의 응답을 사본에 적는다.
 *
 * 한 트랜잭션 안에서 행을 넣고 커서를 올린다. 반쯤 적용한 뒤 커서가 올라가면,
 * 기기는 받지 못한 변경을 "이미 본 번호"로 여겨 영원히 다시 받지 못한다.
 *
 * 타임존을 받는 것은 달력 키를 그때 계산해 넣기 때문이다.
 */
export async function applyPull(
  db: SqlDriver,
  response: SyncDto.PullResponse,
  timeZone: string,
): Promise<void> {
  const { projectId, changes, tombstones, version } = response;

  await db.transaction(async () => {
    const project = changes.project as Row | null;
    if (project) {
      await upsert(db, 'project', {
        id: String(project.id),
        name: asText(project.name) ?? '',
        projectKey: asText(project.projectKey),
        description: asText(project.description),
        ledgerCurrency: asText(project.ledgerCurrency) ?? 'KRW',
        displayCurrency: asText(project.displayCurrency) ?? 'KRW',
        timezone: asText(project.timezone) ?? timeZone,
        updatedVersion: asInt(project.updatedVersion),
      });
    }

    for (const row of changes.members as Row[]) {
      await upsert(db, 'member', {
        id: String(row.id),
        projectId,
        userId: String(row.userId),
        role: String(row.role),
        personId: asText(row.personId),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.people as Row[]) {
      await upsert(db, 'person', {
        id: String(row.id),
        projectId,
        name: asText(row.name) ?? '',
        relationship: asText(row.relationship),
        isActive: asFlag(row.isActive),
        sortRank: asText(row.sortRank) ?? FIRST_RANK,
        fieldHlc: asJson(row.fieldHlc),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.accounts as Row[]) {
      await upsert(db, 'account', {
        id: String(row.id),
        projectId,
        ownerId: asText(row.ownerId),
        type: String(row.type),
        name: asText(row.name) ?? '',
        institutionId: asText(row.institutionId),
        accountNumber: asText(row.accountNumber),
        matchText: asText(row.matchText),
        maturityDate: asText(row.maturityDate),
        currency: asText(row.currency) ?? 'KRW',
        balance: asMoney(row.balance),
        isActive: asFlag(row.isActive),
        sortRank: asText(row.sortRank) ?? FIRST_RANK,
        fieldHlc: asJson(row.fieldHlc),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.categories as Row[]) {
      await upsert(db, 'category', {
        id: String(row.id),
        projectId,
        name: asText(row.name) ?? '',
        parentId: asText(row.parentId),
        type: String(row.type),
        icon: asText(row.icon),
        isDefault: asFlag(row.isDefault),
        sortRank: asText(row.sortRank) ?? FIRST_RANK,
        fieldHlc: asJson(row.fieldHlc),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of (changes.tags ?? []) as Row[]) {
      await upsert(db, 'tag', {
        id: String(row.id),
        projectId,
        name: asText(row.name) ?? '',
        color: asText(row.color),
        sortRank: asText(row.sortRank) ?? FIRST_RANK,
        fieldHlc: asJson(row.fieldHlc),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.cards as Row[]) {
      await upsert(db, 'card', {
        id: String(row.id),
        projectId,
        paymentAccountId: String(row.paymentAccountId),
        liabilityAccountId: asText(row.liabilityAccountId),
        name: asText(row.name) ?? '',
        cardType: String(row.cardType),
        issuerId: String(row.issuerId),
        cardNumber: asText(row.cardNumber),
        creditLimit: asText(row.creditLimit),
        performanceAmount: asText(row.performanceAmount),
        statementClosingDay: row.statementClosingDay == null ? null : asInt(row.statementClosingDay),
        paymentDueDay: row.paymentDueDay == null ? null : asInt(row.paymentDueDay),
        color: asText(row.color),
        matchText: asText(row.matchText),
        expiryDate: asText(row.expiryDate),
        isActive: asFlag(row.isActive),
        sortRank: asText(row.sortRank) ?? FIRST_RANK,
        fieldHlc: asJson(row.fieldHlc),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const entry of changes.entries) {
      const row = entry as unknown as Row;
      const date = asIso(row.date);
      const instant = new Date(date);

      await upsert(db, 'entry', {
        id: String(row.id),
        projectId,
        // 미지정 거래는 사람이 null 로 온다.
        personId: asText(row.personId),
        date,
        // 프로젝트 타임존의 달력 키를 여기서 박아 둔다.
        dateKey: zonedDateKey(instant, timeZone),
        yearMonth: zonedYearMonth(instant, timeZone),
        description: asText(row.description) ?? '',
        merchant: asText(row.merchant),
        detailedNote: asText(row.detailedNote),
        originalCurrency: asText(row.originalCurrency),
        originalAmount: asText(row.originalAmount),
        rateProvisional: asFlag(row.rateProvisional),
        /*
         * 값이 없으면 센 것으로 본다.
         *
         * 서버가 이 필드를 알기 전에 앱이 먼저 올라갈 수 있고, 그때 응답에는 이 칸이
         * 아예 없다. `asFlag(undefined)` 는 0 이라, 그대로 두면 모든 카드 거래가
         * 실적에서 빠져 사용액이 0원으로 보인다 (2026-09-17 에 실기기에서 겪었다).
         */
        countsPerformance: asFlag(row.countsPerformance ?? true),
        // 같은 까닭으로 기본값을 둔다. 값이 없으면 차감이 실적도 깎던 그때의 규칙이다.
        discountCountsPerformance: asFlag(row.discountCountsPerformance ?? true),
        createdByUserId: asText(row.createdByUserId),
        updatedHlc: asText(row.updatedHlc),
        updatedVersion: asInt(row.updatedVersion),
        // 페이백의 원거래. 서버가 원거래를 지우면 비워서 다시 보낸다(SET NULL 이 번호를 올린다).
        paybackOfEntryId: asText(row.paybackOfEntryId),
        paybackOfLineKey: asText(row.paybackOfLineKey),
        paybackType: asText(row.paybackType),
        // 할부 환불이 줄인 회차. 서버는 JSON 으로 보내고 사본은 글자로 든다.
        installmentAdjust: asJson(row.installmentAdjust),
      });

      /*
       * 전표가 오면 그 다리를 통째로 갈아 끼운다. 다리 수가 바뀌는 수정도 이 한
       * 경로로 처리된다.
       *
       * 옛 다리에 걸린 할부 계획은 **새로 온 다리에 없는 것만** 지운다. 서버의 replaceEntry
       * 는 다리를 지우고 다시 만들면서 계획을 cascade 로 지우고 새로 만들어, 새 계획이 새
       * 다리 id 를 달고 이 응답에 함께 실려 온다(그래서 아래 installmentPlans 를 전표보다
       * 뒤에 적용한다). 반대로 태그 손보기·페이백 링크·할부 환불처럼 **다리는 그대로 두고
       * 전표의 번호만 올리는** 변경에서는 계획이 다시 오지 않는다. 그때 통째로 지우면 사본의
       * 할부가 일시불로 남는다 (2026-10-08 실기기에서 태그를 바꾼 할부가 원거래만 남았다).
       */
      const incomingPostingIds = ((entry.postings ?? []) as Row[]).map((posting) =>
        String(posting.id),
      );
      await db.run(
        `DELETE FROM installment_plan
          WHERE postingId IN (SELECT id FROM posting WHERE entryId = ?)
            AND postingId NOT IN (${incomingPostingIds.length > 0 ? placeholders(incomingPostingIds.length) : "''"})`,
        [String(row.id), ...incomingPostingIds],
      );
      await db.run(`DELETE FROM posting WHERE entryId = ?`, [String(row.id)]);

      /*
       * 태그 연결도 다리와 같이 통째로 갈아 끼운다.
       *
       * 이 표에는 번호가 없어 따로 도착하지 않는다. 전표에 실려 온 목록이 곧 그
       * 전표의 태그 전부다. 없으면 비운다.
       */
      await db.run(`DELETE FROM entry_tag WHERE entryId = ?`, [String(row.id)]);
      for (const link of (entry.tagLinks ?? []) as Row[]) {
        // `upsert` 는 id 하나를 열쇠로 본다. 이 표의 열쇠는 세 컬럼이라 직접 넣는다.
        await db.run(
          `INSERT OR IGNORE INTO entry_tag (entryId, lineKey, tagId) VALUES (?, ?, ?)`,
          [String(row.id), asText(link.lineKey), String(link.tagId)],
        );
      }
      for (const posting of (entry.postings ?? []) as Row[]) {
        await upsert(db, 'posting', {
          id: String(posting.id),
          entryId: String(row.id),
          accountId: asText(posting.accountId),
          categoryId: asText(posting.categoryId),
          amount: asMoney(posting.amount),
          quantity: asText(posting.quantity),
          currency: asText(posting.currency) ?? 'KRW',
          baseAmount: asMoney(posting.baseAmount),
          exchangeRate: asMoney(posting.exchangeRate),
          cardId: asText(posting.cardId),
          // 줄에 달린 것. 태그와 차감이 이 줄의 사실이다.
          lineKey: asText(posting.lineKey),
          discountAmount: asText(posting.discountAmount),
        });
      }
    }

    for (const row of changes.budgets as Row[]) {
      await upsert(db, 'budget', {
        id: String(row.id),
        projectId,
        categoryId: asText(row.categoryId),
        tagId: asText(row.tagId),
        type: asText(row.type),
        monthlyAmount: asMoney(row.monthlyAmount),
        effectiveFrom: asText(row.effectiveFrom),
        effectiveTo: asText(row.effectiveTo),
        fieldHlc: asJson(row.fieldHlc),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.budgetOverrides as Row[]) {
      await upsert(db, 'budget_override', {
        id: String(row.id),
        budgetId: String(row.budgetId),
        year: asInt(row.year),
        month: asInt(row.month),
        amount: asMoney(row.amount),
        fieldHlc: asJson(row.fieldHlc),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    for (const row of changes.exchangeRates as Row[]) {
      /*
       * 같은 (쌍, 날짜)의 줄은 하나다 (서버의 유일성). 오프라인에서 넣은 환율은 기기가 정한 id 로
       * 적히는데 서버는 제 id 로 받아 들인다. 그 줄을 지우지 않으면 서버 줄과 나란히 남고, 서버가
       * 그 쌍을 지워도 기기 id 에는 자리표가 오지 않아 옛 환율로 영영 환산했다.
       */
      await db.run(
        `DELETE FROM exchange_rate
          WHERE projectId = ? AND baseCurrency = ? AND quoteCurrency = ? AND date = ? AND id <> ?`,
        [projectId, String(row.baseCurrency), String(row.quoteCurrency), asIso(row.date).slice(0, 10), String(row.id)],
      );
      await upsert(db, 'exchange_rate', {
        id: String(row.id),
        projectId,
        baseCurrency: String(row.baseCurrency),
        quoteCurrency: String(row.quoteCurrency),
        rate: asMoney(row.rate),
        date: asIso(row.date).slice(0, 10),
        source: asText(row.source) ?? 'manual',
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    /*
     * 서버가 아직 이 표를 보내지 않을 수 있다. 앱이 서버보다 먼저 올라가는 배포
     * 순서에서 그렇다. 그때는 이 표만 비워 두고 나머지 동기화는 그대로 돈다.
     */
    for (const row of (changes.assetValuations ?? []) as Row[]) {
      await upsert(db, 'asset_valuation', {
        id: String(row.id),
        accountId: String(row.accountId),
        // 날짜만 쓴다. 최신 한 건을 고르는 비교가 문자열 정렬이라 자릿수가 같아야 한다.
        date: asIso(row.date).slice(0, 10),
        quantity: asMoney(row.quantity),
        price: asMoney(row.price),
        marketValue: asMoney(row.marketValue),
        source: asText(row.source) ?? 'manual',
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    // 전표보다 반드시 뒤다. 위의 전표 교체가 옛 다리의 계획을 지우기 때문이다.
    /*
     * 보관함의 후보.
     *
     * 사본에 이미 있는 행을 덮어쓴다. 후보에는 필드별 병합이 없고(서버 주석 참고)
     * 서버 값이 곧 최신이다. 다만 아직 서버에 알리지 못한 일(draft_op)이 있으면
     * 그 후보는 건드리지 않는다 -- 덮어쓰면 오프라인에서 등록한 것이 대기로
     * 되살아나 같은 거래를 두 번 적게 된다.
     */
    for (const row of (changes.recurringRules ?? []) as Row[]) {
      await upsert(db, 'recurring_rule', recurringRow(projectId, row));
    }

    /*
     * 공휴일은 통째로 갈아 끼운다. 싣지 않은 응답(옛 서버, 서비스를 직접 부른 검사)이면
     * 들고 있던 것을 그대로 둔다 -- 비우면 휴일 처리가 있는 반복의 예정일이 틀어진다.
     */
    if (response.publicHolidays) {
      await db.run(`DELETE FROM public_holiday WHERE projectId = ?`, [projectId]);
      for (const date of response.publicHolidays) {
        await db.run(
          `INSERT OR IGNORE INTO public_holiday (projectId, date) VALUES (?, ?)`,
          [projectId, date],
        );
      }
    }

    for (const row of (changes.entryDrafts ?? []) as Row[]) {
      const id = String(row.id);
      if (await hasDraftOp(db, id)) continue;

      await upsert(db, 'entry_draft', {
        id,
        projectId,
        source: String(row.source),
        status: String(row.status ?? 'pending'),
        rawText: asText(row.rawText) ?? '',
        appPackage: asText(row.appPackage),
        appTitle: asText(row.appTitle),
        kind: asText(row.kind),
        amount: asText(row.amount),
        currency: asText(row.currency),
        occurredAt: row.occurredAt == null ? null : asIso(row.occurredAt),
        merchant: asText(row.merchant),
        description: asText(row.description),
        installmentMonths: row.installmentMonths == null ? null : asInt(row.installmentMonths),
        personId: asText(row.personId),
        categoryId: asText(row.categoryId),
        accountId: asText(row.accountId),
        toAccountId: asText(row.toAccountId),
        feeAmount: asText(row.feeAmount),
        feeCategoryId: asText(row.feeCategoryId),
        cardId: asText(row.cardId),
        confidence: asInt(row.confidence),
        parser: asText(row.parser),
        dedupeKey: asText(row.dedupeKey) ?? '',
        registeredEntryId: asText(row.registeredEntryId),
        recurringRuleId: asText(row.recurringRuleId),
        createdByName: asText(row.createdByName),
        deviceName: asText(row.deviceName),
        createdAt: asIso(row.createdAt),
        updatedAt: asIso(row.updatedAt),
        updatedVersion: asInt(row.updatedVersion),
      });

      /*
       * 태그 연결도 전표와 같이 통째로 갈아 끼운다.
       *
       * 이 표에는 번호가 없어 따로 도착하지 않는다. 후보에 실려 온 목록이 곧 그
       * 후보의 태그 전부다. 없으면 비운다.
       */
      await db.run(`DELETE FROM entry_draft_tag WHERE draftId = ?`, [String(row.id)]);
      for (const tagId of (row.tagIds ?? []) as string[]) {
        await db.run(`INSERT OR IGNORE INTO entry_draft_tag (draftId, tagId) VALUES (?, ?)`, [
          String(row.id),
          String(tagId),
        ]);
      }
    }

    for (const row of (changes.installmentPlans ?? []) as Row[]) {
      /*
       * 같은 다리에 남아 있던 옛 계획을 먼저 치운다. 위에서 살아남은 다리의 계획은 남겨
       * 두므로, 서버가 그 다리에 계획을 새 id 로 다시 만들었으면 다리당 하나라는 색인
       * (`plan_posting_idx`)에 걸린다.
       */
      await db.run(`DELETE FROM installment_plan WHERE postingId = ? AND id <> ?`, [
        String(row.postingId),
        String(row.id),
      ]);
      await upsert(db, 'installment_plan', {
        id: String(row.id),
        postingId: String(row.postingId),
        totalMonths: asInt(row.totalMonths),
        interestBearing: asFlag(row.interestBearing),
        // JSON 배열을 글자 그대로 담는다. 읽는 쪽이 편다.
        principalShares: row.principalShares == null ? null : JSON.stringify(row.principalShares),
        interestShares: row.interestShares == null ? null : JSON.stringify(row.interestShares),
        // 금액은 글자로 담는다. Decimal 을 숫자로 바꾸면 원 단위가 흔들린다.
        monthlyPayment: row.monthlyPayment == null ? null : String(row.monthlyPayment),
        annualRate: row.annualRate == null ? null : String(row.annualRate),
        updatedVersion: asInt(row.updatedVersion),
      });
    }

    // 자리표. 표 이름은 서버 표 이름 그대로 온다.
    for (const tombstone of tombstones) {
      const table = TOMBSTONE_TABLES[tombstone.entity];
      if (!table) continue;
      await forgetRow(db, table, tombstone.entityId);
    }

    await db.run(
      `UPDATE sync_state SET version = ?, timeZone = ?, syncedAt = ? WHERE projectId = ?`,
      [version, timeZone, new Date().toISOString(), projectId],
    );
  });
}

/** 이 후보에 아직 못 보낸 처리가 있는가. 델타를 덮어쓸지 가리는 값이다. */
async function hasDraftOp(db: SqlDriver, draftId: string): Promise<boolean> {
  const rows = await db.all<Row>(
    `SELECT draftId FROM draft_op WHERE draftId = ? LIMIT 1`,
    [draftId],
  );
  return rows.length > 0;
}
