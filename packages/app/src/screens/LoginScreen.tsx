/*
 * 로그인. 웹의 /login 과 같은 배치다.
 *
 * 가운데에 앱 이름과 한 줄 소개, 구글 버튼, 그리고 계정이 없으면 자동으로 만든다는
 * 안내가 온다. 그 아래 접어 둔 것은 개발용이다. 직접 서명한 액세스 토큰을 붙여 넣는다.
 * 출시본에는 그 자리가 없다(__DEV__).
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { saveAuthTokens } from '@money/core/lib/auth-tokens';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import { API_URL } from '../api';

/** 안드로이드가 "이 앱을 모르겠다"고 할 때의 코드. 등록이 빠졌다는 뜻이다. */
const DEVELOPER_ERROR = '10';

export default function LoginScreen({ startupError }: { startupError?: string }) {
  const { t } = useTranslation();
  const { loadUser, signInWithGoogle, isLoading } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isDevOpen, setIsDevOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  const signInWithGoogleAccount = async () => {
    try {
      setIsSubmitting(true);
      setError('');

      // 플레이 서비스가 없으면 로그인 창 자체가 뜨지 않는다. 먼저 확인한다.
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      // 사용자가 창을 닫은 것은 오류가 아니다. 아무 말 없이 화면에 머무른다.
      if (isCancelledResponse(response)) return;

      if (!isSuccessResponse(response) || !response.data.idToken) {
        setError(t('google.noCredential'));
        return;
      }

      await signInWithGoogle(response.data.idToken);
    } catch (err) {
      setError(googleErrorMessage(err, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  const startWithToken = async () => {
    const token = accessToken.trim();
    if (!token) return;

    try {
      setIsSubmitting(true);
      setError('');
      /*
       * 갱신 토큰이 없으면 액세스 토큰을 그 자리에 함께 넣는다. core 의 갱신 경로는
       * 갱신 토큰이 있을 때만 도는데, 개발용 토큰에는 짝이 없는 경우가 많다.
       */
      saveAuthTokens(token, refreshToken.trim() || token);
      await loadUser();

      /*
       * loadUser 는 실패를 삼키고 "로그인 안 된 상태"로 정리한다. 앱은 이 화면에
       * 그대로 머무르므로 아무 일도 없었던 것처럼 보인다. 결과를 직접 보고 알려 준다.
       */
      if (!useAuth.getState().isAuthenticated) setError(t('login.failed'));
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerClassName="flex-1 items-center justify-center px-4"
    >
      <View className="w-full max-w-md gap-8">
        <View className="items-center">
          <Text className="text-3xl font-bold text-gray-900">bboyong</Text>
          <Text className="mt-2 text-sm text-gray-600">{t('login.tagline')}</Text>
        </View>

        {startupError ? (
          <Text className="text-xs text-amber-700">시작 중 오류: {startupError}</Text>
        ) : null}

        {error ? (
          <View className="rounded bg-red-50 p-3">
            <Text className="text-sm text-red-800">{error}</Text>
          </View>
        ) : null}

        <View className="gap-4">
          <Pressable
            onPress={signInWithGoogleAccount}
            disabled={isSubmitting}
            className="items-center rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700"
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-base font-semibold text-white">{t('login.google')}</Text>
            )}
          </Pressable>

          {isLoading ? (
            <Text className="text-center text-sm text-gray-600">{t('shell.signingIn')}</Text>
          ) : null}
        </View>

        <Text className="text-center text-xs text-gray-500">{t('login.autoSignup')}</Text>

        {__DEV__ ? (
          <View className="gap-3">
            <View className="rounded-lg bg-white p-3">
              <Text className="text-xs text-gray-500">서버</Text>
              <Text className="text-sm text-gray-800">{API_URL}</Text>
            </View>

            <Pressable onPress={() => setIsDevOpen(!isDevOpen)}>
              <Text className="text-sm text-gray-500">
                {isDevOpen ? '▾' : '▸'} 개발용 토큰으로 들어가기
              </Text>
            </Pressable>

            {isDevOpen ? (
              <View className="gap-3">
                <TextInput
                  value={accessToken}
                  onChangeText={setAccessToken}
                  placeholder="액세스 토큰"
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  className="min-h-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <TextInput
                  value={refreshToken}
                  onChangeText={setRefreshToken}
                  placeholder="갱신 토큰 (없으면 비워 둡니다)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  className="min-h-16 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <Pressable
                  onPress={startWithToken}
                  className="items-center rounded-lg border border-gray-300 bg-white px-4 py-3"
                >
                  <Text className="font-semibold text-gray-700">토큰으로 시작</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * 구글 로그인이 실패한 까닭.
 *
 * 서버가 거절한 경우가 먼저다. 구글은 토큰을 줬고 우리 서버가 받지 않은 것이라
 * 구글 쪽 코드로 읽으면 엉뚱한 곳을 보게 된다 (axios 오류에도 code 가 붙어 있다).
 *
 * DEVELOPER_ERROR 는 앱이 잘못 만들어졌다는 뜻이 아니라, 지금 앱의 패키지 이름과
 * 서명 지문으로 만든 안드로이드 클라이언트가 구글 콘솔에 없다는 뜻이다.
 */
function googleErrorMessage(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const response = (error as { response?: { status?: number; data?: any } })?.response;
  if (response) {
    const message = response.data?.error?.message ?? response.data?.message;
    return `${t('login.failed')} (${response.status}) ${message ?? ''}`.trim();
  }

  if (!isErrorWithCode(error)) return t('login.failed');

  switch (error.code) {
    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
      return t('google.noPlayServices');
    case DEVELOPER_ERROR:
      return t('google.appNotRegistered');
    default:
      return `${t('login.failed')} (${error.code})`;
  }
}
