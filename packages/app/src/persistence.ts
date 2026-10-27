/*
 * 스토어를 기기에 남긴다.
 *
 * core 의 스토어들은 zustand persist 를 쓰되 저장소는 밖에서 받는다
 * (core/lib/persist-storage). 기본값은 브라우저의 localStorage 라 앱에서는 비어
 * 있으므로, 여기서 AsyncStorage 를 넣고 한 번 다시 읽는다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setPersistStorage } from '@money/core/lib/persist-storage';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';
import { useLocaleStore } from '@money/core/store/locale';
import { useUserFilter } from '@money/core/store/user-filter';
import { useAssetExclusion } from '@money/core/store/asset-exclusion';
import { useHistoryGranularity } from '@money/core/store/history-granularity';
import { useLedgerBasis } from '@money/core/store/ledger-basis';
import { useLedgerKindFilter } from '@money/core/store/ledger-kind-filter';
import { useWeekStartStore } from '@money/core/store/week-start';
import { captureBoxStore } from '@money/core/data/capture-box';
import { useAppUpdate } from '@money/core/store/app-update';
import { useAdCounter } from '@money/core/lib/ads';
import { useAnalyticsPrefs } from '@money/core/lib/analytics';
import { useFilterTemplateStore } from '@money/core/store/filter-templates';
import { useAssetListView } from '@money/core/store/asset-list-view';
import { usePendingProfile } from '@money/core/store/pending-profile';
import { useInboxPrefs } from '@money/core/store/inbox-prefs';
import { useCats } from '@money/core/store/cats';

const PERSISTED = [
  useAuth,
  useProject,
  useLocaleStore,
  useUserFilter,
  useAssetExclusion,
  useHistoryGranularity,
  useWeekStartStore,
  useLedgerBasis,
  useLedgerKindFilter,
  // 이 기기에만 두는 캡처 후보 (서버에 없다).
  captureBoxStore,
  // "나중에"를 누른 권유 버전.
  useAppUpdate,
  // 전면광고까지 남은 거래 저장 횟수. 빠지면 앱을 켤 때마다 0 에서 센다.
  useAdCounter,
  // 사용 통계 끄기. 빠지면 앱을 켤 때마다 켬으로 돌아간다.
  useAnalyticsPrefs,
  /*
   * 아래 셋은 빠져 있었다 (2026-10-16). 다시 읽지 않으면 앱을 켤 때마다 빈 값으로 시작하고, 다음 저장이
   * 기기에 남은 옛 값을 덮는다 -- 저장해 둔 검색 템플릿, 자산 목록 보기, 오프라인에서 고친 이름이 사라졌다.
   */
  useFilterTemplateStore,
  useAssetListView,
  usePendingProfile,
  // 알림 원문 보내기 동의. 빠지면 켜 둔 사람도 다시 켤 때마다 끔으로 돌아간다.
  useInboxPrefs,
  // 받아 둔 고양이·알린 고양이·끊긴 동안 고른 것·보이기 설정. 빠지면 켤 때마다 모든 고양이를 새로 왔다고 알린다.
  useCats,
];

export async function hydrateStores(): Promise<void> {
  setPersistStorage(AsyncStorage);

  // 저장소를 넣기 전에 만들어진 스토어들이라, 지금 한 번 읽어 와야 값이 붙는다.
  await Promise.all(PERSISTED.map((store) => store.persist.rehydrate()));
}
