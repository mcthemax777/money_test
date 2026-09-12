import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { useEffect } from 'react';

import { useTranslation } from '@money/core/lib/i18n';

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

/**
 * 화면 안에서 뒤로가기로 닫히는 것들. 마지막에 연 것이 먼저 닫힌다.
 *
 * 팝업은 여기 오지 않는다. RNModal 이 제 뒤로가기를 스스로 받는다(onRequestClose).
 * 여기 쌓이는 것은 화면을 갈아 끼우지 않고 한 걸음 들어간 자리다 -- 자산 상세,
 * 거래의 선택 모드, 다른 화면에서 건너온 거래 목록처럼 **머리글에 ← 가 서는 자리**다.
 */
const closers: Array<() => void> = [];

/**
 * 기기의 뒤로가기로 이 자리를 닫는다.
 *
 * `active` 인 동안에만 걸린다. 웹의 `useCloseOnBack` 과 같은 구실이고 이름도 같다 --
 * 두 화면이 같은 규칙으로 닫히도록 부르는 쪽의 코드를 같은 모양으로 둔다.
 */
export function useCloseOnBack(active: boolean, onClose: () => void) {
  /* 부르는 쪽이 그릴 때마다 새 함수를 넘기므로 ref 로 든다 (의존성에 넣으면 매번 다시 건다). */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const close = () => closeRef.current();
    closers.push(close);

    return () => {
      const at = closers.lastIndexOf(close);
      if (at >= 0) closers.splice(at, 1);
    };
  }, [active]);
}

/** 한 번 더 눌러야 나가는 시간. 그 사이에 다시 누르면 앱이 닫힌다. */
const EXIT_WINDOW_MS = 2000;

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  /** 이 시각 전에 다시 누르면 앱을 닫는다. 지나면 처음부터다. */
  const exitAtRef = useRef(0);
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

  /*
   * 안드로이드의 뒤로가기. 안쪽부터 한 겹씩 벗긴다.
   *
   *   1. 화면 안에서 열어 둔 자리 (자산 상세, 선택 모드, 건너온 목록) -- 머리글의 ←
   *      를 누른 것과 같게 동작한다.
   *   2. 쌓인 하위 화면 (보관함, 설정 > 내 정보) -- 한 겹 벗긴다.
   *   3. 뿌리 화면. 한 번 더 눌러야 나간다. 실수로 한 번 누른 것이 앱을 닫으면 적던
   *      거래가 사라지므로, 다른 앱들처럼 먼저 알리고 그 사이에 다시 누를 때만 닫는다.
   *      (false 를 돌려주면 안드로이드가 제 방식대로 화면을 닫는다.)
   *
   * 팝업은 여기 오지 않는다. 떠 있는 동안에는 RNModal 이 뒤로가기를 먼저 받아
   * onRequestClose 로 제 창을 닫는다.
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const close = closers[closers.length - 1];
      if (close) {
        close();
        return true;
      }

      if (stack.length > 1) {
        back();
        return true;
      }

      if (Date.now() < exitAtRef.current) return false;

      exitAtRef.current = Date.now() + EXIT_WINDOW_MS;
      if (Platform.OS === 'android') {
        ToastAndroid.show(t('shell.exitHint'), ToastAndroid.SHORT);
      }
      return true;
    });

    return () => subscription.remove();
  }, [back, stack.length, t]);

  const value = useMemo(() => ({ path, go, back }), [path, go, back]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('NavigationProvider 안에서만 쓸 수 있습니다.');
  return value;
}
