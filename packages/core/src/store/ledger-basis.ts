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
 * 가계 화면의 세는 기준.
 *
 * 거래 화면은 이 값을 훅 안의 상태로 들지만(`useTransactions`), 가계는 웹과 앱이 서로
 * 다른 자리에서 데이터를 받는다 -- 웹은 `/dashboard` 가 직접, 앱은 `useLedgerData` 가
 * 받는다. 한 곳에 두지 않으면 같은 값을 두 번 적게 되고, 화면과 그 아래 탭이 서로 다른
 * 기준으로 셀 틈이 생긴다.
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
