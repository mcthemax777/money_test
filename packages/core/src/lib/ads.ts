/**
 * 광고를 띄울지와 전면광고의 횟수.
 *
 * 광고는 지금 보는 프로젝트(가계부)의 이용권을 따른다. 이용권이 무료일 때만 띄우고, 기간제나
 * 평생 이용권이 있으면 띄우지 않는다. 이용권이 프로젝트에 붙으므로 같은 사람이라도 유료
 * 가계부를 볼 때는 광고가 없다.
 *
 * 전면광고는 거래를 저장(등록·수정)할 때 세어 `INTERSTITIAL_EVERY` 번에 한 번 띄운다. 세는 일은 여기서 하고,
 * 실제로 띄우는 일은 플랫폼이 꽂는 `InterstitialPresenter` 가 한다. 꽂지 않은 플랫폼(웹)은
 * 세지도 않는다.
 */
import { planStatusAt } from '@money/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useProject, type Project } from '../store/project';
import { persistStorage } from './persist-storage';

/** 거래 저장 몇 번에 전면광고를 한 번 띄우는가. 10 에서 5 로 줄였다 (2026-10-09 사용자 요청). */
export const INTERSTITIAL_EVERY = 5;

/**
 * 이 프로젝트에 광고를 띄우는가.
 *
 * 이용권을 모르면(옛 서버, 받기 전에 저장해 둔 목록) 무료로 본다. 받아 둔 기간이 지났어도
 * 무료다(planStatusAt). 프로젝트가 없으면(시작 화면) 띄우지 않는다.
 */
export function projectShowsAds(project: Pick<Project, 'plan'> | null | undefined): boolean {
  if (!project) return false;
  return planStatusAt(project.plan).kind === 'free';
}

/** 지금 보는 프로젝트에 광고를 띄우는가. 배너가 쓴다. */
export function useShowAds(): boolean {
  return useProject((state) =>
    projectShowsAds(state.projects.find((project) => project.id === state.selectedProjectId)),
  );
}

/** 플랫폼이 꽂는 전면광고. */
export interface InterstitialPresenter {
  /** 지금 바로 띄울 광고를 받아 두었는가. */
  isReady(): boolean;
  /**
   * 띄운다. 광고가 **실제로 화면에 떴으면** true. 띄우라는 요청이 받아들여진 것만으로는 true 가
   * 아니다 -- 그렇게 세면 뜨지 않은 광고로 횟수가 0 이 되어 다음 광고가 그만큼 밀린다.
   */
  show(): Promise<boolean>;
}

let presenter: InterstitialPresenter | null = null;

/** 앱이 광고를 준비하면 꽂고, 광고를 그만 띄울 때 null 로 뺀다. */
export function setInterstitialPresenter(next: InterstitialPresenter | null): void {
  presenter = next;
}

interface AdCounterStore {
  /** 마지막 전면광고 뒤로 저장한 횟수. */
  savesSinceAd: number;
}

/**
 * 기기에 남긴다. 앱을 껐다 켰다고 처음부터 다시 세면 광고가 영영 안 뜰 수 있다.
 *
 * 앱은 저장소(AsyncStorage)를 이 스토어가 만들어진 뒤에 넣으므로, 앱의 persistence 가 이것을
 * 다시 읽어야(rehydrate) 남긴 값이 붙는다. 그 목록에서 빠지면 켤 때마다 0 에서 센다.
 */
export const useAdCounter = create<AdCounterStore>()(
  persist(() => ({ savesSinceAd: 0 }), {
    name: 'ad-counter',
    storage: createJSONStorage(() => persistStorage),
  }),
);

/**
 * 거래를 저장했다. 등록과 수정이 부른다(지우기는 세지 않는다).
 *
 * 정한 횟수가 되었는데 광고를 아직 받지 못했으면(끊겨 있다, 받는 중이다) 세는 값을 그대로
 * 두고 다음 저장에서 다시 본다. 0 으로 돌리면 그만큼의 저장이 광고 없이 지나간다.
 * 광고가 실제로 뜬 뒤에만 0 으로 돌린다.
 */
export function noteEntrySaved(): void {
  if (!presenter) return;

  const { projects, selectedProjectId } = useProject.getState();
  if (!projectShowsAds(projects.find((project) => project.id === selectedProjectId))) return;

  const count = useAdCounter.getState().savesSinceAd + 1;
  useAdCounter.setState({ savesSinceAd: count });
  if (count < INTERSTITIAL_EVERY || !presenter.isReady()) return;

  const current = presenter;
  void current.show().then((shown) => {
    if (shown) useAdCounter.setState({ savesSinceAd: 0 });
  });
}
