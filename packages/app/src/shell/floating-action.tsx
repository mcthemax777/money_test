/*
 * 화면 오른쪽 아래에 붙박여 있는 단추.
 *
 * 화면(TransactionsScreen 따위)이 이 단추를 제 자리에 그릴 수 없다. 앱은 화면 전체가
 * 하나의 스크롤이라(껍데기의 ScrollView) 화면이 그린 것은 무엇이든 함께 굴러간다.
 * 그래서 화면은 "이런 단추를 달아 달라"고 등록만 하고, 그리는 일은 굴러가지 않는
 * 껍데기가 맡는다 -- 바닥에 닿았다는 소식을 껍데기가 나르는 것과 같은 방식이다.
 *
 * 한 번에 하나만 선다. 두 화면이 동시에 떠 있지 않으므로 목록으로 둘 까닭이 없고,
 * 겹쳐 서면 어느 것을 누르는지 알 수 없다.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** 단추에 실리는 것. 무엇을 하는 단추인지는 부르는 화면이 정한다. */
export interface FloatingAction {
  /** 읽어 주는 말. 단추에는 그림만 선다. */
  label: string;
  onPress: () => void;
}

interface FloatingActionSlot {
  action: FloatingAction | null;
  set: (action: FloatingAction | null) => void;
}

const FloatingActionContext = createContext<FloatingActionSlot | null>(null);

export function FloatingActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<FloatingAction | null>(null);
  const value = useMemo(() => ({ action, set: setAction }), [action]);

  return <FloatingActionContext.Provider value={value}>{children}</FloatingActionContext.Provider>;
}

/** 껍데기가 지금 그릴 단추. 없으면 null. */
export function useFloatingAction(): FloatingAction | null {
  return useContext(FloatingActionContext)?.action ?? null;
}

/**
 * 이 화면이 떠 있는 동안 단추를 세운다. `action` 이 null 이면 세우지 않는다.
 *
 * 화면을 떠날 때 거두는 일까지 여기서 한다 -- 거두지 않으면 다음 화면에 남의 단추가
 * 서고, 그것을 누르면 보이지 않는 화면의 팝업이 열린다.
 */
export function useFloatingActionSlot(action: FloatingAction | null) {
  const slot = useContext(FloatingActionContext);
  const { label, onPress } = action ?? {};

  useEffect(() => {
    if (!slot) return;

    slot.set(label && onPress ? { label, onPress } : null);
    return () => slot.set(null);
    // slot 은 값이 바뀔 때마다 새로 만들어지므로(action 을 담고 있다) 의존성에 넣지
    // 않는다. 넣으면 세우자마자 거두는 일이 끝없이 되풀이된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, onPress]);
}
