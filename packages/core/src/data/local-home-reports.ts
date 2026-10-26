/**
 * 홈 창구의 합계 쪽. 요약, 달별 추이, 분류별 구성비, 거래가 있는 달, 결제수단별 집계다.
 */

import {
  Dec,
  type PaymentMethodAccount,
  categoryBreakdown,
  currencyDecimals,
  entryMonths,
  expandInstallmentRows,
  installmentEntryViews,
  asWeekStart,
  isEntryPeriodUnit,
  DEFAULT_ENTRY_PERIOD,
  isPeriodKey,
  asPeriodAnchor,
  periodDayRange,
  periodTotals,
  shiftPeriodKey,
  parseEntryBasis,
  parseEntrySearch,
  paymentMethods,
  summarize,
  lineMatcherOf,
  toListItem,
  zonedDateKey,
  zonedParts,
  type CurrencyCode,
  INSTALLMENT_LOOKBACK_MONTHS,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { HomeContext } from './local-home-context';
import {
  dateKeyOfRow,
  ownerIdsOf,
  periodKeys,
  periodWindow,
  rateInfoOf,
  requireProject,
  shiftDateKeyMonths,
  timeZoneOf,
} from './local-home-query';

export function reportReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getSummary'
  | 'getTrend'
  | 'getCategoryBreakdown'
  | 'getEntryMonths'
  | 'getPaymentMethods'
> {
  const { store, fallback, note, converter, monthPostings } = ctx;

  return {
    async getSummary(period, projectId, filter) {
      const id = requireProject(projectId);
      note('summary');

      const rows = await monthPostings(id, period, filter);
      const totals = summarize(rows);
      const show = await converter(id);

      const keys = periodKeys(period);
      return {
        startDate: keys.fromDateKey,
        // 달 이름으로 고른 구간의 끝 키는 "-31" 이다(고르기에는 맞다). 내보낼 때는 서버처럼 실제 말일로.
        endDate: period.yearMonth ? periodDayRange(period.yearMonth).endKey : keys.toDateKey,
        // 한 달을 본 경우에만 채운다. 서버의 periodLabel 과 같은 규칙이다.
        ...(period.yearMonth ? { yearMonth: period.yearMonth } : {}),
        income: show.toString(totals.income),
        expense: show.toString(totals.expense),
        net: show.toString(totals.net),
      };
    },

    /**
     * 달별 추이. 서버의 `getTrend` 와 같은 규칙이다 (분류·전체·태그).
     *
     * 막대가 덮는 달을 한 번에 읽어(검색·사람 필터·세는 방식은 `monthPostings` 가 서버와 같게
     * 건다) 대상으로 거른 뒤 공용 `periodTotals` 로 기간마다 더한다. 서버와 같은 함수라
     * 같은 달의 막대가 웹과 기기에서 갈리지 않는다.
     *
     * 결제수단 추이는 "그 수단으로 돈이 나간 지출"을 가르는 규칙(entry-view)이 사본에 없어
     * 서버로 넘긴다.
     */
    async getTrend(target, options, projectId) {
      if (target === 'account' || target === 'card') {
        return fallback.getTrend(target, options, projectId);
      }
      const id = requireProject(projectId);
      note('trend');

      const timeZone = await timeZoneOf(store, id);
      const months = Math.min(Math.max(Number(options.months) || 12, 1), 60);
      const now = zonedParts(new Date(), timeZone);
      /*
       * 마지막 막대의 열쇠. 기간 열쇠(해·달·주)를 주면 그 단위로 선다 (서버와 같은 규칙).
       * 모양이 틀린 열쇠는 서버가 400 으로 거절하는 값이라 여기서는 달로 물러선다.
       */
      const endKey =
        options.endPeriod && isPeriodKey(options.endPeriod)
          ? options.endPeriod
          : options.endMonth ?? `${now.year}-${String(now.month).padStart(2, '0')}`;

      /*
       * 덮는 날. 검색 기간으로 자르면(clip) 그 안으로 줄인다 -- 서버는 [from, to) 로 읽으므로
       * 끝은 1밀리초 앞의 날이다. 겹치는 날이 없으면 모든 기간이 0 이다.
       */
      let fromDateKey = periodDayRange(shiftPeriodKey(endKey, -(months - 1))).startKey;
      let toDateKey = periodDayRange(endKey).endKey;
      if (options.clipFrom) {
        const key = zonedDateKey(new Date(options.clipFrom), timeZone);
        if (key > fromDateKey) fromDateKey = key;
      }
      if (options.clipTo) {
        const key = zonedDateKey(new Date(Date.parse(options.clipTo) - 1), timeZone);
        if (key < toDateKey) toDateKey = key;
      }

      const rows =
        fromDateKey > toDateKey
          ? []
          : await monthPostings(
              id,
              { startDate: fromDateKey, endDate: toDateKey },
              // 태그 추이는 그 태그로 좁힌 검색과 같다 (서버도 tagIds 를 대상으로 덮어쓴다).
              target === 'tag' ? { ...options, tagIds: options.targetId } : options,
            );

      const exact = options.exact === true || (options.exact as unknown) === 'true';
      const picked = rows.filter((row) => {
        if (target === 'category') {
          return exact
            ? row.categoryId === options.targetId
            : row.categoryId === options.targetId || row.parentCategoryId === options.targetId;
        }
        // 전체와 태그는 유형으로 가른다.
        return row.categoryType === (options.type ?? 'expense');
      });

      const show = await converter(id);
      return periodTotals(picked, { timeZone, endKey, count: months }).map((point) => ({
        yearMonth: point.yearMonth,
        amount: show.toString(point.amount),
      }));
    },

    /**
     * 분류별 구성비. 거래 화면의 분류별 목록이 쓴다.
     *
     * 롤업(소분류를 대분류로 합치기)과 비율까지 공용 함수가 낸다. 사본이 손수 더하면
     * 같은 달의 구성비가 웹과 앱에서 갈린다.
     */
    async getCategoryBreakdown(period, type, projectId, options) {
      const id = requireProject(projectId);
      note('categoryBreakdown');

      const rows = await monthPostings(id, period, options);
      const show = await converter(id);

      return categoryBreakdown(rows, {
        type,
        // 쿼리스트링을 거치지 않는 자리라 값이 그대로 온다. 기본은 롤업이다.
        rollup: options?.rollup !== false,
      }).map((bucket) => ({
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        parentCategoryId: bucket.parentCategoryId,
        parentCategoryName: bucket.parentCategoryName,
        amount: show.toString(bucket.amount),
        count: bucket.count,
        ratio: bucket.ratio,
      }));
    },

    /**
     * 거래가 있는 달. 기간을 주면 그 구간에 걸친 달만이다.
     *
     * 달을 자르는 일은 `entryMonths` 가 프로젝트 타임존으로 한다. 사본에 이미
     * `yearMonth` 컬럼이 박혀 있지만 그것을 쓰지 않는 이유가 있다 -- 서버와 같은 함수를
     * 거쳐야 경계 규칙이 한 벌로 남는다. 그 컬럼은 질의로 **고르는** 데 쓰는 것이고,
     * 여기서 하는 일은 고른 것을 **묶는** 것이다.
     */
    async getEntryMonths(projectId, filter) {
      const id = requireProject(projectId);
      note('entryMonths');

      const timeZone = await timeZoneOf(store, id);
      /*
       * 고른 기간. 없으면 전체다 -- 달력 키가 0을 채운 문자열이라 양끝을 이렇게
       * 잡으면 전부 든다.
       *
       * 날짜는 여기서도 달력 날짜다(EntryMonthsQuery). 걸친 달의 합계가 구간만큼만
       * 세어지는 것이 요점이다. 달을 통째로 세면 년월 줄의 금액과 그 안을 펴서 나온
       * 거래의 합이 어긋난다.
       */
      const scope = {
        // 한쪽만 적은 기간은 열린 구간이다. 없는 쪽을 달력 키의 양끝으로 채운다.
        fromDateKey: filter?.startDate || '0000-01-01',
        toDateKey: filter?.endDate || '9999-12-31',
        ownerIds: ownerIdsOf(filter),
        search: parseEntrySearch(filter ?? {}),
      };
      const spread = parseEntryBasis(filter?.basis) === 'installment';
      const [read, dates, show] = await Promise.all([
        store.categoryPostings(id, {
          ...scope,
          // 거래 탭의 달 목록이다. 들어온 날짜로 센다 (서버 getEntryMonths 와 같다, 결정 G).
          dateBasis: 'own',
          // 회차 기준이면 앞에서 산 할부까지 읽는다. 그 회차가 이 구간에 선다.
          ...(spread
            ? {
                fromDateKey: shiftDateKeyMonths(scope.fromDateKey, -INSTALLMENT_LOOKBACK_MONTHS),
                withInstallment: true,
              }
            : {}),
        }),
        // 이체·카드정산은 카테고리 다리가 없어 다리만 보면 달이 만들어지지 않는다.
        store.entryDates(id, scope),
        converter(id),
      ]);

      const rows = spread
        ? expandInstallmentRows(read, timeZone).filter((row) => {
            const key = dateKeyOfRow(row.date, timeZone);
            return key >= scope.fromDateKey && key <= scope.toDateKey;
          })
        : read;
      /*
       * 회차가 선 달도 줄이 되어야 한다. 지난달에 산 할부의 이번 달 회차에는 전표가
       * 없어, 편 줄의 날짜를 함께 넘기지 않으면 그 달이 목록에서 빠진다.
       */
      const monthDates = spread
        ? [...dates, ...rows.map((row) => dateKeyOfRow(row.date, timeZone))]
        : dates;

      // 묶는 단위는 화면이 정한다. 없으면 달이다 (서버의 `getEntryMonths` 와 같다).
      const unit = isEntryPeriodUnit(filter?.unit) ? filter.unit : DEFAULT_ENTRY_PERIOD;
      // 주를 끊는 요일도 화면이 실어 보낸다. 없으면 일요일이다.
      const weekStart = asWeekStart(filter?.weekStart);

      // 달·해를 어디서 끊을지도 화면이 정한다 (서버와 같은 함수로 읽는다).
      const anchor = asPeriodAnchor(filter ?? {});

      return entryMonths(rows, { timeZone, entryDates: monthDates, unit, weekStart, anchor }).map(
        (month) => ({
          yearMonth: month.yearMonth,
          income: show.toString(month.income),
          expense: show.toString(month.expense),
        }),
      );
    },

    /**
     * 결제수단별 집계.
     *
     * 세는 규칙은 서버와 같은 함수를 쓴다. 여기서 하는 일은 사본에서 재료를 고르는
     * 것과 실적 기준액을 표시 통화로 옮기는 것뿐이다.
     */
    async getPaymentMethods(period, projectId, filter) {
      const id = requireProject(projectId);
      note('paymentMethods');

      const keys = periodKeys(period);
      const spread = parseEntryBasis(filter?.basis) === 'installment';
      const timeZone = await timeZoneOf(store, id);
      const [entries, accounts, cards, show] = await Promise.all([
        store.viewEntries(id, {
          ...keys,
          /*
           * 회차 기준이면 앞에서 산 할부도 이 구간의 거래가 된다. 목록·분류 탭과 같은
           * 규칙이라, 한 화면 안에서 카드 합계와 분류 합계가 어긋나지 않는다.
           */
          ...(spread
            ? { fromDateKey: shiftDateKeyMonths(keys.fromDateKey, -INSTALLMENT_LOOKBACK_MONTHS) }
            : {}),
          ownerIds: ownerIdsOf(filter),
          // 거래 화면의 검색. 이것을 빠뜨리면 고르지 않은 카드가 금액을 갖고 목록에 남는다.
          search: parseEntrySearch(filter ?? {}),
        }),
        store.accounts(id),
        store.cardsForPaymentMethods(id),
        converter(id),
      ]);

      /*
       * 실적 기준액을 표시 통화로 옮긴다.
       *
       * 카드에 저장된 값은 결제 통장의 통화다. 통장 통화는 카드마다 다를 수 있어 통화별로 환율을 한 번씩 고른다.
       * 서버와 같은 순서(직접 정한 값 → 역수 → 고정값, `rateInfoOf`)로 찾는다 (2026-10-16) -- 직접 정한 값만 보던
       * 때에는 그것이 없으면 오프라인에서 달성률 막대가 사라졌다. 셋 다 없을 때만 기준액을 내지 않는다.
       */
      const rates = new Map<string, string | null>();
      for (const currency of new Set(cards.map((card) => card.paymentCurrency))) {
        rates.set(
          currency,
          (await rateInfoOf(store, id, currency as CurrencyCode, show.display as CurrencyCode))?.rate ??
            null,
        );
      }

      /*
       * 걸린 줄만 세도록 판정기를 함께 넘긴다. 서버의 `getPaymentMethods` 와 한 규칙이다.
       *
       * 목록이 걸린 줄만 보여 주는데 수단 줄이 거래 전체를 더하면, 화면에 5,000원 한
       * 줄이 서 있고 그 카드 옆에는 10,000원이 적힌다.
       */
      const matchLine = lineMatcherOf(parseEntrySearch(filter ?? {}));
      const items = entries.map((entry) =>
        toListItem(
          entry,
          show.view,
          matchLine,
        ),
      );
      /*
       * 회차 기준이면 금액을 그 회차 몫으로 바꾸고, 회차가 없는 할부는 뺀다.
       *
       * **넓혀 읽은 앞 구간에서는 할부만 남긴다.** 넓힌 것은 앞에서 산 할부의 회차를 찾기
       * 위해서다. `installmentEntryViews` 는 할부가 아닌 거래(일시불·할부 환불)를 그대로
       * 흘려보내므로, 여기서 거르지 않으면 앞 60개월의 일시불이 이 구간의 수단 합계에 더해져
       * 어느 달을 펴도 비슷한 금액이 선다. 서버 `installmentScope` 와 같은 규칙이다 --
       * 할부가 아닌 것은 제 날짜가 구간 안일 때만, 할부는 넓힌 구간 전체에서.
       */
      const counted = spread
        ? installmentEntryViews(
            items.filter((item) => {
              const isPurchase = (item.installmentMonths ?? 1) >= 2 && !item.installmentAdjust;
              if (isPurchase) return true;
              const key = dateKeyOfRow(item.date, timeZone);
              return key >= keys.fromDateKey && key <= keys.toDateKey;
            }),
            { timeZone, ...periodWindow(period, keys, timeZone) },
          )
        : items;

      return paymentMethods(
        counted,
        accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type as PaymentMethodAccount['type'],
          isActive: account.isActive,
          ownerId: account.ownerId,
          ownerName: account.ownerName,
        })),
        cards.map((card) => {
          const rate = rates.get(card.paymentCurrency) ?? null;
          return {
            id: card.id,
            name: card.name,
            cardType: card.cardType,
            isActive: card.isActive,
            color: card.color,
            statementClosingDay: card.statementClosingDay,
            performanceTarget:
              card.performanceAmount === null || rate === null
                ? null
                : Dec.of(card.performanceAmount)
                    .times(rate)
                    .round(currencyDecimals(show.display))
                    .toString(),
            ownerId: card.ownerId,
            ownerName: card.ownerName,
          };
        }),
        {
          personIds: ownerIdsOf(filter) ?? null,
          matchNothing: ownerIdsOf(filter)?.length === 0,
        },
      );
    },
  };
}
