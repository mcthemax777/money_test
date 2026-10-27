/**
 * 고양이 엠블럼을 받는 때와 화면 아래에 세울지 (2026-10-28). 웹과 앱의 껍데기가 한 번씩 부른다.
 *
 * 받는 때: 가계부를 고를 때, 다시 닿을 때, 그리고 동기화 신호가 올 때(1.5초 모아서). 서버는 읽을 때 미션을
 * 판정하므로(`CatsService`) 구성원 누가 무엇을 바꿔도 그 신호로 판정이 돈다. 거래를 몰아서 적으면 신호가 잇따라
 * 오므로 모아서 한 번만 묻는다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CAT_BREEDS, CAT_PARADE_MAX, type CatBreedDef } from '@money/types';

import { onMirrorChanged } from '../data/mirror-events';
import { useShowAds } from '../lib/ads';
import { useApiError } from '../lib/api-error';
import { useTranslation } from '../lib/i18n';
import { useCats, useParade } from '../store/cats';
import { useConnectivity } from '../store/connectivity';

/** 신호를 모으는 시간. */
const SIGNAL_DEBOUNCE_MS = 1500;

export function useCatsSync(projectId: string | null): void {
  const refresh = useCats((state) => state.refresh);
  const isOffline = useConnectivity((state) => state.isOffline);

  useEffect(() => {
    if (projectId && !isOffline) void refresh(projectId);
  }, [projectId, isOffline, refresh]);

  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onMirrorChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(projectId), SIGNAL_DEBOUNCE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [projectId, refresh]);
}

/**
 * 화면 아래에 걷는 고양이들. 세우지 않으면 빈 목록이다.
 *
 * 광고가 있는 가계부에서는 세우지 않는다 (2026-10-28 사용자 결정 -- 고양이가 배너 뒤에 숨어 무료 이용자에게는
 * 보이지 않는다). 배너를 받지 못해 접힌 때에도 같다 -- 그때만 고양이가 나타나면 광고를 막으면 보이는 것이 된다.
 */
export function useVisibleParade(projectId: string | null): string[] {
  const parade = useParade(projectId);
  const showParade = useCats((state) => state.showParade);
  const showAds = useShowAds();
  return showParade && !showAds ? parade : [];
}

export interface CatBookEntry {
  breed: CatBreedDef;
  /** 얻은 시각(ISO). 얻지 않았으면 null. */
  grantedAt: string | null;
  inParade: boolean;
}

/**
 * 도감 화면. 웹과 앱이 같은 훅을 쓴다.
 *
 * 얻은 고양이를 누르면 데리고 다니기에 넣고 뺀다. 다 찼으면 넣지 않고 그 까닭을 적는다. 끊겨 있어도 고를 수 있다 --
 * 다시 닿으면 스토어가 보낸다.
 */
export function useCatBook(projectId: string | null) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const cats = useCats((state) => (projectId ? state.byProject[projectId] : undefined));
  const loadFailed = useCats((state) => state.loadFailed);
  const setParade = useCats((state) => state.setParade);
  const parade = useParade(projectId);
  const paradeKey = parade.join(',');
  const [error, setError] = useState('');

  const entries = useMemo<CatBookEntry[]>(() => {
    const granted = new Map((cats?.owned ?? []).map((cat) => [cat.breedId, cat.grantedAt]));
    const walking = new Set(paradeKey ? paradeKey.split(',') : []);
    return CAT_BREEDS.map((breed) => ({
      breed,
      grantedAt: granted.get(breed.id) ?? null,
      inParade: walking.has(breed.id),
    }));
  }, [cats, paradeKey]);

  const toggle = useCallback(
    (breedId: string) => {
      if (!projectId) return;
      const current = paradeKey ? paradeKey.split(',') : [];
      const next = current.includes(breedId)
        ? current.filter((id) => id !== breedId)
        : [...current, breedId];
      if (next.length > CAT_PARADE_MAX) {
        setError(t('cats.parade.full', { max: CAT_PARADE_MAX }));
        return;
      }
      setError('');
      setParade(projectId, next).catch((err) => setError(messageOf(err, 'cats.parade.saveFailed')));
    },
    [projectId, paradeKey, setParade, t, messageOf],
  );

  return {
    entries,
    ownedCount: cats?.owned.length ?? 0,
    paradeCount: parade.length,
    /** 한 번도 받지 못했고 받기가 실패했다. 받아 둔 것이 있으면 그것을 보여 준다. */
    loadFailed: !cats && loadFailed,
    isLoading: !cats && !loadFailed,
    error,
    toggle,
  };
}

/**
 * 새로 온 고양이 알림. 지금 보는 가계부의 것만 띄운다 -- 다른 가계부의 고양이는 그 가계부를 열 때 알린다.
 */
export function useCatArrivals(projectId: string | null) {
  const arrivals = useCats((state) => state.arrivals);
  const dismiss = useCats((state) => state.dismissArrivals);
  const setParade = useCats((state) => state.setParade);
  const parade = useParade(projectId);
  const breedIds = arrivals && arrivals.projectId === projectId ? arrivals.breedIds : [];

  /** 한 마리가 왔을 때 "데리고 다니기". 다 찼으면 넣지 않는다(부르는 쪽이 단추를 감춘다). */
  const bring = useCallback(
    (breedId: string) => {
      if (!projectId || parade.includes(breedId) || parade.length >= CAT_PARADE_MAX) return;
      // 실패하면 도감에서 다시 고를 수 있다. 알림 창은 닫는다.
      void setParade(projectId, [...parade, breedId]).catch(() => {});
    },
    [projectId, parade, setParade],
  );

  return {
    breedIds,
    canBring: (breedId: string) => !parade.includes(breedId) && parade.length < CAT_PARADE_MAX,
    bring,
    dismiss,
  };
}
