import { create } from 'zustand';

import type { TransactionSearch } from '../hooks/useTransactions';
import { useUserFilter } from './user-filter';

/**
 * 상세에서 거래 화면으로 건너갈 때 쓰는 쪽지.
 *
 * 분류·태그·자산(구성원·통장·카드) 상세의 "거래내역 보기"를 누르면 거래 화면이 그
 * 조건으로 걸린 채 열리고, 거기서 ←를 누르면 떠나온 상세가 다시 펴진다. 두 화면이
 * 서로를 모른 채로 이어지도록 사이에 이 쪽지를 둔다.
 *
 * **앱만 쓴다.** 앱은 화면을 통째로 갈아 끼우며 옮겨 다니므로 두 화면 사이에 값을
 * 놓아둘 자리가 필요하다. 웹은 분류 화면이 제 자리에서 거래 목록(TransactionsView)을
 * 그대로 그리므로 건널 일이 없고, 걸 검색과 돌아갈 자리를 props 로 넘긴다.
 *
 * 앱에서도 주소에 싣지 않는 것은 이동이 주소 문자열 하나뿐이기 때문이다. 물음표 뒤를
 * 붙이면 화면을 고르는 자리마다 그것을 벗겨 내야 한다.
 *
 * 남기지 않는다(persist 없음). 화면을 건너는 동안만 쓰는 값이라, 앱을 껐다 켠 뒤에
 * 되살아나면 가지도 않은 화면의 ←가 머리글에 서 있게 된다.
 */

/** 건너온 자리. 돌아갈 자리이기도 하다. */
export interface EntryFocusOrigin {
  kind: 'category' | 'tag' | 'person' | 'account' | 'card';
  id: string;
}

/**
 * 좁히기 전의 자산주인 선택.
 *
 * 구성원의 거래는 검색 조건으로 걸지 않는다. "이 사람의 거래"는 **돈이 오간 계좌의
 * 주인**이 그 사람인 거래이고(자산 상세의 최근 거래도 같은 기준이다), 그 조건을 가진
 * 것은 화면 위쪽의 자산주인 선택뿐이다. 검색 창의 사람 조건은 "거래를 낸 사람"이라
 * 남의 카드로 쓴 건에서 갈린다.
 *
 * 전역 선택을 건드리는 값이므로 떠나기 전 상태를 들고 있다가 거래 화면을 벗어날 때
 * 되돌린다 (웹은 그 화면이 제 자리에서 목록을 그리므로 돌아올 때 되돌린다).
 */
interface PersonScope {
  selectedPersonIds: string[];
  personFilterTouched: boolean;
}

interface EntryFocusStore {
  /**
   * 거래 화면이 열리면서 걸 검색과 돌아갈 자리.
   *
   * 거래 화면이 집어 들고 곧바로 비운다(`takeFocus`). 남겨 두면 그 화면을 떠났다가
   * 탭으로 다시 들어올 때 사용자가 그 사이에 고친 검색이 처음 것으로 되돌아간다.
   */
  focus: { origin: EntryFocusOrigin; search: TransactionSearch } | null;
  /**
   * 돌아간 화면이 다시 펼 상세.
   *
   * 거래 화면의 ←만 남긴다. 탭으로 그냥 떠난 것은 되돌아가는 길이 아니므로 남기지
   * 않는다 -- 남기면 한참 뒤에 분류 화면을 열었을 때 상세가 혼자 펴진다.
   */
  reopen: EntryFocusOrigin | null;

  /** 상세에서 거래 화면으로 건너간다. */
  focusEntries: (origin: EntryFocusOrigin, search: TransactionSearch) => void;
  /** 거래 화면이 쪽지를 집어 든다. 한 번 집으면 비운다. */
  takeFocus: () => void;
  /** 거래 화면의 ←. 돌아간 화면이 다시 펼 상세를 남긴다. */
  requestReopen: (origin: EntryFocusOrigin) => void;
  /** 상세를 펴고 나면 비운다. */
  clearReopen: () => void;

  /** 좁히기 전의 자산주인 선택. 되돌릴 것이 없으면 null 이다. */
  personScope: PersonScope | null;
  /**
   * 자산주인 선택을 한 사람으로 좁힌다. 그 전 상태를 여기 담아 둔다.
   *
   * "건드림" 표시를 함께 켠다. 켜지 않으면 거래 화면의 usePersonFilterSync 가 이
   * 선택을 "한 번도 고르지 않은 상태"로 보고 전체 선택으로 되돌린다.
   */
  narrowPersonScope: (personId: string) => void;
  /**
   * 좁혀 둔 선택을 되돌린다. 거래 화면을 벗어날 때 부른다.
   *
   * 거래 화면에서 사람을 바꿔 봤더라도 되돌린다 -- 그 화면은 거래 탭이 아니라 자산
   * 상세에서 한 걸음 들어온 자리다. 그 걸음이 화면 전체의 자산주인 설정을 바꿔 놓고
   * 끝나면, 돌아온 자산 목록이 들어가기 전과 달라져 있다.
   */
  restorePersonScope: () => void;
}

export const useEntryFocus = create<EntryFocusStore>()((set, get) => ({
  focus: null,
  reopen: null,
  personScope: null,

  focusEntries: (origin, search) => set({ focus: { origin, search }, reopen: null }),
  takeFocus: () => set({ focus: null }),
  requestReopen: (origin) => set({ reopen: origin }),
  clearReopen: () => set({ reopen: null }),

  narrowPersonScope: (personId) => {
    const filter = useUserFilter.getState();
    set({
      personScope: {
        selectedPersonIds: filter.selectedPersonIds,
        personFilterTouched: filter.personFilterTouched,
      },
    });
    filter.setPersonFilter([personId], true);
  },

  restorePersonScope: () => {
    const scope = get().personScope;
    if (!scope) return;

    set({ personScope: null });
    useUserFilter
      .getState()
      .setPersonFilter(scope.selectedPersonIds, scope.personFilterTouched);
  },
}));
