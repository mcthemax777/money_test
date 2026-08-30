import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { apiClient } from '@money/core/lib/api-client';
import { useApiError } from '@money/core/lib/api-error';
import { activeLocaleTag, useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import PageHeader from '../components/PageHeader';
import { UserAvatar } from '../components/UserAvatar';

/** 내 정보. 웹의 /settings/profile 과 같은 배치다. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const { user, loadUser, logout } = useAuth();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const startEditing = () => {
    setNameInput(user?.name ?? '');
    setError('');
    setSavedMessage('');
    setIsEditingName(true);
  };

  const saveName = async () => {
    const name = nameInput.trim();

    if (!name) {
      setError(t('profile.nameRequired'));
      return;
    }

    if (name === user?.name) {
      setIsEditingName(false);
      return;
    }

    try {
      setIsSaving(true);
      await apiClient.updateProfile({ name });
      // 스토어의 사용자 정보를 서버 값으로 다시 맞춘다.
      await loadUser();
      setIsEditingName(false);
      setError('');
      setSavedMessage(t('profile.nameSaved'));
    } catch (err) {
      setError(messageOf(err, 'profile.nameSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * 로그아웃.
   *
   * 구글 쪽 세션도 함께 끊는다. 우리 토큰만 지우면 다음에 "구글로 로그인"을 눌렀을 때
   * 계정을 묻지 않고 같은 계정으로 들어가, 로그아웃이 안 된 것처럼 보인다.
   */
  const signOut = async () => {
    setIsLoggingOut(true);
    try {
      await GoogleSignin.signOut();
    } catch {
      // 구글로 로그인한 적이 없는 경우. 우리 로그아웃은 그대로 진행한다.
    } finally {
      await logout();
      setIsLoggingOut(false);
    }
  };

  return (
    <View className="gap-6">
      <PageHeader title={t('settings.profile.title')} showBack />

      {error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-red-600">{error}</Text>
        </View>
      ) : null}

      {savedMessage ? (
        <View className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <Text className="text-green-700">{savedMessage}</Text>
        </View>
      ) : null}

      <View className="rounded-lg bg-white p-6 shadow-sm">
        <View className="flex-row items-center gap-4 border-b border-gray-100 pb-6">
          <UserAvatar name={user?.name} avatar={user?.avatar} size="lg" />
          <View className="min-w-0 shrink">
            <Text numberOfLines={1} className="text-lg font-semibold text-gray-900">
              {user?.name}
            </Text>
            <Text numberOfLines={1} className="text-sm text-gray-600">
              {user?.email}
            </Text>
          </View>
        </View>

        <View className="border-b border-gray-100 py-4">
          <Text className="text-sm text-gray-600">{t('profile.name')}</Text>
          {isEditingName ? (
            <View className="mt-2 flex-row flex-wrap gap-2">
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                maxLength={50}
                autoFocus
                className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              />
              <Pressable
                onPress={saveName}
                disabled={isSaving}
                className={`rounded-lg bg-blue-600 px-4 py-2 ${isSaving ? 'opacity-50' : ''}`}
              >
                <Text className="text-white">{isSaving ? t('common.saving') : t('common.save')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setIsEditingName(false)}
                className="rounded-lg bg-gray-200 px-4 py-2"
              >
                <Text className="text-gray-700">{t('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-1 flex-row items-center gap-3">
              <Text className="text-lg font-medium text-gray-900">{user?.name}</Text>
              <Pressable onPress={startEditing}>
                <Text className="text-sm text-blue-600">{t('common.change')}</Text>
              </Pressable>
            </View>
          )}
          <Text className="mt-2 text-xs text-gray-500">{t('profile.nameHint')}</Text>
        </View>

        <View className="border-b border-gray-100 py-4">
          <Text className="text-sm text-gray-600">{t('profile.email')}</Text>
          <Text className="mt-1 text-lg font-medium text-gray-900">{user?.email}</Text>
          <Text className="mt-2 text-xs text-gray-500">{t('profile.emailHint')}</Text>
        </View>

        <View className="py-4">
          <Text className="text-sm text-gray-600">{t('profile.joinedAt')}</Text>
          <Text className="mt-1 text-lg font-medium text-gray-900">
            {user?.createdAt ? new Date(user.createdAt).toLocaleDateString(activeLocaleTag()) : '-'}
          </Text>
        </View>
      </View>

      <View className="rounded-lg bg-white p-6 shadow-sm">
        <Text className="text-lg font-semibold text-gray-900">{t('profile.logout')}</Text>
        <Text className="mt-1 text-sm text-gray-600">{t('profile.logoutHint')}</Text>
        <Pressable
          onPress={signOut}
          disabled={isLoggingOut}
          className={`mt-4 self-start rounded-lg bg-red-600 px-4 py-2 ${
            isLoggingOut ? 'opacity-50' : 'active:bg-red-700'
          }`}
        >
          <Text className="text-white">
            {isLoggingOut ? t('profile.loggingOut') : t('profile.logout')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
