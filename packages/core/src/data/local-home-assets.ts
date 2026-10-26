/**
 * 홈 창구의 자산 쪽. 순자산, 자산 추이, 계좌별 누적 수익, 계좌 원장이다.
 */

import {
  Dec,
  asWeekStart,
  netWorth,
  balanceBuckets,
  stackBalanceHistory,
  classifyEntry,
  EQUITY_ACCOUNT_TYPES,
  VALUED_ACCOUNT_TYPES,
  nonZeroAmounts,
  groupOfRow,
  isAssetGroupKey,
  zonedCurrentYearMonth,
  type AccountType,
  PROFIT_ACCOUNT_TYPES,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { HomeContext } from './local-home-context';
import { ratesFor, requireProject, timeZoneOf } from './local-home-query';

export function assetReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getNetWorth'
  | 'getBalanceHistory'
  | 'getAccountProfit'
  | 'getAccountPostings'
> {
  const { store, note, converter } = ctx;

  return {
    async getNetWorth(projectId) {
      const id = requireProject(projectId);
      note('netWorth');

      const show = await converter(id);
      const result = netWorth(await store.netWorthRows(id), {
        ledgerCurrency: show.ledger,
        displayCurrency: show.display,
        // 계좌 통화별 환율. 사본에 담긴 것만 쓴다. 없으면 1로 본다.
        toDisplay: await ratesFor(store, id, show.display),
        ledgerToDisplay: show.rate,
      });

      return {
        total: result.total.toString(),
        cash: result.cash.toString(),
        investment: result.investment.toString(),
        liability: result.liability.toString(),
        unrealizedGain: result.unrealizedGain.toString(),
        byType: nonZeroAmounts(result.byType),
        byGroup: nonZeroAmounts(result.byGroup),
        byAccount: result.byAccount.map((part) => ({ ...part, amount: part.amount.toString() })),
        byPerson: result.byPerson.map((bucket) => ({
          personId: bucket.personId,
          personName: bucket.personName,
          total: bucket.total.toString(),
          cash: bucket.cash.toString(),
          investment: bucket.investment.toString(),
          liability: bucket.liability.toString(),
          byType: nonZeroAmounts(bucket.byType),
          byGroup: nonZeroAmounts(bucket.byGroup),
        })),
      };
    },

    /**
     * 자산 추이. 서버의 getBalanceHistory 와 같은 계좌 고르기·칸·쌓기다.
     *
     * 칸 나누기와 쌓기는 공용 함수(`balanceBuckets`·`stackBalanceHistory`)이고, 다리의 합만
     * 여기서 낸다 -- 창 시작 전은 기준선, 창 안은 그 다리가 든 칸의 증감이다.
     */
    async getBalanceHistory(options, projectId) {
      const id = requireProject(projectId);
      note('balanceHistory');

      const ownerIds =
        options.ownerIds === undefined
          ? undefined
          : String(options.ownerIds).split(',').filter(Boolean);
      // 빈 문자열은 아무도 고르지 않은 것이다 (목록 필터와 같은 세 상태 규칙).
      if (ownerIds && ownerIds.length === 0) return [];
      // 묶음 하나만 볼 때. 카드 대금은 결제 통장의 묶음을 따른다 (서버와 같다).
      const group = isAssetGroupKey(options.group) ? options.group : null;
      const paymentTypeOf = group ? await store.cardPaymentTypes(id) : null;
      // 합계 제외로 둔 계좌 (서버와 같다). 계좌 하나를 보려고 고른 때는 무시한다.
      const excluded = new Set(
        options.excludeAccountIds && !options.accountId
          ? String(options.excludeAccountIds).split(',').filter(Boolean)
          : [],
      );

      const accounts = (await store.accounts(id))
        .filter((account) => !EQUITY_ACCOUNT_TYPES.includes(account.type as AccountType))
        .filter((account) => !excluded.has(account.id))
        .filter((account) =>
          // 계좌를 지정하면 숨긴 계좌도 보인다. 그 밖에는 활성 계좌만 모은다 (서버와 같다).
          options.accountId
            ? account.id === options.accountId
            : account.isActive &&
              (options.ownerId
                ? account.ownerId === options.ownerId
                : ownerIds
                  ? account.ownerId !== null && ownerIds.includes(account.ownerId)
                  : true),
        )
        .filter(
          (account) =>
            !group ||
            groupOfRow({
              type: account.type as AccountType,
              paymentAccountType: paymentTypeOf?.get(account.id) ?? null,
            }) === group,
        )
        .map((account) => ({ id: account.id, type: account.type as AccountType }));
      if (accounts.length === 0) return [];

      const timeZone = await timeZoneOf(store, id);
      const granularity =
        options.granularity === 'day' || options.granularity === 'week' || options.granularity === 'year'
          ? options.granularity
          : 'month';
      const buckets = balanceBuckets(
        {
          granularity,
          endMonth: options.endMonth ?? zonedCurrentYearMonth(timeZone),
          yearMonth: options.yearMonth,
          endDate: options.endDate,
          days: options.days,
          weeks: options.weeks,
          months: options.months,
          years: options.years,
          weekStart: asWeekStart(options.weekStart),
        },
        timeZone,
      );
      const windowStart = buckets[0].start.getTime();
      const windowEnd = buckets[buckets.length - 1].end.getTime();

      const accountIds = accounts.map((account) => account.id);
      const base = new Map<string, Dec>();
      const steps = new Map<number, Array<{ accountId: string; delta: string }>>();
      for (const row of await store.accountPostingRows(id, accountIds)) {
        const at = new Date(row.date).getTime();
        if (at < windowStart) {
          base.set(row.accountId, (base.get(row.accountId) ?? Dec.of(0)).plus(row.baseAmount));
          continue;
        }
        if (at >= windowEnd) continue;
        const bucket = buckets.find((candidate) => at < candidate.end.getTime());
        if (!bucket) continue;
        const list = steps.get(bucket.start.getTime()) ?? [];
        list.push({ accountId: row.accountId, delta: row.baseAmount });
        steps.set(bucket.start.getTime(), list);
      }

      const valuedIds = accounts
        .filter((account) => VALUED_ACCOUNT_TYPES.includes(account.type))
        .map((account) => account.id);
      // 평가 날짜는 달력 날짜로 담겨 있다. 서버(@db.Date)와 같이 그날 UTC 0시로 읽는다.
      const valuations = (await store.valuationRows(valuedIds)).map((row) => ({
        accountId: row.accountId,
        date: new Date(`${row.date}T00:00:00.000Z`),
        marketValue: row.marketValue,
      }));

      const show = await converter(id);
      return stackBalanceHistory({ accounts, base, steps, valuations, buckets }).map((point) => ({
        date: point.label,
        balance: show.toString(point.total),
      }));
    },

    /**
     * 계좌별 누적 수익. 서버의 getAccountProfit 과 같은 규칙이다 -- 투자·저축 계좌마다, 수입·지출
     * 전표의 그 계좌 다리를 그대로 더한다 (계좌 통화, 환산 없음). 거래 종류는 공용 `classifyEntry`
     * 가 가른다. 기초잔액·이체·잔액조정은 빠진다.
     */
    async getAccountProfit(projectId) {
      const id = requireProject(projectId);
      note('accountProfit');

      const accountIds = (await store.accounts(id))
        .filter((account) => PROFIT_ACCOUNT_TYPES.includes(account.type as AccountType))
        .map((account) => account.id);
      if (accountIds.length === 0) return [];

      const profit = new Map<string, Dec>(accountIds.map((accountId) => [accountId, Dec.of(0)]));
      for (const entry of await store.entriesTouchingAccounts(id, accountIds)) {
        const kind = classifyEntry(entry.postings);
        // 서버 getAccountProfit 과 같다. 되돌려 받은 수수료(페이백)도 수익이다.
        if (kind !== 'income' && kind !== 'expense' && kind !== 'payback') continue;
        for (const posting of entry.postings) {
          const current = posting.accountId ? profit.get(posting.accountId) : undefined;
          if (!current) continue;
          profit.set(posting.accountId!, current.plus(posting.amount));
        }
      }
      return accountIds.map((accountId) => ({
        accountId,
        profit: profit.get(accountId)!.toString(),
      }));
    },

    /**
     * 계좌 원장 한 쪽.
     *
     * 줄마다 붙는 잔액은 **가장 오래된 다리부터 더한 값**이다. 서버도 같은 규칙이고
     * (`cumulativeBalanceThrough`), 계좌 잔액 자체가 그 합이라 마지막 줄의 잔액과
     * 화면 위의 잔액이 정의상 맞는다.
     *
     * 금액은 다리 전부를 읽어 더하고, 화면에 적을 것은 보여 줄 줄에만 붙인다.
     */
    async getAccountPostings(accountId, params) {
      note('accountPostings');

      const limit = Math.min(Math.max(Number(params?.limit) || 50, 1), 200);
      const [amounts, seed] = await Promise.all([
        store.accountPostingAmounts(accountId),
        store.openingSeedOf(accountId),
      ]);

      // 오래된 것부터 더해 줄마다의 잔액을 만든다. 목록은 그 반대로 읽는다. 머리의 잔액과 같은 씨앗에서 출발한다.
      let running = Dec.of(seed);
      const withBalance = amounts.map((row) => {
        running = running.plus(row.amount);
        return { ...row, balanceAfter: running.toString() };
      });
      withBalance.reverse();

      /*
       * 구간을 고른 조회는 **잔액을 다 쌓은 뒤에** 자른다.
       *
       * 줄에 붙는 잔액은 구간과 상관없이 맨 앞부터 센 값이다. 구간만큼만 더하면 그
       * 줄의 잔액이 통장의 실제 잔액과 달라진다 (서버도 같은 규칙이다).
       */
      const fromTime = params?.startDate ? new Date(params.startDate).getTime() : null;
      const toTime = params?.endDate ? new Date(params.endDate).getTime() : null;
      const inRange =
        fromTime === null && toTime === null
          ? withBalance
          : withBalance.filter((row) => {
              const at = new Date(row.date).getTime();
              if (fromTime !== null && at < fromTime) return false;
              if (toTime !== null && at > toTime) return false;
              return true;
            });

      /*
       * 커서는 앞 쪽의 마지막 다리 id 다(서버와 같다). 그 줄이 사라졌으면 이어 붙일
       * 자리를 알 수 없으므로 빈 쪽을 준다 -- 처음부터 다시 주면 같은 줄이 두 번 선다.
       */
      const from = params?.cursor
        ? inRange.findIndex((row) => row.postingId === params.cursor) + 1
        : 0;
      if (params?.cursor && from === 0) return { data: [], nextCursor: null };

      const page = inRange.slice(from, from + limit);
      const detail = await store.ledgerRows(page.map((row) => row.postingId));

      const data = page.flatMap((row) => {
        const found = detail.get(row.postingId);
        return found ? [{ ...found, balanceAfter: row.balanceAfter }] : [];
      });

      return {
        data,
        nextCursor: from + limit < inRange.length ? page[page.length - 1].postingId : null,
      };
    },
  };
}
