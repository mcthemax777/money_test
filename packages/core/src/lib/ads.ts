/**
 * 광고를 띄울지와 전면광고의 횟수.
 *
 * 광고는 지금 보는 프로젝트(가계부)의 이용권을 따른다. 이용권이 무료일 때만 띄우고, 기간제나
 * 평생 이용권이 있으면 띄우지 않는다. 이용권이 프로젝트에 붙으므로 같은 사람이라도 유료
 * 가계부를 볼 때는 광고가 없다.
 *
 * 전면광고는 거래를 저장(등록·수정)할 때 세어 10번에 한 번 띄운다. 세는 일은 여기서 하고,
 * 실제로 띄우는 일은 플랫폼이 꽂는 `InterstitialPresenter` 가 한다. 꽂지 않은 플랫폼(웹)은
 * 세지도 않는다.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useProject, type Project } from '../store/project';
import { persistStorage } from './persist-storage';

/** 거래 저장 몇 번에 전면광고를 한 번 띄우는가. */
export const INTERSTITIAL_EVERY = 10;

/**
 * 이 프로젝트에 광고를 띄우는가.
 *
 * 이용권을 모르면(옛 서버, 받기 전에 저장해 둔 목록) 무료로 본다. 프로젝트가 없으면(시작
 * 화면) 띄우지 않는다.
 */
export function projectShowsAds(project: Pick<Project, 'plan'> | null | undefined): boolean {
  if (!project) return false;
  return (project.plan?.kind ?? 'free') === 'free';
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
  /** 띄운다. 실제로 떴으면 true. */
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

/** 기기에 남긴다. 앱을 껐다 켰다고 처음부터 다시 세면 광고가 영영 안 뜰 수 있다. */
const useAdCounter = create<AdCounterStore>()(
  persist(() => ({ savesSinceAd: 0 }), {
    name: 'ad-counter',
    storage: createJSONStorage(() => persistStorage),
  }),
);

/**
 * 거래를 저장했다. 등록과 수정이 부른다(지우기는 세지 않는다).
 *
 * 열 번째가 되었는데 광고를 아직 받지 못했으면(끊겨 있다, 받는 중이다) 세는 값을 그대로
 * 두고 다음 저장에서 다시 본다. 0 으로 돌리면 그 열 번은 광고 없이 지나간다.
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
