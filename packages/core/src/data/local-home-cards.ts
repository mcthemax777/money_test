/**
 * 홈 창구의 카드 쪽. 실적, 청구액 미확정 결제, 주기별 사용액, 실적 원장과 청구 내역이다.
 *
 * 사본만으로 주기를 자를 수 없는 카드(설정이 빠진 신용카드)는 서버 창구에 넘긴다.
 */

import {
  type CardDto,
  Dec,
  billedShares,
  creditPerformanceShares,
  creditUsagePeriods,
  debitPerformanceShares,
  debitUsagePeriods,
  closingMonthKey,
  closingMonthOf,
  performanceOf,
  periodForClosingMonth,
  usageSpan,
  zonedParts,
  zonedYearMonth,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { StoredCardLedgerPosting, StoredPerformanceCard } from './local-store';
import type { HomeContext } from './local-home-context';
import { timeZoneOf } from './local-home-query';

export function cardReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getCardPerformance'
  | 'getCardPendingRates'
  | 'getCardUsage'
  | 'getCardPerformanceLedger'
  | 'getCardBilledLedger'
> {
  const { store, fallback, note } = ctx;

  return {
    /**
     * 카드 실적 진행 상황.
     *
     * 주기를 자르고 할부를 나누는 규칙은 서버와 같은 함수(card-usage)가 갖는다.
     * 사본이 낼 수 없는 카드(설정이 빠진 신용카드)는 서버에 물어본다.
     */
    async getCardPerformance(cardId): Promise<CardDto.PerformanceResponse> {
      const card = await store.cardForPerformance(cardId);

      /*
       * 사본에 없거나 신용카드인데 마감일 설정이 비어 있으면 계산할 수 없다.
       * 서버가 그 경우 오류를 주는 쪽이 맞으므로 그대로 넘긴다.
       */
      const isCredit = card?.cardType === 'credit';
      // 주기를 자를 수 없는 신용카드는 서버에 맡긴다 (`ledgerReady`).
      if (!card || !ledgerReady(card)) return fallback.getCardPerformance(cardId);

      note('cardPerformance');
      const timeZone = await timeZoneOf(store, card.projectId);

      if (isCredit) {
        const { periods } = creditUsagePeriods({
          postings: await store.creditCardPostings(card.liabilityAccountId!),
          statementClosingDay: card.statementClosingDay!,
          paymentDueDay: card.paymentDueDay!,
          timeZone,
          // 앞이 지난 주기, 뒤가 진행 중인 주기다.
          span: 2,
        });
        const [previous, current] = periods;

        return performanceOf({
          cardId: card.id,
          currency: card.liabilityCurrency ?? card.paymentCurrency,
          basis: 'statement',
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          usage: current.usage,
          previousPeriodStart: previous.periodStart,
          previousPeriodEnd: previous.periodEnd,
          previousUsage: previous.usage,
          target: card.performanceAmount,
        });
      }

      const [previous, current] = debitUsagePeriods({
        postings: await store.debitCardPostings(card.id),
        timeZone,
        span: 2,
      });

      return performanceOf({
        cardId: card.id,
        currency: card.paymentCurrency,
        basis: 'month',
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
        usage: current.usage,
        previousPeriodStart: previous.periodStart,
        previousPeriodEnd: previous.periodEnd,
        previousUsage: previous.usage,
        target: card.performanceAmount,
      });
    },

    /** 청구액 미확정 외화 결제. 고르는 조건과 주기 매기기는 서버와 같다 (`pendingRates`). */
    async getCardPendingRates(cardId) {
      note('pendingRates');
      return store.pendingRates(cardId);
    },

    /**
     * 주기별 사용액과 남은 대금.
     *
     * 실적 막대와 같은 재료로 낸다(`getCardPerformance`). 남은 대금은 부채 계정의 다리
     * 합을 뒤집은 값이라 서버가 준 잔액 칸을 읽지 않는다 -- 아직 보내지 못한 결제도
     * 그대로 셈에 든다.
     */
    async getCardUsage(cardId, months) {
      const card = await store.cardForPerformance(cardId);
      const isCredit = card?.cardType === 'credit';
      // 주기를 자를 수 없는 신용카드는 서버에 맡긴다 (`ledgerReady`).
      if (!card || !ledgerReady(card)) return fallback.getCardUsage(cardId, months);

      note('cardUsage');
      const timeZone = await timeZoneOf(store, card.projectId);
      const span = usageSpan(months);

      if (isCredit) {
        const { periods } = creditUsagePeriods({
          postings: await store.creditCardPostings(card.liabilityAccountId!),
          statementClosingDay: card.statementClosingDay!,
          paymentDueDay: card.paymentDueDay!,
          timeZone,
          span,
        });

        return {
          cardId: card.id,
          currency: card.liabilityCurrency ?? card.paymentCurrency,
          // 부채는 음수로 쌓인다. 남은 대금은 부호를 뒤집은 값이다.
          outstanding: Dec.of(card.liabilityBalance ?? '0').negated().toString(),
          periods,
        };
      }

      return {
        cardId: card.id,
        currency: card.paymentCurrency,
        // 체크카드는 결제 즉시 통장에서 빠진다. 갚을 대금이 남지 않는다.
        outstanding: '0',
        periods: debitUsagePeriods({
          postings: await store.debitCardPostings(card.id),
          timeZone,
          span,
        }),
      };
    },

    /**
     * 실적 원장 한 쪽.
     *
     * 주기를 나누고 차감을 되살리는 규칙은 서버와 같은 함수가 갖는다
     * (`creditPerformanceShares`). 사본은 그 카드의 다리를 한 번에 읽어 주기마다 줄을
     * 만든 뒤, 보여 줄 만큼만 잘라 준다 -- 누적은 주기 시작부터 센 값 그대로다.
     */
    async getCardPerformanceLedger(cardId, params) {
      const card = await store.cardForPerformance(cardId);
      const isCredit = card?.cardType === 'credit';
      if (!card || !ledgerReady(card)) return fallback.getCardPerformanceLedger(cardId, params);

      note('cardPerformanceLedger');
      const timeZone = await timeZoneOf(store, card.projectId);

      const postings = await store.cardLedgerPostings(
        isCredit ? { liabilityAccountId: card.liabilityAccountId } : { cardId: card.id },
      );

      /** 마감 연월 -> 그 주기의 줄. 오래된 것이 앞이다(누적을 그 차례로 더한다). */
      const byPeriod = new Map<string, CardDto.PeriodLedgerRow[]>();
      for (const posting of postings) {
        const shares = isCredit
          ? creditPerformanceShares(posting, card.statementClosingDay!, timeZone)
          : debitPerformanceShares(posting, timeZone);

        for (const share of shares) {
          push(byPeriod, share.closingKey, {
            ...ledgerRowOf(posting, card, share.amount),
            installmentMonths: share.months,
          });
        }
      }

      return periodLedgerPage({
        byPeriod,
        params,
        timeZone,
        card,
        isCredit,
        target: card.performanceAmount,
      });
    },

    /**
     * 청구 내역 한 쪽. 이 주기의 청구서에 무엇이 얼마씩 들었는가.
     *
     * 실적 원장과 같은 길을 쓰되 나누는 함수만 다르다(`billedShares`). **할부가 회차마다
     * 한 줄이다** -- 24개월 할부로 산 차는 원장에 산 달 한 줄뿐이라, 그 뒤 주기에서는
     * 대금이 왜 이만큼 나가는지 목록에서 알 수 없었다.
     *
     * 신용카드만이다. 체크카드는 쓰는 즉시 통장에서 빠져 청구라는 것이 없다.
     */
    async getCardBilledLedger(cardId, params) {
      const card = await store.cardForPerformance(cardId);
      if (!card || card.cardType !== 'credit' || !ledgerReady(card)) {
        return fallback.getCardBilledLedger(cardId, params);
      }

      note('cardBilledLedger');
      const timeZone = await timeZoneOf(store, card.projectId);

      const postings = await store.cardLedgerPostings({
        liabilityAccountId: card.liabilityAccountId,
      });

      const byPeriod = new Map<string, CardDto.PeriodLedgerRow[]>();
      for (const posting of postings) {
        /*
         * 실적에서 뺀 거래도 그대로 싣는다. 청구는 실적과 상관없이 되므로, 여기서
         * 거르면 줄의 합이 막대(`UsagePeriod.billed`)와 어긋난다.
         */
        for (const share of billedShares(posting, card.statementClosingDay!, timeZone)) {
          push(byPeriod, share.closingKey, {
            ...ledgerRowOf(posting, card, share.amount),
            // 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
            key: share.months > 1 ? `${posting.postingId}:${share.index}` : posting.postingId,
            installmentIndex: share.index,
            installmentMonths: share.months,
          });
        }
      }

      return periodLedgerPage({
        byPeriod,
        params,
        timeZone,
        card,
        isCredit: true,
        // 실적 기준액은 청구와 상관없는 값이다. 막대에 기준선을 긋지 않는다.
        target: null,
      });
    },
  };
}

/**
 * 이 카드를 사본만으로 그릴 수 있는가.
 *
 * 신용카드는 마감일·결제일·부채 계정이 다 있어야 주기를 자를 수 있다. 하나라도 비면
 * 서버가 오류를 주는 쪽이 맞으므로 그대로 넘긴다.
 */
function ledgerReady(card: StoredPerformanceCard): boolean {
  if (card.cardType !== 'credit') return true;
  return (
    card.statementClosingDay !== null &&
    card.paymentDueDay !== null &&
    card.liabilityAccountId !== null
  );
}

/** 마감 연월 칸에 줄 하나를 더한다. */
function push(byPeriod: Map<string, CardDto.PeriodLedgerRow[]>, key: string, row: CardDto.PeriodLedgerRow) {
  const rows = byPeriod.get(key) ?? [];
  rows.push(row);
  byPeriod.set(key, rows);
}

/** 주기 원장 한 줄의 바탕. 누적과 주기 시작은 쪽을 만들 때 붙인다. */
function ledgerRowOf(
  posting: StoredCardLedgerPosting,
  card: { id: string; name: string },
  amount: string,
): CardDto.PeriodLedgerRow {
  return {
    key: posting.postingId,
    entryId: posting.entryId,
    date: posting.date,
    description: posting.description,
    merchant: posting.merchant,
    // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
    amount: Dec.of(amount).negated().toString(),
    runningTotal: '0',
    periodStart: '',
    cardId: card.id,
    // 서버 카드 원장처럼 이름을 싣는다.
    cardName: card.name,
    categoryName: posting.categoryName,
    parentCategoryName: posting.parentCategoryName,
    installmentMonths: 1,
  };
}

/**
 * 주기마다 만든 줄을 한 쪽으로 자른다. 실적 원장과 청구 내역이 이 한 길을 쓴다.
 *
 * 누적은 주기 시작부터 세야 뜻이 있어, 주기는 통째로 만들어 두고 자르는 것은 보여 줄
 * 줄뿐이다 -- 뒷부분만 받아도 줄에 붙은 누적은 처음부터 센 값이다 (서버와 같은 규칙).
 */
function periodLedgerPage(input: {
  byPeriod: Map<string, CardDto.PeriodLedgerRow[]>;
  params?: CardDto.PeriodLedgerQuery;
  timeZone: string;
  card: StoredPerformanceCard;
  isCredit: boolean;
  target: string | null;
}): CardDto.PeriodLedgerResponse {
  const { byPeriod, params, timeZone, card, isCredit } = input;
  const limit = Math.min(Math.max(Number(params?.limit) || 20, 1), 100);

  const head = {
    cardId: card.id,
    currency: isCredit ? card.liabilityCurrency ?? card.paymentCurrency : card.paymentCurrency,
    basis: (isCredit ? 'statement' : 'month') as 'statement' | 'month',
    target: input.target,
  };

  const today = zonedParts(new Date(), timeZone);
  const todayMarker = Date.UTC(today.year, today.month - 1, today.day);

  const periods: CardDto.PeriodLedgerPeriod[] = [];
  const rows: CardDto.PeriodLedgerRow[] = [];
  /** 주기 시작 -> 마감 연월. 커서에 그 키를 실어 서버와 같은 모양을 쓴다. */
  const closingOf = new Map<string, string>();

  /*
   * 쭉 훑을 때는 진행 중인 주기까지다. 키가 "YYYY-MM" 이라 글자 차례가 곧 시간 차례다.
   *
   * 할부 청구는 뒤 주기로 넘어가고 날짜를 잘못 적은 거래도 있어, 아직 오지 않은 주기에
   * 줄이 놓일 수 있다. 고르지 않은 채로 훑는 목록에는 세우지 않는다 -- 서버도 진행 중인
   * 주기에서 시작해 거슬러 오른다.
   */
  const currentKey = isCredit
    ? closingMonthKey(closingMonthOf(new Date(), card.statementClosingDay!, timeZone))
    : zonedYearMonth(new Date(), timeZone);

  /*
   * 주기 하나만 보는 조회. 그래프에서 막대를 눌렀을 때 온다.
   *
   * 날짜 구간이 아니라 주기 이름으로 가린다. 주기 경계는 마감일이 정하고 할부 회차는
   * 산 날이 아니라 청구되는 주기에 들어, 날짜로 자르면 둘 다 어긋난다.
   */
  const only = params?.closingKey;

  for (const key of [...byPeriod.keys()]
    /*
     * 고른 주기가 있으면 그것만이다. 아직 오지 않은 주기여도 보여 준다 -- 24개월 할부의
     * 다음 달 몫을 그래프에서 눌러 열어 보는 자리이고, 서버도 같은 줄을 준다.
     */
    .filter((key) => (only ? key === only : key <= currentKey))
    .sort()
    .reverse()) {
    const [year, month] = key.split('-').map(Number);
    const span = isCredit
      ? periodForClosingMonth(year, month, card.statementClosingDay!, card.paymentDueDay!)
      : {
          // 달력 월 표시자. 청구 주기 쪽과 같은 형태다 (그 달 1일 ~ 말일).
          periodStart: new Date(Date.UTC(year, month - 1, 1)),
          periodEnd: new Date(Date.UTC(year, month, 0)),
        };
    const periodStart = span.periodStart.toISOString();
    closingOf.set(periodStart, key);

    // 누적은 가장 오래된 줄부터 더하고, 보여 주는 차례는 그 반대다.
    let running = Dec.of(0);
    const filled = (byPeriod.get(key) ?? []).map((row) => {
      running = running.plus(Dec.of(row.amount).negated());
      return { ...row, periodStart, runningTotal: running.toString() };
    });
    filled.reverse();

    periods.push({
      periodStart,
      periodEnd: span.periodEnd.toISOString(),
      closed: span.periodEnd.getTime() < todayMarker,
      total: running.toString(),
    });
    rows.push(...filled);
  }

  /*
   * 커서는 "주기|줄키|날짜" 다(서버와 같다, 2026-10-16). 그 줄 다음부터 limit 만큼 준다.
   * 사라진 줄을 가리키면 그 날짜보다 오래된 줄부터 잇는다 -- 처음부터 주면 같은 줄이 두 번 서고, 빈 쪽을 주면
   * 남은 줄을 볼 수 없었다. 날짜가 없는 옛 커서는 빈 쪽이다.
   */
  const [cursorMonth = '', ...cursorParts] = params?.cursor ? params.cursor.split('|') : [];
  const cursorDate =
    cursorParts.length >= 2 && /^\d{4}-\d{2}-\d{2}T/.test(cursorParts[cursorParts.length - 1])
      ? cursorParts[cursorParts.length - 1]
      : null;
  const cursorKey = (cursorDate ? cursorParts.slice(0, -1) : cursorParts).join('|');
  let from = cursorKey ? rows.findIndex((row) => row.key === cursorKey) + 1 : 0;
  if (params?.cursor && !cursorKey) {
    /*
     * 줄키가 빈 "주기|" 는 서버가 "그 주기부터 더 오래된 줄이 있다" 고 준 자리다. 온라인으로 받은
     * 첫 쪽을 오프라인에서 이어 받을 때 온다. 그 주기와 그보다 오래된 주기의 첫 줄부터 잇는다.
     */
    const at = rows.findIndex((row) => (closingOf.get(row.periodStart) ?? '') <= cursorMonth);
    if (!/^\d{4}-\d{2}$/.test(cursorMonth) || at < 0) {
      return { ...head, periods: [], rows: [], nextCursor: null };
    }
    from = at;
  } else if (params?.cursor && from === 0) {
    const after = cursorDate ? rows.findIndex((row) => row.date < cursorDate) : -1;
    if (after < 0) return { ...head, periods: [], rows: [], nextCursor: null };
    from = after;
  }

  const page = rows.slice(from, from + limit);
  const shown = new Set(page.map((row) => row.periodStart));
  const last = page[page.length - 1];

  return {
    ...head,
    periods: periods.filter((period) => shown.has(period.periodStart)),
    rows: page,
    nextCursor:
      from + limit < rows.length && last
        ? `${closingOf.get(last.periodStart) ?? ''}|${last.key}|${last.date}`
        : null,
  };
}
