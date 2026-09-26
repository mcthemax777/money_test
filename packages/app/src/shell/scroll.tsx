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
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

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
  /** 껍데기가 스크롤 영역의 높이를 알려 준다(`onLayout`). */
  noteViewport: (height: number) => void;
  /** 껍데기가 내용 길이가 바뀔 때마다 알려 준다(`onContentSizeChange`). */
  noteContent: (height: number) => void;
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

  /** 마지막으로 안 자리·영역·내용의 길이. 스크롤 없이 길이만 바뀔 때 다시 잰다. */
  const size = useRef({ offset: 0, viewport: 0, content: 0 });

  /**
   * 바닥 가까이인지 잰다.
   *
   * 스크롤할 때는 **들어올 때만** 부른다(바닥 언저리에서 굴리는 동안 거듭 부르지 않게).
   * 길이가 바뀔 때는 **여전히 가까우면 또 부른다.** 내용이 화면을 다 채우지 못하면
   * 스크롤이 생기지 않아 굴려서 들어올 수가 없다 -- 한 번 부르고 말면 더 이을 것이 있어도
   * 거기서 멈춘다. 이어 붙인 것이 화면을 넘기면 바닥에서 멀어져 저절로 그친다.
   */
  const check = useCallback((fromSizeChange: boolean) => {
    const { offset, viewport, content } = size.current;
    // 아직 재지 못했다. 0 으로 재면 빈 화면을 "바닥"으로 읽는다.
    if (viewport <= 0 || content <= 0) return;

    const isNear = content - offset - viewport <= THRESHOLD;
    if (isNear && (fromSizeChange || !wasNearBottom.current)) {
      handlers.current.forEach((handler) => handler());
    }
    wasNearBottom.current = isNear;
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      size.current = {
        offset: contentOffset.y,
        viewport: layoutMeasurement.height,
        content: contentSize.height,
      };
      check(false);
    },
    [check],
  );

  const noteViewport = useCallback(
    (height: number) => {
      size.current = { ...size.current, viewport: height };
      check(true);
    },
    [check],
  );

  const noteContent = useCallback(
    (height: number) => {
      size.current = { ...size.current, content: height };
      check(true);
    },
    [check],
  );

  const value = useMemo(
    () => ({ register, onScroll, noteViewport, noteContent }),
    [register, onScroll, noteViewport, noteContent],
  );

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
  /**
   * 같은 값을 UI 실에서도 읽을 수 있게 둔 사본.
   *
   * 붙박이 머리글(`RevealTop`, `StickySection`)은 굴러간 만큼을 프레임마다 읽어 제자리에
   * 남는다. ref 는 UI 실의 worklet 에서 읽을 수 없어 공유값이 따로 있어야 한다.
   */
  scrollY: SharedValue<number>;
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
  /**
   * 보던 자리로 되돌린다.
   *
   * 상세를 접고 목록으로 나오는 길에 쓴다. 되돌릴 때는 아직 목록이 그려지기 전이라
   * 내용이 짧아 그 자리까지 갈 수 없다. 그래서 목표만 적어 두었다가 내용이 그만큼
   * 길어지는 순간에 굴린다.
   */
  restoreTo: (y: number) => void;
  /** 껍데기가 내용 길이가 바뀔 때마다 알려 준다. 기다리던 되돌리기가 여기서 이뤄진다. */
  noteContentHeight: (height: number) => void;
  /** 기다리던 되돌리기를 그만둔다. 사람이 손으로 굴리기 시작하면 껍데기가 부른다. */
  cancelRestore: () => void;
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
  const scrollY = useSharedValue(0);
  const area = useRef({ top: 0, height: 0 });

  const attach = useCallback((next: ScrollHandle | null, nextArea: { top: number; height: number }) => {
    view.current = next;
    area.current = nextArea;
  }, []);

  /** 지금 내용의 길이. 되돌릴 자리까지 갈 수 있는지 재는 데 쓴다. */
  const contentHeight = useRef(0);
  /** 되돌아갈 자리. 아직 내용이 짧아 가지 못했으면 들고 기다린다. */
  const pendingRestore = useRef<number | null>(null);

  const cancelRestore = useCallback(() => {
    pendingRestore.current = null;
  }, []);

  /**
   * 기다리던 되돌리기를 해 본다.
   *
   * 내용이 그 자리까지 길어지지 않았으면 아무것도 하지 않는다 -- 그대로 굴리면 끝에
   * 걸려 어중간한 데 서고, 뒤이어 목록이 다 그려져도 그 자리가 되지 않는다.
   */
  const applyRestore = useCallback(() => {
    const target = pendingRestore.current;
    if (target === null || !view.current) return;
    if (contentHeight.current - area.current.height < target) return;

    pendingRestore.current = null;
    view.current.scrollTo({ y: target, animated: false });
  }, []);

  const scrollBy = useCallback(
    (dy: number) => {
      if (!view.current) return;
      cancelRestore();
      const next = Math.max(0, offset.current + dy);
      view.current.scrollTo({ y: next, animated: false });
    },
    [cancelRestore],
  );

  const scrollToTop = useCallback(() => {
    cancelRestore();
    view.current?.scrollTo({ y: 0, animated: true });
  }, [cancelRestore]);

  const restoreTo = useCallback(
    (y: number) => {
      /* 맨 위였으면 되돌릴 것이 없다. 이미 거기서 시작한다. */
      if (y <= 0) {
        cancelRestore();
        return;
      }
      pendingRestore.current = y;
      applyRestore();
    },
    [applyRestore, cancelRestore],
  );

  const noteContentHeight = useCallback(
    (height: number) => {
      contentHeight.current = height;
      applyRestore();
    },
    [applyRestore],
  );

  const value = useMemo(
    () => ({
      isLocked,
      setLocked,
      attach,
      offset,
      scrollY,
      area,
      scrollBy,
      scrollToTop,
      restoreTo,
      noteContentHeight,
      cancelRestore,
    }),
    [
      attach,
      cancelRestore,
      isLocked,
      noteContentHeight,
      restoreTo,
      scrollBy,
      scrollToTop,
      scrollY,
    ],
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

/**
 * 화면이 쓰는 "보던 자리로".
 *
 * 상세를 펼치기 전 자리를 적어 두었다가(`offsetOf`) 접고 나올 때 그리로 되돌린다
 * (`restoreTo`). 껍데기 밖(시험 등)에서는 0 을 주고 아무 일도 하지 않는다.
 */
export function useScrollRestore(): {
  offsetOf: () => number;
  restoreTo: (y: number) => void;
} {
  const context = useContext(ScrollControlContext);

  return useMemo(
    () => ({
      offsetOf: () => context?.offset.current ?? 0,
      restoreTo: (y: number) => context?.restoreTo(y),
    }),
    [context],
  );
}

/** 껍데기가 제 스크롤을 등록하고, 내려온 만큼을 알려 주는 손잡이. */
export function useScrollRegistration() {
  const context = useContext(ScrollControlContext);

  return {
    attach: context?.attach,
    noteContentHeight: context?.noteContentHeight,
    cancelRestore: context?.cancelRestore,
    /*
     * 붙박이 머리글이 읽는 공유값. 껍데기가 UI 실에서 스크롤 사건을 받아 직접 적는다
     * (`useScrollOffset`).
     *
     * 여기(`noteOffset`)서 적지 않는다. 이 길은 JS 실을 거쳐 한두 프레임 늦게 오는데,
     * 그 값으로 머리글을 옮기면 내용이 먼저 굴러간 뒤에 머리글이 뒤따라 돌아와 --
     * 년월 줄이 스크롤을 따라가려다 제자리로 튀는 것처럼 떨린다.
     */
    scrollY: context?.scrollY,
    noteOffset: useCallback(
      (y: number) => {
        if (!context) return;
        context.offset.current = y;
      },
      [context],
    ),
  };
}

/**
 * 붙박이 머리글이 읽는 스크롤 자리.
 *
 * 껍데기 밖(모달·시험)에서는 늘 0 인 제 값을 쥔다 -- 굴러가지 않으니 머리글도 붙을
 * 일이 없고, 부르는 쪽이 껍데기가 있는지 따지지 않아도 된다.
 */
export function useScrollY(): SharedValue<number> {
  const context = useContext(ScrollControlContext);
  const alone = useSharedValue(0);
  return context?.scrollY ?? alone;
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
  const context = useContext(NearBottomContext);
  return {
    onScroll: context?.onScroll,
    noteViewport: context?.noteViewport,
    noteContent: context?.noteContent,
  };
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
