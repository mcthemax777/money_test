/**
 * 홈 창구의 목록들. 구성원·카드·통장·분류·태그·반복 등록·환율과 쓰임 수를 사본 그대로 낸다.
 */

import {
  zonedDateKey,
  nextOccurrence,
  type RecurringRuleDto,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
  type ExchangeRateInfo,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { HomeContext } from './local-home-context';
import { rateInfoOf, requireProject, timeZoneOf } from './local-home-query';

export function listReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getPeople'
  | 'getCards'
  | 'getAccountsV2'
  | 'getCategories'
  | 'getTags'
  | 'getTagUsage'
  | 'getRecurringRules'
  | 'getExchangeRates'
  | 'getCategoryUsage'
> {
  const { store, note } = ctx;

  return {
    async getPeople(projectId) {
      note('people');
      return store.personRows(requireProject(projectId));
    },

    async getCards(projectId) {
      note('cards');
      return store.cardRows(requireProject(projectId));
    },

    async getAccountsV2(projectId) {
      note('accounts');
      return store.accountRows(requireProject(projectId));
    },

    async getCategories(projectId) {
      note('categories');
      // 사본에 있는 것이 곧 고를 수 있는 것이다. 감춰진 분류는 없고, 지운 분류는 행이
      // 사라진다 (서버의 `/categories` 와 같은 규칙이다).
      return store.categoryRows(requireProject(projectId));
    },

    async getTags(projectId) {
      note('tags');
      return store.tagRows(requireProject(projectId));
    },

    /** 태그가 붙은 자리의 수 (거래 줄·보관함 후보·반복 등록). 사본에서 센다. */
    async getTagUsage(tagId) {
      note('tagUsage');
      return store.tagUsageCounts(tagId);
    },

    /**
     * 반복 등록 목록. 서버 `RecurringService.list` 와 같은 모양이다 -- 다음 예정일은 꺼 둔
     * 반복이면 없고, 켜진 것은 공휴일(사본)과 마지막으로 만든 날(후보 열쇠)로 `nextOccurrence`
     * 가 셈한다. "오늘"은 가계부 타임존의 날이다.
     */
    async getRecurringRules(projectId) {
      const id = requireProject(projectId);
      note('recurringRules');

      const timeZone = await timeZoneOf(store, id);
      const today = zonedDateKey(new Date(), timeZone);
      const [rows, made, holidays] = await Promise.all([
        store.recurringRuleRows(id),
        store.recurringLastMadeOn(id),
        store.publicHolidays(id),
      ]);
      const list = (value: unknown): number[] | string[] => {
        try {
          const parsed = JSON.parse(String(value ?? '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };
      const intOrNull = (value: unknown) => (value == null ? null : Number(value));

      return rows.map((row): RecurringRuleDto.Response => {
        const lastMadeOn = made.get(String(row.id)) ?? null;
        const base = {
          id: String(row.id),
          projectId: id,
          isActive: Boolean(row.isActive),
          frequency: String(row.frequency) as RecurringRuleDto.Response['frequency'],
          everyDays: intOrNull(row.everyDays),
          weekdays: list(row.weekdays) as number[],
          holidayRule: String(row.holidayRule ?? 'none') as RecurringRuleDto.Response['holidayRule'],
          dayOfMonth: intOrNull(row.dayOfMonth),
          month: intOrNull(row.month),
          startDate: String(row.startDate),
          endDate: row.endDate == null ? null : String(row.endDate),
          timeOfDay: row.timeOfDay == null ? null : String(row.timeOfDay),
          kind: String(row.kind) as RecurringRuleDto.Response['kind'],
          amount: row.amount == null ? null : String(row.amount),
          currency: row.currency == null ? null : String(row.currency),
          description: String(row.description),
          merchant: row.merchant == null ? null : String(row.merchant),
          personId: row.personId == null ? null : String(row.personId),
          categoryId: row.categoryId == null ? null : String(row.categoryId),
          accountId: row.accountId == null ? null : String(row.accountId),
          toAccountId: row.toAccountId == null ? null : String(row.toAccountId),
          feeAmount: row.feeAmount == null ? null : String(row.feeAmount),
          feeCategoryId: row.feeCategoryId == null ? null : String(row.feeCategoryId),
          cardId: row.cardId == null ? null : String(row.cardId),
          installmentMonths: intOrNull(row.installmentMonths),
          tagIds: list(row.tagIds) as string[],
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
        };
        return {
          ...base,
          // 꺼 둔 반복은 아무 날도 오지 않는다 (서버와 같다).
          nextRunOn: base.isActive
            ? nextOccurrence(
                {
                  frequency: base.frequency,
                  everyDays: base.everyDays,
                  weekdays: base.weekdays,
                  holidayRule: base.holidayRule,
                  publicHolidays: holidays,
                  dayOfMonth: base.dayOfMonth,
                  month: base.month,
                  startDate: base.startDate,
                  endDate: base.endDate,
                  lastMadeOn,
                },
                today,
              )
            : null,
          lastMadeOn,
        };
      });
    },

    /**
     * 환율 목록. 서버의 `GET /exchange-rates` 와 같은 답이다 -- 저장 통화 기준으로 다른 지원
     * 통화마다 한 줄, 그리고 저장 → 표시 통화 한 줄. 환율 설정 화면과 거래 입력 폼이 쓴다.
     */
    async getExchangeRates(projectId) {
      const id = requireProject(projectId);
      note('exchangeRates');

      const project = await store.projectRow(id);
      const ledger = (project?.ledgerCurrency ?? 'KRW') as CurrencyCode;
      const display = (project?.displayCurrency ?? ledger) as CurrencyCode;

      const rates = (
        await Promise.all(
          SUPPORTED_CURRENCIES.filter((code) => code !== ledger).map((code) =>
            rateInfoOf(store, id, code, ledger),
          ),
        )
      ).filter((info): info is ExchangeRateInfo => info !== null);

      return {
        ledgerCurrency: ledger,
        displayCurrency: display,
        rates,
        displayRate: (await rateInfoOf(store, id, ledger, display)) ?? {
          from: ledger,
          to: display,
          rate: '1',
          source: 'fallback',
        },
      };
    },

    /** 이 분류와 그 소분류에 달린 거래 다리의 수. 사본의 원장을 그대로 센다. */
    async getCategoryUsage(id) {
      note('categoryUsage');
      return { counts: await store.categoryPostingCounts(id) };
    },
  };
}
