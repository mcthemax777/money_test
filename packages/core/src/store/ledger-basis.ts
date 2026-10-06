import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type EntryBasis, parseEntryBasis } from '@money/types';

import { persistStorage } from '../lib/persist-storage';

interface LedgerBasisStore {
  /** 가계 화면이 무엇을 "그 달에 쓴 돈"으로 세는가 */
  basis: EntryBasis;
  setBasis: (basis: EntryBasis) => void;
}

/**
 * 달마다 세는 기준 (예산 화면, `useLedgerData` 를 쓰는 거래 달력).
 *
 * 거래 목록은 이 값을 훅 안의 상태로 든다(`useTransactions`). 여기 두는 것은 여러 화면이
 * 같이 읽는 값이다 -- 한 곳에 두지 않으면 같은 값을 두 번 적게 되고, 화면마다 서로 다른
 * 기준으로 셀 틈이 생긴다. 가계 화면(웹 `/dashboard`)이 쓰던 것을 2026-10-06에 가계를 빼며 남겼다.
 *
 * 기본은 회차 기준이다. 할부를 산 달 하나에 몰아 두면 그 달만 혼자 튀고, 매달 빠져나가는
 * 돈은 어느 달에서도 보이지 않는다. 고른 값은 기기에 남는다 -- 더보기 안에 있어 바꿀
 * 때마다 다시 찾아 들어가야 하는 자리다.
 */
export const useLedgerBasis = create<LedgerBasisStore>()(
  persist(
    (set) => ({
      basis: 'installment',
      setBasis: (basis: EntryBasis) => set({ basis }),
    }),
    {
      name: 'ledger-basis-storage',
      storage: createJSONStorage(() => persistStorage),
      /*
       * 저장된 값이 아는 낱말이 아니면 발생 기준으로 읽는다 (서버의 `parseEntryBasis` 와
       * 같은 규칙). 그냥 실으면 두 단추 가운데 어느 쪽도 켜지지 않은 화면이 된다.
       * 저장된 것이 없으면 위의 기본값(회차 기준)이 그대로 남는다.
       */
      merge: (persisted, current) => {
        const saved = (persisted as { basis?: string } | undefined)?.basis;
        return { ...current, ...(saved ? { basis: parseEntryBasis(saved) } : {}) };
      },
    },
  ),
);
