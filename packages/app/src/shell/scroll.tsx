import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
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

  return <NearBottomContext.Provider value={value}>{children}</NearBottomContext.Provider>;
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
