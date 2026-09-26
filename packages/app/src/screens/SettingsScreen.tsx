import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SUPPORTED_LOCALES, WEEK_START_DAYS, type Locale, type WeekStart } from '@money/types';

import { useApiError } from '@money/core/lib/api-error';
import { weekdayNames } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';
import { useWeekStartStore } from '@money/core/store/week-start';

import ExchangeRateSettings from '../components/ExchangeRateSettings';
import PageHeader from '../components/PageHeader';
import { useNavigation } from '../shell/navigation';

/** 언어 이름을 담은 열쇠. 사전이 세 언어 모두에서 같은 값(그 나라 말)을 갖는다. */
const NAME_KEY: Record<Locale, MessageKey> = {
  ko: 'language.ko',
  en: 'language.en',
  ja: 'language.ja',
};

/** 설정. 웹의 /settings 와 같은 배치다 (환율 칸은 아직 없다). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { go } = useNavigation();

  return (
    <View className="gap-6">
      <PageHeader title={t('settings.title')} />

      <View className="gap-6 md:flex-row">
        <SettingsCard
          title={t('settings.profile.title')}
          description={t('settings.profile.description')}
          onPress={() => go('/settings/profile')}
        />
        <SettingsCard
          title={t('settings.projects.title')}
          description={t('settings.projects.description')}
          onPress={() => go('/settings/projects')}
        />
        {/*
          분류와 태그는 한 번 짜 두고 오래 쓰는 것이라 아래 탭에서 내려 여기에 둔다.
        */}
        <SettingsCard
          title={t('settings.categories.title')}
          description={t('settings.categories.description')}
          onPress={() => go('/settings/categories')}
        />
        {/*
          오프라인에서 적었지만 아직 서버로 가지 못한 거래.
          대개는 조용히 나가므로 평소에는 빈 화면이고, 충돌과 거절만 여기 남는다.
        */}
        <SettingsCard
          title={t('settings.outbox.title')}
          description={t('settings.outbox.description')}
          onPress={() => go('/settings/outbox')}
        />
      </View>

      <View className="gap-4">
        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />

        {/* 시작 요일도 이 계정의 값이다. 달력과 주 단위 보기가 함께 본다. */}
        <WeekStartSettings />
      </View>
    </View>
  );
}

function SettingsCard({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-lg bg-white p-6 shadow-sm active:bg-gray-50"
    >
      <View className="flex-row items-center justify-between">
        <View className="shrink">
          <Text className="text-lg font-semibold text-gray-900">{title}</Text>
          <Text className="mt-1 text-sm text-gray-600">{description}</Text>
        </View>
        <Text className="text-2xl text-gray-400">→</Text>
      </View>
    </Pressable>
  );
}

/**
 * 화면 언어를 고르는 자리. 웹의 LanguageSettings 와 같다.
 *
 * 목록이 아니라 세 칸을 한 줄에 늘어놓는다. 셋뿐이라 접어 둘 까닭이 없고, 지금
 * 무엇으로 보고 있는지가 열지 않고도 보인다.
 */
function LanguageSettings() {
  const { t, locale } = useTranslation();
  const { setLocale, isSaving } = useLocaleStore();
  const { messageOf } = useApiError();
  const [error, setError] = useState('');

  return (
    <View className="rounded-lg bg-white p-6 shadow-sm">
      <Text className="text-lg font-semibold text-gray-900">{t('settings.language.title')}</Text>
      <Text className="mt-1 text-sm text-gray-600">{t('settings.language.description')}</Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {SUPPORTED_LOCALES.map((code: Locale) => {
          const selected = code === locale;

          return (
            <Pressable
              key={code}
              disabled={isSaving}
              onPress={() => {
                // 저장이 실패하면 스토어가 이전 언어로 되돌린다. 말없이 되돌아가면 눌러도
                // 안 되는 것으로 보이므로 이유를 적는다 (웹의 LanguageSettings 와 같다).
                setError('');
                setLocale(code).catch((err) =>
                  setError(messageOf(err, 'settings.language.saveFailed')),
                );
              }}
              /* 고른 칸 표시는 사이드바 메뉴·분류 목록과 같은 값을 쓴다. */
              className={`min-w-24 items-center rounded-lg border px-4 py-2 ${
                selected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
              } ${isSaving ? 'opacity-50' : ''}`}
            >
              <Text className={`text-sm ${selected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>
                {t(NAME_KEY[code])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text className="mt-3 text-sm text-red-600">{error}</Text> : null}
    </View>
  );
}

/**
 * 한 주를 어느 요일에서 시작할지 고르는 자리. 웹의 WeekStartSettings 와 같다.
 *
 * 요일 이름은 사전이 아니라 Intl 이 만든다 (`weekdayNames`). 일요일 차례로 받아
 * 번호를 그대로 자리로 쓴다 -- 0 이 일요일이다.
 */
function WeekStartSettings() {
  const { t } = useTranslation();
  const { weekStart, setWeekStart, isSaving } = useWeekStartStore();
  const { messageOf } = useApiError();
  const [error, setError] = useState('');
  // useTranslation 이 언어 스토어를 구독하므로, 언어를 바꾸면 이름도 다시 만들어진다.
  const names = weekdayNames();

  return (
    <View className="rounded-lg bg-white p-6 shadow-sm">
      <Text className="text-lg font-semibold text-gray-900">{t('settings.weekStart.title')}</Text>
      <Text className="mt-1 text-sm text-gray-600">{t('settings.weekStart.description')}</Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {WEEK_START_DAYS.map((day: WeekStart) => {
          const selected = day === weekStart;

          return (
            <Pressable
              key={day}
              disabled={isSaving}
              onPress={() => {
                // 저장이 실패하면 스토어가 이전 요일로 되돌린다. 이유는 아래에 적는다.
                setError('');
                setWeekStart(day).catch((err) =>
                  setError(messageOf(err, 'settings.weekStart.saveFailed')),
                );
              }}
              /* 고른 칸 표시는 언어 칸과 같은 값을 쓴다. */
              className={`min-w-14 items-center rounded-lg border px-4 py-2 ${
                selected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
              } ${isSaving ? 'opacity-50' : ''}`}
            >
              <Text className={`text-sm ${selected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>
                {names[day]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text className="mt-3 text-sm text-red-600">{error}</Text> : null}
    </View>
  );
}
