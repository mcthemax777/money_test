import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MutableRefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * 화면 바닥에 닿았다는 소식.
 *
 * 앱은 화면 전체가 하나의 스크롤이라(껍데기의 ScrollView) 목록이 자기 스크롤을 갖지
 * 않는다. 그래서 "더 받아 올 때가 됐다"를 목록이 스스로 알 수 없다. 껍데기가 스크롤을
 * 지켜보다 바닥 가까이 오면 여기 등록된 것들을 부른다.
 *
 * 웹은 window 의 스크롤을 같은 방식으로 지켜본다(EntryFeed 참고).
 */
type Handler = () => void;

interface NearBottom {
  register: (handler: Handler) => () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/** 바닥에서 이만큼 남았을 때 미리 부른다. 다 닿은 뒤에 부르면 빈 자리가 한 번 보인다. */
const THRESHOLD = 240;

const NearBottomContext = createContext<NearBottom | null>(null);

export function NearBottomProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  /** 바닥 언저리에 머무는 동안 계속 부르지 않도록, 한 번 벗어났다 들어올 때만 부른다. */
  const wasNearBottom = useRef(false);

  const register = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const remaining = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const isNear = remaining <= THRESHOLD;

    if (isNear && !wasNearBottom.current) {
      handlers.current.forEach((handler) => handler());
    }
    wasNearBottom.current = isNear;
  }, []);

  const value = useMemo(() => ({ register, onScroll }), [register, onScroll]);

  return (
    <NearBottomContext.Provider value={value}>
      <ScrollLockProvider>{children}</ScrollLockProvider>
    </NearBottomContext.Provider>
  );
}

/**
 * 껍데기의 스크롤을 목록이 빌려 쓰는 자리.
 *
 * 화면 전체가 하나의 스크롤이라(`AppShell`) 목록이 제 스크롤을 갖지 않는다. 그래서
 * 끌어 옮기는 동안 필요한 두 가지를 목록이 스스로 할 수 없다.
 *
 *   - **손가락 스크롤을 멈춘다.** 함께 움직이면 줄이 손끝에서 달아난다.
 *   - **가장자리에 닿으면 대신 굴린다.** 맨 위의 줄을 맨 아래로 옮기려면 화면이 따라와야
 *     한다. 멈추기만 하고 굴려 주지 않으면 보이는 만큼밖에 못 옮긴다.
 */
interface ScrollControl {
  isLocked: boolean;
  setLocked: (locked: boolean) => void;
  /** 껍데기가 제 스크롤과 자리를 등록한다. */
  attach: (view: ScrollHandle | null, area: { top: number; height: number }) => void;
  /** 지금 얼마나 내려와 있는가. 끄는 줄의 자리를 계산하는 데 쓴다. */
  offset: MutableRefObject<number>;
  /** 화면에서 스크롤 영역이 차지하는 자리. 가장자리를 재는 기준이다. */
  area: MutableRefObject<{ top: number; height: number }>;
  /** 이만큼 더 굴린다. 끝에 닿으면 그 이상은 움직이지 않는다. */
  scrollBy: (dy: number) => void;
  /**
   * 맨 위로 올린다.
   *
   * 화면 안에서 보는 것이 통째로 바뀌는 자리(자산 목록 -> 고른 항목의 상세)가 쓴다.
   * 내려와 있던 자리에 그대로 두면 새로 그린 칸의 가운데부터 보인다.
   */
  scrollToTop: () => void;
}

/** `ScrollView` 에서 쓰는 것만 추린 모양. 시험에서 갈아 끼우기 쉽다. */
interface ScrollHandle {
  scrollTo: (options: { y: number; animated: boolean }) => void;
}

const ScrollControlContext = createContext<ScrollControl | null>(null);

function ScrollLockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setLocked] = useState(false);
  const view = useRef<ScrollHandle | null>(null);
  const offset = useRef(0);
  const area = useRef({ top: 0, height: 0 });

  const attach = useCallback((next: ScrollHandle | null, nextArea: { top: number; height: number }) => {
    view.current = next;
    area.current = nextArea;
  }, []);

  const scrollBy = useCallback((dy: number) => {
    if (!view.current) return;
    const next = Math.max(0, offset.current + dy);
    view.current.scrollTo({ y: next, animated: false });
  }, []);

  const scrollToTop = useCallback(() => {
    view.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const value = useMemo(
    () => ({ isLocked, setLocked, attach, offset, area, scrollBy, scrollToTop }),
    [attach, isLocked, scrollBy, scrollToTop],
  );

  return <ScrollControlContext.Provider value={value}>{children}</ScrollControlContext.Provider>;
}

/** 껍데기가 읽는다. 잠겨 있으면 손가락 스크롤을 끈다. */
export function useScrollLocked(): boolean {
  return useContext(ScrollControlContext)?.isLocked ?? false;
}

/**
 * 화면이 쓰는 "맨 위로".
 *
 * 껍데기가 스크롤을 들고 있어 화면은 제 스크롤을 갖지 않는다. 껍데기 밖(시험 등)에서
 * 부르면 아무 일도 하지 않는다.
 */
export function useScrollToTop(): () => void {
  const context = useContext(ScrollControlContext);
  return useCallback(() => context?.scrollToTop(), [context]);
}

/** 껍데기가 제 스크롤을 등록하고, 내려온 만큼을 알려 주는 손잡이. */
export function useScrollRegistration() {
  const context = useContext(ScrollControlContext);

  return {
    attach: context?.attach,
    noteOffset: useCallback(
      (y: number) => {
        if (context) context.offset.current = y;
      },
      [context],
    ),
  };
}

/** 목록이 쥐는 손잡이. 껍데기 밖(모달 등)에서는 아무 일도 하지 않는다. */
export function useScrollControl() {
  const context = useContext(ScrollControlContext);

  return useMemo(
    () => ({
      lock: (locked: boolean) => context?.setLocked(locked),
      scrollBy: (dy: number) => context?.scrollBy(dy),
      offsetOf: () => context?.offset.current ?? 0,
      areaOf: () => context?.area.current ?? { top: 0, height: 0 },
      /** 껍데기가 없으면 굴릴 것도 없다. */
      canScroll: Boolean(context),
    }),
    [context],
  );
}

/** 껍데기가 스크롤에 붙일 값. */
export function useNearBottomScroll() {
  return useContext(NearBottomContext)?.onScroll;
}

/** 바닥에 닿으면 부를 것을 등록한다. 화면을 떠나면 저절로 풀린다. */
export function useNearBottom(handler: Handler) {
  const context = useContext(NearBottomContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!context) return;
    // 늘 최신 handler 를 부른다. 등록을 다시 하면 그 사이 스크롤 사건을 놓친다.
    return context.register(() => latest.current());
  }, [context]);
}
