/**
 * 전표 조립이 읽는 것을 기기 사본으로 채우는 창구.
 *
 * 조립 규칙은 `@money/types` 의 entry-build 가 갖고, 서버 쪽 짝은 api 의 prisma-lookup 이다.
 * 여기 남는 것은 "무엇을 읽을지"뿐이라 두 쪽이 같은 전표를 만든다.
 *
 * 사본에 없는 것은 null 로 돌려준다. 오프라인에서 아직 받지 못한 계좌를 가리키면 조립이
 * "계좌를 찾을 수 없습니다"로 거절하는데, 그 편이 맞다. 없는 계좌로 전표를 만들어 두면
 * 서버가 영구히 거절하는 명령이 큐에 남는다.
 */

import {
  Dec,
  type LedgerLookup,
  type LookupAccount,
  type LookupCard,
  type LookupCategory,
} from '@money/types';

import type { LocalStore } from './local-store';

/**
 * 환율이 사본에 없을 때 쓰는 값.
 *
 * 서버의 `exchange-rates.service` 가 가진 것과 같은 표다. 두 벌인 것이 마음에 걸리지만
 * 이 값은 서버가 변경 피드로 내보내지 않는 상수라(코드에 박혀 있다) 옮길 자리가 없다.
 * 환율 행이 하나라도 있으면 그것이 이긴다.
 */
const FALLBACK_RATES: Record<string, string> = {
  'USD:KRW': '1380',
  'JPY:KRW': '9.2',
  'USD:JPY': '150',
};

export function localLedgerLookup(store: LocalStore): LedgerLookup {
  return {
    async ledgerCurrency(projectId) {
      const project = await store.projectRow(projectId);
      return project?.ledgerCurrency ?? 'KRW';
    },

    async rate(projectId, from, to) {
      if (from === to) return Dec.of(1);

      const direct = await store.latestRate(projectId, from, to);
      if (direct) return Dec.of(direct);

      // 반대 방향만 담겨 있을 수 있다. 역수를 쓴다.
      const inverse = await store.latestRate(projectId, to, from);
      if (inverse && !Dec.of(inverse).isZero()) return Dec.of(1).dividedBy(inverse, 8);

      const fallback = FALLBACK_RATES[`${from}:${to}`];
      if (fallback) return Dec.of(fallback);

      const inverseFallback = FALLBACK_RATES[`${to}:${from}`];
      if (inverseFallback) return Dec.of(1).dividedBy(inverseFallback, 8);

      // 모르는 통화쌍이다. 1로 눙치지 않고 조립이 막게 둔다.
      throw new Error(`환율을 알 수 없습니다: ${from} -> ${to}`);
    },

    async account(projectId, accountId): Promise<LookupAccount | null> {
      const row = await store.accountById(projectId, accountId);
      return row && { id: row.id, projectId, type: row.type as LookupAccount['type'], currency: row.currency };
    },

    async card(projectId, cardId): Promise<LookupCard | null> {
      const row = await store.cardById(projectId, cardId);
      return (
        row && {
          id: row.id,
          projectId,
          cardType: row.cardType as LookupCard['cardType'],
          paymentAccountId: row.paymentAccountId,
          liabilityAccountId: row.liabilityAccountId,
        }
      );
    },

    cardIdForLiability: (projectId, accountId) => store.cardIdForLiability(projectId, accountId),

    async categories(projectId, ids): Promise<LookupCategory[]> {
      const rows = await store.categoriesByIds(projectId, ids);
      return rows.map((row) => ({
        id: row.id,
        projectId,
        name: row.name,
        type: row.type as LookupCategory['type'],
        defaultIsExtra: row.defaultIsExtra,
      }));
    },
  };
}
