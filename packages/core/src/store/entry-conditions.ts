import { create } from 'zustand';
import { DEFAULT_ENTRY_PERIOD, type EntryPeriodUnit } from '@money/types';

import type { TransactionSearch } from '../hooks/useTransactions';

/** 값이나 앞 값을 받아 새 값을 내는 함수. React 의 setState 와 같은 모양이다. */
type Update<T> = T | ((prev: T) => T);

interface EntryConditionsStore {
  /** 이 검색을 건 가계부. 다른 가계부의 검색(분류·자산 id)은 쓰지 않는다. */
  projectId: string | null;
  /** null 이면 아무것도 걸지 않았다 (`EMPTY_SEARCH`). 세는 기준도 여기 든다. */
  search: TransactionSearch | null;
  unit: EntryPeriodUnit;
  setSearch: (projectId: string | null, update: Update<TransactionSearch>, empty: TransactionSearch) => void;
  setUnit: (unit: EntryPeriodUnit) => void;
}

/**
 * 거래 탭과 분석 탭이 함께 쓰는 조건 -- 검색, 묶는 단위, 세는 방식.
 *
 * 두 탭은 같은 거래를 목록과 그래프로 보는 자리라, 한쪽에서 건 조건이 다른 쪽에도 걸려 있어야
 * 한다(2026-10-07 사용자 요청). 훅 안에 두면 탭을 옮길 때 화면이 내려가며 사라진다.
 *
 * 탭 화면만 쓴다(`useTransactions` 의 shared). 분류·자산 상세에서 건너온 거래 화면이나 거래 탭
 * 안에 얹힌 분석은 제 조건을 따로 든다 -- 그 조건이 탭으로 새어 나오면 한참 뒤에 연 거래 탭에
 * 고른 적 없는 분류가 걸려 있다.
 *
 * 남기지 않는다(persist 없음). 앱을 다시 켜면 아무것도 걸지 않은 처음으로 돌아간다 -- 지금까지의
 * 거래 탭과 같다.
 */
export const useEntryConditions = create<EntryConditionsStore>()((set, get) => ({
  projectId: null,
  search: null,
  unit: DEFAULT_ENTRY_PERIOD,
  setSearch: (projectId, update, empty) => {
    const state = get();
    // 가계부가 바뀌었으면 앞 가계부의 검색이 아니라 빈 검색에서 고친다.
    const prev = state.projectId === projectId && state.search ? state.search : empty;
    set({ projectId, search: typeof update === 'function' ? update(prev) : update });
  },
  setUnit: (unit) => set({ unit }),
}));
