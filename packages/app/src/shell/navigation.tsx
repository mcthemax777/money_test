import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';
import { useEffect } from 'react';

/**
 * 어느 화면을 보고 있는지.
 *
 * 웹은 주소가 그 답이다(`/home`). 앱에도 같은 값을 두어 메뉴(core 의 navItemsOf)와
 * "지금 여기" 표시(isActiveNav)를 웹과 똑같이 쓴다. 주소 문자열을 그대로 쓰므로
 * 두 화면의 메뉴가 어긋날 일이 없다.
 */
interface Navigation {
  path: string;
  go: (path: string) => void;
  /** 하위 화면에서 돌아간다. 뒤로가기와 머리글의 ← 가 함께 쓴다. */
  back: () => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  /** 쌓인 화면. 마지막이 지금 보는 것이다. 웹의 히스토리와 같은 구실이다. */
  const [stack, setStack] = useState<string[]>(['/home']);
  const path = stack[stack.length - 1];

  const go = useCallback((next: string) => {
    setStack((prev) => {
      if (prev[prev.length - 1] === next) return prev;

      /*
       * 메뉴에 있는 화면은 쌓지 않고 갈아 끼운다.
       *
       * 하단 탭을 오갈 때마다 쌓으면 뒤로가기가 지나온 탭을 하나씩 되짚는다.
       * 하위 화면(설정 > 내 정보)만 위에 얹어 뒤로가기로 되돌아온다.
       */
      const isSubScreen = next.split('/').length > 2;
      return isSubScreen ? [...prev, next] : [next];
    });
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // 안드로이드의 뒤로가기. 쌓인 것이 있으면 앱을 나가지 않고 한 겹 벗긴다.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length <= 1) return false;
      back();
      return true;
    });

    return () => subscription.remove();
  }, [back, stack.length]);

  const value = useMemo(() => ({ path, go, back }), [path, go, back]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('NavigationProvider 안에서만 쓸 수 있습니다.');
  return value;
}
