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
import { useAssetTypeFilter } from '@money/core/store/asset-type-filter';

const PERSISTED = [useAuth, useProject, useLocaleStore, useUserFilter, useAssetTypeFilter];

export async function hydrateStores(): Promise<void> {
  setPersistStorage(AsyncStorage);

  // 저장소를 넣기 전에 만들어진 스토어들이라, 지금 한 번 읽어 와야 값이 붙는다.
  await Promise.all(PERSISTED.map((store) => store.persist.rehydrate()));
}
