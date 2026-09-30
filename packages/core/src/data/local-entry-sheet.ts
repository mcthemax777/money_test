/**
 * 엑셀 가져오기·내보내기의 사본 창구. 끊겨 있어도 된다.
 *
 * **가져오기**는 이름표를 사본에서 읽고(`entrySheetCatalog`), 없는 것과 거래를 지금 꽂힌
 * 쓰기 창구로 만든다 -- 사람이 손으로 만들 때와 같은 오프라인 명령이 쌓이고, 연결되면
 * 서버가 같은 검사로 재생한다. 끊긴 동안 다른 기기가 같은 이름을 만들었으면 그 명령이
 * 거절되어 대기 화면의 보류 칸에 남는다 (손으로 만든 것과 같다).
 *
 * 카드사는 사본에 없다. 새 카드의 카드사는 받아 둔 목록에서 이름으로 찾고, "기타
 * 카드사"를 새로 만들어야 하면 서버에 묻는다. 끊겨 있으면 그 행만 까닭과 함께 건너뛴다.
 *
 * **내보내기**는 사본의 거래를 서버와 같은 함수(`entrySheetRowsOf`)로 편다.
 */
import {
  EntrySheetRowError,
  entrySheetCatalog,
  entrySheetRowsOf,
  importEntrySheetRows,
  numberEntrySheetRows,
} from '@money/types';

import { apiClient } from '../lib/api-client';
import { apiErrorMessage, codedError } from '../lib/api-error';
import { activeLocale } from '../lib/i18n';
import { cachedInstitutions, fetchInstitutions, invalidateInstitutions } from '../lib/institutions';
import { isOfflineError } from '../lib/offline-error';
import { myPersonIdOf } from '../store/project';
import type { EntrySheetPort } from './entry-sheet-port';
import { entryWritePort } from './entry-write-port';
import type { LocalStore } from './local-store';
import { settingsWritePort } from './settings-write-port';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function createLocalEntrySheet(store: LocalStore, timeZoneOf: () => string): EntrySheetPort {
  return {
    async importRows(rows, projectId) {
      const [project, people, accounts, cards, categories, tags, issuers] = await Promise.all([
        store.projectRow(projectId),
        store.people(projectId),
        store.accounts(projectId),
        store.cardRows(projectId),
        store.categoryRows(projectId),
        store.tagRows(projectId),
        issuerList(projectId),
      ]);
      const catalog = entrySheetCatalog({
        timeZone: timeZoneOf(),
        myPersonId: myPersonIdOf(projectId),
        people,
        accounts,
        cards,
        categories: categories.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type as 'income' | 'expense',
          parentId: row.parentId ?? null,
        })),
        tags,
        issuers,
      });

      const settings = settingsWritePort();
      return importEntrySheetRows(rows, catalog, {
        createPerson: async (name) => (await settings.addPerson({ name })).id,
        // 통화는 서버와 같이 장부 통화다. 비워 보내면 사본이 KRW 로 적어 pull 전까지 어긋난다.
        createAccount: async (input) =>
          (await settings.addAccount({ ...input, currency: project?.ledgerCurrency })).id,
        createCard: async (input) => (await settings.addCard(input)).id,
        async createIssuer(name) {
          try {
            const created = await apiClient.createInstitution({ type: 'card_issuer', name }, projectId);
            invalidateInstitutions('card_issuer');
            return created.id;
          } catch (error) {
            if (!isOfflineError(error)) throw error;
            throw new EntrySheetRowError(
              '새 카드의 카드사를 정하지 못했습니다. 인터넷에 연결된 뒤 다시 가져오거나, 카드를 먼저 만들어 두세요.',
            );
          }
        },
        createCategory: async ({ name, type, parentId }) =>
          (await settings.addCategory({ name, type, ...(parentId ? { parentId } : {}) })).id,
        createTag: async (name) => (await settings.addTag({ name })).id,
        createEntry: async (request) => {
          await entryWritePort().createEntry(request);
        },
        reasonOf: (error) => apiErrorMessage(activeLocale(), error, 'sheet.importFailed'),
      });
    },

    async exportRows(query, projectId) {
      for (const day of [query.startDate, query.endDate]) {
        if (day !== undefined && !DAY_KEY.test(day)) throw codedError('ENTRY_SHEET_INVALID');
      }
      const [entries, cards] = await Promise.all([
        store.viewEntries(projectId, {
          fromDateKey: query.startDate ?? '0000-01-01',
          toDateKey: query.endDate ?? '9999-12-31',
        }),
        store.cardRows(projectId),
      ]);
      const cardTypeOf = new Map(cards.map((card) => [card.id, card.cardType as string]));
      const timeZone = timeZoneOf();
      // 사본은 새것부터 준다. 서버와 같이 오래된 것부터 적는다.
      const rows = entries
        .reverse()
        .flatMap((entry) => entrySheetRowsOf(entry, timeZone, cardTypeOf));
      return numberEntrySheetRows(rows);
    },
  };
}

/** 카드사 목록. 받아 올 수 있으면 새로, 끊겨 있으면 받아 둔 것을, 그것도 없으면 빈 목록이다. */
async function issuerList(projectId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    return await fetchInstitutions('card_issuer', projectId);
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    return cachedInstitutions('card_issuer', projectId) ?? [];
  }
}
