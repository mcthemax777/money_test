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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

/** 단추에 실리는 것. 무엇을 하는 단추인지는 부르는 화면이 정한다. */
export interface FloatingAction {
  /** 읽어 주는 말. 단추에는 그림만 선다. */
  label: string;
  onPress: () => void;
  /**
   * 단추의 그림. 비우면 더하기(+)다.
   *
   * 같은 자리에 서는 단추라도 화면마다 만드는 것이 다르다 (거래 추가와 자산 추가).
   * 그림까지 같으면 무엇을 만드는 단추인지 눌러 봐야 안다.
   */
  icon?: ComponentType;
}

/*
 * 그릴 단추와 세우는 함수를 다른 컨텍스트에 둔다.
 *
 * 하나에 담으면 단추를 세우는 화면도 단추 값을 구독하게 된다. 세울 때마다 그 화면이
 * 다시 그려지고, 다시 그려지며 새로 만든 `onPress` 로 또 세우는 고리가 생긴다 -- 거래
 * 화면이 그렇게 초당 백 번 넘게 다시 그려져 JS 가 내내 100% 였다. 세우는 함수는
 * useState 의 것이라 바뀌지 않으므로, 이쪽만 구독하는 화면은 단추가 바뀌어도 그대로다.
 */
const FloatingActionContext = createContext<FloatingAction | null>(null);
const FloatingActionSetterContext = createContext<Dispatch<
  SetStateAction<FloatingAction | null>
> | null>(null);

export function FloatingActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<FloatingAction | null>(null);

  return (
    <FloatingActionSetterContext.Provider value={setAction}>
      <FloatingActionContext.Provider value={action}>{children}</FloatingActionContext.Provider>
    </FloatingActionSetterContext.Provider>
  );
}

/** 껍데기가 지금 그릴 단추. 없으면 null. */
export function useFloatingAction(): FloatingAction | null {
  return useContext(FloatingActionContext);
}

/**
 * 이 화면이 떠 있는 동안 단추를 세운다. `action` 이 null 이면 세우지 않는다.
 *
 * 화면을 떠날 때 거두는 일까지 여기서 한다 -- 거두지 않으면 다음 화면에 남의 단추가
 * 서고, 그것을 누르면 보이지 않는 화면의 팝업이 열린다.
 *
 * `onPress` 는 매번 새 함수여도 된다. 누를 때 가장 최근 것을 부르고, 그것이 바뀌었다고
 * 단추를 다시 세우지는 않는다 -- 다시 세우는 것은 이름·그림이 바뀌거나 단추가
 * 생기고 사라질 때뿐이다.
 */
export function useFloatingActionSlot(action: FloatingAction | null) {
  const setAction = useContext(FloatingActionSetterContext);
  const onPressRef = useRef(action?.onPress);
  onPressRef.current = action?.onPress;
  const onPress = useCallback(() => onPressRef.current?.(), []);

  const label = action?.label;
  const icon = action?.icon;
  const isShown = Boolean(label && action?.onPress);

  useEffect(() => {
    if (!setAction) return;

    setAction(isShown && label ? { label, onPress, icon } : null);
    return () => setAction(null);
  }, [setAction, isShown, label, icon, onPress]);
}
