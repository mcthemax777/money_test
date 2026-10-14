/*
 * 화면 오른쪽 아래에 붙박여 있는 단추.
 *
 * 화면(TransactionsScreen 따위)이 이 단추를 제 자리에 그릴 수 없다. 앱은 화면 전체가
 * 하나의 스크롤이라(껍데기의 ScrollView) 화면이 그린 것은 무엇이든 함께 굴러간다.
 * 그래서 화면은 "이런 단추를 달아 달라"고 등록만 하고, 그리는 일은 굴러가지 않는
 * 껍데기가 맡는다 -- 바닥에 닿았다는 소식을 껍데기가 나르는 것과 같은 방식이다.
 *
 * 한 번에 하나만 선다. 겹쳐 서면 어느 것을 누르는지 알 수 없다.
 *
 * **등록은 쌓는다** (2026-10-15). 새 화면을 위에 덮을 때 아래 화면을 지우지 않고 숨겨 두므로
 * (보던 그대로 돌아오게) 두 화면이 함께 살아 있다. 나중에 올라온 화면의 단추가 서고, 그 화면이
 * 닫히면 아래 화면의 단추가 다시 선다. 하나만 기억하면 위 화면이 닫히며 아래 단추까지 지운다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

import { useScreenVisible } from './after-paint';

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

/** 쌓인 등록 하나. 단추가 없는 화면도 자리를 갖는다 (그 화면이 다시 단추를 걸 수 있다). */
type Slot = { id: number; action: FloatingAction | null };

interface SlotRegistry {
  /** 자리를 하나 얻는다. 먼저 얻은 것이 아래다. */
  open: () => number;
  update: (id: number, action: FloatingAction | null) => void;
  close: (id: number) => void;
}

const FloatingActionContext = createContext<FloatingAction | null>(null);
const SlotRegistryContext = createContext<SlotRegistry | null>(null);

let nextSlotId = 1;

export function FloatingActionProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slot[]>([]);

  const registry = useMemo<SlotRegistry>(
    () => ({
      open: () => {
        const id = nextSlotId++;
        setSlots((prev) => [...prev, { id, action: null }]);
        return id;
      },
      update: (id, action) =>
        setSlots((prev) => prev.map((slot) => (slot.id === id ? { id, action } : slot))),
      close: (id) => setSlots((prev) => prev.filter((slot) => slot.id !== id)),
    }),
    [],
  );

  /** 맨 위 화면부터 내려가며 단추를 건 첫 화면의 것. */
  const action = [...slots].reverse().find((slot) => slot.action)?.action ?? null;

  return (
    <SlotRegistryContext.Provider value={registry}>
      <FloatingActionContext.Provider value={action}>{children}</FloatingActionContext.Provider>
    </SlotRegistryContext.Provider>
  );
}

export function useFloatingAction(): FloatingAction | null {
  return useContext(FloatingActionContext);
}

export function useFloatingActionSlot(action: FloatingAction | null) {
  const registry = useContext(SlotRegistryContext);
  const onPressRef = useRef(action?.onPress);
  onPressRef.current = action?.onPress;
  const onPress = useCallback(() => onPressRef.current?.(), []);

  const label = action?.label;
  const icon = action?.icon;
  /* 숨은 탭 화면의 단추는 세우지 않는다 (after-paint 의 ScreenVisibleContext). */
  const visible = useScreenVisible();
  const isShown = visible && Boolean(label && action?.onPress);

  /** 이 화면의 자리. 화면이 사는 동안 하나다 -- 자리를 옮기면 겹 순서가 흐트러진다. */
  const slotRef = useRef<number | null>(null);
  useEffect(() => {
    if (!registry) return;
    const id = registry.open();
    slotRef.current = id;
    return () => {
      registry.close(id);
      slotRef.current = null;
    };
  }, [registry]);

  useEffect(() => {
    if (!registry || slotRef.current === null) return;
    registry.update(slotRef.current, isShown && label ? { label, onPress, icon } : null);
  }, [registry, isShown, label, icon, onPress]);
}
