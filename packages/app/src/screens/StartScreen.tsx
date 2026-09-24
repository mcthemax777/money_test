/*
 * 가계부가 하나도 없는 사람의 첫 화면. 웹의 `/start` 와 같은 자리다.
 *
 * 첫 로그인 때 서버가 가계부를 만들어 주지 않는다(`auth.service`). 남의 가계부에
 * 들어오려고 가입한 사람에게 빈 가계부가 하나 생기는 것을 막으려는 것이고, 그 대신
 * 여기서 **만들지 들어갈지를 사람이 고른다.**
 *
 * 껍데기(AppShell)를 쓰지 않는다. 사이드바와 아래 탭은 가계부 하나를 고른 상태를
 * 전제로 그려져, 이 자리에서는 어느 칸을 눌러도 빈 화면이 나온다.
 *
 * **QR 은 여기서 찍는다.** 웹에는 없는 길이다 -- 초대를 보여 주는 쪽은 대개 큰 화면이고
 * 찍는 쪽은 폰이라, 카메라가 있는 이쪽에만 두면 된다. 번호를 손으로 치는 길은 양쪽에
 * 모두 있다.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProjectStart } from '@money/core/hooks/useProjectStart';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

const INPUT = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';

export default function StartScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const start = useProjectStart();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const invite = start.invite;
  const canJoin = invite !== null && (invite.isMember || invite.status === 'pending');

  const create = async () => {
    setError('');
    const result = await start.create(name);
    if (!result.ok) setError(result.message);
    // 성공하면 App 이 껍데기로 갈아 끼운다 (가계부가 생겼으므로).
  };

  const check = async (value: string) => {
    setError('');
    const result = await start.preview(value);
    if (!result.ok) setError(result.message || t('start.codeInvalid'));
  };

  const join = async () => {
    setError('');
    const result = await start.join();
    if (!result.ok) setError(result.message);
  };

  /*
   * 카메라를 연 동안의 뒤로가기는 그 카메라를 닫는다.
   *
   * 이 화면은 껍데기 밖에 있어 `useCloseOnBack`(navigation.tsx)이 닿지 않는다 -- 그쪽의
   * 뒤로가기 처리는 NavigationProvider 안에서만 걸린다. 걸어 두지 않으면 카메라에서
   * 누른 뒤로가기가 앱을 닫는다.
   */
  useEffect(() => {
    if (!isScanning) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setIsScanning(false);
      return true;
    });
    return () => subscription.remove();
  }, [isScanning]);

  const openScanner = async () => {
    setError('');
    /*
     * 권한을 여기서 묻는다. 화면을 열자마자 묻지 않는 것은, 번호를 칠 사람에게는
     * 카메라가 필요 없기 때문이다 -- 쓰겠다고 누른 자리에서 묻는 편이 무엇에 쓰는지
     * 분명하다.
     */
    if (!permission?.granted) {
      const asked = await requestPermission();
      if (!asked.granted) {
        setError(t('start.scanPermission'));
        return;
      }
    }
    setIsScanning(true);
  };

  /*
   * 찍은 QR. 한 번만 받는다.
   *
   * 카메라는 같은 QR 을 프레임마다 읽어 준다. 그대로 두면 확인 조회가 초당 수십 번
   * 나가므로, 첫 한 번에 카메라를 닫고 그 값으로만 확인한다.
   */
  const onScanned = (scanned: string) => {
    if (!isScanning) return;
    setIsScanning(false);
    setCode(scanned);
    void check(scanned);
  };

  if (isScanning) {
    return (
      <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(event) => onScanned(event.data)}
        />
        <View className="gap-3 px-4 pb-8 pt-4" style={{ paddingBottom: insets.bottom + 24 }}>
          <Text className="text-center text-sm text-white">{t('start.scanHint')}</Text>
          <Pressable
            onPress={() => setIsScanning(false)}
            className="items-center rounded-lg border border-white/40 px-4 py-3 active:bg-white/10"
          >
            <Text className="text-base font-medium text-white">{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerClassName="mx-auto w-full max-w-md gap-6 px-4 py-10"
      contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }}
    >
      <View className="items-center">
        <Text className="text-2xl font-bold text-gray-900">{t('start.title')}</Text>
        <Text className="mt-2 text-center text-sm text-gray-600">{t('start.hint')}</Text>
      </View>

      {error ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{error}</Text>
        </View>
      ) : null}

      {/*
        들어갈 곳을 찾았으면 그것만 보여 준다. 무엇에 들어가는지 한 번 확인시키는
        자리라, 옆에 다른 칸이 함께 있으면 눈이 갈린다.
      */}
      {invite ? (
        <View className="gap-4 rounded-xl border border-blue-200 bg-white p-5">
          <View>
            <Text className="text-lg font-semibold text-gray-900">{invite.projectName}</Text>
            <Text className="mt-1 text-sm text-gray-600">
              {invite.ownerName ? `${t('start.inviteOf', { name: invite.ownerName })} · ` : ''}
              {t('start.inviteMembers', { count: invite.memberCount })}
            </Text>
          </View>

          {invite.isMember ? (
            <Text className="text-sm text-gray-600">{t('start.alreadyMember')}</Text>
          ) : invite.status !== 'pending' ? (
            <Text className="text-sm text-red-700">{t('start.inviteUnusable')}</Text>
          ) : null}

          <Pressable
            onPress={join}
            disabled={!canJoin || start.isBusy}
            className={`items-center rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700 ${
              !canJoin || start.isBusy ? 'opacity-50' : ''
            }`}
          >
            <Text className="text-base font-medium text-white">
              {t(start.isBusy ? 'start.joining' : 'start.joinSubmit')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              start.clearInvite();
              setCode('');
              setError('');
            }}
            className="items-center rounded-lg border border-gray-300 px-4 py-3 active:bg-gray-50"
          >
            <Text className="text-base text-gray-700">{t('start.joinOther')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View className="gap-3 rounded-xl border border-gray-200 bg-white p-5">
            <View>
              <Text className="text-lg font-semibold text-gray-900">{t('start.createTitle')}</Text>
              <Text className="mt-1 text-sm text-gray-600">{t('start.createHint')}</Text>
            </View>

            <View>
              <Text className="mb-1 text-sm font-medium text-gray-700">{t('start.nameLabel')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('start.namePlaceholder')}
                placeholderTextColor="#9ca3af"
                className={INPUT}
              />
            </View>

            <Pressable
              onPress={create}
              disabled={!name.trim() || start.isBusy}
              className={`items-center rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700 ${
                !name.trim() || start.isBusy ? 'opacity-50' : ''
              }`}
            >
              <Text className="text-base font-medium text-white">
                {t(start.isBusy ? 'start.creating' : 'start.createSubmit')}
              </Text>
            </Pressable>
          </View>

          <View className="gap-3 rounded-xl border border-gray-200 bg-white p-5">
            <View>
              <Text className="text-lg font-semibold text-gray-900">{t('start.joinTitle')}</Text>
              <Text className="mt-1 text-sm text-gray-600">{t('start.joinHint')}</Text>
            </View>

            <Pressable
              onPress={openScanner}
              className="items-center rounded-lg bg-gray-900 px-4 py-3 active:bg-gray-800"
            >
              <Text className="text-base font-medium text-white">{t('start.scan')}</Text>
            </Pressable>

            <View>
              <Text className="mb-1 text-sm font-medium text-gray-700">{t('start.codeLabel')}</Text>
              <TextInput
                value={code}
                /*
                  사람이 치는 번호라 대문자로 올려 보여 준다. 서버도 그렇게 찾는다
                  (`normalizeInvitationCode`). 붙여 넣은 링크는 그대로 두어야 하므로
                  주소처럼 생겼으면 손대지 않는다.
                */
                onChangeText={(value) =>
                  setCode(/[/:?]/.test(value) ? value : value.toUpperCase())
                }
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABCD2345"
                placeholderTextColor="#9ca3af"
                className={`${INPUT} tracking-widest`}
              />
            </View>

            <Pressable
              onPress={() => void check(code)}
              disabled={!code.trim() || start.isBusy}
              className={`items-center rounded-lg border border-blue-600 px-4 py-3 active:bg-blue-50 ${
                !code.trim() || start.isBusy ? 'opacity-50' : ''
              }`}
            >
              {start.isBusy ? (
                <ActivityIndicator color="#2563eb" />
              ) : (
                <Text className="text-base font-medium text-blue-700">{t('start.codeSubmit')}</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      {/*
        가계부가 없는 사람에게는 이 화면이 전부다. 계정을 바꾸려면 여기서 나갈 수 있어야 한다.
      */}
      <Pressable onPress={() => void logout()} className="items-center py-2">
        <Text className="text-sm text-gray-500">{t('profile.logout')}</Text>
      </Pressable>
    </ScrollView>
  );
}
