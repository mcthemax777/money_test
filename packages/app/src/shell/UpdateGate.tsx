/*
 * 업데이트 안내. 강제면 닫을 수 없는 창, 권유면 "나중에"가 있는 창을 띄운다.
 *
 * 정책은 켤 때와 다시 앞으로 올 때 읽는다(`checkAppUpdate`). 서버가 426 으로 거절해도
 * 강제 창이 뜬다(core 의 `installUpdateHandler`). **로그인 화면 위에도 뜬다** -- 로그인도
 * 서버를 부르므로 옛 판은 거기서 막힌다.
 *
 * 강제 창은 뒤로가기로도 닫히지 않는다. 닫히면 막힌 요청만 계속 실패하는 화면이 남는다.
 */
import { useEffect } from 'react';
import { AppState, Linking, Modal, Pressable, Text, View } from 'react-native';
import * as Application from 'expo-application';

import { useTranslation } from '@money/core/lib/i18n';
import { checkAppUpdate, useAppUpdate, useUpdateLevel } from '@money/core/store/app-update';

/** 정책에 주소가 없을 때. 플레이 스토어 앱으로, 없으면 웹으로 연다. */
function storeUrls(): string[] {
  const id = Application.applicationId ?? 'online.bboyong.app';
  return [`market://details?id=${id}`, `https://play.google.com/store/apps/details?id=${id}`];
}

async function openStore(policyUrl: string | null): Promise<void> {
  for (const url of policyUrl ? [policyUrl] : storeUrls()) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // 그 주소를 열 앱이 없다(스토어가 없는 기기). 다음 주소로.
    }
  }
}

export default function UpdateGate() {
  const { t } = useTranslation();
  const level = useUpdateLevel();
  const policy = useAppUpdate((state) => state.policy);
  const currentVersion = useAppUpdate((state) => state.currentVersion);
  const dismiss = useAppUpdate((state) => state.dismiss);

  // 켤 때 한 번, 그리고 다시 앞으로 올 때마다. 뒤에 둔 채 며칠 지나는 일이 흔하다.
  useEffect(() => {
    void checkAppUpdate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAppUpdate();
    });
    return () => subscription.remove();
  }, []);

  const isForce = level === 'force';

  return (
    <Modal
      visible={level !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      // 강제는 뒤로가기로 닫지 않는다. 권유는 "나중에"와 같다.
      onRequestClose={isForce ? () => {} : dismiss}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md rounded-2xl bg-white p-6">
          <Text className="text-lg font-semibold text-gray-900">
            {t(isForce ? 'update.forceTitle' : 'update.recommendTitle')}
          </Text>
          <Text className="mt-3 text-sm leading-5 text-gray-700">
            {t(isForce ? 'update.forceBody' : 'update.recommendBody')}
          </Text>
          {policy?.message ? (
            <Text className="mt-3 text-sm leading-5 text-gray-700">{policy.message}</Text>
          ) : null}
          {currentVersion ? (
            <Text className="mt-3 text-xs text-gray-500">
              {t('update.current', { version: currentVersion })}
            </Text>
          ) : null}

          <View className="mt-6 flex-row gap-2">
            {isForce ? null : (
              <Pressable
                onPress={dismiss}
                className="flex-1 items-center rounded-lg border border-gray-300 py-3 active:bg-gray-50"
              >
                <Text className="font-medium text-gray-700">{t('update.later')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => void openStore(policy?.storeUrl ?? null)}
              className="flex-1 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
            >
              <Text className="font-medium text-white">{t('update.now')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
